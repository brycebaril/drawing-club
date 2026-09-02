"use server";

import { redirect } from "next/navigation";
import { pool } from "@/lib/db/pool";
import { hashPassword } from "@/lib/auth/password";
import { sendVerificationEmail } from "@/lib/email/verification";
import { signIn } from "@/auth";
import { isValidEmail } from "@/lib/validation/email";

export interface RegisterState {
  error?: string;
}

const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;

interface PgError {
  code?: string;
}

export async function registerAction(
  _prevState: RegisterState,
  formData: FormData,
): Promise<RegisterState> {
  const displayName = String(formData.get("displayName") ?? "").trim();
  const username = String(formData.get("username") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!displayName) {
    return { error: "Enter your name." };
  }
  if (!USERNAME_RE.test(username)) {
    return { error: "Username must be 3-32 characters: letters, numbers, underscores only." };
  }
  if (!isValidEmail(email)) {
    return { error: "Enter a valid email address." };
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }

  const existing = await pool.query(`SELECT id FROM users WHERE username = $1 OR email = $2`, [
    username,
    email,
  ]);
  if ((existing.rowCount ?? 0) > 0) {
    return { error: "Username or email is already registered." };
  }

  const passwordHash = await hashPassword(password);

  let user: { id: string; username: string; email: string };
  try {
    const result = await pool.query<{ id: string; username: string; email: string }>(
      `INSERT INTO users (username, password_hash, email, display_name, base_role, status)
       VALUES ($1, $2, $3, $4, 'AccountHolder', 'Active')
       RETURNING id, username, email`,
      [username, passwordHash, email, displayName],
    );
    user = result.rows[0];
  } catch (error) {
    if ((error as PgError).code === "23505") {
      return { error: "Username or email is already registered." };
    }
    throw error;
  }

  await sendVerificationEmail(user);
  await signIn("credentials", { username, password, redirect: false });
  redirect("/dashboard");
}
