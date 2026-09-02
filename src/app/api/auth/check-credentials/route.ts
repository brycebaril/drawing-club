import { NextResponse } from "next/server";
import { pool } from "@/lib/db/pool";
import { verifyPassword, isLegacyBcryptHash, verifyLegacyBcryptPassword } from "@/lib/auth/password";
import { getUserAuthContext } from "@/lib/auth/roles";
import { isLoginRateLimited, recordLoginAttempt } from "@/lib/auth/rateLimit";
import { getClientIp } from "@/lib/auth/clientIp";

/**
 * Validates username/password WITHOUT creating a session, so the login UI
 * can decide whether to show the TOTP field before the real signIn() call
 * (docs/SecurityDocument.md's MFA flow, ArchitectureDocument-adjacent —
 * Auth.js's Credentials provider can't express a two-step authorize() on
 * its own). Shares the same rate-limit budget as the real sign-in.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const username = typeof body?.username === "string" ? body.username : null;
  const password = typeof body?.password === "string" ? body.password : null;

  if (!username || !password) {
    return NextResponse.json({ valid: false }, { status: 400 });
  }

  const ip = getClientIp(request.headers);

  if (await isLoginRateLimited(username, ip)) {
    return NextResponse.json({ valid: false, rateLimited: true }, { status: 429 });
  }

  // Accepts email as an alternate identifier, matching src/auth.ts's
  // authorize() — see that file's comment for why this is unambiguous.
  const userRow = await pool.query<{ id: string; password_hash: string }>(
    `SELECT id, password_hash FROM users WHERE username = $1 OR lower(email) = lower($1)`,
    [username],
  );
  if (userRow.rowCount === 0) {
    await recordLoginAttempt(username, ip, false);
    return NextResponse.json({ valid: false });
  }

  // Migrated legacy accounts (docs/MigrationPlan.md §7) carry a bcrypt hash
  // until authorize()'s real signIn() call re-hashes them to argon2id —
  // this pre-check has to accept that hash too, or an MFA-required migrated
  // account (e.g. a Board Member, who gets base_role='Admin') could never
  // get past this step to reach the TOTP field at all. No rehash happens
  // here — this route never creates a session; the real authorize() call
  // that follows handles the rehash.
  const { password_hash: passwordHash } = userRow.rows[0];
  const passwordOk = isLegacyBcryptHash(passwordHash)
    ? await verifyLegacyBcryptPassword(passwordHash, password)
    : await verifyPassword(passwordHash, password);
  if (!passwordOk) {
    await recordLoginAttempt(username, ip, false);
    return NextResponse.json({ valid: false });
  }

  const ctx = await getUserAuthContext(userRow.rows[0].id);
  if (!ctx || ctx.status !== "Active") {
    await recordLoginAttempt(username, ip, false);
    return NextResponse.json({ valid: false });
  }

  // Same fix as src/auth.ts's authorize(): any ENABLED MFA prompts for a
  // code, not just a mandatory-role one — this route is what actually
  // drives the login UI's decision to show the TOTP step at all
  // (src/app/auth/login/page.tsx), so the old "mfaRequired && mfaEnabled"
  // conflation here meant a voluntarily-enrolled non-admin's second login
  // never even reached authorize()'s own (already-fixed) TOTP check — the
  // UI would sign them in with no code prompt at all, silently bypassing
  // MFA they'd explicitly turned on.
  const totpRequired = ctx.mfaEnabled;
  return NextResponse.json({ valid: true, totpRequired });
}
