#!/usr/bin/env node

import { loadConfig } from "./config";
import { createDatabaseManager } from "./database";

export async function main(): Promise<void> {
  const config = loadConfig();

  console.log("personal-elite-trade-db");
  console.log(`Environment: ${config.nodeEnv}`);
  console.log(`Database: ${config.databaseName}`);
  console.log(`Database user: ${config.databaseUsername}`);

  const database = createDatabaseManager(config);

  try {
    await database.connect();
    console.log("Database setup verified.");
  } finally {
    await database.close();
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
