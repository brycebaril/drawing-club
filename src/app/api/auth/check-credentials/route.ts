import { NextResponse } from "next/server";
import { pool } from "@/lib/db/pool";
import { verifyPassword } from "@/lib/auth/password";
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

  const ip = getClientIp(request);

  if (await isLoginRateLimited(username, ip)) {
    return NextResponse.json({ valid: false, rateLimited: true }, { status: 429 });
  }

  const userRow = await pool.query<{ id: string; password_hash: string }>(
    `SELECT id, password_hash FROM users WHERE username = $1`,
    [username],
  );
  if (userRow.rowCount === 0) {
    await recordLoginAttempt(username, ip, false);
    return NextResponse.json({ valid: false });
  }

  const passwordOk = await verifyPassword(userRow.rows[0].password_hash, password);
  if (!passwordOk) {
    await recordLoginAttempt(username, ip, false);
    return NextResponse.json({ valid: false });
  }

  const ctx = await getUserAuthContext(userRow.rows[0].id);
  if (!ctx || ctx.status !== "Active") {
    await recordLoginAttempt(username, ip, false);
    return NextResponse.json({ valid: false });
  }

  const totpRequired = ctx.mfaRequired && ctx.mfaEnabled;
  return NextResponse.json({ valid: true, totpRequired });
}
