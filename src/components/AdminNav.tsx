import Link from "next/link";
import { LogoutForm } from "./LogoutForm";
import { NotificationBanner } from "./NotificationBanner";

export function AdminNav() {
  return (
    <>
      <nav>
        <ul>
          <li>
            <Link href="/admin/sessions">Sessions</Link>
          </li>
          <li>
            <Link href="/admin/users">Users</Link>
          </li>
          <li>
            <Link href="/admin/transactions">Transactions</Link>
          </li>
          <li>
            <Link href="/admin/passes">Passes</Link>
          </li>
          <li>
            <Link href="/admin/audit-logs">Audit Logs</Link>
          </li>
          <li>
            <Link href="/admin/dashboard">Reporting</Link>
          </li>
          <li>
            <Link href="/admin/api-keys">API Keys</Link>
          </li>
          <li>
            <Link href="/admin/settings">Settings</Link>
          </li>
          <li>
            <Link href="/dashboard">Dashboard</Link>
          </li>
          <li>
            <Link href="/app/schedule">Schedule</Link>
          </li>
          <li>
            <Link href="/app/wallet">Wallet</Link>
          </li>
          <li>
            <LogoutForm />
          </li>
        </ul>
      </nav>
      <NotificationBanner />
    </>
  );
}
