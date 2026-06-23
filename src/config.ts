import { userInfo } from "node:os";

const DEFAULT_DATABASE_HOST = "/var/run/postgresql";
const DEFAULT_DATABASE_NAME = "personal_elite_trade_db";
const DEFAULT_DATABASE_PORT = 5432;

export interface AppConfig {
  readonly adminPasswordHash: string | undefined;
  readonly databaseName: string;
  readonly databaseUrl: string;
  readonly databaseUsername: string;
  readonly dashboardPasswordHash: string | undefined;
  readonly nodeEnv: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const databaseName = readOptionalEnv(env.DATABASE_NAME) ?? DEFAULT_DATABASE_NAME;
  const databaseUsername = readOptionalEnv(env.DATABASE_USERNAME) ?? userInfo().username;
  const databaseUrl =
    readOptionalEnv(env.DATABASE_URL) ??
    buildDatabaseUrl({
      databaseName,
      host: readOptionalEnv(env.DATABASE_HOST) ?? DEFAULT_DATABASE_HOST,
      password: readOptionalEnv(env.DATABASE_PASSWORD),
      port: parseDatabasePort(readOptionalEnv(env.DATABASE_PORT)),
      username: databaseUsername,
    });

  return {
    adminPasswordHash: env.ADMIN_PASSWORD_HASH,
    databaseName,
    databaseUrl,
    databaseUsername,
    dashboardPasswordHash: env.DASHBOARD_PASSWORD_HASH,
    nodeEnv: env.NODE_ENV ?? "development",
  };
}

function readOptionalEnv(value: string | undefined): string | undefined {
  const trimmedValue = value?.trim();

  return trimmedValue ? trimmedValue : undefined;
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

function parseDatabasePort(port: string | undefined): number {
  if (!port) {
    return DEFAULT_DATABASE_PORT;
  }

  const parsedPort = Number.parseInt(port, 10);

  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
    throw new Error(`Invalid DATABASE_PORT value: ${port}`);
  }

  return parsedPort;
}
