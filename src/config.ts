import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";

const DEFAULT_DATABASE_HOST = "/var/run/postgresql";
const DEFAULT_DATABASE_NAME = "personal_elite_trade_db";
const DEFAULT_DATABASE_PORT = 5432;
const DEFAULT_NODE_ENV = "development";
const DEFAULT_CONFIG_FILE_NAME = "config.json";
const DEFAULT_ENV_FILE_NAME = ".env";

const MANAGED_ENV_KEYS = [
  "DATABASE_URL",
  "DATABASE_USERNAME",
  "DATABASE_PASSWORD",
  "DASHBOARD_PASSWORD_HASH",
  "ADMIN_PASSWORD_HASH",
] as const;

const DEFAULT_ENV_VALUES: Record<ManagedEnvKey, string> = {
  ADMIN_PASSWORD_HASH: "",
  DATABASE_PASSWORD: "",
  DATABASE_URL: "",
  DATABASE_USERNAME: "",
  DASHBOARD_PASSWORD_HASH: "",
};

export interface AppConfig {
  readonly adminPasswordHash: string | undefined;
  readonly databaseName: string;
  readonly databaseUrl: string;
  readonly databaseUsername: string;
  readonly dashboardPasswordHash: string | undefined;
  readonly nodeEnv: string;
}

export interface ConfigManagerOptions {
  readonly configPath?: string;
  readonly cwd?: string;
  readonly envPath?: string;
}

interface ManagedConfigFile {
  readonly database?: {
    readonly host?: unknown;
    readonly name?: unknown;
    readonly port?: unknown;
  };
  readonly nodeEnv?: unknown;
  readonly [key: string]: unknown;
}

type ManagedEnvKey = (typeof MANAGED_ENV_KEYS)[number];

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  options: ConfigManagerOptions = {},
): AppConfig {
  const cwd = options.cwd ?? process.cwd();
  const configPath = options.configPath ?? join(cwd, DEFAULT_CONFIG_FILE_NAME);
  const envPath = options.envPath ?? join(cwd, DEFAULT_ENV_FILE_NAME);
  const fileConfig = loadManagedConfigFile(configPath);
  const fileEnv = loadManagedEnvFile(envPath);
  const readEnvValue = (key: string): string | undefined =>
    readOptionalEnv(env[key]) ?? readOptionalEnv(fileEnv[key]);

  const databaseName =
    readEnvValue("DATABASE_NAME") ??
    readOptionalString(fileConfig.database?.name) ??
    DEFAULT_DATABASE_NAME;
  const databaseUsername =
    readEnvValue("DATABASE_USERNAME") ?? userInfo().username;
  const databaseHost =
    readEnvValue("DATABASE_HOST") ??
    readOptionalString(fileConfig.database?.host) ??
    DEFAULT_DATABASE_HOST;
  const databasePort = parseDatabasePort(
    readEnvValue("DATABASE_PORT") ?? readOptionalPort(fileConfig.database?.port),
  );
  const databaseUrl =
    readEnvValue("DATABASE_URL") ??
    buildDatabaseUrl({
      databaseName,
      host: databaseHost,
      password: readEnvValue("DATABASE_PASSWORD"),
      port: databasePort,
      username: databaseUsername,
    });

  return {
    adminPasswordHash: readEnvValue("ADMIN_PASSWORD_HASH"),
    databaseName,
    databaseUrl,
    databaseUsername,
    dashboardPasswordHash: readEnvValue("DASHBOARD_PASSWORD_HASH"),
    nodeEnv:
      readEnvValue("NODE_ENV") ??
      readOptionalString(fileConfig.nodeEnv) ??
      DEFAULT_NODE_ENV,
  };
}

function readOptionalEnv(value: string | undefined): string | undefined {
  const trimmedValue = value?.trim();

  return trimmedValue ? trimmedValue : undefined;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? readOptionalEnv(value) : undefined;
}

function readOptionalPort(value: unknown): string | number | undefined {
  if (typeof value === "string" || typeof value === "number") {
    return value;
  }

  return undefined;
}

interface DatabaseUrlOptions {
  readonly databaseName: string;
  readonly host: string;
  readonly password: string | undefined;
  readonly port: number;
  readonly username: string;
}

function buildDatabaseUrl(options: DatabaseUrlOptions): string {
  const credentials = options.password
    ? `${encodeURIComponent(options.username)}:${encodeURIComponent(options.password)}`
    : encodeURIComponent(options.username);
  const databaseName = encodeURIComponent(options.databaseName);

  if (options.host.startsWith("/")) {
    return `postgres://${credentials}@/${databaseName}?host=${encodeURIComponent(options.host)}`;
  }

  return `postgres://${credentials}@${options.host}:${options.port}/${databaseName}`;
}

function parseDatabasePort(port: string | number | undefined): number {
  if (!port) {
    return DEFAULT_DATABASE_PORT;
  }

  const parsedPort =
    typeof port === "number" ? port : Number.parseInt(port, 10);

  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
    throw new Error(`Invalid DATABASE_PORT value: ${port}`);
  }

  return parsedPort;
}

function loadManagedConfigFile(configPath: string): ManagedConfigFile {
  if (!existsSync(configPath)) {
    const defaultConfig = createDefaultConfigFile();
    writeConfigFile(configPath, defaultConfig);
    return defaultConfig;
  }

  const config = parseConfigFile(configPath);
  const managedConfig = mergeDefaultConfig(config);

  if (JSON.stringify(config) !== JSON.stringify(managedConfig)) {
    writeConfigFile(configPath, managedConfig);
  }

  return managedConfig;
}

function createDefaultConfigFile(): ManagedConfigFile {
  return {
    database: {
      host: DEFAULT_DATABASE_HOST,
      name: DEFAULT_DATABASE_NAME,
      port: DEFAULT_DATABASE_PORT,
    },
    nodeEnv: DEFAULT_NODE_ENV,
  };
}

function mergeDefaultConfig(config: ManagedConfigFile): ManagedConfigFile {
  const defaults = createDefaultConfigFile();

  return {
    ...config,
    database: {
      ...defaults.database,
      ...config.database,
    },
    nodeEnv: config.nodeEnv ?? defaults.nodeEnv,
  };
}

function parseConfigFile(configPath: string): ManagedConfigFile {
  try {
    const parsedConfig: unknown = JSON.parse(readFileSync(configPath, "utf8"));

    if (!isPlainObject(parsedConfig)) {
      throw new Error("Expected a JSON object.");
    }

    return normalizeConfigFile(parsedConfig);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read ${configPath}: ${reason}`);
  }
}

function normalizeConfigFile(
  config: Record<string, unknown>,
): ManagedConfigFile {
  const database = readDatabaseConfig(config.database);
  const nodeEnv = readConfigString(config.nodeEnv, "nodeEnv");

  return {
    ...config,
    database,
    nodeEnv,
  };
}

function readDatabaseConfig(value: unknown): ManagedConfigFile["database"] {
  if (value === undefined) {
    return undefined;
  }

  if (!isPlainObject(value)) {
    throw new Error("Expected database to be an object.");
  }

  return {
    ...value,
    host: readConfigString(value.host, "database.host"),
    name: readConfigString(value.name, "database.name"),
    port: readConfigPort(value.port, "database.port"),
  };
}

function readConfigString(value: unknown, key: string): string | undefined {
  if (value === undefined || typeof value === "string") {
    return value;
  }

  throw new Error(`Expected ${key} to be a string.`);
}

function readConfigPort(
  value: unknown,
  key: string,
): string | number | undefined {
  if (
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number"
  ) {
    return value;
  }

  throw new Error(`Expected ${key} to be a string or number.`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function writeConfigFile(
  configPath: string,
  config: ManagedConfigFile,
): void {
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

function loadManagedEnvFile(envPath: string): NodeJS.ProcessEnv {
  if (!existsSync(envPath)) {
    writeEnvFile(envPath, createDefaultEnvFile());
    return {};
  }

  const envFile = readFileSync(envPath, "utf8");
  const parsedEnv = parseEnvFile(envFile);
  const missingKeys = MANAGED_ENV_KEYS.filter((key) => !(key in parsedEnv));

  if (missingKeys.length > 0) {
    const additions = missingKeys.map(
      (key) => `${key}=${DEFAULT_ENV_VALUES[key]}`,
    );
    const separator = envFile.endsWith("\n") || envFile.length === 0 ? "" : "\n";
    writeFileSync(envPath, `${envFile}${separator}${additions.join("\n")}\n`);
  }

  return parsedEnv;
}

function createDefaultEnvFile(): string {
  return [
    "# Credentials and other secrets. Non-secret settings live in config.json.",
    ...MANAGED_ENV_KEYS.map((key) => `${key}=${DEFAULT_ENV_VALUES[key]}`),
    "",
  ].join("\n");
}

function writeEnvFile(envPath: string, contents: string): void {
  writeFileSync(envPath, contents, { mode: 0o600 });
}

function parseEnvFile(contents: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};

  for (const rawLine of contents.split(/\r?\n/u)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const equalsIndex = line.indexOf("=");

    if (equalsIndex === -1) {
      continue;
    }

    const key = line.slice(0, equalsIndex).trim();
    const value = line.slice(equalsIndex + 1).trim();

    if (key) {
      env[key] = unquoteEnvValue(value);
    }
  }

  return env;
}

function unquoteEnvValue(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
