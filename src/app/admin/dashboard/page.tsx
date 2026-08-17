import Link from "next/link";
import { SiteNav } from "@/components/SiteNav";
import { getUserStats } from "@/lib/reporting/users";
import { getAttendanceTrend } from "@/lib/reporting/attendance";
import { getRevenueTrend } from "@/lib/reporting/revenue";
import { getRecentAuditLogs } from "@/lib/reporting/auditLogs";
import { getOpenFlags } from "@/lib/reporting/flags";

const FLAG_LABELS = { needs_model: "Needs a model", full: "Full" } as const;

export default async function AdminDashboardPage() {
  const [userStats, attendanceTrend, revenueTrend, recentAuditLogs, openFlags] = await Promise.all([
    getUserStats(),
    getAttendanceTrend(),
    getRevenueTrend(),
    getRecentAuditLogs(),
    getOpenFlags(),
  ]);

  return (
    <>
      <SiteNav />
      <main>
      <h1>Reporting dashboard</h1>

      <h2>Accounts</h2>
      <p>{userStats.totalUsers} total users, {userStats.activeMembers} with an active membership.</p>
      <table>
        <thead>
          <tr>
            <th>Base role</th>
            <th>Count</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(userStats.byBaseRole).map(([role, count]) => (
            <tr key={role}>
              <td>{role}</td>
              <td>{count}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table>
        <thead>
          <tr>
            <th>Status</th>
            <th>Count</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(userStats.byStatus).map(([status, count]) => (
            <tr key={status}>
              <td>{status}</td>
              <td>{count}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Open flags (next 14 days)</h2>
      {openFlags.length === 0 ? (
        <p>Nothing flagged.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Type</th>
              <th>Flag</th>
            </tr>
          </thead>
          <tbody>
            {openFlags.map((flag) => (
              <tr key={`${flag.id}-${flag.reason}`}>
                <td>{new Date(flag.start_time).toLocaleString()}</td>
                <td>{flag.session_type}</td>
                <td>{FLAG_LABELS[flag.reason]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Attendance — trailing 12 weeks</h2>
      {attendanceTrend.length === 0 ? (
        <p>No completed sessions in this window.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Week of</th>
              <th>Sessions run</th>
              <th>Bookings</th>
              <th>Checked in</th>
              <th>Attendance rate</th>
            </tr>
          </thead>
          <tbody>
            {attendanceTrend.map((week) => (
              <tr key={week.weekStart.toISOString()}>
                <td>{new Date(week.weekStart).toLocaleDateString()}</td>
                <td>{week.sessionsRun}</td>
                <td>{week.totalBookings}</td>
                <td>{week.checkedInBookings}</td>
                <td>{week.attendanceRate === null ? "—" : `${Math.round(week.attendanceRate * 100)}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Revenue — trailing 12 weeks</h2>
      {revenueTrend.length === 0 ? (
        <p>No successful transactions in this window.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Week of</th>
              <th>By item type</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {revenueTrend.map((week) => (
              <tr key={week.weekStart.toISOString()}>
                <td>{new Date(week.weekStart).toLocaleDateString()}</td>
                <td>
                  {Object.entries(week.byItemType)
                    .map(([itemType, { count, total }]) => `${itemType}: ${count} ($${total.toFixed(2)})`)
                    .join(", ")}
                </td>
                <td>${week.totalRevenue.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Recent activity</h2>
      <p>
        <Link href="/admin/audit-logs">View full audit log</Link>
      </p>
      <table>
        <thead>
          <tr>
            <th>When</th>
            <th>Actor</th>
            <th>Action</th>
            <th>Target</th>
          </tr>
        </thead>
        <tbody>
          {recentAuditLogs.map((entry) => (
            <tr key={entry.id}>
              <td>{new Date(entry.created_at).toLocaleString()}</td>
              <td>{entry.actor_username ?? "—"}</td>
              <td>{entry.action_type}</td>
              <td>{entry.target_username ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
    </>
  );
}
