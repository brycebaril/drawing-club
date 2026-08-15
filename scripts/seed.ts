/**
 * Local dev seed script (docs/ArchitectureDocument.md §5).
 *
 * Not full coverage yet: creates one user per role tier relevant to the
 * auth/RBAC phase (Admin, an active Paid Member, a basic Account Holder) so
 * MFA and MBR-derived logic have something to exercise locally. As more
 * features land this should grow further — it's also reused to reset the
 * `staging` environment between migration rehearsals (docs/MigrationPlan.md
 * §4), so keep it idempotent.
 */
import { hashPassword } from "../src/lib/auth/password";
import { pool } from "../src/lib/db/pool";

const DEV_PASSWORD = "dev-password-change-me";

async function upsertUser(params: {
  username: string;
  email: string;
  baseRole: "AccountHolder" | "Admin";
  membershipExpiresAt?: Date;
}) {
  const passwordHash = await hashPassword(DEV_PASSWORD);
  const result = await pool.query(
    `INSERT INTO users (username, password_hash, email, email_verified_at, base_role, membership_expires_at, status)
     VALUES ($1, $2, $3, now(), $4, $5, 'Active')
     ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash
     RETURNING id, username, base_role`,
    [
      params.username,
      passwordHash,
      params.email,
      params.baseRole,
      params.membershipExpiresAt ?? null,
    ],
  );
  return result.rows[0];
}

async function main() {
  const oneYearFromNow = new Date();
  oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);

  const admin = await upsertUser({
    username: "admin",
    email: "admin@example.test",
    baseRole: "Admin",
  });
  const member = await upsertUser({
    username: "member",
    email: "member@example.test",
    baseRole: "AccountHolder",
    membershipExpiresAt: oneYearFromNow,
  });
  const basic = await upsertUser({
    username: "basic",
    email: "basic@example.test",
    baseRole: "AccountHolder",
  });

  console.log("Seeded users (all use password:", DEV_PASSWORD, "):");
  console.log(" -", admin);
  console.log(" -", member);
  console.log(" -", basic);
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
