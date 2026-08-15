import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { getUserAuthContext } from "@/lib/auth/roles";

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
    <main>
      <h1>Dashboard</h1>
      <p>Logged in as {ctx.username}</p>
      <p>Roles: {ctx.roles.join(", ")}</p>
      <p>Email verified: {ctx.emailVerified ? "yes" : "no"}</p>
      <nav>
        <ul>
          <li>
            <Link href="/app/schedule">Schedule</Link>
          </li>
          <li>
            <Link href="/app/wallet">Wallet</Link>
          </li>
          {ctx.roles.includes("ADMIN") && (
            <>
              <li>
                <Link href="/admin/sessions">Admin: Sessions</Link>
              </li>
              <li>
                <Link href="/admin/users">Admin: Users</Link>
              </li>
              <li>
                <Link href="/admin/audit-logs">Admin: Audit Logs</Link>
              </li>
            </>
          )}
        </ul>
      </nav>
      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/" });
        }}
      >
        <button type="submit">Log out</button>
      </form>
    </main>
  );
}
