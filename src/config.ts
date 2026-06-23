export interface AppConfig {
  readonly databaseUrl: string | undefined;
  readonly nodeEnv: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    databaseUrl: env.DATABASE_URL,
    nodeEnv: env.NODE_ENV ?? "development",
  };
}
