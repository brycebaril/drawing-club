import Link from "next/link";

export function AdminNav() {
  return (
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
          <Link href="/admin/audit-logs">Audit Logs</Link>
        </li>
        <li>
          <Link href="/dashboard">Dashboard</Link>
        </li>
      </ul>
    </nav>
  );
}
