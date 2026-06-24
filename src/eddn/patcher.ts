import type { DatabaseManager, DatabasePatch } from "../database";
import type {
  CommodityRow,
  StationCommodityRow,
} from "./parser";
import { parseMarketSnapshotRows } from "./parser";
import type { MarketSnapshot } from "./listener";

const DEFAULT_EDDN_PATCH_BATCH_SIZE = 500;

export interface EddnMarketPatchBufferOptions {
  readonly batchSize?: number;
}

export interface QueuedEddnMarketPatches {
  readonly patches: readonly DatabasePatch[];
  readonly warnings: readonly string[];
}

interface EddnMarketPatchRows {
  readonly commodities: readonly CommodityRow[];
  readonly stations: readonly StationRow[];
  readonly stationCommodities: readonly StationCommodityRow[];
}

interface StationRow {
  readonly id: number;
  readonly name: string;
  readonly systemName: string;
  readonly updatedAt: string;
}

export class EddnMarketPatchBuffer {
  private readonly batchSize: number;
  private readonly commodities = new Map<string, CommodityRow>();
  private readonly stations = new Map<number, StationRow>();
  private readonly stationCommodities = new Map<string, StationCommodityRow>();

  public constructor(options: EddnMarketPatchBufferOptions = {}) {
    this.batchSize = options.batchSize ?? DEFAULT_EDDN_PATCH_BATCH_SIZE;

    if (!Number.isInteger(this.batchSize) || this.batchSize < 1) {
      throw new Error("EDDN patch batch size must be a positive integer.");
    }
  }

  public queueSnapshot(snapshot: MarketSnapshot): QueuedEddnMarketPatches {
    const parsedRows = parseMarketSnapshotRows(snapshot);

    for (const commodity of parsedRows.commodities) {
      this.commodities.set(commodity.id, commodity);
    }

    if (parsedRows.station?.systemName && snapshot.collectedAt) {
      this.stations.set(parsedRows.station.id, {
        id: parsedRows.station.id,
        name: parsedRows.station.name,
        systemName: parsedRows.station.systemName,
        updatedAt: snapshot.collectedAt,
      });
    }

    for (const stationCommodity of parsedRows.stationCommodities) {
      this.stationCommodities.set(
        createStationCommodityKey(stationCommodity),
        stationCommodity,
      );
    }

    return {
      patches: this.drainReadyPatches(),
      warnings: parsedRows.warnings,
    };
  }

  public flush(): readonly DatabasePatch[] {
    if (
      this.commodities.size === 0 &&
      this.stations.size === 0 &&
      this.stationCommodities.size === 0
    ) {
      return [];
    }

    return [this.createPatch()];
  }

  private drainReadyPatches(): DatabasePatch[] {
    const patches: DatabasePatch[] = [];

    while (this.stationCommodities.size >= this.batchSize) {
      patches.push(this.createPatch());
    }

    return patches;
  }

  private createPatch(): DatabasePatch {
    const rows: EddnMarketPatchRows = {
      commodities: takeAllRows(this.commodities),
      stations: takeAllRows(this.stations),
      stationCommodities: takeRows(this.stationCommodities, this.batchSize),
    };
    const commodityCount = rows.commodities.length;
    const stationCount = rows.stations.length;
    const stationCommodityCount = rows.stationCommodities.length;

    return {
      id: `eddn-market-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      description: `Upsert ${commodityCount} commodities, ${stationCount} stations, and ${stationCommodityCount} station commodity rows from EDDN.`,
      async apply(database: DatabaseManager): Promise<void> {
        await applyEddnMarketPatch(database, rows);
      },
    };
  }
}

async function applyEddnMarketPatch(
  database: DatabaseManager,
  rows: EddnMarketPatchRows,
): Promise<void> {
  await database.transaction(async (client) => {
    if (rows.commodities.length > 0) {
      await client.query(
        `
          INSERT INTO commodities (id, name, category, updated_at)
          SELECT *
          FROM unnest(
            $1::text[],
            $2::text[],
            $3::text[],
            $4::timestamp with time zone[]
          )
          ON CONFLICT (id) DO UPDATE
          SET
            name = EXCLUDED.name,
            category = COALESCE(EXCLUDED.category, commodities.category),
            updated_at = EXCLUDED.updated_at
        `,
        [
          rows.commodities.map((commodity) => commodity.id),
          rows.commodities.map((commodity) => commodity.name),
          rows.commodities.map((commodity) => commodity.category),
          rows.commodities.map((commodity) => commodity.updatedAt),
        ],
      );
    }

    if (rows.stations.length > 0) {
      await client.query(
        `
          WITH patch_rows AS (
            SELECT *
            FROM unnest(
              $1::bigint[],
              $2::text[],
              $3::text[],
              $4::timestamp with time zone[]
            ) AS patch(id, name, system_name, updated_at)
          )
          INSERT INTO stations (
            id,
            system_id,
            name,
            type,
            distance_to_arrival,
            max_landing_pad_size,
            has_market,
            is_planetary,
            updated_at
          )
          SELECT
            patch.id,
            systems.id,
            patch.name,
            NULL,
            NULL,
            NULL,
            true,
            NULL,
            patch.updated_at
          FROM patch_rows patch
          JOIN systems
            ON systems.name = patch.system_name
          ON CONFLICT (id) DO UPDATE
          SET
            system_id = EXCLUDED.system_id,
            name = EXCLUDED.name,
            has_market = true,
            updated_at = EXCLUDED.updated_at
        `,
        [
          rows.stations.map((station) => station.id),
          rows.stations.map((station) => station.name),
          rows.stations.map((station) => station.systemName),
          rows.stations.map((station) => station.updatedAt),
        ],
      );
    }

    if (rows.stationCommodities.length > 0) {
      await client.query(
        `
          WITH patch_rows AS (
            SELECT *
            FROM unnest(
              $1::bigint[],
              $2::text[],
              $3::bigint[],
              $4::bigint[],
              $5::bigint[],
              $6::text[],
              $7::bigint[],
              $8::text[],
              $9::timestamp with time zone[],
              $10::text[]
            ) AS patch(
              station_id,
              commodity_id,
              station_sell_price,
              station_buy_price,
              demand,
              demand_level,
              stock,
              stock_level,
              collected_at,
              source
            )
          )
          INSERT INTO station_commodities (
            station_id,
            commodity_id,
            station_sell_price,
            station_buy_price,
            demand,
            demand_level,
            stock,
            stock_level,
            collected_at,
            received_at,
            source
          )
          SELECT
            patch.station_id,
            patch.commodity_id,
            patch.station_sell_price,
            patch.station_buy_price,
            patch.demand,
            patch.demand_level,
            patch.stock,
            patch.stock_level,
            patch.collected_at,
            now(),
            patch.source
          FROM patch_rows patch
          JOIN stations
            ON stations.id = patch.station_id
          JOIN commodities
            ON commodities.id = patch.commodity_id
          ON CONFLICT (station_id, commodity_id) DO UPDATE
          SET
            station_sell_price = EXCLUDED.station_sell_price,
            station_buy_price = EXCLUDED.station_buy_price,
            demand = EXCLUDED.demand,
            demand_level = EXCLUDED.demand_level,
            stock = EXCLUDED.stock,
            stock_level = EXCLUDED.stock_level,
            collected_at = EXCLUDED.collected_at,
            received_at = EXCLUDED.received_at,
            source = EXCLUDED.source
        `,
        [
          rows.stationCommodities.map((commodity) => commodity.stationId),
          rows.stationCommodities.map((commodity) => commodity.commodityId),
          rows.stationCommodities.map((commodity) => commodity.stationSellPrice),
          rows.stationCommodities.map((commodity) => commodity.stationBuyPrice),
          rows.stationCommodities.map((commodity) => commodity.demand),
          rows.stationCommodities.map((commodity) => commodity.demandLevel),
          rows.stationCommodities.map((commodity) => commodity.stock),
          rows.stationCommodities.map((commodity) => commodity.stockLevel),
          rows.stationCommodities.map((commodity) => commodity.collectedAt),
          rows.stationCommodities.map((commodity) => commodity.source),
        ],
      );
    }
  });
}

function takeRows<Row>(
  rows: Map<string | number, Row>,
  rowCount: number,
): Row[] {
  const takenRows: Row[] = [];

  for (const [key, row] of rows) {
    takenRows.push(row);
    rows.delete(key);

    if (takenRows.length >= rowCount) {
      break;
    }
  }

  return takenRows;
}

function takeAllRows<Row>(rows: Map<string | number, Row>): Row[] {
  const takenRows = [...rows.values()];
  rows.clear();
  return takenRows;
}

function createStationCommodityKey(row: StationCommodityRow): string {
  return `${row.stationId}:${row.commodityId}`;
}
