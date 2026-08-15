/**
 * Local dev seed script (docs/ArchitectureDocument.md §5).
 *
 * This is a skeleton, not full coverage: it proves inserts work against the
 * real schema by creating one admin user. As features land (sessions, passes,
 * multi-week series, etc.) this script should grow to seed one account per
 * role and a representative spread of session/pass states, per §5 — it's
 * also reused to reset the `staging` environment between migration
 * rehearsals (docs/MigrationPlan.md §4), so keep it idempotent.
 */
import { hash } from "@node-rs/argon2";
import { pool } from "../src/lib/db/pool";

async function main() {
  const passwordHash = await hash("dev-password-change-me");

  const result = await pool.query(
    `INSERT INTO users (username, password_hash, email, email_verified_at, base_role, status)
     VALUES ($1, $2, $3, now(), 'Admin', 'Active')
     ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash
     RETURNING id, username`,
    ["admin", passwordHash, "admin@example.test"],
  );

  console.log("Seeded admin user:", result.rows[0]);
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
