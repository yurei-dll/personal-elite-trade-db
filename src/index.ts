#!/usr/bin/env node

import { loadConfig } from "./config";

export function main(): void {
  const config = loadConfig();

  console.log("personal-elite-trade-db");
  console.log(`Environment: ${config.nodeEnv}`);

  if (!config.databaseUrl) {
    console.log("DATABASE_URL is not configured yet.");
  }
}

if (require.main === module) {
  main();
}
