import { createReadStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createGunzip } from "node:zlib";

import type { DatabaseManager } from "./manager";

const DEFAULT_IMPORT_WORKSPACE = "import";
const DEFAULT_SYSTEMS_IMPORT_FILE = "systemsWithCoordinates7days.json.gz";
const DEFAULT_BATCH_SIZE = 50;

export interface SystemsImportOptions {
  readonly batchSize?: number;
  readonly filePath?: string;
  readonly logger?: Pick<Console, "log" | "warn">;
  readonly workspacePath?: string;
}

export interface SystemsImportResult {
  readonly batchesPatched: number;
  readonly filePath: string;
  readonly systemsImported: number;
  readonly systemsSkipped: number;
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
  let batchesPatched = 0;
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

    batch.push(system);

    if (batch.length >= batchSize) {
      await patchSystems(database, batch);
      batchesPatched += 1;
      systemsImported += batch.length;
      batch.length = 0;
    }
  }

  if (batch.length > 0) {
    await patchSystems(database, batch);
    batchesPatched += 1;
    systemsImported += batch.length;
  }

  return {
    batchesPatched,
    filePath,
    systemsImported,
    systemsSkipped,
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

async function patchSystems(
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
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
