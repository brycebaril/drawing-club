/**
 * One-time legacy data cutover (docs/MigrationPlan.md). Reads from the
 * legacy Robostrar/Robobooker dump (via LEGACY_MYSQL_URL, always a
 * throwaway MySQL import — never a production legacy system) and writes
 * into this app's Postgres schema (via DATABASE_URL, same as every other
 * script in this repo).
 *
 * The whole run is one transaction: if anything fails partway, nothing
 * commits — matching MigrationPlan.md §8's rollback plan (migration is
 * read-only against the source, so a failed run just means fix-and-rerun).
 *
 * Refuses to run against a Postgres database that already has migrated
 * data (users.legacy_id IS NOT NULL) unless --reset is passed, which
 * truncates every table this script writes to first. This is meant for
 * repeated staging rehearsal (MigrationPlan.md §8 phase 4), not a single
 * unattended production run.
 */
import { pool } from "../src/lib/db/pool";
import { closeLegacyPool } from "./legacy-migration/mysqlSource";
import { migrateModels } from "./legacy-migration/models";
import { migrateUsers } from "./legacy-migration/users";
import { migrateTransactions } from "./legacy-migration/transactions";
import { migrateRolesAndMembership } from "./legacy-migration/rolesAndMembership";
import { migratePasses } from "./legacy-migration/passes";
import { migrateSessions } from "./legacy-migration/sessions";
import { migrateAttendanceHistory } from "./legacy-migration/attendanceHistory";
import type { MigrationReport } from "./legacy-migration/types";

const RESET_TABLES = [
  "legacy_attendance_history",
  "seat_reservations",
  "passes",
  "membership_history",
  "volunteer_roles",
  "transactions",
  "sessions",
  "models",
  "users",
] as const;

async function alreadyMigrated(): Promise<boolean> {
  const result = await pool.query(`SELECT 1 FROM users WHERE legacy_id IS NOT NULL LIMIT 1`);
  return (result.rowCount ?? 0) > 0;
}

async function resetDestinationTables(): Promise<void> {
  // Only ever run against a throwaway staging DB dedicated to migration
  // rehearsal — never intended for a DB with real post-cutover activity.
  await pool.query(`TRUNCATE ${RESET_TABLES.join(", ")} CASCADE`);
}

function printReport(report: MigrationReport) {
  console.log(`  ${report.table}: ${report.migrated} migrated, ${report.skipped} skipped`);
  for (const warning of report.warnings) {
    console.log(`    ! ${warning}`);
  }
}

function getCutoverDate(): Date {
  // --cutover-date exists only for repeatable staging rehearsal against a
  // dump whose own creation date has since fallen entirely into the past —
  // a real cutover run always uses the actual moment it executes
  // (docs/MigrationPlan.md §4), never a date fixed during planning.
  const arg = process.argv.find((a) => a.startsWith("--cutover-date="));
  return arg ? new Date(arg.split("=")[1]) : new Date();
}

async function main() {
  const reset = process.argv.includes("--reset");
  const cutoverDate = getCutoverDate();

  if (reset) {
    // Unconditional — don't gate this behind alreadyMigrated(), which only
    // checks users.legacy_id and can miss a prior partial run that touched
    // other tables (e.g. models) without ever getting as far as users.
    console.log("Resetting destination tables...");
    await resetDestinationTables();
  } else if (await alreadyMigrated()) {
    throw new Error(
      "This database already has migrated data (users.legacy_id is set). " +
        "Pass --reset to truncate and re-run, or point DATABASE_URL at a fresh database.",
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    console.log("Migrating...");
    printReport(await migrateModels(client));
    printReport(await migrateUsers(client));
    printReport(await migrateTransactions(client));
    printReport(await migrateRolesAndMembership(client));
    printReport(await migratePasses(client));
    printReport(await migrateSessions(client));
    printReport(await migrateAttendanceHistory(client, cutoverDate));

    await client.query("COMMIT");
    console.log("Migration committed.");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Migration failed, rolled back:", error);
    throw error;
  } finally {
    client.release();
  }
}

main()
  .catch(() => {
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeLegacyPool();
    await pool.end();
  });
