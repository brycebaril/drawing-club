import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { pool } from "@/lib/db/pool";
import { verifyPassword } from "@/lib/auth/password";
import { getUserAuthContext } from "@/lib/auth/roles";
import { verifyTotpCode } from "@/lib/auth/totp";
import { isLoginRateLimited, recordLoginAttempt } from "@/lib/auth/rateLimit";
import { getClientIp } from "@/lib/auth/clientIp";

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  trustHost: true,
  secret: process.env.NEXTAUTH_SECRET,
  pages: {
    signIn: "/auth/login",
  },
  providers: [
    Credentials({
      credentials: {
        username: { label: "Username" },
        password: { label: "Password" },
        totpCode: { label: "Authenticator code" },
      },
      async authorize(credentials, request) {
        const username = credentials?.username;
        const password = credentials?.password;
        const totpCode = credentials?.totpCode;
        if (typeof username !== "string" || typeof password !== "string" || !username || !password) {
          return null;
        }

        const ip = getClientIp(request);

        if (await isLoginRateLimited(username, ip)) {
          return null;
        }

        const userRow = await pool.query<{ id: string; password_hash: string }>(
          `SELECT id, password_hash FROM users WHERE username = $1`,
          [username],
        );
        if (userRow.rowCount === 0) {
          await recordLoginAttempt(username, ip, false);
          return null;
        }
        const { id, password_hash: passwordHash } = userRow.rows[0];

        const passwordOk = await verifyPassword(passwordHash, password);
        if (!passwordOk) {
          await recordLoginAttempt(username, ip, false);
          return null;
        }

        const ctx = await getUserAuthContext(id);
        if (!ctx || ctx.status !== "Active") {
          // Suspended/Banned accounts can't start a new session even with a
          // correct password (docs/SecurityDocument.md §2).
          await recordLoginAttempt(username, ip, false);
          return null;
        }

        if (ctx.mfaRequired && ctx.mfaEnabled) {
          if (typeof totpCode !== "string" || !totpCode) {
            await recordLoginAttempt(username, ip, false);
            return null;
          }
          const secretRow = await pool.query<{ mfa_secret: string | null }>(
            `SELECT mfa_secret FROM users WHERE id = $1`,
            [id],
          );
          const secret = secretRow.rows[0]?.mfa_secret;
          if (!secret || !verifyTotpCode(secret, totpCode)) {
            await recordLoginAttempt(username, ip, false);
            return null;
          }
        }
        // ctx.mfaRequired && !ctx.mfaEnabled: first-time — let them sign in;
        // middleware routes them straight to /auth/mfa-setup for everything
        // else until enrollment completes.

        await recordLoginAttempt(username, ip, true);
        return { id: ctx.id, name: ctx.username };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) {
        token.userId = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && typeof token.userId === "string") {
        session.user.id = token.userId;
      }
      return session;
    },
  },
});
