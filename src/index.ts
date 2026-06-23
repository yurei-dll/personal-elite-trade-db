#!/usr/bin/env node

import type { ManagedEnvUpdates } from "./config";
import { loadConfig, saveManagedEnvValues } from "./config";
import { createDatabaseManager } from "./database";
import { hashPassword } from "./dashboard";

const DASHBOARD_PASSWORD_FLAGS = new Set([
  "--dashboard-user-password",
  "--dashboard-password",
]);
const ADMIN_PASSWORD_FLAGS = new Set(["--admin-user-password", "--admin-password"]);

export async function main(args: readonly string[] = process.argv.slice(2)): Promise<void> {
  const parsedArgs = parseArgs(args);

  if (parsedArgs.showHelp) {
    printHelp();
    return;
  }

  if (parsedArgs.hasPasswordUpdates) {
    clearConsole();
    saveManagedEnvValues(parsedArgs.envValues);
    console.log("Saved password hash updates to .env.");

    for (const label of parsedArgs.updatedLabels) {
      console.log(`Updated ${label} password hash.`);
    }

    return;
  }

  const config = loadConfig();

  console.log("personal-elite-trade-db");
  console.log(`Environment: ${config.nodeEnv}`);
  console.log(`Database: ${config.databaseName}`);
  console.log(`Database user: ${config.databaseUsername}`);

  const database = createDatabaseManager(config);

  try {
    if (parsedArgs.initializeDatabase) {
      await database.initialize();
      console.log("Database initialized.");
    } else {
      await database.connect();
      console.log("Database setup verified.");
    }
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

interface ParsedArgs {
  readonly envValues: ManagedEnvUpdates;
  readonly hasPasswordUpdates: boolean;
  readonly initializeDatabase: boolean;
  readonly showHelp: boolean;
  readonly updatedLabels: readonly string[];
}

function parseArgs(args: readonly string[]): ParsedArgs {
  const envValues: ManagedEnvUpdates = {};
  const updatedLabels: string[] = [];
  let initializeDatabase = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg) {
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      return {
        envValues,
        hasPasswordUpdates: false,
        initializeDatabase: false,
        showHelp: true,
        updatedLabels,
      };
    }

    if (arg === "--init") {
      initializeDatabase = true;
      continue;
    }

    const parsedFlag = parsePasswordFlag(arg);

    if (!parsedFlag) {
      throw new Error(`Unknown option: ${arg}`);
    }

    const password =
      parsedFlag.password ?? readRequiredFlagValue(args, index, parsedFlag.flag);

    if (parsedFlag.password === undefined) {
      index += 1;
    }

    if (!password) {
      throw new Error(`${parsedFlag.flag} requires a non-empty password.`);
    }

    if (DASHBOARD_PASSWORD_FLAGS.has(parsedFlag.flag)) {
      envValues.DASHBOARD_PASSWORD_HASH = hashPassword(password);
      updatedLabels.push("dashboard");
      continue;
    }

    envValues.ADMIN_PASSWORD_HASH = hashPassword(password);
    updatedLabels.push("admin");
  }

  return {
    envValues,
    hasPasswordUpdates: updatedLabels.length > 0,
    initializeDatabase,
    showHelp: false,
    updatedLabels,
  };
}

interface ParsedPasswordFlag {
  readonly flag: string;
  readonly password: string | undefined;
}

function parsePasswordFlag(arg: string): ParsedPasswordFlag | undefined {
  const equalsIndex = arg.indexOf("=");
  const flag = equalsIndex === -1 ? arg : arg.slice(0, equalsIndex);

  if (!DASHBOARD_PASSWORD_FLAGS.has(flag) && !ADMIN_PASSWORD_FLAGS.has(flag)) {
    return undefined;
  }

  return {
    flag,
    password: equalsIndex === -1 ? undefined : arg.slice(equalsIndex + 1),
  };
}

function readRequiredFlagValue(
  args: readonly string[],
  index: number,
  flag: string,
): string {
  const value = args[index + 1];

  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a password value.`);
  }

  return value;
}

function clearConsole(): void {
  if (process.stdout.isTTY) {
    process.stdout.write("\u001bc");
  }
}

function printHelp(): void {
  console.log(`personal-elite-trade-db

Usage:
  npm run dev
  npm run dev -- --init
  npm run dev -- --dashboard-user-password <password>
  npm run dev -- --admin-user-password <password>

Database flags:
  --init                                Create the database schema if needed.

Password flags:
  --dashboard-user-password <password>  Hash and save the dashboard password.
  --admin-user-password <password>      Hash and save the admin password.
`);
}
