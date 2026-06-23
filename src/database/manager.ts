import type { AppConfig } from "../config";

export interface DatabaseManager {
  readonly databaseUrl: string;
  connect(): Promise<void>;
  close(): Promise<void>;
}

export function createDatabaseManager(config: AppConfig): DatabaseManager {
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL is required to create a database manager.");
  }

  return {
    databaseUrl: config.databaseUrl,
    async connect(): Promise<void> {
      throw new Error("Database connection is not implemented yet.");
    },
    async close(): Promise<void> {
      throw new Error("Database shutdown is not implemented yet.");
    },
  };
}
