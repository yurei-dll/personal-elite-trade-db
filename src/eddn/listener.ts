import { inflateSync } from "node:zlib";

import { Subscriber } from "zeromq";

const DEFAULT_EDDN_RELAY_URL = "tcp://eddn.edcd.io:9500";
const COMMODITY_SCHEMA_MARKER = "/commodity/";

export interface EddnListener {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface EddnListenerOptions {
  readonly relayUrl?: string;
  readonly logger?: Pick<Console, "error" | "log" | "warn">;
}

interface EddnEnvelope {
  readonly $schemaRef?: unknown;
  readonly header?: unknown;
  readonly message?: unknown;
}

interface EddnCommodityMessage {
  readonly commodities?: unknown;
  readonly marketId?: unknown;
  readonly stationName?: unknown;
  readonly systemName?: unknown;
  readonly timestamp?: unknown;
}

interface EddnCommodity {
  readonly buyPrice?: unknown;
  readonly demand?: unknown;
  readonly demandBracket?: unknown;
  readonly meanPrice?: unknown;
  readonly name?: unknown;
  readonly sellPrice?: unknown;
  readonly stock?: unknown;
  readonly stockBracket?: unknown;
}

export interface MarketCommoditySnapshot {
  readonly buyPrice: number | undefined;
  readonly demand: number | undefined;
  readonly demandLevel: number | undefined;
  readonly meanPrice: number | undefined;
  readonly name: string;
  readonly sellPrice: number | undefined;
  readonly stock: number | undefined;
  readonly stockLevel: number | undefined;
}

export interface MarketSnapshot {
  readonly collectedAt: string | undefined;
  readonly commodities: readonly MarketCommoditySnapshot[];
  readonly marketId: number | undefined;
  readonly stationName: string | undefined;
  readonly systemName: string | undefined;
}

export function createEddnListener(
  options: EddnListenerOptions = {},
): EddnListener {
  const relayUrl = options.relayUrl ?? DEFAULT_EDDN_RELAY_URL;
  const logger = options.logger ?? console;
  let socket: Subscriber | undefined;
  let isRunning = false;
  let loopPromise: Promise<void> | undefined;

  return {
    async start(): Promise<void> {
      if (loopPromise) {
        return loopPromise;
      }

      socket = new Subscriber();
      socket.connect(relayUrl);
      socket.subscribe();
      isRunning = true;
      logger.log(`Listening for EDDN commodity market data at ${relayUrl}`);

      loopPromise = runListenerLoop(socket, logger).finally(() => {
        isRunning = false;
        socket = undefined;
        loopPromise = undefined;
      });

      return loopPromise;
    },
    async stop(): Promise<void> {
      if (!isRunning) {
        return;
      }

      isRunning = false;
      socket?.close();

      try {
        await loopPromise;
      } catch (error: unknown) {
        if (!isExpectedCloseError(error)) {
          throw error;
        }
      }
    },
  };
}

async function runListenerLoop(
  socket: Subscriber,
  logger: Pick<Console, "error" | "log" | "warn">,
): Promise<void> {
  try {
    for await (const [payload] of socket) {
      if (!payload) {
        continue;
      }

      const snapshot = parseMarketSnapshot(payload);

      if (!snapshot) {
        continue;
      }

      logMarketSnapshot(snapshot, logger);
    }
  } catch (error: unknown) {
    if (!isExpectedCloseError(error)) {
      throw error;
    }
  }
}

export function parseMarketSnapshot(
  compressedPayload: Buffer,
): MarketSnapshot | undefined {
  const parsed: unknown = JSON.parse(inflateSync(compressedPayload).toString("utf8"));

  if (!isEddnEnvelope(parsed) || !isCommoditySchema(parsed.$schemaRef)) {
    return undefined;
  }

  const message = parsed.message;

  if (!isCommodityMessage(message) || !Array.isArray(message.commodities)) {
    return undefined;
  }

  const commodities = message.commodities
    .map(readCommoditySnapshot)
    .filter((commodity): commodity is MarketCommoditySnapshot => Boolean(commodity));

  if (commodities.length === 0) {
    return undefined;
  }

  return {
    collectedAt: readString(message.timestamp),
    commodities,
    marketId: readNumber(message.marketId),
    stationName: readString(message.stationName),
    systemName: readString(message.systemName),
  };
}

function readCommoditySnapshot(
  commodity: unknown,
): MarketCommoditySnapshot | undefined {
  if (!isPlainObject(commodity)) {
    return undefined;
  }

  const eddnCommodity = commodity as EddnCommodity;
  const name = readString(eddnCommodity.name);

  if (!name) {
    return undefined;
  }

  return {
    buyPrice: readNumber(eddnCommodity.buyPrice),
    demand: readNumber(eddnCommodity.demand),
    demandLevel: readNumber(eddnCommodity.demandBracket),
    meanPrice: readNumber(eddnCommodity.meanPrice),
    name,
    sellPrice: readNumber(eddnCommodity.sellPrice),
    stock: readNumber(eddnCommodity.stock),
    stockLevel: readNumber(eddnCommodity.stockBracket),
  };
}

function logMarketSnapshot(
  snapshot: MarketSnapshot,
  logger: Pick<Console, "log">,
): void {
  logger.log(
    JSON.stringify(
      {
        collectedAt: snapshot.collectedAt,
        commodityCount: snapshot.commodities.length,
        commodities: snapshot.commodities,
        marketId: snapshot.marketId,
        stationName: snapshot.stationName,
        systemName: snapshot.systemName,
      },
      undefined,
      2,
    ),
  );
}

function isEddnEnvelope(value: unknown): value is EddnEnvelope {
  return isPlainObject(value);
}

function isCommoditySchema(schemaRef: unknown): boolean {
  return typeof schemaRef === "string" && schemaRef.includes(COMMODITY_SCHEMA_MARKER);
}

function isCommodityMessage(value: unknown): value is EddnCommodityMessage {
  return isPlainObject(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isExpectedCloseError(error: unknown): boolean {
  return error instanceof Error && /Socket is closed|Operation was interrupted/u.test(error.message);
}
