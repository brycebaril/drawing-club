import type { PoolClient } from "pg";

export interface MigrationReport {
  table: string;
  migrated: number;
  skipped: number;
  warnings: string[];
}

export function emptyReport(table: string): MigrationReport {
  return { table, migrated: 0, skipped: 0, warnings: [] };
}

/** Every per-table migration function shares this shape: write through the
 * one transactional client the orchestrator holds open for the whole run. */
export type Migrator = (client: PoolClient) => Promise<MigrationReport>;
