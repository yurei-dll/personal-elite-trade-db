import { createReadStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createGunzip } from "node:zlib";

import type { DatabaseManager } from "./manager";

const DEFAULT_IMPORT_WORKSPACE = "import";
const DEFAULT_SYSTEMS_IMPORT_FILE = "systemsWithCoordinates7days.json.gz";
const DEFAULT_STATIONS_IMPORT_FILE = "stations.json.gz";
const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_STATIONS_BATCH_SIZE = 1_000;
const DEFAULT_PROGRESS_RECORDS = 10_000;

export interface SystemsImportOptions {
  readonly batchSize?: number;
  readonly filePath?: string;
  readonly logger?: Pick<Console, "log" | "warn">;
  readonly workspacePath?: string;
}

export interface SystemsImportResult {
  readonly batchesPatched: number;
  readonly filePath: string;
  readonly systemDuplicatesSkipped: number;
  readonly systemsImported: number;
  readonly systemsSkipped: number;
  readonly workspacePath: string;
}

export interface StationsImportOptions {
  readonly batchSize?: number;
  readonly filePath?: string;
  readonly logger?: Pick<Console, "log" | "warn">;
  readonly workspacePath?: string;
}

export interface StationsImportResult {
  readonly batchesPatched: number;
  readonly filePath: string;
  readonly stationDuplicatesSkipped: number;
  readonly stationsImported: number;
  readonly stationsSkipped: number;
  readonly stationsWithoutImportedSystems: number;
  readonly workspacePath: string;
}

interface ImportedSystem {
  readonly id: number;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly updatedAt: string;
}

interface RawImportedSystem {
  readonly coords?: unknown;
  readonly date?: unknown;
  readonly id?: unknown;
  readonly name?: unknown;
}

interface RawCoordinates {
  readonly x?: unknown;
  readonly y?: unknown;
  readonly z?: unknown;
}

interface ImportedStation {
  readonly distanceToArrival: number | null;
  readonly hasMarket: boolean;
  readonly id: number;
  readonly isPlanetary: boolean | null;
  readonly maxLandingPadSize: string | null;
  readonly name: string;
  readonly systemId: number;
  readonly systemName: string | null;
  readonly type: string | null;
  readonly updatedAt: string;
}

interface RawImportedStation {
  readonly distanceToArrival?: unknown;
  readonly haveMarket?: unknown;
  readonly id?: unknown;
  readonly isPlanetary?: unknown;
  readonly marketId?: unknown;
  readonly maxLandingPadSize?: unknown;
  readonly name?: unknown;
  readonly systemId?: unknown;
  readonly systemName?: unknown;
  readonly type?: unknown;
  readonly updateTime?: unknown;
}

interface RawStationUpdateTime {
  readonly information?: unknown;
  readonly market?: unknown;
  readonly outfitting?: unknown;
  readonly shipyard?: unknown;
}

interface SystemIdRow {
  readonly id: string;
  readonly name: string;
}

interface ImportedSystemLookup {
  readonly ids: ReadonlySet<number>;
  readonly names: ReadonlyMap<string, number>;
}

interface ImportPatchResult {
  readonly duplicatesSkipped: number;
  readonly imported: number;
}

export async function importSystems(
  database: DatabaseManager,
  options: SystemsImportOptions = {},
): Promise<SystemsImportResult> {
  const logger = options.logger ?? console;
  const workspacePath = path.resolve(options.workspacePath ?? DEFAULT_IMPORT_WORKSPACE);
  const filePath = path.resolve(
    options.filePath ?? path.join(workspacePath, DEFAULT_SYSTEMS_IMPORT_FILE),
  );
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const batch: ImportedSystem[] = [];
  const startedAt = Date.now();
  let batchesPatched = 0;
  let systemsParsed = 0;
  let systemDuplicatesSkipped = 0;
  let systemsImported = 0;
  let systemsSkipped = 0;

  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error("Import batch size must be a positive integer.");
  }

  await mkdir(workspacePath, { recursive: true });
  logger.log(`Import workspace ready at ${workspacePath}`);
  logger.log(`Importing systems from ${filePath}`);

  for await (const candidate of streamTopLevelJsonObjects(filePath)) {
    const system = parseImportedSystem(candidate);

    if (!system) {
      systemsSkipped += 1;
      continue;
    }

    systemsParsed += 1;
    batch.push(system);

    if (batch.length >= batchSize) {
      const result = await patchSystems(database, batch, logger);
      batchesPatched += 1;
      systemDuplicatesSkipped += result.duplicatesSkipped;
      systemsImported += result.imported;
      batch.length = 0;
    }

    if (shouldLogImportProgress(systemsParsed)) {
      logSystemImportProgress(logger, {
        batchesPatched,
        startedAt,
        systemDuplicatesSkipped,
        systemsImported,
        systemsParsed,
        systemsSkipped,
      });
    }
  }

  if (batch.length > 0) {
    const result = await patchSystems(database, batch, logger);
    batchesPatched += 1;
    systemDuplicatesSkipped += result.duplicatesSkipped;
    systemsImported += result.imported;
  }

  return {
    batchesPatched,
    filePath,
    systemDuplicatesSkipped,
    systemsImported,
    systemsSkipped,
    workspacePath,
  };
}

export async function importStations(
  database: DatabaseManager,
  options: StationsImportOptions = {},
): Promise<StationsImportResult> {
  const logger = options.logger ?? console;
  const workspacePath = path.resolve(options.workspacePath ?? DEFAULT_IMPORT_WORKSPACE);
  const filePath = path.resolve(
    options.filePath ?? path.join(workspacePath, DEFAULT_STATIONS_IMPORT_FILE),
  );
  const batchSize = options.batchSize ?? DEFAULT_STATIONS_BATCH_SIZE;
  const batch: ImportedStation[] = [];
  const startedAt = Date.now();
  let batchesPatched = 0;
  let stationDuplicatesSkipped = 0;
  let stationsImported = 0;
  let stationsParsed = 0;
  let stationsSkipped = 0;
  let stationsWithoutImportedSystems = 0;

  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error("Import batch size must be a positive integer.");
  }

  await mkdir(workspacePath, { recursive: true });
  logger.log(`Import workspace ready at ${workspacePath}`);
  logger.log(`Importing stations from ${filePath}`);

  const importedSystems = await loadImportedSystemLookup(database);
  logger.log(
    `Loaded ${importedSystems.ids.size.toLocaleString()} imported systems for station matching.`,
  );

  for await (const candidate of streamTopLevelJsonObjects(filePath)) {
    const station = parseImportedStation(candidate);

    if (!station) {
      stationsSkipped += 1;
      continue;
    }

    stationsParsed += 1;

    const resolvedSystemId = resolveImportedStationSystemId(station, importedSystems);

    if (resolvedSystemId === undefined) {
      stationsWithoutImportedSystems += 1;
    } else {
      batch.push({ ...station, systemId: resolvedSystemId });
    }

    if (batch.length >= batchSize) {
      const result = await patchStations(database, batch, logger);
      stationDuplicatesSkipped += result.duplicatesSkipped;
      stationsImported += result.imported;
      batchesPatched += 1;
      batch.length = 0;
    }

    if (shouldLogStationImportProgress(stationsParsed)) {
      if (batch.length > 0) {
        const result = await patchStations(database, batch, logger);
        stationDuplicatesSkipped += result.duplicatesSkipped;
        stationsImported += result.imported;
        batchesPatched += 1;
        batch.length = 0;
      }

      logStationImportProgress(logger, {
        batchesPatched,
        stationDuplicatesSkipped,
        startedAt,
        stationsImported,
        stationsParsed,
        stationsSkipped,
        stationsWithoutImportedSystems,
      });
    }
  }

  if (batch.length > 0) {
    const result = await patchStations(database, batch, logger);
    stationDuplicatesSkipped += result.duplicatesSkipped;
    stationsImported += result.imported;
    batchesPatched += 1;
  }

  return {
    batchesPatched,
    filePath,
    stationDuplicatesSkipped,
    stationsImported,
    stationsSkipped,
    stationsWithoutImportedSystems,
    workspacePath,
  };
}

async function* streamTopLevelJsonObjects(
  filePath: string,
): AsyncGenerator<string> {
  const stream = createReadStream(filePath)
    .pipe(createGunzip())
    .setEncoding("utf8");
  let buffer = "";
  let objectStartIndex: number | undefined;
  let depth = 0;
  let isInString = false;
  let isEscaped = false;
  let scanIndex = 0;

  for await (const chunk of stream) {
    buffer += chunk;

    let compactUntil = 0;

    for (; scanIndex < buffer.length; scanIndex += 1) {
      const index = scanIndex;
      const character = buffer[index];

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
          objectStartIndex = index;
        }

        depth += 1;
        continue;
      }

      if (character !== "}") {
        continue;
      }

      depth -= 1;

      if (depth !== 0 || objectStartIndex === undefined) {
        continue;
      }

      yield buffer.slice(objectStartIndex, index + 1);
      compactUntil = index + 1;
      objectStartIndex = undefined;
    }

    if (compactUntil > 0) {
      buffer = buffer.slice(compactUntil);
      scanIndex -= compactUntil;

      if (objectStartIndex !== undefined) {
        objectStartIndex -= compactUntil;
      }
    } else if (objectStartIndex === undefined && depth === 0) {
      const keepFrom = Math.max(0, buffer.length - 1);
      buffer = buffer.slice(keepFrom);
      scanIndex -= keepFrom;
    }
  }

  if (depth !== 0 || isInString) {
    throw new Error("Import file ended before the current JSON object was complete.");
  }
}

function parseImportedSystem(candidate: string): ImportedSystem | undefined {
  let parsed: unknown;

  try {
    parsed = JSON.parse(candidate);
  } catch {
    return undefined;
  }

  if (!isPlainObject(parsed)) {
    return undefined;
  }

  const rawSystem = parsed as RawImportedSystem;
  const coords = rawSystem.coords;

  if (!isPlainObject(coords)) {
    return undefined;
  }

  const rawCoords = coords as RawCoordinates;
  const id = readNumber(rawSystem.id);
  const name = readString(rawSystem.name);
  const x = readNumber(rawCoords.x);
  const y = readNumber(rawCoords.y);
  const z = readNumber(rawCoords.z);
  const updatedAt = readDate(rawSystem.date);

  if (
    id === undefined ||
    !name ||
    x === undefined ||
    y === undefined ||
    z === undefined ||
    !updatedAt
  ) {
    return undefined;
  }

  return {
    id,
    name,
    x,
    y,
    z,
    updatedAt,
  };
}

function parseImportedStation(candidate: string): ImportedStation | undefined {
  const rawStation = readStationHeader(candidate);

  if (!rawStation) {
    return undefined;
  }

  const id = readNumber(rawStation.marketId) ?? readNumber(rawStation.id);
  const systemId = readNumber(rawStation.systemId);
  const systemName = readStringOrNull(rawStation.systemName);
  const name = readString(rawStation.name);
  const updatedAt = readStationUpdatedAt(rawStation.updateTime);

  if (id === undefined || systemId === undefined || !name || !updatedAt) {
    return undefined;
  }

  return {
    distanceToArrival: readNumberOrNull(rawStation.distanceToArrival),
    hasMarket: readBoolean(rawStation.haveMarket) ?? false,
    id,
    isPlanetary: readBooleanOrNull(rawStation.isPlanetary),
    maxLandingPadSize: readStringOrNull(rawStation.maxLandingPadSize),
    name,
    systemId,
    systemName,
    type: readStringOrNull(rawStation.type),
    updatedAt,
  };
}

function readStationHeader(candidate: string): RawImportedStation | undefined {
  const commoditiesIndex = candidate.indexOf("\"commodities\"");
  const header =
    commoditiesIndex < 0 ? candidate : `${candidate.slice(0, commoditiesIndex).replace(/,\s*$/u, "")}}`;

  try {
    const parsed = JSON.parse(header);

    return isPlainObject(parsed) ? (parsed as RawImportedStation) : undefined;
  } catch {
    return undefined;
  }
}

function readStationUpdatedAt(value: unknown): string | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const updateTime = value as RawStationUpdateTime;

  return (
    readDate(updateTime.information) ??
    readDate(updateTime.market) ??
    readDate(updateTime.shipyard) ??
    readDate(updateTime.outfitting)
  );
}

async function patchSystems(
  database: DatabaseManager,
  systems: readonly ImportedSystem[],
  logger: Pick<Console, "log" | "warn">,
): Promise<ImportPatchResult> {
  try {
    await patchSystemsBatch(database, systems);

    return { duplicatesSkipped: 0, imported: systems.length };
  } catch (error) {
    if (!isRecoverableImportDuplicateError(error)) {
      throw error;
    }
  }

  let duplicatesSkipped = 0;
  let imported = 0;

  for (const system of systems) {
    try {
      await patchSystemsBatch(database, [system]);
      imported += 1;
    } catch (error) {
      if (!isRecoverableImportDuplicateError(error)) {
        throw error;
      }

      duplicatesSkipped += 1;
      logger.warn(
        `Skipped duplicate system ${system.id} (${system.name}): ${formatImportError(error)}`,
      );
    }
  }

  return { duplicatesSkipped, imported };
}

async function patchSystemsBatch(
  database: DatabaseManager,
  systems: readonly ImportedSystem[],
): Promise<void> {
  await database.query(
    `
      INSERT INTO systems (id, name, x, y, z, updated_at)
      SELECT *
      FROM unnest(
        $1::bigint[],
        $2::text[],
        $3::double precision[],
        $4::double precision[],
        $5::double precision[],
        $6::timestamp with time zone[]
      )
      ON CONFLICT (id) DO UPDATE
      SET
        name = EXCLUDED.name,
        x = EXCLUDED.x,
        y = EXCLUDED.y,
        z = EXCLUDED.z,
        updated_at = EXCLUDED.updated_at
    `,
    [
      systems.map((system) => system.id),
      systems.map((system) => system.name),
      systems.map((system) => system.x),
      systems.map((system) => system.y),
      systems.map((system) => system.z),
      systems.map((system) => system.updatedAt),
    ],
  );
}

async function loadImportedSystemLookup(
  database: DatabaseManager,
): Promise<ImportedSystemLookup> {
  const result = await database.query<SystemIdRow>(
    "SELECT id::text AS id, name FROM systems",
  );
  const ids = new Set<number>();
  const names = new Map<string, number>();

  for (const row of result.rows) {
    const id = Number(row.id);

    if (!Number.isFinite(id)) {
      continue;
    }

    ids.add(id);
    names.set(row.name, id);
  }

  return { ids, names };
}

function resolveImportedStationSystemId(
  station: ImportedStation,
  importedSystems: ImportedSystemLookup,
): number | undefined {
  if (importedSystems.ids.has(station.systemId)) {
    return station.systemId;
  }

  if (!station.systemName) {
    return undefined;
  }

  return importedSystems.names.get(station.systemName);
}

async function patchStations(
  database: DatabaseManager,
  stations: readonly ImportedStation[],
  logger: Pick<Console, "log" | "warn">,
): Promise<ImportPatchResult> {
  try {
    return { duplicatesSkipped: 0, imported: await patchStationsBatch(database, stations) };
  } catch (error) {
    if (!isRecoverableImportDuplicateError(error)) {
      throw error;
    }
  }

  let duplicatesSkipped = 0;
  let imported = 0;

  for (const station of stations) {
    try {
      imported += await patchStationsBatch(database, [station]);
    } catch (error) {
      if (!isRecoverableImportDuplicateError(error)) {
        throw error;
      }

      duplicatesSkipped += 1;
      logger.warn(
        `Skipped duplicate station ${station.id} (${station.name}) in system ${station.systemId}: ${formatImportError(error)}`,
      );
    }
  }

  return { duplicatesSkipped, imported };
}

async function patchStationsBatch(
  database: DatabaseManager,
  stations: readonly ImportedStation[],
): Promise<number> {
  const result = await database.query(
    `
      WITH patch_rows AS (
        SELECT *
        FROM unnest(
          $1::bigint[],
          $2::bigint[],
          $3::text[],
          $4::text[],
          $5::double precision[],
          $6::text[],
          $7::boolean[],
          $8::boolean[],
          $9::timestamp with time zone[]
        ) AS patch(
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
        patch.system_id,
        patch.name,
        patch.type,
        patch.distance_to_arrival,
        patch.max_landing_pad_size,
        patch.has_market,
        patch.is_planetary,
        patch.updated_at
      FROM patch_rows patch
      JOIN systems
        ON systems.id = patch.system_id
      ON CONFLICT (id) DO UPDATE
      SET
        system_id = EXCLUDED.system_id,
        name = EXCLUDED.name,
        type = EXCLUDED.type,
        distance_to_arrival = EXCLUDED.distance_to_arrival,
        max_landing_pad_size = EXCLUDED.max_landing_pad_size,
        has_market = EXCLUDED.has_market,
        is_planetary = EXCLUDED.is_planetary,
        updated_at = EXCLUDED.updated_at
    `,
    [
      stations.map((station) => station.id),
      stations.map((station) => station.systemId),
      stations.map((station) => station.name),
      stations.map((station) => station.type),
      stations.map((station) => station.distanceToArrival),
      stations.map((station) => station.maxLandingPadSize),
      stations.map((station) => station.hasMarket),
      stations.map((station) => station.isPlanetary),
      stations.map((station) => station.updatedAt),
    ],
  );

  return result.rowCount ?? 0;
}

function logStationImportProgress(
  logger: Pick<Console, "log" | "warn">,
  stats: {
    readonly batchesPatched: number;
    readonly stationDuplicatesSkipped: number;
    readonly startedAt: number;
    readonly stationsImported: number;
    readonly stationsParsed: number;
    readonly stationsSkipped: number;
    readonly stationsWithoutImportedSystems: number;
  },
): void {
  const elapsedSeconds = Math.max(1, Math.round((Date.now() - stats.startedAt) / 1_000));
  const recordsPerSecond = Math.round(stats.stationsParsed / elapsedSeconds);

  logger.log(
    [
      `Station import progress: parsed ${stats.stationsParsed.toLocaleString()}`,
      `imported ${stats.stationsImported.toLocaleString()}`,
      `missing systems ${stats.stationsWithoutImportedSystems.toLocaleString()}`,
      `duplicates ${stats.stationDuplicatesSkipped.toLocaleString()}`,
      `malformed ${stats.stationsSkipped.toLocaleString()}`,
      `batches ${stats.batchesPatched.toLocaleString()}`,
      `${recordsPerSecond.toLocaleString()} records/s`,
    ].join("; "),
  );
}

function logSystemImportProgress(
  logger: Pick<Console, "log" | "warn">,
  stats: {
    readonly batchesPatched: number;
    readonly startedAt: number;
    readonly systemDuplicatesSkipped: number;
    readonly systemsImported: number;
    readonly systemsParsed: number;
    readonly systemsSkipped: number;
  },
): void {
  const elapsedSeconds = Math.max(1, Math.round((Date.now() - stats.startedAt) / 1_000));
  const recordsPerSecond = Math.round(stats.systemsParsed / elapsedSeconds);

  logger.log(
    [
      `System import progress: parsed ${stats.systemsParsed.toLocaleString()}`,
      `imported ${stats.systemsImported.toLocaleString()}`,
      `duplicates ${stats.systemDuplicatesSkipped.toLocaleString()}`,
      `malformed ${stats.systemsSkipped.toLocaleString()}`,
      `batches ${stats.batchesPatched.toLocaleString()}`,
      `${recordsPerSecond.toLocaleString()} records/s`,
    ].join("; "),
  );
}

function shouldLogStationImportProgress(stationsParsed: number): boolean {
  return shouldLogImportProgress(stationsParsed);
}

function shouldLogImportProgress(recordsParsed: number): boolean {
  return recordsParsed > 0 && recordsParsed % DEFAULT_PROGRESS_RECORDS === 0;
}

function isRecoverableImportDuplicateError(error: unknown): boolean {
  if (!isPlainObject(error)) {
    return false;
  }

  const code = error.code;

  return code === "23505" || code === "21000";
}

function formatImportError(error: unknown): string {
  if (!isPlainObject(error)) {
    return String(error);
  }

  const detail = typeof error.detail === "string" ? error.detail : undefined;
  const message = typeof error.message === "string" ? error.message : undefined;

  return detail ?? message ?? String(error);
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

function readNumberOrNull(value: unknown): number | null {
  return readNumber(value) ?? null;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readBooleanOrNull(value: unknown): boolean | null {
  return readBoolean(value) ?? null;
}

function readStringOrNull(value: unknown): string | null {
  return readString(value) ?? null;
}

function readDate(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  const timestamp = value.includes("T") ? value : value.replace(" ", "T");
  const withTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/u.test(timestamp)
    ? timestamp
    : `${timestamp}Z`;
  const date = new Date(withTimezone);

  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
