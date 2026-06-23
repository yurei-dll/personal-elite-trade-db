import type { AppConfig } from "../config";
import { Pool } from "pg";
import type { PoolClient, QueryResult, QueryResultRow } from "pg";

export type DatabaseQueryParams = readonly unknown[];

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
}

export function createDatabaseManager(config: AppConfig): DatabaseManager {
  const pool = new Pool({
    connectionString: config.databaseUrl,
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
  };
}
