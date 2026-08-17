import Link from "next/link";
import type { Role } from "@/lib/auth/roles";
import { LogoutForm } from "./LogoutForm";
import { NotificationBanner } from "./NotificationBanner";

/**
 * Shared member-facing nav for /dashboard, /app/schedule, and /app/wallet —
 * previously only /dashboard had a (placeholder-only, inline) nav at all,
 * and it was the only page in the app offering logout.
 */
export function AppNav({ roles }: { roles: Role[] }) {
  const isAdmin = roles.includes("ADMIN");

  return (
    <>
      <nav>
        <ul>
          <li>
            <Link href="/dashboard">Dashboard</Link>
          </li>
          <li>
            <Link href="/app/schedule">Schedule</Link>
          </li>
          <li>
            <Link href="/app/wallet">Wallet</Link>
          </li>
          {isAdmin && (
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
          <li>
            <LogoutForm />
          </li>
        </ul>
      </nav>
      <NotificationBanner />
    </>
  );
}
