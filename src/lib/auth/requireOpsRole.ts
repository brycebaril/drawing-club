import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getUserAuthContext, type Role, type UserAuthContext } from "./roles";

/**
 * Shared guard for /ops/* Server Functions — like requireAdmin, but the
 * allowed role set varies per workspace (check-in: VOL_HOST+VOL_MBR,
 * model-booking: VOL_MBR, financials: VOL_CTRL) and volunteer sub-roles
 * aren't mutually exclusive, so this takes the caller's allowed list rather
 * than hardcoding one role. ADMIN is always allowed, matching every /ops/*
 * row in SiteOutline.md §4's route matrix.
 *
 * Redirects if there's no session at all; returns null — for the caller to
 * turn into an error state — if there's a session but none of the allowed
 * roles (or ADMIN).
 */
export async function requireOpsRole(allowed: Role[]): Promise<UserAuthContext | null> {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/login");

  const ctx = await getUserAuthContext(session.user.id);
  if (!ctx) return null;
  if (ctx.roles.includes("ADMIN")) return ctx;
  if (allowed.some((role) => ctx.roles.includes(role))) return ctx;
  return null;
}
