import type { DatabaseManager } from "./manager";

export interface DatabasePatch {
  readonly id: string;
  readonly description: string;
  apply(database: DatabaseManager): Promise<void>;
}

export async function applyDatabasePatches(
  database: DatabaseManager,
  patches: readonly DatabasePatch[] = [],
): Promise<void> {
  for (const patch of patches) {
    await patch.apply(database);
  }
}
