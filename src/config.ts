export interface AppConfig {
  readonly adminPasswordHash: string | undefined;
  readonly databaseUrl: string | undefined;
  readonly dashboardPasswordHash: string | undefined;
  readonly nodeEnv: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    adminPasswordHash: env.ADMIN_PASSWORD_HASH,
    databaseUrl: env.DATABASE_URL,
    dashboardPasswordHash: env.DASHBOARD_PASSWORD_HASH,
    nodeEnv: env.NODE_ENV ?? "development",
  };
}
