import { createHmac, timingSafeEqual } from "node:crypto";
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
import type { InboundMessageTracker } from "./inbound_messages";
import {
  DASHBOARD_SCRIPT,
  HTMX_SCRIPT,
  MARKET_BROWSER_SCRIPT,
  ROUTE_PLANNER_SCRIPT,
  STATION_BROWSER_SCRIPT,
  THREE_CORE_SCRIPT,
  THREE_MODULE_SCRIPT,
} from "./web/assets";
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
const DASHBOARD_REFRESH_SECONDS = new Set(["0", "5", "15", "30", "60", "300"]);

export interface DashboardServerOptions {
  readonly config: AppConfig;
  readonly database: DatabaseManager;
  readonly host?: string;
  readonly inboundMessages?: InboundMessageTracker;
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

interface DashboardStatsRow {
  readonly commodities: string | number;
  readonly database_size_bytes: string | number;
  readonly latest_collected_at: Date | string | null;
  readonly market_rows: string | number;
  readonly stale_market_rows: string | number | null;
  readonly stations: string | number;
  readonly systems: string | number;
}

interface RoutePlannerSystemRow {
  readonly distance: string | number;
  readonly id: string | number;
  readonly name: string;
  readonly x: string | number;
  readonly y: string | number;
  readonly z: string | number;
}

interface RoutePlannerSearchSystemRow {
  readonly id: string | number;
  readonly name: string;
  readonly x: string | number;
  readonly y: string | number;
  readonly z: string | number;
}

interface MarketBrowserSystemRow {
  readonly id: string | number;
  readonly name: string;
  readonly x: string | number;
  readonly y: string | number;
  readonly z: string | number;
}

interface MarketBrowserStationRow {
  readonly bought_commodity_count: string | number;
  readonly distance_to_arrival: string | number | null;
  readonly has_market: boolean;
  readonly id: string | number;
  readonly max_landing_pad_size: string | null;
  readonly name: string;
  readonly sold_commodity_count: string | number;
  readonly type: string | null;
  readonly updated_at: Date | string;
}

interface MarketBrowserCommodityRow {
  readonly category: string | null;
  readonly id: string;
  readonly name: string;
}

interface StationBrowserSearchRow {
  readonly id: string | number;
  readonly name: string;
  readonly system_name: string;
}

interface StationBrowserStationRow {
  readonly distance_to_arrival: string | number | null;
  readonly has_market: boolean;
  readonly id: string | number;
  readonly max_landing_pad_size: string | null;
  readonly name: string;
  readonly system_id: string | number;
  readonly system_name: string;
  readonly type: string | null;
  readonly updated_at: Date | string;
}

interface StationBrowserCommodityRow {
  readonly category: string | null;
  readonly collected_at: Date | string;
  readonly demand: string | number | null;
  readonly demand_level: string | null;
  readonly id: string;
  readonly name: string;
  readonly station_buy_price: string | number | null;
  readonly station_sell_price: string | number | null;
  readonly stock: string | number | null;
  readonly stock_level: string | null;
}

export async function startDashboardServer(
  options: DashboardServerOptions,
): Promise<DashboardServerHandle> {
  const host = options.host ?? DEFAULT_DASHBOARD_HOST;
  const port = options.port ?? DEFAULT_DASHBOARD_PORT;
  const authManager = createDashboardAuthManager(
    createDashboardAuthOptions(options.config, verifyPasswordHash),
  );
  const sessionSecret = readSessionSecret(options.config.dashboardSessionSecret);
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

  app.get("/dashboard/assets/dashboard.js", (context) => {
    return context.body(DASHBOARD_SCRIPT, 200, {
      "Cache-Control": "no-store",
      "Content-Type": "text/javascript; charset=utf-8",
    });
  });

  app.get("/dashboard/assets/route-planner.js", (context) => {
    return context.body(ROUTE_PLANNER_SCRIPT, 200, {
      "Cache-Control": "no-store",
      "Content-Type": "text/javascript; charset=utf-8",
    });
  });

  app.get("/dashboard/assets/market-browser.js", (context) => {
    return context.body(MARKET_BROWSER_SCRIPT, 200, {
      "Cache-Control": "no-store",
      "Content-Type": "text/javascript; charset=utf-8",
    });
  });

  app.get("/dashboard/assets/station-browser.js", (context) => {
    return context.body(STATION_BROWSER_SCRIPT, 200, {
      "Cache-Control": "no-store",
      "Content-Type": "text/javascript; charset=utf-8",
    });
  });

  app.get("/dashboard/assets/three.module.js", (context) => {
    return context.body(THREE_MODULE_SCRIPT, 200, {
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Type": "text/javascript; charset=utf-8",
    });
  });

  app.get("/dashboard/assets/three.core.js", (context) => {
    return context.body(THREE_CORE_SCRIPT, 200, {
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
      readDashboardStats(options.database, options.inboundMessages),
      readDashboardHealth(options.database),
    ]);

    return context.html(renderDashboardPage({ health, session, stats }));
  });

  app.get("/dashboard/partials/summary", async (context) => {
    const session = readSession(context.req.header("Cookie"), sessionSecret);

    if (!session) {
      return context.text("Unauthorized", 401);
    }

    const stats = await readDashboardStats(options.database, options.inboundMessages);
    return context.html(
      renderSummarySection(stats, readRefreshSeconds(context.req.query("refreshSeconds"))),
    );
  });

  app.get("/dashboard/data/inbound-messages", (context) => {
    const session = readSession(context.req.header("Cookie"), sessionSecret);

    if (!session) {
      return context.json({ error: "Unauthorized" }, 401);
    }

    return context.json(
      options.inboundMessages?.readSeries() ?? {
        points: [],
        total: 0,
        windowMinutes: 60,
      },
    );
  });

  app.get("/dashboard/data/route-planner/systems", async (context) => {
    const session = readSession(context.req.header("Cookie"), sessionSecret);

    if (!session) {
      return context.json({ error: "Unauthorized" }, 401);
    }

    const origin = {
      x: readQueryNumber(context.req.query("x"), 0),
      y: readQueryNumber(context.req.query("y"), 0),
      z: readQueryNumber(context.req.query("z"), 0),
    };
    const limit = readRoutePlannerLimit(context.req.query("limit"));
    const result = await options.database.query<RoutePlannerSystemRow>(
      `
        SELECT
          id::text,
          name,
          x,
          y,
          z,
          sqrt(
            power(x - $1::double precision, 2) +
            power(y - $2::double precision, 2) +
            power(z - $3::double precision, 2)
          ) AS distance
        FROM systems
        ORDER BY distance ASC
        LIMIT $4
      `,
      [origin.x, origin.y, origin.z, limit],
    );

    return context.json({
      limit,
      origin,
      systems: result.rows.map((row) => ({
        distance: readOptionalNumber(row.distance) ?? 0,
        id: String(row.id),
        name: row.name,
        x: readOptionalNumber(row.x) ?? 0,
        y: readOptionalNumber(row.y) ?? 0,
        z: readOptionalNumber(row.z) ?? 0,
      })),
    });
  });

  app.get("/dashboard/data/route-planner/system-search", async (context) => {
    const session = readSession(context.req.header("Cookie"), sessionSecret);

    if (!session) {
      return context.json({ error: "Unauthorized" }, 401);
    }

    const query = readRoutePlannerSearchQuery(context.req.query("q"));

    if (!query) {
      return context.json({ systems: [] });
    }

    const result = await options.database.query<RoutePlannerSearchSystemRow>(
      `
        SELECT
          id::text,
          name,
          x,
          y,
          z
        FROM systems
        WHERE name ILIKE $1
        ORDER BY
          CASE
            WHEN name ILIKE $2 THEN 0
            ELSE 1
          END,
          name ASC
        LIMIT 12
      `,
      [`%${query}%`, `${query}%`],
    );

    return context.json({
      systems: result.rows.map((row) => ({
        id: String(row.id),
        name: row.name,
        x: readOptionalNumber(row.x) ?? 0,
        y: readOptionalNumber(row.y) ?? 0,
        z: readOptionalNumber(row.z) ?? 0,
      })),
    });
  });

  app.get("/dashboard/data/market-browser/system-search", async (context) => {
    const session = readSession(context.req.header("Cookie"), sessionSecret);

    if (!session) {
      return context.json({ error: "Unauthorized" }, 401);
    }

    const query = readSystemSearchQuery(context.req.query("q"));

    if (!query) {
      return context.json({ systems: [] });
    }

    const result = await options.database.query<MarketBrowserSystemRow>(
      `
        SELECT
          id::text,
          name,
          x,
          y,
          z
        FROM systems
        WHERE name ILIKE $1
        ORDER BY
          CASE
            WHEN name ILIKE $2 THEN 0
            ELSE 1
          END,
          name ASC
        LIMIT 12
      `,
      [`%${query}%`, `${query}%`],
    );

    return context.json({
      systems: result.rows.map((row) => ({
        id: String(row.id),
        name: row.name,
        x: readOptionalNumber(row.x) ?? 0,
        y: readOptionalNumber(row.y) ?? 0,
        z: readOptionalNumber(row.z) ?? 0,
      })),
    });
  });

  app.get("/dashboard/data/market-browser/systems/:systemId", async (context) => {
    const session = readSession(context.req.header("Cookie"), sessionSecret);

    if (!session) {
      return context.json({ error: "Unauthorized" }, 401);
    }

    const systemId = readIdParam(context.req.param("systemId"));

    if (!systemId) {
      return context.json({ error: "Invalid system id" }, 400);
    }

    const systemResult = await options.database.query<MarketBrowserSystemRow>(
      `
        SELECT
          id::text,
          name,
          x,
          y,
          z
        FROM systems
        WHERE id = $1::bigint
      `,
      [systemId],
    );
    const systemRow = systemResult.rows[0];

    if (!systemRow) {
      return context.json({ error: "System not found" }, 404);
    }

    const [marketsResult, boughtResult, soldResult] = await Promise.all([
      options.database.query<MarketBrowserStationRow>(
        `
          SELECT
            stations.id::text,
            stations.name,
            stations.type,
            stations.distance_to_arrival,
            stations.max_landing_pad_size,
            stations.has_market,
            stations.updated_at,
            count(DISTINCT station_commodities.commodity_id)
              FILTER (WHERE station_commodities.station_buy_price > 0) AS bought_commodity_count,
            count(DISTINCT station_commodities.commodity_id)
              FILTER (WHERE station_commodities.station_sell_price > 0) AS sold_commodity_count
          FROM stations
          LEFT JOIN station_commodities
            ON station_commodities.station_id = stations.id
          WHERE stations.system_id = $1::bigint
            AND stations.has_market = true
          GROUP BY stations.id
          ORDER BY stations.distance_to_arrival ASC NULLS LAST, stations.name ASC
        `,
        [systemId],
      ),
      options.database.query<MarketBrowserCommodityRow>(
        `
          SELECT DISTINCT
            commodities.id,
            commodities.name,
            commodities.category
          FROM stations
          JOIN station_commodities
            ON station_commodities.station_id = stations.id
          JOIN commodities
            ON commodities.id = station_commodities.commodity_id
          WHERE stations.system_id = $1::bigint
            AND station_commodities.station_buy_price > 0
          ORDER BY commodities.name ASC
        `,
        [systemId],
      ),
      options.database.query<MarketBrowserCommodityRow>(
        `
          SELECT DISTINCT
            commodities.id,
            commodities.name,
            commodities.category
          FROM stations
          JOIN station_commodities
            ON station_commodities.station_id = stations.id
          JOIN commodities
            ON commodities.id = station_commodities.commodity_id
          WHERE stations.system_id = $1::bigint
            AND station_commodities.station_sell_price > 0
          ORDER BY commodities.name ASC
        `,
        [systemId],
      ),
    ]);

    return context.json({
      commoditiesBought: boughtResult.rows.map(formatCommodityRow),
      commoditiesSold: soldResult.rows.map(formatCommodityRow),
      markets: marketsResult.rows.map((row) => ({
        boughtCommodityCount: readOptionalNumber(row.bought_commodity_count) ?? 0,
        distanceToArrival: readOptionalNumber(row.distance_to_arrival),
        hasMarket: row.has_market,
        id: String(row.id),
        maxLandingPadSize: row.max_landing_pad_size,
        name: row.name,
        soldCommodityCount: readOptionalNumber(row.sold_commodity_count) ?? 0,
        type: row.type,
        updatedAt: formatJsonDate(row.updated_at),
      })),
      system: {
        id: String(systemRow.id),
        name: systemRow.name,
        x: readOptionalNumber(systemRow.x) ?? 0,
        y: readOptionalNumber(systemRow.y) ?? 0,
        z: readOptionalNumber(systemRow.z) ?? 0,
      },
    });
  });

  app.get("/dashboard/data/station-browser/station-search", async (context) => {
    const session = readSession(context.req.header("Cookie"), sessionSecret);

    if (!session) {
      return context.json({ error: "Unauthorized" }, 401);
    }

    const query = readSystemSearchQuery(context.req.query("q"));

    if (!query) {
      return context.json({ stations: [] });
    }

    const result = await options.database.query<StationBrowserSearchRow>(
      `
        SELECT
          stations.id::text,
          stations.name,
          systems.name AS system_name
        FROM stations
        JOIN systems
          ON systems.id = stations.system_id
        WHERE stations.name ILIKE $1
        ORDER BY
          CASE
            WHEN stations.name ILIKE $2 THEN 0
            ELSE 1
          END,
          stations.name ASC,
          systems.name ASC
        LIMIT 12
      `,
      [`%${query}%`, `${query}%`],
    );

    return context.json({
      stations: result.rows.map((row) => ({
        id: String(row.id),
        name: row.name,
        systemName: row.system_name,
      })),
    });
  });

  app.get("/dashboard/data/station-browser/stations/:stationId", async (context) => {
    const session = readSession(context.req.header("Cookie"), sessionSecret);

    if (!session) {
      return context.json({ error: "Unauthorized" }, 401);
    }

    const stationId = readIdParam(context.req.param("stationId"));

    if (!stationId) {
      return context.json({ error: "Invalid station id" }, 400);
    }

    const stationResult = await options.database.query<StationBrowserStationRow>(
      `
        SELECT
          stations.id::text,
          stations.name,
          stations.system_id::text,
          systems.name AS system_name,
          stations.type,
          stations.distance_to_arrival,
          stations.max_landing_pad_size,
          stations.has_market,
          stations.updated_at
        FROM stations
        JOIN systems
          ON systems.id = stations.system_id
        WHERE stations.id = $1::bigint
      `,
      [stationId],
    );
    const stationRow = stationResult.rows[0];

    if (!stationRow) {
      return context.json({ error: "Station not found" }, 404);
    }

    const commoditiesResult = await options.database.query<StationBrowserCommodityRow>(
      `
        SELECT
          commodities.id,
          commodities.name,
          commodities.category,
          station_commodities.station_buy_price,
          station_commodities.station_sell_price,
          station_commodities.demand,
          station_commodities.demand_level,
          station_commodities.stock,
          station_commodities.stock_level,
          station_commodities.collected_at
        FROM station_commodities
        JOIN commodities
          ON commodities.id = station_commodities.commodity_id
        WHERE station_commodities.station_id = $1::bigint
        ORDER BY commodities.name ASC
      `,
      [stationId],
    );

    return context.json({
      commodities: commoditiesResult.rows.map((row) => ({
        category: row.category,
        collectedAt: formatJsonDate(row.collected_at),
        demand: readOptionalNumber(row.demand),
        demandLevel: row.demand_level,
        id: row.id,
        name: row.name,
        stationBuyPrice: readOptionalNumber(row.station_buy_price),
        stationSellPrice: readOptionalNumber(row.station_sell_price),
        stock: readOptionalNumber(row.stock),
        stockLevel: row.stock_level,
      })),
      station: {
        distanceToArrival: readOptionalNumber(stationRow.distance_to_arrival),
        hasMarket: stationRow.has_market,
        id: String(stationRow.id),
        maxLandingPadSize: stationRow.max_landing_pad_size,
        name: stationRow.name,
        systemId: String(stationRow.system_id),
        systemName: stationRow.system_name,
        type: stationRow.type,
        updatedAt: formatJsonDate(stationRow.updated_at),
      },
    });
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
      const stats = await readDashboardStats(options.database, options.inboundMessages);
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

function readSessionSecret(value: string | undefined): Buffer {
  if (!value) {
    throw new Error("DASHBOARD_SESSION_SECRET is not set in .env.");
  }

  const secret = Buffer.from(value, "base64url");

  if (secret.length < 32) {
    throw new Error("DASHBOARD_SESSION_SECRET must be at least 32 bytes.");
  }

  return secret;
}

function readRefreshSeconds(value: string | undefined): string {
  return value && DASHBOARD_REFRESH_SECONDS.has(value) ? value : "30";
}

function readQueryNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsedValue = Number.parseFloat(value);

  return Number.isFinite(parsedValue) ? parsedValue : fallback;
}

function readRoutePlannerLimit(value: string | undefined): number {
  const parsedLimit = value ? Number.parseInt(value, 10) : 100;

  if (!Number.isInteger(parsedLimit)) {
    return 100;
  }

  return Math.max(1, Math.min(parsedLimit, 500));
}

function readRoutePlannerSearchQuery(value: string | undefined): string {
  return value?.trim().slice(0, 80) ?? "";
}

function readSystemSearchQuery(value: string | undefined): string {
  return value?.trim().slice(0, 80) ?? "";
}

function readIdParam(value: string | undefined): string | undefined {
  if (!value || !/^\d+$/u.test(value)) {
    return undefined;
  }

  return value;
}

function formatCommodityRow(row: MarketBrowserCommodityRow): {
  readonly category: string | null;
  readonly id: string;
  readonly name: string;
} {
  return {
    category: row.category,
    id: row.id,
    name: row.name,
  };
}

function formatJsonDate(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

async function readDashboardStats(
  database: DatabaseManager,
  inboundMessages: InboundMessageTracker | undefined,
): Promise<DashboardStats> {
  const activity = inboundMessages?.readActivity();

  try {
    const statsResult = await database.query<DashboardStatsRow>(`
      SELECT
        (SELECT count(*) FROM systems) AS systems,
        (SELECT count(*) FROM stations) AS stations,
        (SELECT count(*) FROM commodities) AS commodities,
        pg_database_size(current_database()) AS database_size_bytes,
        count(*) AS market_rows,
        max(collected_at) AS latest_collected_at,
        count(*) FILTER (WHERE collected_at < now() - interval '7 days') AS stale_market_rows
      FROM station_commodities
    `);
    const statsRow = statsResult.rows[0];

    return {
      commodities: readOptionalNumber(statsRow?.commodities),
      databaseSizeBytes: readOptionalNumber(statsRow?.database_size_bytes),
      lastPatchAt: activity?.lastPatchAt,
      latestCollectedAt: readOptionalDate(statsRow?.latest_collected_at),
      latestReceivedAt: activity?.lastReceivedAt,
      marketRows: readOptionalNumber(statsRow?.market_rows),
      staleMarketRows: readOptionalNumber(statsRow?.stale_market_rows),
      stations: readOptionalNumber(statsRow?.stations),
      systems: readOptionalNumber(statsRow?.systems),
    };
  } catch {
    return {
      commodities: undefined,
      databaseSizeBytes: undefined,
      lastPatchAt: activity?.lastPatchAt,
      latestCollectedAt: undefined,
      latestReceivedAt: activity?.lastReceivedAt,
      marketRows: undefined,
      staleMarketRows: undefined,
      stations: undefined,
      systems: undefined,
    };
  }
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
