import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { secureHeaders } from "hono/secure-headers";
import type { ServerType } from "@hono/node-server";
import type { Context } from "hono";
import type { AppConfig } from "../config";
import type { DatabaseManager } from "../database";
import {
  createDashboardAuthManager,
  createDashboardAuthOptions,
  verifyPasswordHash,
} from "./index";
import { HTMX_SCRIPT } from "./web/assets";
import {
  renderDashboardPage,
  renderLoginPage,
  renderSummarySection,
} from "./web/pages";
import type {
  DashboardHealth,
  DashboardSession,
  DashboardStats,
} from "./web/types";

const DEFAULT_DASHBOARD_HOST = "127.0.0.1";
const DEFAULT_DASHBOARD_PORT = 8787;
const SESSION_COOKIE_NAME = "petdb_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;
const ADMIN_MAX_AGE_SECONDS = 60 * 10;
const LOGIN_RATE_LIMIT_WINDOW_MS = 60_000;
const LOGIN_RATE_LIMIT_MAX_ATTEMPTS = 8;

export interface DashboardServerOptions {
  readonly config: AppConfig;
  readonly database: DatabaseManager;
  readonly host?: string;
  readonly port?: number;
}

export interface DashboardServerHandle {
  readonly host: string;
  readonly port: number;
  close(): Promise<void>;
}

interface RateLimitEntry {
  attempts: number;
  resetAt: number;
}

interface CountRow {
  readonly count: string | number;
}

interface MarketFreshnessRow {
  readonly latest_collected_at: Date | string | null;
  readonly latest_received_at: Date | string | null;
  readonly stale_market_rows: string | number | null;
}

export async function startDashboardServer(
  options: DashboardServerOptions,
): Promise<DashboardServerHandle> {
  const host = options.host ?? DEFAULT_DASHBOARD_HOST;
  const port = options.port ?? DEFAULT_DASHBOARD_PORT;
  const authManager = createDashboardAuthManager(
    createDashboardAuthOptions(options.config, verifyPasswordHash),
  );
  const sessionSecret = randomBytes(32);
  const loginRateLimits = new Map<string, RateLimitEntry>();
  const app = new Hono();

  app.use(
    "*",
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
      },
    }),
  );

  app.get("/", (context) => context.redirect("/dashboard"));

  app.get("/dashboard/assets/htmx.min.js", (context) => {
    return context.body(HTMX_SCRIPT, 200, {
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Type": "text/javascript; charset=utf-8",
    });
  });

  app.get("/dashboard/login", (context) => {
    if (readSession(context.req.header("Cookie"), sessionSecret)) {
      return context.redirect("/dashboard");
    }

    return context.html(renderLoginPage());
  });

  app.post("/dashboard/login", async (context) => {
    const rateLimitKey = readRateLimitKey(context.req.header("x-forwarded-for"));
    const rateLimit = readRateLimit(loginRateLimits, rateLimitKey);

    if (!rateLimit.allowed) {
      return context.html(
        renderLoginPage("Too many login attempts. Try again in a minute."),
        429,
      );
    }

    const body = await context.req.parseBody();
    const password = readFormString(body.password);
    const isAuthorized = password
      ? await authManager.verifyPassword("dashboard", password)
      : false;

    if (!isAuthorized) {
      recordFailedLogin(loginRateLimits, rateLimitKey);
      return context.html(renderLoginPage("That password did not match."), 401);
    }

    loginRateLimits.delete(rateLimitKey);
    setSessionCookie(context, sessionSecret, {
      expiresAt: Date.now() + SESSION_MAX_AGE_SECONDS * 1000,
      role: "dashboard",
    });

    return context.redirect("/dashboard");
  });

  app.post("/dashboard/logout", (context) => {
    clearSessionCookie(context);
    return context.redirect("/dashboard/login");
  });

  app.get("/dashboard", async (context) => {
    const session = readSession(context.req.header("Cookie"), sessionSecret);

    if (!session) {
      return context.redirect("/dashboard/login");
    }

    const [stats, health] = await Promise.all([
      readDashboardStats(options.database),
      readDashboardHealth(options.database),
    ]);

    return context.html(renderDashboardPage({ health, session, stats }));
  });

  app.get("/dashboard/partials/summary", async (context) => {
    const session = readSession(context.req.header("Cookie"), sessionSecret);

    if (!session) {
      return context.text("Unauthorized", 401);
    }

    const stats = await readDashboardStats(options.database);
    return context.html(renderSummarySection(stats));
  });

  app.post("/dashboard/admin/elevate", async (context) => {
    const session = readSession(context.req.header("Cookie"), sessionSecret);

    if (!session) {
      return context.redirect("/dashboard/login");
    }

    const body = await context.req.parseBody();
    const password = readFormString(body.password);
    const isAuthorized = password
      ? await authManager.verifyPassword("admin", password)
      : false;

    if (!isAuthorized) {
      const stats = await readDashboardStats(options.database);
      const health = await readDashboardHealth(options.database);

      return context.html(
        renderDashboardPage({
          adminMessage: "Admin password did not match.",
          health,
          session,
          stats,
        }),
        401,
      );
    }

    const elevatedSession: DashboardSession = {
      expiresAt:
        Math.min(session.expiresAt, Date.now() + ADMIN_MAX_AGE_SECONDS * 1000),
      role: "admin",
    };
    setSessionCookie(context, sessionSecret, elevatedSession);

    return context.redirect("/dashboard");
  });

  const server = serve({
    fetch: app.fetch,
    hostname: host,
    port,
  });

  await waitForListening(server);

  return {
    host,
    port,
    async close(): Promise<void> {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
  };
}

async function readDashboardStats(
  database: DatabaseManager,
): Promise<DashboardStats> {
  try {
    const [
      systems,
      stations,
      commodities,
      marketRows,
      marketFreshness,
    ] = await Promise.all([
      readTableCount(database, "systems"),
      readTableCount(database, "stations"),
      readTableCount(database, "commodities"),
      readTableCount(database, "station_commodities"),
      database.query<MarketFreshnessRow>(`
        SELECT
          max(collected_at) AS latest_collected_at,
          max(received_at) AS latest_received_at,
          count(*) FILTER (
            WHERE collected_at < now() - interval '7 days'
          ) AS stale_market_rows
        FROM station_commodities
      `),
    ]);
    const freshnessRow = marketFreshness.rows[0];

    return {
      commodities,
      latestCollectedAt: readOptionalDate(freshnessRow?.latest_collected_at),
      latestReceivedAt: readOptionalDate(freshnessRow?.latest_received_at),
      marketRows,
      staleMarketRows: readOptionalNumber(freshnessRow?.stale_market_rows),
      stations,
      systems,
    };
  } catch {
    return {
      commodities: undefined,
      latestCollectedAt: undefined,
      latestReceivedAt: undefined,
      marketRows: undefined,
      staleMarketRows: undefined,
      stations: undefined,
      systems: undefined,
    };
  }
}

async function readTableCount(
  database: DatabaseManager,
  tableName: "commodities" | "station_commodities" | "stations" | "systems",
): Promise<number> {
  const result = await database.query<CountRow>(`SELECT count(*) AS count FROM ${tableName}`);
  return readOptionalNumber(result.rows[0]?.count) ?? 0;
}

async function readDashboardHealth(
  database: DatabaseManager,
): Promise<DashboardHealth> {
  const report = await database.doctor();

  return {
    checks: report.checks,
    connected: report.connected,
    connectionMilliseconds: report.connectionMilliseconds,
    error: report.error,
  };
}

function setSessionCookie(
  context: Context,
  secret: Buffer,
  session: DashboardSession,
): void {
  setCookie(context, SESSION_COOKIE_NAME, signSession(session, secret), {
    httpOnly: true,
    maxAge: Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000)),
    path: "/dashboard",
    sameSite: "Lax",
    secure: false,
  });
}

function clearSessionCookie(context: Context): void {
  setCookie(context, SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/dashboard",
    sameSite: "Lax",
    secure: false,
  });
}

function readSession(
  cookieHeader: string | undefined,
  secret: Buffer,
): DashboardSession | undefined {
  const signedSession = readCookieValue(cookieHeader, SESSION_COOKIE_NAME);

  if (!signedSession) {
    return undefined;
  }

  const [payload, signature] = signedSession.split(".");

  if (!payload || !signature || !isValidSignature(payload, signature, secret)) {
    return undefined;
  }

  const parsedPayload = parseSessionPayload(payload);

  if (!parsedPayload || parsedPayload.expiresAt <= Date.now()) {
    return undefined;
  }

  return parsedPayload;
}

function signSession(session: DashboardSession, secret: Buffer): string {
  const payload = Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");

  return `${payload}.${signature}`;
}

function isValidSignature(
  payload: string,
  signature: string,
  secret: Buffer,
): boolean {
  const expectedSignature = createHmac("sha256", secret)
    .update(payload)
    .digest();
  const actualSignature = Buffer.from(signature, "base64url");

  return (
    actualSignature.length === expectedSignature.length &&
    timingSafeEqual(actualSignature, expectedSignature)
  );
}

function parseSessionPayload(payload: string): DashboardSession | undefined {
  try {
    const parsedPayload: unknown = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );

    if (!isSessionPayload(parsedPayload)) {
      return undefined;
    }

    return parsedPayload;
  } catch {
    return undefined;
  }
}

function isSessionPayload(value: unknown): value is DashboardSession {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<DashboardSession>;

  return (
    typeof candidate.expiresAt === "number" &&
    (candidate.role === "admin" || candidate.role === "dashboard")
  );
}

function readCookieValue(
  cookieHeader: string | undefined,
  cookieName: string,
): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }

  for (const cookie of cookieHeader.split(";")) {
    const [name, ...valueParts] = cookie.trim().split("=");

    if (name === cookieName) {
      return valueParts.join("=");
    }
  }

  return undefined;
}

function readRateLimit(
  entries: Map<string, RateLimitEntry>,
  key: string,
): { readonly allowed: boolean } {
  const now = Date.now();
  const entry = entries.get(key);

  if (!entry || entry.resetAt <= now) {
    entries.delete(key);
    return { allowed: true };
  }

  return { allowed: entry.attempts < LOGIN_RATE_LIMIT_MAX_ATTEMPTS };
}

function recordFailedLogin(entries: Map<string, RateLimitEntry>, key: string): void {
  const now = Date.now();
  const existingEntry = entries.get(key);

  if (!existingEntry || existingEntry.resetAt <= now) {
    entries.set(key, {
      attempts: 1,
      resetAt: now + LOGIN_RATE_LIMIT_WINDOW_MS,
    });
    return;
  }

  entries.set(key, {
    attempts: existingEntry.attempts + 1,
    resetAt: existingEntry.resetAt,
  });
}

function readRateLimitKey(forwardedForHeader: string | undefined): string {
  return forwardedForHeader?.split(",")[0]?.trim() || "local";
}

function readFormString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmedValue = value.trim();
    return trimmedValue ? trimmedValue : undefined;
  }

  return undefined;
}

function readOptionalNumber(value: string | number | null | undefined): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  const parsedValue = typeof value === "number" ? value : Number(value);

  return Number.isFinite(parsedValue) ? parsedValue : undefined;
}

function readOptionalDate(value: Date | string | null | undefined): Date | undefined {
  if (!value) {
    return undefined;
  }

  const date = value instanceof Date ? value : new Date(value);

  return Number.isNaN(date.valueOf()) ? undefined : date;
}

async function waitForListening(server: ServerType): Promise<void> {
  if (server.listening) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
}
