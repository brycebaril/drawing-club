/**
 * Connection to the legacy Robostrar/Robobooker MySQL dump
 * (docs/MigrationPlan.md, docs/LegacyDataAnalysis.md). Lives entirely under
 * scripts/, never src/lib/ — this is one-time cutover tooling the running
 * app never calls, and keeping mysql2 (and its Node built-ins) out of
 * src/lib/ means there's no risk of it ever leaking into the Next.js app
 * bundle the way importing pg from a client component once did (see
 * CLAUDE.md's Recurring session implementation notes).
 *
 * Always points at a throwaway MySQL import of the dump, never a
 * production legacy system — see LEGACY_MYSQL_URL in .env.example.
 */
import mysql from "mysql2/promise";

let pool: mysql.Pool | undefined;

export function legacyPool(): mysql.Pool {
  if (!pool) {
    const connectionString = process.env.LEGACY_MYSQL_URL;
    if (!connectionString) {
      throw new Error("LEGACY_MYSQL_URL is not set — see .env.example");
    }
    // dateStrings: true avoids mysql2's default DATE->JS-Date conversion,
    // which interprets the date in a timezone and can silently shift the
    // calendar day by one — the exact class of bug this codebase's own
    // parseDateOnly/toDateOnly helpers exist to avoid (see CLAUDE.md's
    // multi-week series notes). Plain "YYYY-MM-DD" strings sidestep it.
    pool = mysql.createPool({ uri: connectionString, dateStrings: true });
  }
  return pool;
}

export async function legacyQuery<T extends mysql.RowDataPacket[]>(
  sql: string,
  params?: unknown[],
): Promise<T> {
  const [rows] = await legacyPool().query<T>(sql, params);
  return rows;
}

export async function closeLegacyPool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}
