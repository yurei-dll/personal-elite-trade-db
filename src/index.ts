#!/usr/bin/env node

import { loadConfig } from "./config";

export function main(): void {
  const config = loadConfig();

  console.log("personal-elite-trade-db");
  console.log(`Environment: ${config.nodeEnv}`);
  console.log(`Database: ${config.databaseName}`);
  console.log(`Database user: ${config.databaseUsername}`);
}

if (require.main === module) {
  main();
}
