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
  baseRole?: "AccountHolder" | "Admin";
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
      params.baseRole ?? "AccountHolder",
      params.membershipExpiresAt ?? null,
    ],
  );
  return result.rows[0];
}

async function grantVolunteerRole(userId: string, role: string) {
  await pool.query(
    `INSERT INTO volunteer_roles (user_id, role) VALUES ($1, $2)
     ON CONFLICT (user_id, role) DO NOTHING`,
    [userId, role],
  );
}

async function upsertModel(name: string, contactInfo: string) {
  const result = await pool.query(
    `INSERT INTO models (name, contact_info) VALUES ($1, $2) RETURNING id, name`,
    [name, contactInfo],
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
  });

  // Ops workspaces (check-in, model booking, financials) — one dedicated
  // account per volunteer sub-role, kept separate rather than combined onto
  // one account for clarity when testing against them locally.
  const host = await upsertUser({
    username: "host",
    email: "host@example.test",
  });
  await grantVolunteerRole(host.id, "SessionManager");

  const modelBooker = await upsertUser({
    username: "modelbooker",
    email: "modelbooker@example.test",
  });
  await grantVolunteerRole(modelBooker.id, "ModelBooker");

  const controller = await upsertUser({
    username: "controller",
    email: "controller@example.test",
  });
  await grantVolunteerRole(controller.id, "Controller");

  // Models table has no unique constraint on name, so this only runs against
  // a freshly-migrated/seeded DB, not idempotently re-run — matches this
  // script's existing header note that it's also used to reset `staging`
  // between rehearsals (a fresh DB each time), not a repeatable local upsert.
  const modelsResult = await pool.query<{ count: string }>(`SELECT count(*) FROM models`);
  let models: { id: string; name: string }[] = [];
  if (Number(modelsResult.rows[0].count) === 0) {
    models = await Promise.all([
      upsertModel("Alex Rivera", "alex.rivera@example.test"),
      upsertModel("Jordan Lee", "jordan.lee@example.test"),
      upsertModel("Sam Okafor", "sam.okafor@example.test"),
    ]);
  }

  console.log("Seeded users (all use password:", DEV_PASSWORD, "):");
  console.log(" -", admin);
  console.log(" -", member);
  console.log(" -", basic);
  console.log(" -", { ...host, volunteerRole: "SessionManager" });
  console.log(" -", { ...modelBooker, volunteerRole: "ModelBooker" });
  console.log(" -", { ...controller, volunteerRole: "Controller" });
  if (models.length > 0) console.log("Seeded models:", models);
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
