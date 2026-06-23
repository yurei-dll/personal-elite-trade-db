#!/usr/bin/env node

import type { ManagedEnvUpdates } from "./config";
import { loadConfig, saveManagedEnvValues } from "./config";
import type { DatabaseDoctorReport, DatabaseDoctorStatus } from "./database";
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
    }

    if (parsedArgs.runDoctor) {
      const report = await database.doctor();
      printDoctorReport(report, {
        databaseUrl: config.databaseUrl,
        nodeEnv: config.nodeEnv,
      });

      if (report.checks.some((check) => check.status === "error")) {
        process.exitCode = 1;
      }

      return;
    }

    if (!parsedArgs.initializeDatabase) {
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
  readonly runDoctor: boolean;
  readonly showHelp: boolean;
  readonly updatedLabels: readonly string[];
}

function parseArgs(args: readonly string[]): ParsedArgs {
  const envValues: ManagedEnvUpdates = {};
  const updatedLabels: string[] = [];
  let initializeDatabase = false;
  let runDoctor = false;

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
        runDoctor: false,
        showHelp: true,
        updatedLabels,
      };
    }

    if (arg === "--init") {
      initializeDatabase = true;
      continue;
    }

    if (arg === "--doctor") {
      runDoctor = true;
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
    runDoctor,
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

interface DoctorPrintOptions {
  readonly databaseUrl: string;
  readonly nodeEnv: string;
}

function printDoctorReport(
  report: DatabaseDoctorReport,
  options: DoctorPrintOptions,
): void {
  console.log("");
  console.log("Doctor report");
  console.log(`Node.js: ${process.version}`);
  console.log(`Runtime: ${options.nodeEnv}`);
  console.log(`Database URL: ${redactDatabaseUrl(options.databaseUrl)}`);

  if (report.connectionMilliseconds !== undefined) {
    console.log(`Connection time: ${report.connectionMilliseconds} ms`);
  }

  if (report.account) {
    console.log("");
    console.log("Account");
    console.log(`  Database: ${report.account.databaseName}`);
    console.log(`  Current user: ${report.account.currentUser}`);
    console.log(`  Session user: ${report.account.sessionUser}`);
    console.log(
      `  Privileges: CONNECT=${formatBoolean(report.account.canConnect)}, public USAGE=${formatBoolean(report.account.canUsePublicSchema)}, public CREATE=${formatBoolean(report.account.canCreateInPublicSchema)}`,
    );
  }

  if (report.server) {
    console.log("");
    console.log("Server");
    console.log(`  Version: ${report.server.version}`);
    console.log(`  Current schema: ${report.server.currentSchema ?? "(none)"}`);
    console.log(
      `  Address: ${report.server.serverAddress ?? "(local socket)"}:${report.server.serverPort ?? "(unknown)"}`,
    );
  }

  if (report.tables.length > 0) {
    console.log("");
    console.log("Tables");

    for (const table of report.tables) {
      const tableState = table.exists
        ? `${table.estimatedRows ?? "unknown"} estimated rows, ${table.totalSize ?? "unknown size"}`
        : "missing";
      console.log(`  ${table.name}: ${tableState}`);
    }
  }

  console.log("");
  console.log("Checks");

  for (const check of report.checks) {
    console.log(`  ${formatDoctorStatus(check.status)} ${check.name}`);
    console.log(indentMultiline(check.message, "    "));
  }
}

function formatDoctorStatus(status: DatabaseDoctorStatus): string {
  switch (status) {
    case "ok":
      return "[ok]";
    case "warning":
      return "[warn]";
    case "error":
      return "[error]";
  }
}

function formatBoolean(value: boolean): string {
  return value ? "yes" : "no";
}

function indentMultiline(value: string, indentation: string): string {
  return value
    .split("\n")
    .map((line) => `${indentation}${line}`)
    .join("\n");
}

function redactDatabaseUrl(databaseUrl: string): string {
  try {
    const parsedUrl = new URL(databaseUrl);

    if (parsedUrl.password) {
      parsedUrl.password = "REDACTED";
    }

    return parsedUrl.toString();
  } catch {
    return databaseUrl.replace(
      /^(postgres(?:ql)?:\/\/[^:@/?#]+:)([^@/?#]*)@/u,
      "$1REDACTED@",
    );
  }
}

function printHelp(): void {
  console.log(`personal-elite-trade-db

Usage:
  npm run dev
  npm run dev -- --doctor
  npm run dev -- --init
  npm run dev -- --dashboard-user-password <password>
  npm run dev -- --admin-user-password <password>

Database flags:
  --doctor                              Check connection, account, schema, and debug info.
  --init                                Create the database schema if needed.

Password flags:
  --dashboard-user-password <password>  Hash and save the dashboard password.
  --admin-user-password <password>      Hash and save the admin password.
`);
}
