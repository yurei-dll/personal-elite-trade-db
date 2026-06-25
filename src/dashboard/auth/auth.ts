import type { AppConfig } from "../../config";

export type DashboardAuthRole = "dashboard" | "admin";

export interface DashboardAuthManager {
  verifyPassword(role: DashboardAuthRole, password: string): Promise<boolean>;
}

export type PasswordHashVerifier = (
  password: string,
  passwordHash: string,
) => Promise<boolean>;

export interface DashboardAuthOptions {
  readonly adminPasswordHash: string | undefined;
  readonly dashboardPasswordHash: string | undefined;
  readonly verifyPasswordHash: PasswordHashVerifier;
}

export function createDashboardAuthManager(
  options: DashboardAuthOptions,
): DashboardAuthManager {
  return {
    async verifyPassword(
      role: DashboardAuthRole,
      password: string,
    ): Promise<boolean> {
      const passwordHash = getPasswordHashForRole(options, role);

      if (!passwordHash) {
        return false;
      }

      return options.verifyPasswordHash(password, passwordHash);
    },
  };
}

export function createDashboardAuthOptions(
  config: AppConfig,
  verifyPasswordHash: PasswordHashVerifier,
): DashboardAuthOptions {
  return {
    adminPasswordHash: config.adminPasswordHash,
    dashboardPasswordHash: config.dashboardPasswordHash,
    verifyPasswordHash,
  };
}

function getPasswordHashForRole(
  options: DashboardAuthOptions,
  role: DashboardAuthRole,
): string | undefined {
  switch (role) {
    case "admin":
      return options.adminPasswordHash;
    case "dashboard":
      return options.dashboardPasswordHash;
  }
}
