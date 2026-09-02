import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getUserAuthContext } from "@/lib/auth/roles";
import { SiteNav } from "@/components/SiteNav";
import { memberLabel } from "@/lib/users/memberLabel";

/**
 * Placeholder only — proves the auth/RBAC chain works end to end
 * (docs/SiteOutline.md §3.2 will replace this with the real member dashboard
 * in a later phase).
 */
export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/login?redirect=/dashboard");

  const ctx = await getUserAuthContext(session.user.id);
  if (!ctx) redirect("/auth/login");

  return (
    <>
      <SiteNav />
      <main>
        <h1>Dashboard</h1>
        <p>Logged in as {memberLabel(ctx.displayName, ctx.username)}</p>
        <p>Roles: {ctx.roles.join(", ")}</p>
        <p>Email verified: {ctx.emailVerified ? "yes" : "no"}</p>
      </main>
    </>
  );
}
