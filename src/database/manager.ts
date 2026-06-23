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

export interface DatabaseManager {
  readonly databaseUrl: string;
  readonly isConnected: boolean;
  connect(): Promise<void>;
  close(): Promise<void>;
  query<Row extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: DatabaseQueryParams,
  ): Promise<QueryResult<Row>>;
  transaction<Result>(
    callback: (client: PoolClient) => Promise<Result>,
  ): Promise<Result>;
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
        array_agg(kcu.column_name ORDER BY kcu.ordinal_position) AS columns
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

  if (problems.length > 0) {
    throw new DatabaseSetupError(problems);
  }
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
