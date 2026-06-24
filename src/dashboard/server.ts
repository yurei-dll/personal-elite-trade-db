import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
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

const DEFAULT_DASHBOARD_HOST = "127.0.0.1";
const DEFAULT_DASHBOARD_PORT = 8787;
const SESSION_COOKIE_NAME = "petdb_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;
const ADMIN_MAX_AGE_SECONDS = 60 * 10;
const LOGIN_RATE_LIMIT_WINDOW_MS = 60_000;
const LOGIN_RATE_LIMIT_MAX_ATTEMPTS = 8;
const HTMX_SCRIPT = readFileSync(
  require.resolve("htmx.org/dist/htmx.min.js"),
  "utf8",
);

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

type DashboardSessionRole = "dashboard" | "admin";

interface DashboardSession {
  readonly expiresAt: number;
  readonly role: DashboardSessionRole;
}

interface RateLimitEntry {
  attempts: number;
  resetAt: number;
}

interface DashboardStats {
  readonly commodities: number | undefined;
  readonly latestCollectedAt: Date | undefined;
  readonly latestReceivedAt: Date | undefined;
  readonly marketRows: number | undefined;
  readonly staleMarketRows: number | undefined;
  readonly stations: number | undefined;
  readonly systems: number | undefined;
}

interface DashboardHealth {
  readonly checks: readonly {
    readonly message: string;
    readonly name: string;
    readonly status: "error" | "ok" | "warning";
  }[];
  readonly connected: boolean;
  readonly connectionMilliseconds: number | undefined;
  readonly error: string | undefined;
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

function renderLoginPage(errorMessage?: string): string {
  return renderDocument({
    body: `
      <main class="login-shell">
        <section class="login-panel">
          <p class="eyebrow">personal-elite-trade-db</p>
          <h1>Dashboard Login</h1>
          <p class="muted">Read-only access to local trade database status.</p>
          ${errorMessage ? `<p class="alert">${escapeHtml(errorMessage)}</p>` : ""}
          <form method="post" action="/dashboard/login" class="stack">
            <label>
              <span>Password</span>
              <input type="password" name="password" autocomplete="current-password" autofocus required>
            </label>
            <button type="submit">Enter dashboard</button>
          </form>
        </section>
      </main>
    `,
    title: "Dashboard Login",
  });
}

function renderDashboardPage(options: {
  readonly adminMessage?: string;
  readonly health: DashboardHealth;
  readonly session: DashboardSession;
  readonly stats: DashboardStats;
}): string {
  return renderDocument({
    body: `
      <header class="topbar">
        <div>
          <p class="eyebrow">Elite: Dangerous trade database</p>
          <h1>Command Dashboard</h1>
        </div>
        <form method="post" action="/dashboard/logout">
          <button type="submit" class="secondary">Log out</button>
        </form>
      </header>
      <main class="dashboard-grid">
        ${renderSummarySection(options.stats)}
        ${renderHealthSection(options.health)}
        ${renderAdminSection(options.session, options.adminMessage)}
      </main>
      <script src="/dashboard/assets/htmx.min.js"></script>
    `,
    title: "Command Dashboard",
  });
}

function renderSummarySection(stats: DashboardStats): string {
  return `
    <section id="summary" class="section wide" hx-get="/dashboard/partials/summary" hx-trigger="every 30s" hx-swap="outerHTML">
      <div class="section-header">
        <div>
          <p class="eyebrow">Database</p>
          <h2>Trade Data</h2>
        </div>
        <span class="pill">auto-refresh 30s</span>
      </div>
      <div class="metric-grid">
        ${renderMetric("Systems", stats.systems)}
        ${renderMetric("Stations", stats.stations)}
        ${renderMetric("Commodities", stats.commodities)}
        ${renderMetric("Market rows", stats.marketRows)}
      </div>
      <div class="freshness">
        <p><span>Latest collected</span>${formatDate(stats.latestCollectedAt)}</p>
        <p><span>Latest received</span>${formatDate(stats.latestReceivedAt)}</p>
        <p><span>Stale market rows</span>${formatNumber(stats.staleMarketRows)}</p>
      </div>
    </section>
  `;
}

function renderHealthSection(health: DashboardHealth): string {
  return `
    <section class="section">
      <div class="section-header">
        <div>
          <p class="eyebrow">Server</p>
          <h2>Health</h2>
        </div>
        <span class="status ${health.connected ? "ok" : "error"}">
          ${health.connected ? "connected" : "offline"}
        </span>
      </div>
      <p class="muted">
        ${health.connectionMilliseconds === undefined
          ? "No successful connection timing yet."
          : `Connected in ${escapeHtml(String(health.connectionMilliseconds))} ms.`}
      </p>
      ${health.error ? `<p class="alert">${escapeHtml(health.error)}</p>` : ""}
      <div class="check-list">
        ${health.checks.map(renderHealthCheck).join("")}
      </div>
    </section>
  `;
}

function renderAdminSection(
  session: DashboardSession,
  message: string | undefined,
): string {
  const isAdmin = session.role === "admin";

  return `
    <section class="section">
      <div class="section-header">
        <div>
          <p class="eyebrow">Access</p>
          <h2>Admin Elevation</h2>
        </div>
        <span class="status ${isAdmin ? "ok" : "warning"}">
          ${isAdmin ? "admin" : "read-only"}
        </span>
      </div>
      <p class="muted">
        Admin elevation lasts for ${Math.round(ADMIN_MAX_AGE_SECONDS / 60)} minutes and is reserved for destructive actions.
      </p>
      ${message ? `<p class="alert">${escapeHtml(message)}</p>` : ""}
      <form method="post" action="/dashboard/admin/elevate" class="stack">
        <label>
          <span>Admin password</span>
          <input type="password" name="password" autocomplete="current-password" required>
        </label>
        <button type="submit" ${isAdmin ? "disabled" : ""}>Elevate</button>
      </form>
    </section>
  `;
}

function renderMetric(label: string, value: number | undefined): string {
  return `
    <article class="metric">
      <span>${escapeHtml(label)}</span>
      <strong>${formatNumber(value)}</strong>
    </article>
  `;
}

function renderHealthCheck(check: DashboardHealth["checks"][number]): string {
  return `
    <article class="check">
      <span class="status ${check.status}">${escapeHtml(check.status)}</span>
      <div>
        <strong>${escapeHtml(check.name)}</strong>
        <p>${escapeHtml(check.message)}</p>
      </div>
    </article>
  `;
}

function renderDocument(options: {
  readonly body: string;
  readonly title: string;
}): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(options.title)} - personal-elite-trade-db</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #08090d;
        --panel: #11141c;
        --panel-strong: #181d29;
        --text: #f4f7fb;
        --muted: #9aa7b8;
        --line: #263142;
        --accent: #48d7ff;
        --accent-strong: #7bf2c4;
        --danger: #ff6b7a;
        --warning: #f6c95f;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        background: radial-gradient(circle at top left, #182033 0, #08090d 38rem);
        color: var(--text);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      h1, h2, p { margin: 0; }
      h1 { font-size: clamp(2rem, 5vw, 4.5rem); line-height: 1; }
      h2 { font-size: 1.2rem; }
      button, input {
        border: 1px solid var(--line);
        border-radius: 8px;
        color: var(--text);
        font: inherit;
      }
      button {
        background: linear-gradient(135deg, var(--accent), var(--accent-strong));
        color: #071014;
        cursor: pointer;
        font-weight: 800;
        padding: 0.8rem 1rem;
      }
      button.secondary {
        background: var(--panel-strong);
        color: var(--text);
      }
      button:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }
      input {
        background: #090c12;
        margin-top: 0.45rem;
        padding: 0.75rem 0.85rem;
        width: 100%;
      }
      label span {
        color: var(--muted);
        display: block;
        font-size: 0.9rem;
      }
      .login-shell {
        display: grid;
        min-height: 100vh;
        padding: 1.25rem;
        place-items: center;
      }
      .login-panel {
        background: rgba(17, 20, 28, 0.92);
        border: 1px solid var(--line);
        border-radius: 8px;
        max-width: 28rem;
        padding: 2rem;
        width: min(100%, 28rem);
      }
      .topbar {
        align-items: end;
        display: flex;
        gap: 1rem;
        justify-content: space-between;
        padding: 2rem;
      }
      .dashboard-grid {
        display: grid;
        gap: 1rem;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        padding: 0 2rem 2rem;
      }
      .section {
        background: rgba(17, 20, 28, 0.9);
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 1.1rem;
      }
      .wide { grid-column: 1 / -1; }
      .section-header {
        align-items: start;
        display: flex;
        gap: 1rem;
        justify-content: space-between;
        margin-bottom: 1rem;
      }
      .eyebrow {
        color: var(--accent);
        font-size: 0.76rem;
        font-weight: 800;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .muted {
        color: var(--muted);
        margin-top: 0.45rem;
      }
      .alert {
        background: rgba(255, 107, 122, 0.12);
        border: 1px solid rgba(255, 107, 122, 0.4);
        border-radius: 8px;
        color: #ffd3d8;
        margin: 1rem 0;
        padding: 0.75rem;
      }
      .stack {
        display: grid;
        gap: 1rem;
        margin-top: 1.2rem;
      }
      .metric-grid {
        display: grid;
        gap: 0.8rem;
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }
      .metric {
        background: var(--panel-strong);
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 1rem;
      }
      .metric span, .freshness span {
        color: var(--muted);
        display: block;
        font-size: 0.82rem;
      }
      .metric strong {
        display: block;
        font-size: clamp(1.5rem, 4vw, 2.7rem);
        margin-top: 0.25rem;
      }
      .freshness {
        display: grid;
        gap: 0.8rem;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        margin-top: 0.9rem;
      }
      .freshness p {
        border-left: 3px solid var(--accent);
        color: var(--text);
        padding-left: 0.75rem;
      }
      .pill, .status {
        border-radius: 999px;
        border: 1px solid var(--line);
        color: var(--muted);
        font-size: 0.78rem;
        font-weight: 800;
        padding: 0.25rem 0.55rem;
        text-transform: uppercase;
        white-space: nowrap;
      }
      .status.ok { color: var(--accent-strong); }
      .status.warning { color: var(--warning); }
      .status.error { color: var(--danger); }
      .check-list {
        display: grid;
        gap: 0.75rem;
        margin-top: 1rem;
      }
      .check {
        align-items: start;
        display: flex;
        gap: 0.75rem;
      }
      .check p {
        color: var(--muted);
        font-size: 0.9rem;
        margin-top: 0.2rem;
        white-space: pre-wrap;
      }
      @media (max-width: 760px) {
        .topbar {
          align-items: stretch;
          flex-direction: column;
          padding: 1rem;
        }
        .dashboard-grid {
          grid-template-columns: 1fr;
          padding: 0 1rem 1rem;
        }
        .metric-grid, .freshness {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>${options.body}</body>
</html>`;
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

function formatNumber(value: number | undefined): string {
  return value === undefined ? "unknown" : new Intl.NumberFormat("en-US").format(value);
}

function formatDate(value: Date | undefined): string {
  if (!value) {
    return "unknown";
  }

  return escapeHtml(
    new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(value),
  );
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return character;
    }
  });
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
