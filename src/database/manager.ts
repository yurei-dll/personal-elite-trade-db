import type { AppConfig } from "../config";
import { Pool } from "pg";
import type { PoolClient, QueryResult, QueryResultRow } from "pg";

export type DatabaseQueryParams = readonly unknown[];

export class DatabaseSetupError extends Error {
  public constructor(readonly problems: readonly string[]) {
    super(`Database schema is not set up correctly:\n${problems.join("\n")}`);
    this.name = "DatabaseSetupError";
  }
}

export type DatabaseDoctorStatus = "ok" | "warning" | "error";

export interface DatabaseDoctorCheck {
  readonly name: string;
  readonly status: DatabaseDoctorStatus;
  readonly message: string;
}

export interface DatabaseDoctorAccountInfo {
  readonly databaseName: string;
  readonly currentUser: string;
  readonly sessionUser: string;
  readonly canConnect: boolean;
  readonly canCreateInPublicSchema: boolean;
  readonly canUsePublicSchema: boolean;
}

export interface DatabaseDoctorServerInfo {
  readonly currentSchema: string | null;
  readonly serverAddress: string | null;
  readonly serverPort: number | null;
  readonly version: string;
}

export interface DatabaseDoctorTableInfo {
  readonly name: string;
  readonly exists: boolean;
  readonly estimatedRows: number | null;
  readonly totalSize: string | null;
}

export interface DatabaseDoctorReport {
  readonly account: DatabaseDoctorAccountInfo | undefined;
  readonly checks: readonly DatabaseDoctorCheck[];
  readonly connected: boolean;
  readonly connectionMilliseconds: number | undefined;
  readonly error: string | undefined;
  readonly server: DatabaseDoctorServerInfo | undefined;
  readonly tables: readonly DatabaseDoctorTableInfo[];
}

export interface DatabaseInitializeResult {
  readonly databaseCreated: boolean;
  readonly databaseName: string;
}

export interface DatabaseManager {
  readonly databaseUrl: string;
  readonly isConnected: boolean;
  connect(): Promise<void>;
  close(): Promise<void>;
  destroy(): Promise<string>;
  query<Row extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: DatabaseQueryParams,
  ): Promise<QueryResult<Row>>;
  transaction<Result>(
    callback: (client: PoolClient) => Promise<Result>,
  ): Promise<Result>;
  doctor(): Promise<DatabaseDoctorReport>;
  initialize(): Promise<DatabaseInitializeResult>;
  verifySetup(): Promise<void>;
}

interface ExpectedColumn {
  readonly name: string;
  readonly type: string;
  readonly isNullable: boolean;
}

interface ExpectedTable {
  readonly name: string;
  readonly columns: readonly ExpectedColumn[];
  readonly constraints: readonly ExpectedConstraint[];
  readonly foreignKeys: readonly ExpectedForeignKey[];
}

interface ExpectedConstraint {
  readonly type: "PRIMARY KEY" | "UNIQUE";
  readonly columns: readonly string[];
}

interface ExpectedForeignKey {
  readonly column: string;
  readonly referencedTable: string;
  readonly referencedColumn: string;
}

const EXPECTED_TABLES: readonly ExpectedTable[] = [
  {
    name: "systems",
    columns: [
      { name: "id", type: "bigint", isNullable: false },
      { name: "name", type: "text", isNullable: false },
      { name: "x", type: "double precision", isNullable: false },
      { name: "y", type: "double precision", isNullable: false },
      { name: "z", type: "double precision", isNullable: false },
      { name: "updated_at", type: "timestamp with time zone", isNullable: false },
    ],
    constraints: [
      { type: "PRIMARY KEY", columns: ["id"] },
      { type: "UNIQUE", columns: ["name"] },
    ],
    foreignKeys: [],
  },
  {
    name: "stations",
    columns: [
      { name: "id", type: "bigint", isNullable: false },
      { name: "system_id", type: "bigint", isNullable: false },
      { name: "name", type: "text", isNullable: false },
      { name: "type", type: "text", isNullable: true },
      { name: "distance_to_arrival", type: "double precision", isNullable: true },
      { name: "max_landing_pad_size", type: "text", isNullable: true },
      { name: "has_market", type: "boolean", isNullable: false },
      { name: "is_planetary", type: "boolean", isNullable: true },
      { name: "updated_at", type: "timestamp with time zone", isNullable: false },
    ],
    constraints: [
      { type: "PRIMARY KEY", columns: ["id"] },
      { type: "UNIQUE", columns: ["system_id", "name"] },
    ],
    foreignKeys: [
      { column: "system_id", referencedTable: "systems", referencedColumn: "id" },
    ],
  },
  {
    name: "commodities",
    columns: [
      { name: "id", type: "text", isNullable: false },
      { name: "name", type: "text", isNullable: false },
      { name: "category", type: "text", isNullable: true },
      { name: "updated_at", type: "timestamp with time zone", isNullable: false },
    ],
    constraints: [{ type: "PRIMARY KEY", columns: ["id"] }],
    foreignKeys: [],
  },
  {
    name: "station_commodities",
    columns: [
      { name: "station_id", type: "bigint", isNullable: false },
      { name: "commodity_id", type: "text", isNullable: false },
      { name: "station_sell_price", type: "bigint", isNullable: true },
      { name: "station_buy_price", type: "bigint", isNullable: true },
      { name: "demand", type: "bigint", isNullable: true },
      { name: "demand_level", type: "text", isNullable: true },
      { name: "stock", type: "bigint", isNullable: true },
      { name: "stock_level", type: "text", isNullable: true },
      { name: "collected_at", type: "timestamp with time zone", isNullable: false },
      { name: "received_at", type: "timestamp with time zone", isNullable: false },
      { name: "source", type: "text", isNullable: false },
    ],
    constraints: [
      { type: "PRIMARY KEY", columns: ["station_id", "commodity_id"] },
    ],
    foreignKeys: [
      { column: "station_id", referencedTable: "stations", referencedColumn: "id" },
      {
        column: "commodity_id",
        referencedTable: "commodities",
        referencedColumn: "id",
      },
    ],
  },
];

const EXPECTED_INDEXES = [
  "station_commodities_commodity_id_idx",
  "station_commodities_collected_at_idx",
] as const;

const EXPECTED_TABLE_NAMES = EXPECTED_TABLES.map((table) => table.name);
const SOCKET_DATABASE_URL_PATTERN =
  /^(postgres(?:ql)?:\/\/(?:[^@/?#]*@)?\/)([^/?#]+)(.*)$/u;

export function createDatabaseManager(config: AppConfig): DatabaseManager {
  const pool = new Pool({
    connectionString: config.databaseUrl,
    connectionTimeoutMillis: 5000,
  });

  let isConnected = false;

  return {
    databaseUrl: config.databaseUrl,
    get isConnected(): boolean {
      return isConnected;
    },
    async connect(): Promise<void> {
      const client = await pool.connect();

      try {
        await client.query("SELECT 1");
        await verifyDatabaseSetup(client);
        isConnected = true;
      } finally {
        client.release();
      }
    },
    async close(): Promise<void> {
      await pool.end();
      isConnected = false;
    },
    async destroy(): Promise<string> {
      const targetDatabaseName = readDatabaseNameFromUrl(config.databaseUrl);
      const maintenanceDatabaseName =
        targetDatabaseName === "postgres" ? "template1" : "postgres";
      const maintenancePool = new Pool({
        connectionString: replaceDatabaseNameInUrl(
          config.databaseUrl,
          maintenanceDatabaseName,
        ),
        connectionTimeoutMillis: 5000,
      });
      const client = await maintenancePool.connect();

      try {
        await client.query(
          `
            SELECT pg_terminate_backend(pid)
            FROM pg_stat_activity
            WHERE datname = $1
              AND pid <> pg_backend_pid()
          `,
          [targetDatabaseName],
        );
        await client.query(
          `DROP DATABASE IF EXISTS ${quoteIdentifier(targetDatabaseName)}`,
        );
        isConnected = false;
        return targetDatabaseName;
      } finally {
        client.release();
        await maintenancePool.end();
      }
    },
    async query<Row extends QueryResultRow = QueryResultRow>(
      sql: string,
      params: DatabaseQueryParams = [],
    ): Promise<QueryResult<Row>> {
      return pool.query<Row>(sql, [...params]);
    },
    async transaction<Result>(
      callback: (client: PoolClient) => Promise<Result>,
    ): Promise<Result> {
      const client = await pool.connect();

      try {
        await client.query("BEGIN");
        const result = await callback(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async doctor(): Promise<DatabaseDoctorReport> {
      const checks: DatabaseDoctorCheck[] = [];
      const startedAt = process.hrtime.bigint();
      let client: PoolClient | undefined;

      try {
        client = await pool.connect();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        return {
          account: undefined,
          checks: [
            {
              name: "connection",
              status: "error",
              message,
            },
          ],
          connected: false,
          connectionMilliseconds: undefined,
          error: message,
          server: undefined,
          tables: [],
        };
      }

      const connectionMilliseconds = Number(
        (process.hrtime.bigint() - startedAt) / 1_000_000n,
      );

      try {
        const account = await readDoctorAccountInfo(client);
        const server = await readDoctorServerInfo(client);
        const tables = await readDoctorTableInfo(client);
        const schemaProblems = await collectDatabaseSetupProblems(client);

        checks.push({
          name: "connection",
          status: "ok",
          message: `Connected in ${connectionMilliseconds} ms.`,
        });
        checks.push({
          name: "account",
          status:
            account.canConnect && account.canUsePublicSchema ? "ok" : "warning",
          message: createAccountCheckMessage(account),
        });
        checks.push({
          name: "tables",
          status: schemaProblems.length === 0 ? "ok" : "error",
          message:
            schemaProblems.length === 0
              ? "Expected tables, constraints, foreign keys, and indexes are present."
              : schemaProblems.join("\n"),
        });

        return {
          account,
          checks,
          connected: true,
          connectionMilliseconds,
          error: undefined,
          server,
          tables,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        checks.push({
          name: "doctor",
          status: "error",
          message,
        });

        return {
          account: undefined,
          checks,
          connected: true,
          connectionMilliseconds,
          error: message,
          server: undefined,
          tables: [],
        };
      } finally {
        client.release();
      }
    },
    async initialize(): Promise<DatabaseInitializeResult> {
      const databaseCreation = await ensureDatabaseExists(config.databaseUrl);
      const client = await pool.connect();

      try {
        await client.query("BEGIN");
        await initializeDatabaseSetup(client);
        await verifyDatabaseSetup(client);
        await client.query("COMMIT");
        isConnected = true;
        return databaseCreation;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async verifySetup(): Promise<void> {
      const client = await pool.connect();

      try {
        await verifyDatabaseSetup(client);
      } finally {
        client.release();
      }
    },
  };
}

function readDatabaseNameFromUrl(databaseUrl: string): string {
  try {
    const parsedUrl = new URL(databaseUrl);
    const databaseName = decodeURIComponent(parsedUrl.pathname.slice(1));

    if (databaseName) {
      return databaseName;
    }
  } catch {
    // The connection attempt will produce the most useful error for invalid URLs.
  }

  const socketMatch = SOCKET_DATABASE_URL_PATTERN.exec(databaseUrl);
  const socketDatabaseName = socketMatch?.[2]
    ? decodeURIComponent(socketMatch[2])
    : undefined;

  if (socketDatabaseName) {
    return socketDatabaseName;
  }

  throw new Error("Could not determine the configured database name.");
}

function replaceDatabaseNameInUrl(
  databaseUrl: string,
  databaseName: string,
): string {
  try {
    const parsedUrl = new URL(databaseUrl);
    parsedUrl.pathname = `/${encodeURIComponent(databaseName)}`;

    return parsedUrl.toString();
  } catch {
    const socketMatch = SOCKET_DATABASE_URL_PATTERN.exec(databaseUrl);

    if (socketMatch) {
      return `${socketMatch[1]}${encodeURIComponent(databaseName)}${socketMatch[3]}`;
    }
  }

  throw new Error("Could not update the configured database name.");
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/gu, '""')}"`;
}

interface DatabaseCreationResult {
  readonly created: boolean;
  readonly databaseName: string;
}

interface DatabaseExistsRow extends QueryResultRow {
  readonly exists: boolean;
}

async function ensureDatabaseExists(
  databaseUrl: string,
): Promise<DatabaseInitializeResult> {
  const targetDatabaseName = readDatabaseNameFromUrl(databaseUrl);
  const maintenanceDatabaseName =
    targetDatabaseName === "postgres" ? "template1" : "postgres";
  const maintenancePool = new Pool({
    connectionString: replaceDatabaseNameInUrl(
      databaseUrl,
      maintenanceDatabaseName,
    ),
    connectionTimeoutMillis: 5000,
  });
  const client = await maintenancePool.connect();

  try {
    const creationResult = await createDatabaseIfMissing(
      client,
      targetDatabaseName,
    );

    return {
      databaseCreated: creationResult.created,
      databaseName: creationResult.databaseName,
    };
  } finally {
    client.release();
    await maintenancePool.end();
  }
}

async function createDatabaseIfMissing(
  client: PoolClient,
  databaseName: string,
): Promise<DatabaseCreationResult> {
  const existsResult = await client.query<DatabaseExistsRow>(
    "SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS exists",
    [databaseName],
  );
  const exists = existsResult.rows[0]?.exists ?? false;

  if (exists) {
    return {
      created: false,
      databaseName,
    };
  }

  await client.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);

  return {
    created: true,
    databaseName,
  };
}

interface DoctorAccountRow extends QueryResultRow {
  readonly database_name: string;
  readonly current_user: string;
  readonly session_user: string;
  readonly can_connect: boolean;
  readonly can_create_in_public_schema: boolean;
  readonly can_use_public_schema: boolean;
}

interface DoctorServerRow extends QueryResultRow {
  readonly current_schema: string | null;
  readonly server_address: string | null;
  readonly server_port: number | null;
  readonly version: string;
}

interface DoctorTableRow extends QueryResultRow {
  readonly table_name: string;
  readonly estimated_rows: string | number | null;
  readonly total_size: string | null;
}

async function readDoctorAccountInfo(
  client: PoolClient,
): Promise<DatabaseDoctorAccountInfo> {
  const result = await client.query<DoctorAccountRow>(`
    SELECT
      current_database() AS database_name,
      current_user,
      session_user,
      has_database_privilege(current_database(), 'CONNECT') AS can_connect,
      has_schema_privilege('public', 'CREATE') AS can_create_in_public_schema,
      has_schema_privilege('public', 'USAGE') AS can_use_public_schema
  `);
  const row = result.rows[0];

  if (!row) {
    throw new Error("Could not read database account details.");
  }

  return {
    databaseName: row.database_name,
    currentUser: row.current_user,
    sessionUser: row.session_user,
    canConnect: row.can_connect,
    canCreateInPublicSchema: row.can_create_in_public_schema,
    canUsePublicSchema: row.can_use_public_schema,
  };
}

async function readDoctorServerInfo(
  client: PoolClient,
): Promise<DatabaseDoctorServerInfo> {
  const result = await client.query<DoctorServerRow>(`
    SELECT
      current_schema() AS current_schema,
      inet_server_addr()::text AS server_address,
      inet_server_port() AS server_port,
      version()
  `);
  const row = result.rows[0];

  if (!row) {
    throw new Error("Could not read database server details.");
  }

  return {
    currentSchema: row.current_schema,
    serverAddress: row.server_address,
    serverPort: row.server_port,
    version: row.version,
  };
}

async function readDoctorTableInfo(
  client: PoolClient,
): Promise<DatabaseDoctorTableInfo[]> {
  const result = await client.query<DoctorTableRow>(
    `
      SELECT
        c.relname AS table_name,
        c.reltuples::bigint AS estimated_rows,
        pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size
      FROM pg_class c
      JOIN pg_namespace n
        ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND c.relname = ANY($1::text[])
    `,
    [EXPECTED_TABLE_NAMES],
  );
  const rowsByTable = new Map(result.rows.map((row) => [row.table_name, row]));

  return EXPECTED_TABLE_NAMES.map((tableName) => {
    const row = rowsByTable.get(tableName);
    const estimatedRows =
      row?.estimated_rows === undefined || row.estimated_rows === null
        ? null
        : Number(row.estimated_rows);

    return {
      name: tableName,
      exists: row !== undefined,
      estimatedRows,
      totalSize: row?.total_size ?? null,
    };
  });
}

function createAccountCheckMessage(account: DatabaseDoctorAccountInfo): string {
  const privileges = [
    account.canConnect ? "CONNECT ok" : "CONNECT missing",
    account.canUsePublicSchema ? "public USAGE ok" : "public USAGE missing",
    account.canCreateInPublicSchema ? "public CREATE ok" : "public CREATE missing",
  ];

  return `${account.currentUser} on ${account.databaseName}; ${privileges.join(", ")}.`;
}

async function initializeDatabaseSetup(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS systems (
      id bigint PRIMARY KEY,
      name text NOT NULL UNIQUE,
      x double precision NOT NULL,
      y double precision NOT NULL,
      z double precision NOT NULL,
      updated_at timestamp with time zone NOT NULL
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS stations (
      id bigint PRIMARY KEY,
      system_id bigint NOT NULL REFERENCES systems(id),
      name text NOT NULL,
      type text,
      distance_to_arrival double precision,
      max_landing_pad_size text,
      has_market boolean NOT NULL,
      is_planetary boolean,
      updated_at timestamp with time zone NOT NULL,
      UNIQUE (system_id, name)
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS commodities (
      id text PRIMARY KEY,
      name text NOT NULL,
      category text,
      updated_at timestamp with time zone NOT NULL
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS station_commodities (
      station_id bigint NOT NULL REFERENCES stations(id),
      commodity_id text NOT NULL REFERENCES commodities(id),
      station_sell_price bigint,
      station_buy_price bigint,
      demand bigint,
      demand_level text,
      stock bigint,
      stock_level text,
      collected_at timestamp with time zone NOT NULL,
      received_at timestamp with time zone NOT NULL,
      source text NOT NULL,
      PRIMARY KEY (station_id, commodity_id)
    )
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS station_commodities_commodity_id_idx
    ON station_commodities (commodity_id)
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS station_commodities_collected_at_idx
    ON station_commodities (collected_at)
  `);
}

interface ColumnCatalogRow extends QueryResultRow {
  readonly table_name: string;
  readonly column_name: string;
  readonly data_type: string;
  readonly is_nullable: "YES" | "NO";
}

interface ConstraintCatalogRow extends QueryResultRow {
  readonly table_name: string;
  readonly constraint_type: "PRIMARY KEY" | "UNIQUE";
  readonly columns: string[];
}

interface ForeignKeyCatalogRow extends QueryResultRow {
  readonly table_name: string;
  readonly column_name: string;
  readonly foreign_table_name: string;
  readonly foreign_column_name: string;
}

interface IndexCatalogRow extends QueryResultRow {
  readonly indexname: string;
}

async function verifyDatabaseSetup(client: PoolClient): Promise<void> {
  const problems = await collectDatabaseSetupProblems(client);

  if (problems.length > 0) {
    throw new DatabaseSetupError(problems);
  }
}

async function collectDatabaseSetupProblems(client: PoolClient): Promise<string[]> {
  const columnResult = await client.query<ColumnCatalogRow>(
    `
      SELECT table_name, column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])
      ORDER BY table_name, ordinal_position
    `,
    [EXPECTED_TABLE_NAMES],
  );
  const constraintResult = await client.query<ConstraintCatalogRow>(
    `
      SELECT
        tc.table_name,
        tc.constraint_type,
        array_agg(kcu.column_name::text ORDER BY kcu.ordinal_position)::text[] AS columns
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_schema = tc.constraint_schema
        AND kcu.constraint_name = tc.constraint_name
        AND kcu.table_schema = tc.table_schema
        AND kcu.table_name = tc.table_name
      WHERE tc.table_schema = 'public'
        AND tc.table_name = ANY($1::text[])
        AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
      GROUP BY tc.table_name, tc.constraint_name, tc.constraint_type
    `,
    [EXPECTED_TABLE_NAMES],
  );
  const foreignKeyResult = await client.query<ForeignKeyCatalogRow>(
    `
      SELECT
        tc.table_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_schema = tc.constraint_schema
        AND kcu.constraint_name = tc.constraint_name
        AND kcu.table_schema = tc.table_schema
        AND kcu.table_name = tc.table_name
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_schema = tc.constraint_schema
        AND ccu.constraint_name = tc.constraint_name
      WHERE tc.table_schema = 'public'
        AND tc.table_name = ANY($1::text[])
        AND tc.constraint_type = 'FOREIGN KEY'
    `,
    [EXPECTED_TABLE_NAMES],
  );
  const indexResult = await client.query<IndexCatalogRow>(
    `
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = ANY($1::text[])
    `,
    [EXPECTED_INDEXES],
  );
  const existingTableNames = new Set(
    columnResult.rows.map((row) => row.table_name),
  );

  const problems = [
    ...verifyColumns(columnResult.rows),
    ...verifyConstraints(constraintResult.rows, existingTableNames),
    ...verifyForeignKeys(foreignKeyResult.rows, existingTableNames),
    ...verifyIndexes(indexResult.rows, existingTableNames),
  ];

  return problems;
}

function verifyColumns(rows: readonly ColumnCatalogRow[]): string[] {
  const columnsByTable = new Map<string, Map<string, ColumnCatalogRow>>();

  for (const row of rows) {
    const tableColumns =
      columnsByTable.get(row.table_name) ?? new Map<string, ColumnCatalogRow>();
    tableColumns.set(row.column_name, row);
    columnsByTable.set(row.table_name, tableColumns);
  }

  const problems: string[] = [];

  for (const table of EXPECTED_TABLES) {
    const tableColumns = columnsByTable.get(table.name);

    if (!tableColumns) {
      problems.push(`- Missing table public.${table.name}`);
      continue;
    }

    for (const expectedColumn of table.columns) {
      const column = tableColumns.get(expectedColumn.name);

      if (!column) {
        problems.push(`- Missing column public.${table.name}.${expectedColumn.name}`);
        continue;
      }

      if (column.data_type !== expectedColumn.type) {
        problems.push(
          `- Column public.${table.name}.${expectedColumn.name} has type ${column.data_type}; expected ${expectedColumn.type}`,
        );
      }

      const isNullable = column.is_nullable === "YES";

      if (isNullable !== expectedColumn.isNullable) {
        problems.push(
          `- Column public.${table.name}.${expectedColumn.name} nullable=${isNullable}; expected ${expectedColumn.isNullable}`,
        );
      }
    }
  }

  return problems;
}

function verifyConstraints(
  rows: readonly ConstraintCatalogRow[],
  existingTableNames: ReadonlySet<string>,
): string[] {
  const constraintsByTable = new Map<string, ConstraintCatalogRow[]>();

  for (const row of rows) {
    constraintsByTable.set(row.table_name, [
      ...(constraintsByTable.get(row.table_name) ?? []),
      row,
    ]);
  }

  const problems: string[] = [];

  for (const table of EXPECTED_TABLES) {
    if (!existingTableNames.has(table.name)) {
      continue;
    }

    const tableConstraints = constraintsByTable.get(table.name) ?? [];

    for (const expectedConstraint of table.constraints) {
      const hasConstraint = tableConstraints.some(
        (constraint) =>
          constraint.constraint_type === expectedConstraint.type &&
          arraysMatch(constraint.columns, expectedConstraint.columns),
      );

      if (!hasConstraint) {
        problems.push(
          `- Missing ${expectedConstraint.type} on public.${table.name} (${expectedConstraint.columns.join(", ")})`,
        );
      }
    }
  }

  return problems;
}

function verifyIndexes(
  rows: readonly IndexCatalogRow[],
  existingTableNames: ReadonlySet<string>,
): string[] {
  if (!existingTableNames.has("station_commodities")) {
    return [];
  }

  const actualIndexes = new Set(rows.map((row) => row.indexname));

  return EXPECTED_INDEXES.flatMap((indexName) =>
    actualIndexes.has(indexName) ? [] : [`- Missing index public.${indexName}`],
  );
}

function verifyForeignKeys(
  rows: readonly ForeignKeyCatalogRow[],
  existingTableNames: ReadonlySet<string>,
): string[] {
  const foreignKeysByTable = new Map<string, ForeignKeyCatalogRow[]>();

  for (const row of rows) {
    foreignKeysByTable.set(row.table_name, [
      ...(foreignKeysByTable.get(row.table_name) ?? []),
      row,
    ]);
  }

  const problems: string[] = [];

  for (const table of EXPECTED_TABLES) {
    if (!existingTableNames.has(table.name)) {
      continue;
    }

    const tableForeignKeys = foreignKeysByTable.get(table.name) ?? [];

    for (const expectedForeignKey of table.foreignKeys) {
      const hasForeignKey = tableForeignKeys.some(
        (foreignKey) =>
          foreignKey.column_name === expectedForeignKey.column &&
          foreignKey.foreign_table_name === expectedForeignKey.referencedTable &&
          foreignKey.foreign_column_name === expectedForeignKey.referencedColumn,
      );

      if (!hasForeignKey) {
        problems.push(
          `- Missing foreign key public.${table.name}.${expectedForeignKey.column} -> public.${expectedForeignKey.referencedTable}.${expectedForeignKey.referencedColumn}`,
        );
      }
    }
  }

  return problems;
}

function arraysMatch(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
