import Link from "next/link";
import { SiteNav } from "@/components/SiteNav";

/**
 * reporting-overhaul Phase 1: the new home for parameterized reports,
 * alongside (not replacing, yet) /admin/dashboard and /ops/financials —
 * see docs plan file's "Consolidation" decision. Attendance/Model
 * Payouts/Revenue land here in a later phase.
 */
export default function AdminReportsIndexPage() {
  return (
    <>
      <SiteNav />
      <main>
        <h1>Reports</h1>
        <p>Flexible, filterable lookups — a work in progress alongside the existing dashboard.</p>
        <ul>
          <li>
            <Link href="/admin/reports/passes">Passes</Link> — wallet contents by status, cost basis, owner role,
            origin
          </li>
          <li>
            <Link href="/admin/reports/members">Members</Link> — by role, membership status, volunteer role; also
            covers the volunteer roster and &ldquo;staff without an active membership&rdquo;
          </li>
        </ul>
      </main>
    </>
  );
}
