export type DashboardSessionRole = "dashboard" | "admin";

export interface DashboardSession {
  readonly expiresAt: number;
  readonly role: DashboardSessionRole;
}

export interface DashboardStats {
  readonly commodities: number | undefined;
  readonly databaseSizeBytes: number | undefined;
  readonly lastPatchAt: Date | undefined;
  readonly latestCollectedAt: Date | undefined;
  readonly latestReceivedAt: Date | undefined;
  readonly marketRows: number | undefined;
  readonly staleMarketRows: number | undefined;
  readonly stations: number | undefined;
  readonly systems: number | undefined;
}

export interface DashboardHealth {
  readonly checks: readonly {
    readonly message: string;
    readonly name: string;
    readonly status: "error" | "ok" | "warning";
  }[];
  readonly connected: boolean;
  readonly connectionMilliseconds: number | undefined;
  readonly error: string | undefined;
}
