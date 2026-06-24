import type { MarketCommoditySnapshot, MarketSnapshot } from "./listener";

const LOW_LEVEL = 1;
const MEDIUM_LEVEL = 2;
const HIGH_LEVEL = 3;

export interface ParsedMarketLog {
  readonly snapshots: readonly MarketSnapshot[];
  readonly warnings: readonly string[];
}

export interface CommodityRow {
  readonly id: string;
  readonly name: string;
  readonly category: string | null;
  readonly updatedAt: string;
}

export interface StationCommodityRow {
  readonly stationId: number;
  readonly commodityId: string;
  readonly stationSellPrice: number | null;
  readonly stationBuyPrice: number | null;
  readonly demand: number | null;
  readonly demandLevel: string | null;
  readonly stock: number | null;
  readonly stockLevel: string | null;
  readonly collectedAt: string;
  readonly source: string;
}

export interface ParsedSystemIdentity {
  readonly name: string;
}

export interface ParsedStationIdentity {
  readonly id: number;
  readonly name: string;
  readonly systemName: string | undefined;
}

export interface ParsedMarketSnapshotRows {
  readonly system: ParsedSystemIdentity | undefined;
  readonly station: ParsedStationIdentity | undefined;
  readonly commodities: readonly CommodityRow[];
  readonly stationCommodities: readonly StationCommodityRow[];
  readonly warnings: readonly string[];
}

interface LoggedMarketSnapshot {
  readonly collectedAt?: unknown;
  readonly commodities?: unknown;
  readonly marketId?: unknown;
  readonly stationName?: unknown;
  readonly systemName?: unknown;
}

interface LoggedMarketCommodity {
  readonly buyPrice?: unknown;
  readonly demand?: unknown;
  readonly demandLevel?: unknown;
  readonly meanPrice?: unknown;
  readonly name?: unknown;
  readonly sellPrice?: unknown;
  readonly stock?: unknown;
  readonly stockLevel?: unknown;
}

export function parseMarketLog(logText: string): ParsedMarketLog {
  const warnings: string[] = [];
  const snapshots: MarketSnapshot[] = [];

  for (const candidate of readTopLevelJsonObjects(logText)) {
    let parsed: unknown;

    try {
      parsed = JSON.parse(candidate);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Skipped invalid JSON object: ${message}`);
      continue;
    }

    const snapshot = readLoggedMarketSnapshot(parsed);

    if (!snapshot) {
      warnings.push("Skipped JSON object that was not a market snapshot.");
      continue;
    }

    snapshots.push(snapshot);
  }

  return { snapshots, warnings };
}

export function parseMarketSnapshotRows(
  snapshot: MarketSnapshot,
  source = "eddn",
): ParsedMarketSnapshotRows {
  const warnings: string[] = [];
  const collectedAt = snapshot.collectedAt;

  if (!collectedAt) {
    warnings.push("Market snapshot does not include collectedAt/timestamp.");
  }

  if (!snapshot.marketId) {
    warnings.push("Market snapshot does not include marketId; station_commodities rows were skipped.");
  }

  if (!snapshot.systemName) {
    warnings.push("Market snapshot does not include systemName.");
  }

  if (!snapshot.stationName) {
    warnings.push("Market snapshot does not include stationName.");
  }

  warnings.push(
    "Commodity market snapshots do not include system id or coordinates, so systems/stations rows require another data source before insertion.",
  );

  const updatedAt = collectedAt ?? new Date(0).toISOString();
  const commodities = new Map<string, CommodityRow>();
  const stationCommodities: StationCommodityRow[] = [];

  for (const commodity of snapshot.commodities) {
    const commodityId = normalizeCommodityId(commodity.name);

    if (!commodityId) {
      warnings.push("Skipped commodity with an empty name.");
      continue;
    }

    commodities.set(commodityId, {
      id: commodityId,
      name: commodity.name,
      category: null,
      updatedAt,
    });

    if (snapshot.marketId && collectedAt) {
      stationCommodities.push(
        createStationCommodityRow(snapshot.marketId, commodityId, commodity, collectedAt, source),
      );
    }
  }

  return {
    system: snapshot.systemName ? { name: snapshot.systemName } : undefined,
    station:
      snapshot.marketId && snapshot.stationName
        ? {
            id: snapshot.marketId,
            name: snapshot.stationName,
            systemName: snapshot.systemName,
          }
        : undefined,
    commodities: [...commodities.values()],
    stationCommodities,
    warnings,
  };
}

function createStationCommodityRow(
  stationId: number,
  commodityId: string,
  commodity: MarketCommoditySnapshot,
  collectedAt: string,
  source: string,
): StationCommodityRow {
  return {
    stationId,
    commodityId,
    stationSellPrice: numberOrNull(commodity.sellPrice),
    stationBuyPrice: numberOrNull(commodity.buyPrice),
    demand: numberOrNull(commodity.demand),
    demandLevel: levelToText(commodity.demandLevel),
    stock: numberOrNull(commodity.stock),
    stockLevel: levelToText(commodity.stockLevel),
    collectedAt,
    source,
  };
}

function readLoggedMarketSnapshot(value: unknown): MarketSnapshot | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const logged = value as LoggedMarketSnapshot;

  if (!Array.isArray(logged.commodities)) {
    return undefined;
  }

  const commodities = logged.commodities
    .map(readLoggedMarketCommodity)
    .filter((commodity): commodity is MarketCommoditySnapshot => commodity !== undefined);

  if (commodities.length === 0) {
    return undefined;
  }

  return {
    collectedAt: readString(logged.collectedAt),
    commodities,
    marketId: readNumber(logged.marketId),
    stationName: readString(logged.stationName),
    systemName: readString(logged.systemName),
  };
}

function readLoggedMarketCommodity(
  value: unknown,
): MarketCommoditySnapshot | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const commodity = value as LoggedMarketCommodity;
  const name = readString(commodity.name);

  if (!name) {
    return undefined;
  }

  return {
    buyPrice: readNumber(commodity.buyPrice),
    demand: readNumber(commodity.demand),
    demandLevel: readNumber(commodity.demandLevel),
    meanPrice: readNumber(commodity.meanPrice),
    name,
    sellPrice: readNumber(commodity.sellPrice),
    stock: readNumber(commodity.stock),
    stockLevel: readNumber(commodity.stockLevel),
  };
}

function readTopLevelJsonObjects(text: string): string[] {
  const objects: string[] = [];
  let startIndex: number | undefined;
  let depth = 0;
  let isInString = false;
  let isEscaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (isInString) {
      if (isEscaped) {
        isEscaped = false;
      } else if (character === "\\") {
        isEscaped = true;
      } else if (character === "\"") {
        isInString = false;
      }

      continue;
    }

    if (character === "\"") {
      isInString = true;
      continue;
    }

    if (character === "{") {
      if (depth === 0) {
        startIndex = index;
      }

      depth += 1;
      continue;
    }

    if (character === "}") {
      depth -= 1;

      if (depth === 0 && startIndex !== undefined) {
        objects.push(text.slice(startIndex, index + 1));
        startIndex = undefined;
      }
    }
  }

  return objects;
}

function normalizeCommodityId(name: string): string {
  return name.trim().toLowerCase();
}

function levelToText(level: number | undefined): string | null {
  if (level === undefined) {
    return null;
  }

  if (level >= HIGH_LEVEL) {
    return "high";
  }

  if (level === MEDIUM_LEVEL) {
    return "medium";
  }

  if (level === LOW_LEVEL) {
    return "low";
  }

  return "none";
}

function numberOrNull(value: number | undefined): number | null {
  return value ?? null;
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
