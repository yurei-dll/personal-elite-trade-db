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
  HTMX_SCRIPT,
  THREE_CORE_SCRIPT,
  THREE_MODULE_SCRIPT,
  readDashboardWebAsset,
  readDashboardWebBinaryAsset,
} from "./assets";
import {
  renderDashboardPage,
  renderLoginPage,
  renderSummarySection,
} from "./pages";
import {
  dashboardStatsQuery,
  marketBrowserCommoditiesQuery,
  marketBrowserStationsQuery,
  routePlannerBestTradeRouteQuery,
  routePlannerCommoditiesQuery,
  routePlannerReturnHaulQuery,
  routePlannerSystemsQuery,
  routePlannerSystemsChunkQuery,
  routePlannerTradeRouteQuery,
  routePlannerWaypointsQuery,
  stationByIdQuery,
  stationCommoditiesQuery,
  stationSearchQuery,
  systemByIdQuery,
  systemSearchQuery,
} from "./queries";
import type {
  DashboardHealth,
  DashboardSession,
  DashboardStats,
} from "./types";

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
  readonly carrier_count: string | number | null;
  readonly distance: string | number;
  readonly id: string | number;
  readonly market_count: string | number | null;
  readonly name: string;
  readonly planetary_market_count: string | number | null;
  readonly x: string | number;
  readonly y: string | number;
  readonly z: string | number;
}

interface RoutePlannerSearchSystemRow {
  readonly carrier_count?: string | number | null;
  readonly id: string | number;
  readonly market_count?: string | number | null;
  readonly name: string;
  readonly planetary_market_count?: string | number | null;
  readonly x: string | number;
  readonly y: string | number;
  readonly z: string | number;
}

interface RoutePlannerCommodityRow {
  readonly category: string | null;
  readonly id: string;
  readonly name: string;
  readonly source_is_planetary: boolean | null;
  readonly source_station_id: string | number;
  readonly source_station_name: string;
  readonly station_sell_price: string | number | null;
  readonly stock: string | number | null;
}

interface RoutePlannerTradeRouteRow {
  readonly commodity_category: string | null;
  readonly commodity_id: string;
  readonly commodity_name: string;
  readonly destination_collected_at: Date | string;
  readonly destination_distance_to_arrival: string | number | null;
  readonly demand: string | number | null;
  readonly destination_station_id: string | number;
  readonly destination_station_name: string;
  readonly destination_is_planetary: boolean | null;
  readonly destination_system_id: string | number;
  readonly destination_system_name: string;
  readonly destination_x: string | number;
  readonly destination_y: string | number;
  readonly destination_z: string | number;
  readonly distance: string | number;
  readonly profit: string | number | null;
  readonly source_station_id: string | number;
  readonly source_station_name: string;
  readonly source_distance_to_arrival: string | number | null;
  readonly source_is_planetary: boolean | null;
  readonly source_collected_at: Date | string;
  readonly station_buy_price: string | number | null;
  readonly station_sell_price: string | number | null;
  readonly stock: string | number | null;
}

interface RoutePlannerWaypointRow {
  readonly distance: string | number;
  readonly id: string | number;
  readonly jump_index: string | number;
  readonly name: string;
  readonly x: string | number;
  readonly y: string | number;
  readonly z: string | number;
}

interface RoutePlannerReturnHaulRow {
  readonly commodity_category: string | null;
  readonly commodity_id: string;
  readonly commodity_name: string;
  readonly destination_collected_at: Date | string;
  readonly demand: string | number | null;
  readonly destination_station_id: string | number;
  readonly destination_station_name: string;
  readonly destination_is_planetary: boolean | null;
  readonly profit: string | number | null;
  readonly source_station_id: string | number;
  readonly source_station_name: string;
  readonly source_is_planetary: boolean | null;
  readonly source_collected_at: Date | string;
  readonly station_buy_price: string | number | null;
  readonly station_sell_price: string | number | null;
  readonly stock: string | number | null;
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

  app.get("/dashboard/assets/styles.css", (context) => {
    return context.body(readDashboardWebAsset("styles.css"), 200, {
      "Cache-Control": "no-store",
      "Content-Type": "text/css; charset=utf-8",
    });
  });

  app.get("/dashboard/assets/dashboard.js", (context) => {
    return context.body(readDashboardWebAsset("dashboard.js"), 200, {
      "Cache-Control": "no-store",
      "Content-Type": "text/javascript; charset=utf-8",
    });
  });

  app.get("/dashboard/assets/route-planner.js", (context) => {
    return context.body(readDashboardWebAsset("route-planner.js"), 200, {
      "Cache-Control": "no-store",
      "Content-Type": "text/javascript; charset=utf-8",
    });
  });

  app.get("/dashboard/assets/market-browser.js", (context) => {
    return context.body(readDashboardWebAsset("market-browser.js"), 200, {
      "Cache-Control": "no-store",
      "Content-Type": "text/javascript; charset=utf-8",
    });
  });

  app.get("/dashboard/assets/station-browser.js", (context) => {
    return context.body(readDashboardWebAsset("station-browser.js"), 200, {
      "Cache-Control": "no-store",
      "Content-Type": "text/javascript; charset=utf-8",
    });
  });

  for (const level of ["none", "low", "medium", "high"] as const) {
    app.get(`/dashboard/assets/img/${level}.png`, (context) => {
      return context.body(readDashboardWebBinaryAsset(`img/${level}.png`), 200, {
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Type": "image/png",
      });
    });
  }

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
    const chunkSize = readQueryNumber(context.req.query("chunkSize"), 0);
    const result = await options.database.query<RoutePlannerSystemRow>(
      chunkSize > 0 ? routePlannerSystemsChunkQuery : routePlannerSystemsQuery,
      chunkSize > 0
        ? [origin.x, origin.y, origin.z, limit, Math.min(500, Math.max(20, chunkSize))]
        : [origin.x, origin.y, origin.z, limit],
    );

    return context.json({
      chunkSize: chunkSize > 0 ? Math.min(500, Math.max(20, chunkSize)) : undefined,
      limit,
      origin,
      systems: result.rows.map((row) => ({
        carrierCount: readOptionalNumber(row.carrier_count) ?? 0,
        distance: readOptionalNumber(row.distance) ?? 0,
        id: String(row.id),
        marketCount: readOptionalNumber(row.market_count) ?? 0,
        name: row.name,
        planetaryMarketCount: readOptionalNumber(row.planetary_market_count) ?? 0,
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
      systemSearchQuery,
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

  app.get("/dashboard/data/route-planner/systems/:systemId", async (context) => {
    const session = readSession(context.req.header("Cookie"), sessionSecret);

    if (!session) {
      return context.json({ error: "Unauthorized" }, 401);
    }

    const systemId = readIdParam(context.req.param("systemId"));

    if (!systemId) {
      return context.json({ error: "Invalid system id" }, 400);
    }

    const result = await options.database.query<RoutePlannerSearchSystemRow>(
      systemByIdQuery,
      [systemId],
    );
    const row = result.rows[0];

    if (!row) {
      return context.json({ error: "System not found" }, 404);
    }

    return context.json({
      system: {
        carrierCount: readOptionalNumber(row.carrier_count) ?? 0,
        id: String(row.id),
        marketCount: readOptionalNumber(row.market_count) ?? 0,
        name: row.name,
        planetaryMarketCount: readOptionalNumber(row.planetary_market_count) ?? 0,
        x: readOptionalNumber(row.x) ?? 0,
        y: readOptionalNumber(row.y) ?? 0,
        z: readOptionalNumber(row.z) ?? 0,
      },
    });
  });

  app.get("/dashboard/data/route-planner/commodities", async (context) => {
    const session = readSession(context.req.header("Cookie"), sessionSecret);

    if (!session) {
      return context.json({ error: "Unauthorized" }, 401);
    }

    const systemId = readIdParam(context.req.query("systemId"));
    const includeFleetCarriers = readQueryBoolean(context.req.query("includeFleetCarriers"));
    const includePlanetary = readQueryBoolean(context.req.query("includePlanetary"));
    const padSize = readLandingPadSize(context.req.query("padSize"));

    if (!systemId) {
      return context.json({ error: "Invalid system id" }, 400);
    }

    const result = await options.database.query<RoutePlannerCommodityRow>(
      routePlannerCommoditiesQuery({
        includeFleetCarriers,
        includePlanetary,
        padSize,
      }),
      [systemId],
    );

    return context.json({
      commodities: result.rows.map((row) => ({
        category: row.category,
        id: row.id,
        name: row.name,
        sourceIsPlanetary: row.source_is_planetary === true,
        sourceStationId: String(row.source_station_id),
        sourceStationName: row.source_station_name,
        stationSellPrice: readOptionalNumber(row.station_sell_price),
        stock: readOptionalNumber(row.stock),
      })),
      padSize,
      systemId,
    });
  });

  app.get("/dashboard/data/route-planner/trade-route", async (context) => {
    const session = readSession(context.req.header("Cookie"), sessionSecret);

    if (!session) {
      return context.json({ error: "Unauthorized" }, 401);
    }

    const originSystemId = readIdParam(context.req.query("originSystemId"));
    const commodityId = readCommodityId(context.req.query("commodityId"));
    const maxRange = Math.max(1, Math.min(readQueryNumber(context.req.query("maxRange"), 30), 500));
    const maxJumps = Math.max(1, Math.min(readQueryInteger(context.req.query("maxJumps"), 8), 100));
    const includeFleetCarriers = readQueryBoolean(context.req.query("includeFleetCarriers"));
    const includePlanetary = readQueryBoolean(context.req.query("includePlanetary"));
    const padSize = readLandingPadSize(context.req.query("padSize"));
    const requireDestinationDemand = readQueryBoolean(context.req.query("requireDestinationDemand"));

    if (!originSystemId || !commodityId) {
      return context.json({ error: "Invalid route request" }, 400);
    }

    const maxDistance = maxRange * maxJumps;
    const result = await options.database.query<RoutePlannerTradeRouteRow>(
      routePlannerTradeRouteQuery({
        includeFleetCarriers,
        includePlanetary,
        padSize,
        requireDestinationDemand,
      }),
      [originSystemId, commodityId, maxDistance],
    );
    const row = result.rows[0];

    if (!row) {
      return context.json({
        maxDistance,
        maxJumps,
        maxRange,
        padSize,
        route: null,
      });
    }

    const distance = readOptionalNumber(row.distance) ?? 0;
    const jumps = Math.max(1, Math.ceil(distance / maxRange));
    const destination = {
      isPlanetary: row.destination_is_planetary === true,
      collectedAt: formatJsonDate(row.destination_collected_at),
      demand: readOptionalNumber(row.demand),
      distanceToArrival: readOptionalNumber(row.destination_distance_to_arrival),
      stationId: String(row.destination_station_id),
      stationName: row.destination_station_name,
      systemId: String(row.destination_system_id),
      systemName: row.destination_system_name,
      x: readOptionalNumber(row.destination_x) ?? 0,
      y: readOptionalNumber(row.destination_y) ?? 0,
      z: readOptionalNumber(row.destination_z) ?? 0,
    };
    const waypoints = jumps > 1
      ? await readRoutePlannerWaypoints(options.database, {
          destination,
          jumps,
          originSystemId,
        })
      : [];
    const returnHaul = await readRoutePlannerReturnHaul(options.database, {
      destinationSystemId: destination.systemId,
      includeFleetCarriers,
      includePlanetary,
      originSystemId,
      padSize,
      requireDestinationDemand,
    });

    return context.json({
      maxDistance,
      maxJumps,
      maxRange,
      padSize,
      route: {
        commodity: {
          category: row.commodity_category,
          id: row.commodity_id,
          name: row.commodity_name,
        },
        destination,
        distance,
        jumps,
        profit: readOptionalNumber(row.profit),
        source: {
          isPlanetary: row.source_is_planetary === true,
          distanceToArrival: readOptionalNumber(row.source_distance_to_arrival),
          stationId: String(row.source_station_id),
          stationName: row.source_station_name,
          stationSellPrice: readOptionalNumber(row.station_sell_price),
          collectedAt: formatJsonDate(row.source_collected_at),
          stock: readOptionalNumber(row.stock),
        },
        stationBuyPrice: readOptionalNumber(row.station_buy_price),
        returnHaul,
        waypoints,
      },
    });
  });

  app.get("/dashboard/data/route-planner/best-trade-route", async (context) => {
    const session = readSession(context.req.header("Cookie"), sessionSecret);

    if (!session) {
      return context.json({ error: "Unauthorized" }, 401);
    }

    const originSystemId = readIdParam(context.req.query("originSystemId"));
    const maxRange = Math.max(1, Math.min(readQueryNumber(context.req.query("maxRange"), 30), 500));
    const maxJumps = Math.max(1, Math.min(readQueryInteger(context.req.query("maxJumps"), 8), 100));
    const includeFleetCarriers = readQueryBoolean(context.req.query("includeFleetCarriers"));
    const includePlanetary = readQueryBoolean(context.req.query("includePlanetary"));
    const padSize = readLandingPadSize(context.req.query("padSize"));
    const requireDestinationDemand = readQueryBoolean(context.req.query("requireDestinationDemand"));

    if (!originSystemId) {
      return context.json({ error: "Invalid route request" }, 400);
    }

    const maxDistance = maxRange * maxJumps;
    const result = await options.database.query<RoutePlannerTradeRouteRow>(
      routePlannerBestTradeRouteQuery({
        includeFleetCarriers,
        includePlanetary,
        padSize,
        requireDestinationDemand,
      }),
      [originSystemId, maxDistance],
    );
    const row = result.rows[0];

    if (!row) {
      return context.json({
        maxDistance,
        maxJumps,
        maxRange,
        padSize,
        route: null,
      });
    }

    const distance = readOptionalNumber(row.distance) ?? 0;
    const jumps = Math.max(1, Math.ceil(distance / maxRange));
    const destination = {
      isPlanetary: row.destination_is_planetary === true,
      collectedAt: formatJsonDate(row.destination_collected_at),
      demand: readOptionalNumber(row.demand),
      distanceToArrival: readOptionalNumber(row.destination_distance_to_arrival),
      stationId: String(row.destination_station_id),
      stationName: row.destination_station_name,
      systemId: String(row.destination_system_id),
      systemName: row.destination_system_name,
      x: readOptionalNumber(row.destination_x) ?? 0,
      y: readOptionalNumber(row.destination_y) ?? 0,
      z: readOptionalNumber(row.destination_z) ?? 0,
    };
    const waypoints = jumps > 1
      ? await readRoutePlannerWaypoints(options.database, {
          destination,
          jumps,
          originSystemId,
        })
      : [];
    const returnHaul = await readRoutePlannerReturnHaul(options.database, {
      destinationSystemId: destination.systemId,
      includeFleetCarriers,
      includePlanetary,
      originSystemId,
      padSize,
      requireDestinationDemand,
    });

    return context.json({
      maxDistance,
      maxJumps,
      maxRange,
      padSize,
      route: {
        commodity: {
          category: row.commodity_category,
          id: row.commodity_id,
          name: row.commodity_name,
        },
        destination,
        distance,
        jumps,
        profit: readOptionalNumber(row.profit),
        source: {
          isPlanetary: row.source_is_planetary === true,
          distanceToArrival: readOptionalNumber(row.source_distance_to_arrival),
          stationId: String(row.source_station_id),
          stationName: row.source_station_name,
          stationSellPrice: readOptionalNumber(row.station_sell_price),
          collectedAt: formatJsonDate(row.source_collected_at),
          stock: readOptionalNumber(row.stock),
        },
        stationBuyPrice: readOptionalNumber(row.station_buy_price),
        returnHaul,
        waypoints,
      },
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
      systemSearchQuery,
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
    const includeFleetCarriers = readQueryBoolean(context.req.query("includeFleetCarriers"));
    const includePlanetary = readQueryBoolean(context.req.query("includePlanetary"));

    if (!systemId) {
      return context.json({ error: "Invalid system id" }, 400);
    }

    const systemResult = await options.database.query<MarketBrowserSystemRow>(
      systemByIdQuery,
      [systemId],
    );
    const systemRow = systemResult.rows[0];

    if (!systemRow) {
      return context.json({ error: "System not found" }, 404);
    }

    const [marketsResult, boughtResult, soldResult] = await Promise.all([
      options.database.query<MarketBrowserStationRow>(
        marketBrowserStationsQuery({
          includeFleetCarriers,
          includePlanetary,
        }),
        [systemId],
      ),
      options.database.query<MarketBrowserCommodityRow>(
        marketBrowserCommoditiesQuery({
          includeFleetCarriers,
          includePlanetary,
          stationTradeRole: "station_buys",
        }),
        [systemId],
      ),
      options.database.query<MarketBrowserCommodityRow>(
        marketBrowserCommoditiesQuery({
          includeFleetCarriers,
          includePlanetary,
          stationTradeRole: "station_sells",
        }),
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
      stationSearchQuery,
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
      stationByIdQuery,
      [stationId],
    );
    const stationRow = stationResult.rows[0];

    if (!stationRow) {
      return context.json({ error: "Station not found" }, 404);
    }

    const commoditiesResult = await options.database.query<StationBrowserCommodityRow>(
      stationCommoditiesQuery,
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

function readQueryInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsedValue = Number.parseInt(value, 10);

  return Number.isInteger(parsedValue) ? parsedValue : fallback;
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

function readLandingPadSize(value: string | undefined): "M" | "L" {
  return value === "M" ? "M" : "L";
}

function readQueryBoolean(value: string | undefined): boolean {
  return value === "true" || value === "1" || value === "yes";
}

function readCommodityId(value: string | undefined): string | undefined {
  const commodityId = value?.trim();

  if (!commodityId || !/^[A-Za-z0-9_.$:-]{1,80}$/u.test(commodityId)) {
    return undefined;
  }

  return commodityId;
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
    const statsResult = await database.query<DashboardStatsRow>(dashboardStatsQuery);
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

async function readRoutePlannerWaypoints(
  database: DatabaseManager,
  options: {
    readonly destination: {
      readonly systemId: string;
      readonly x: number;
      readonly y: number;
      readonly z: number;
    };
    readonly jumps: number;
    readonly originSystemId: string;
  },
): Promise<Array<{
  readonly distance: number;
  readonly id: string;
  readonly jumpIndex: number;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}>> {
  if (options.jumps <= 1) {
    return [];
  }

  const result = await database.query<RoutePlannerWaypointRow>(
    routePlannerWaypointsQuery(),
    [
      options.originSystemId,
      options.destination.x,
      options.destination.y,
      options.destination.z,
      options.jumps,
      options.destination.systemId,
    ],
  );

  return result.rows.map((row) => ({
    distance: readOptionalNumber(row.distance) ?? 0,
    id: String(row.id),
    jumpIndex: readOptionalNumber(row.jump_index) ?? 0,
    name: row.name,
    x: readOptionalNumber(row.x) ?? 0,
    y: readOptionalNumber(row.y) ?? 0,
    z: readOptionalNumber(row.z) ?? 0,
  }));
}

async function readRoutePlannerReturnHaul(
  database: DatabaseManager,
  options: {
    readonly destinationSystemId: string;
    readonly includeFleetCarriers: boolean;
    readonly includePlanetary: boolean;
    readonly originSystemId: string;
    readonly padSize: "M" | "L";
    readonly requireDestinationDemand: boolean;
  },
): Promise<{
  readonly commodity: {
    readonly category: string | null;
    readonly id: string;
    readonly name: string;
  };
  readonly destination: {
    readonly isPlanetary: boolean;
    readonly stationId: string;
    readonly stationName: string;
    readonly stationBuyPrice: number | undefined;
    readonly collectedAt: string;
    readonly demand: number | undefined;
  };
  readonly profit: number | undefined;
  readonly source: {
    readonly isPlanetary: boolean;
    readonly stationId: string;
    readonly stationName: string;
    readonly stationSellPrice: number | undefined;
    readonly collectedAt: string;
    readonly stock: number | undefined;
  };
} | null> {
  const result = await database.query<RoutePlannerReturnHaulRow>(
    routePlannerReturnHaulQuery({
      includeFleetCarriers: options.includeFleetCarriers,
      includePlanetary: options.includePlanetary,
      padSize: options.padSize,
      requireDestinationDemand: options.requireDestinationDemand,
    }),
    [options.destinationSystemId, options.originSystemId],
  );
  const row = result.rows[0];

  if (!row) {
    return null;
  }

  return {
    commodity: {
      category: row.commodity_category,
      id: row.commodity_id,
      name: row.commodity_name,
    },
    destination: {
      isPlanetary: row.destination_is_planetary === true,
      collectedAt: formatJsonDate(row.destination_collected_at),
      demand: readOptionalNumber(row.demand),
      stationBuyPrice: readOptionalNumber(row.station_buy_price),
      stationId: String(row.destination_station_id),
      stationName: row.destination_station_name,
    },
    profit: readOptionalNumber(row.profit),
    source: {
      isPlanetary: row.source_is_planetary === true,
      stationId: String(row.source_station_id),
      stationName: row.source_station_name,
      stationSellPrice: readOptionalNumber(row.station_sell_price),
      collectedAt: formatJsonDate(row.source_collected_at),
      stock: readOptionalNumber(row.stock),
    },
  };
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
