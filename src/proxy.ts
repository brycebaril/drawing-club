import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserAuthContext } from "@/lib/auth/roles";
import { isAllowed } from "@/lib/auth/rbac";

// Next.js Proxy (the current name for the former "middleware" convention,
// see node_modules/next/dist/docs/.../proxy.md) defaults to the Node.js
// runtime as of Next 16 — no opt-in needed, and setting a `runtime` export
// here would throw. That's what lets this query Postgres directly via the
// existing pg pool on every request, so status/role checks are always
// fresh rather than cached JWT claims — a ban takes effect immediately
// (docs/SecurityDocument.md §2).
export default auth(async (req) => {
  const { pathname } = req.nextUrl;
  const userId = req.auth?.user?.id;

  const ctx = userId ? await getUserAuthContext(userId) : null;
  const isActiveSession = ctx !== null && ctx.status === "Active";
  const roles = isActiveSession ? ctx.roles : null;

  // Suspended/Banned: treat exactly like logged out, everywhere.
  if (userId && !isActiveSession && pathname !== "/auth/login") {
    const loginUrl = new URL("/auth/login", req.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Mandatory MFA enrollment gate (docs/SecurityDocument.md §2): a session
  // that needs MFA but hasn't enrolled yet can reach nothing except the
  // enrollment page itself.
  if (isActiveSession && ctx.mfaRequired && !ctx.mfaEnabled && pathname !== "/auth/mfa-setup") {
    return NextResponse.redirect(new URL("/auth/mfa-setup", req.url));
  }

  if (isAllowed(pathname, roles)) {
    return NextResponse.next();
  }

  if (roles === null) {
    const loginUrl = new URL("/auth/login", req.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Authenticated but not permitted here (e.g. hitting /auth/login while
  // already signed in, or a role without access to this route) — bounce
  // somewhere valid rather than exposing a bare 403.
  return NextResponse.redirect(new URL("/dashboard", req.url));
});

// API routes are excluded entirely: they need their own auth handling (e.g.
// a 401 JSON response or a bearer-token check per ArchitectureDocument.md
// §9), not a redirect to an HTML login page.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|api/).*)"],
};
