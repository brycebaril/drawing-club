import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getUserAuthContext, type UserAuthContext } from "./roles";

/**
 * Shared guard for admin-only Server Functions. Proxy (src/proxy.ts) covers
 * page renders, but Server Functions must re-check auth themselves
 * (see CLAUDE.md's "Server Functions" note) — this is that check, factored
 * out so every admin action doesn't repeat the same four lines.
 *
 * Redirects if there's no session at all (nothing useful to return to a
 * logged-out caller); returns null — for the caller to turn into an error
 * state — if there's a session but it isn't an Admin.
 */
export async function requireAdmin(): Promise<UserAuthContext | null> {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/login");

  const ctx = await getUserAuthContext(session.user.id);
  if (!ctx || !ctx.roles.includes("ADMIN")) return null;
  return ctx;
}
