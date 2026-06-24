#!/usr/bin/env node

import chalk from "chalk";
import type { AppConfig, ManagedEnvUpdates } from "./config";
import { loadConfig, saveManagedEnvValues } from "./config";
import type { DatabaseDoctorReport, DatabaseDoctorStatus } from "./database";
import { createDatabaseManager, importSystems } from "./database";
import { hashPassword, verifyPasswordHash } from "./dashboard";
import { createEddnListener } from "./eddn/listener";

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
    console.log(successText("Saved password hash updates to .env."));

    for (const label of parsedArgs.updatedLabels) {
      console.log(`${statusTag("ok")} Updated ${accentText(label)} password hash.`);
    }

    return;
  }

  if (parsedArgs.listenEddn) {
    await runEddnListener();
    return;
  }

  const config = loadConfig();

  if (parsedArgs.destroyDatabase) {
    await destroyDatabase(config, parsedArgs.destroyPassword);
    return;
  }

  printBanner();
  console.log(`${fieldLabel("Environment")}: ${valueText(config.nodeEnv)}`);
  console.log(`${fieldLabel("Database")}: ${valueText(config.databaseName)}`);
  console.log(`${fieldLabel("Database user")}: ${valueText(config.databaseUsername)}`);

  const database = createDatabaseManager(config);

  try {
    if (parsedArgs.initializeDatabase) {
      const result = await database.initialize();

      if (result.databaseCreated) {
        console.log(
          `${statusTag("created")} Database did not exist; created ${valueText(result.databaseName)}.`,
        );
      }

      console.log(`${statusTag("ok")} Database initialized.`);
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

    if (parsedArgs.importSystems) {
      if (!parsedArgs.initializeDatabase) {
        const result = await database.initialize();

        if (result.databaseCreated) {
          console.log(
            `${statusTag("created")} Database did not exist; created ${valueText(result.databaseName)}.`,
          );
        }

        console.log(`${statusTag("ok")} Database initialized.`);
      }

      const result = await importSystems(database, {
        filePath: parsedArgs.importFilePath,
      });

      console.log(
        `${statusTag("ok")} Imported ${valueText(
          String(result.systemsImported),
        )} systems across ${valueText(String(result.batchesPatched))} batches.`,
      );

      if (result.systemsSkipped > 0) {
        console.log(
          `${statusTag("warn")} Skipped ${valueText(
            String(result.systemsSkipped),
          )} malformed system records.`,
        );
      }

      return;
    }

    if (!parsedArgs.initializeDatabase) {
      await database.connect();
      console.log(`${statusTag("ok")} Database setup verified.`);
    }
  } finally {
    await database.close();
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${statusTag("error")} ${dangerText(message)}`);
    process.exitCode = 1;
  });
}

interface ParsedArgs {
  readonly destroyDatabase: boolean;
  readonly destroyPassword: string | undefined;
  readonly envValues: ManagedEnvUpdates;
  readonly hasPasswordUpdates: boolean;
  readonly importFilePath: string | undefined;
  readonly importSystems: boolean;
  readonly initializeDatabase: boolean;
  readonly listenEddn: boolean;
  readonly runDoctor: boolean;
  readonly showHelp: boolean;
  readonly updatedLabels: readonly string[];
}

function parseArgs(args: readonly string[]): ParsedArgs {
  const envValues: ManagedEnvUpdates = {};
  const updatedLabels: string[] = [];
  let destroyDatabase = false;
  let destroyPassword: string | undefined;
  let importFilePath: string | undefined;
  let importSystemsFlag = false;
  let initializeDatabase = false;
  let listenEddn = false;
  let runDoctor = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg) {
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      return {
        destroyDatabase: false,
        destroyPassword: undefined,
        envValues,
        hasPasswordUpdates: false,
        importFilePath: undefined,
        importSystems: false,
        initializeDatabase: false,
        listenEddn: false,
        runDoctor: false,
        showHelp: true,
        updatedLabels,
      };
    }

    if (arg === "--init") {
      initializeDatabase = true;
      continue;
    }

    if (arg === "--eddn") {
      listenEddn = true;
      continue;
    }

    if (arg === "--doctor") {
      runDoctor = true;
      continue;
    }

    if (arg === "--import") {
      importSystemsFlag = true;

      const nextArg = args[index + 1];

      if (nextArg && !nextArg.startsWith("--")) {
        importFilePath = nextArg;
        index += 1;
      }

      continue;
    }

    if (arg === "--destroy-db") {
      destroyDatabase = true;
      continue;
    }

    const parsedDestroyPassword = parseDestroyPasswordFlag(arg);

    if (parsedDestroyPassword) {
      const password =
        parsedDestroyPassword.password ??
        readRequiredFlagValue(args, index, parsedDestroyPassword.flag);

      if (parsedDestroyPassword.password === undefined) {
        index += 1;
      }

      if (!password) {
        throw new Error(`${parsedDestroyPassword.flag} requires a non-empty password.`);
      }

      destroyPassword = password;
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

  if (destroyDatabase && updatedLabels.length > 0) {
    throw new Error("Password hash updates cannot be combined with --destroy-db.");
  }

  if (destroyPassword !== undefined && !destroyDatabase) {
    throw new Error("--password can only be used with --destroy-db.");
  }

  if (destroyDatabase && destroyPassword === undefined) {
    throw new Error("--destroy-db requires --password <password>.");
  }

  return {
    destroyDatabase,
    destroyPassword,
    envValues,
    hasPasswordUpdates: updatedLabels.length > 0,
    importFilePath,
    importSystems: importSystemsFlag,
    initializeDatabase,
    listenEddn,
    runDoctor,
    showHelp: false,
    updatedLabels,
  };
}

async function destroyDatabase(
  config: AppConfig,
  password: string | undefined,
): Promise<void> {
  if (!config.adminPasswordHash) {
    throw new Error("ADMIN_PASSWORD_HASH is not set in .env.");
  }

  if (!password) {
    throw new Error("--destroy-db requires --password <password>.");
  }

  const isAuthorized = await verifyPasswordHash(password, config.adminPasswordHash);
  clearConsole();

  if (!isAuthorized) {
    throw new Error("Admin password did not match.");
  }

  printBanner();
  console.log(`${fieldLabel("Database")}: ${valueText(config.databaseName)}`);

  const database = createDatabaseManager(config);

  try {
    const destroyedDatabaseName = await database.destroy();
    console.log(`${statusTag("warn")} Database destroyed: ${valueText(destroyedDatabaseName)}`);
  } finally {
    await database.close();
  }
}

async function runEddnListener(): Promise<void> {
  const listener = createEddnListener();
  let isStopping = false;
  const stop = (): void => {
    if (isStopping) {
      return;
    }

    isStopping = true;
    console.log(`${statusTag("warn")} Stopping EDDN listener...`);
    void listener.stop();
  };

  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    await listener.start();
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
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

function parseDestroyPasswordFlag(arg: string): ParsedPasswordFlag | undefined {
  const equalsIndex = arg.indexOf("=");
  const flag = equalsIndex === -1 ? arg : arg.slice(0, equalsIndex);

  if (flag !== "--password") {
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
  console.log(sectionTitle("Doctor report"));
  console.log(`${fieldLabel("Node.js")}: ${valueText(process.version)}`);
  console.log(`${fieldLabel("Runtime")}: ${valueText(options.nodeEnv)}`);
  console.log(`${fieldLabel("Database URL")}: ${redactDatabaseUrl(options.databaseUrl)}`);

  if (report.connectionMilliseconds !== undefined) {
    console.log(
      `${fieldLabel("Connection time")}: ${valueText(`${report.connectionMilliseconds} ms`)}`,
    );
  }

  if (report.account) {
    console.log("");
    console.log(sectionTitle("Account"));
    console.log(`  ${fieldLabel("Database")}: ${valueText(report.account.databaseName)}`);
    console.log(`  ${fieldLabel("Current user")}: ${valueText(report.account.currentUser)}`);
    console.log(`  ${fieldLabel("Session user")}: ${valueText(report.account.sessionUser)}`);
    console.log(
      `  ${fieldLabel("Privileges")}: CONNECT=${formatBoolean(report.account.canConnect)}, public USAGE=${formatBoolean(report.account.canUsePublicSchema)}, public CREATE=${formatBoolean(report.account.canCreateInPublicSchema)}`,
    );
  }

  if (report.server) {
    console.log("");
    console.log(sectionTitle("Server"));
    console.log(`  ${fieldLabel("Version")}: ${valueText(report.server.version)}`);
    console.log(
      `  ${fieldLabel("Current schema")}: ${valueText(report.server.currentSchema ?? "(none)")}`,
    );
    console.log(
      `  ${fieldLabel("Address")}: ${valueText(
        `${report.server.serverAddress ?? "(local socket)"}:${report.server.serverPort ?? "(unknown)"}`,
      )}`,
    );
  }

  if (report.tables.length > 0) {
    console.log("");
    console.log(sectionTitle("Tables"));

    for (const table of report.tables) {
      const tableState = table.exists
        ? valueText(
            `${table.estimatedRows ?? "unknown"} estimated rows, ${table.totalSize ?? "unknown size"}`,
          )
        : dangerText("missing");
      console.log(`  ${accentText(table.name)}: ${tableState}`);
    }
  }

  console.log("");
  console.log(sectionTitle("Checks"));

  for (const check of report.checks) {
    console.log(`  ${formatDoctorStatus(check.status)} ${accentText(check.name)}`);
    console.log(indentMultiline(check.message, "    "));
  }
}

function formatDoctorStatus(status: DatabaseDoctorStatus): string {
  switch (status) {
    case "ok":
      return statusTag("ok");
    case "warning":
      return statusTag("warn");
    case "error":
      return statusTag("error");
  }
}

function formatBoolean(value: boolean): string {
  return value ? successText("yes") : dangerText("no");
}

function printBanner(): void {
  console.log(chalk.bold.hex("#ff5fd7")("personal-elite-trade-db"));
}

function sectionTitle(value: string): string {
  return chalk.bold.underline.hex("#5fd7ff")(value);
}

function fieldLabel(value: string): string {
  return chalk.bold.hex("#ffd75f")(value);
}

function valueText(value: string): string {
  return chalk.hex("#87ff87")(value);
}

function accentText(value: string): string {
  return chalk.bold.hex("#af87ff")(value);
}

function successText(value: string): string {
  return chalk.bold.greenBright(value);
}

function dangerText(value: string): string {
  return chalk.bold.redBright(value);
}

function statusTag(status: "created" | "error" | "ok" | "warn"): string {
  switch (status) {
    case "created":
      return chalk.bold.bgMagenta.white("[created]");
    case "error":
      return chalk.bold.bgRed.white("[error]");
    case "ok":
      return chalk.bold.bgGreen.black("[ok]");
    case "warn":
      return chalk.bold.bgYellow.black("[warn]");
  }
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
  npm run dev -- --import [systems file]
  npm run dev -- --destroy-db --password <admin password>
  npm run dev -- --eddn
  npm run dev -- --dashboard-user-password <password>
  npm run dev -- --admin-user-password <password>

Database flags:
  --doctor                              Check connection, account, schema, and debug info.
  --init                                Create the database schema if needed.
  --destroy-db                          Drop the configured PostgreSQL database.
  --password <password>                 Admin password required by --destroy-db.
  --import [systems file]               Import gzipped systems JSON from import/.

EDDN flags:
  --eddn                                Listen for commodity market messages and log them.

Password flags:
  --dashboard-user-password <password>  Hash and save the dashboard password.
  --admin-user-password <password>      Hash and save the admin password.
`);
}
