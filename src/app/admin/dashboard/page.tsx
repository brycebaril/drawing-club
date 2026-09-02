import Link from "next/link";
import { SiteNav } from "@/components/SiteNav";
import { getUserStats } from "@/lib/reporting/users";
import { getAttendanceTrend } from "@/lib/reporting/attendance";
import { getRevenueTrend } from "@/lib/reporting/revenue";
import { getRecentAuditLogs } from "@/lib/reporting/auditLogs";
import { getOpenFlags } from "@/lib/reporting/flags";
import { getAccountClassStats, type AccountClassSummary } from "@/lib/reporting/accountClasses";
import { getAccountActivityStats } from "@/lib/reporting/accountActivity";
import { getTicketCirculationStats } from "@/lib/reporting/ticketCirculation";
import { ORG_TIMEZONE } from "@/lib/org";
import { memberLabelWithUsername } from "@/lib/users/memberLabel";

const FLAG_LABELS = { needs_model: "Needs a model", full: "Full" } as const;

function formatPct(pct: number | null): string {
  return pct === null ? "no data" : `${Math.round(pct * 100)}%`;
}

function AccountClassCard({ label, summary }: { label: string; summary: AccountClassSummary }) {
  return (
    <div className="stat-card">
      <p className="stat-card-value">{summary.total}</p>
      <p className="stat-card-label">{label}</p>
      <p className="stat-card-sub">{formatPct(summary.activePct)} active this week</p>
    </div>
  );
}

export default async function AdminDashboardPage() {
  const [userStats, attendanceTrend, revenueTrend, recentAuditLogs, openFlags, accountClasses, accountActivity, ticketCirculation] =
    await Promise.all([
      getUserStats(),
      getAttendanceTrend(),
      getRevenueTrend(),
      getRecentAuditLogs(),
      getOpenFlags(),
      getAccountClassStats(),
      getAccountActivityStats(),
      getTicketCirculationStats(),
    ]);

  return (
    <>
      <SiteNav />
      <main className="main--wide">
      <h1>Reporting dashboard</h1>

      <h2>Accounts</h2>
      <p>{userStats.totalUsers} total users, {userStats.activeMembers} with an active membership.</p>

      <h3>Account classes</h3>
      {/* Admin/Volunteer/Member overlap with each other and are not a
          partition — an account can count in more than one card. Only
          Member and Account Holder are complements of each other. */}
      <div className="stat-grid">
        <AccountClassCard label="Admin" summary={accountClasses.admin} />
        <AccountClassCard label="Volunteer" summary={accountClasses.volunteer} />
        <AccountClassCard label="Member" summary={accountClasses.member} />
        <AccountClassCard label="Account Holder" summary={accountClasses.accountHolder} />
      </div>

      <h3>New this week</h3>
      <div className="stat-grid">
        <div className="stat-card">
          <p className="stat-card-value">{accountActivity.newAccounts}</p>
          <p className="stat-card-label">New accounts</p>
        </div>
        <div className="stat-card">
          <p className="stat-card-value">{accountActivity.newMembershipSignups}</p>
          <p className="stat-card-label">New memberships</p>
        </div>
        <div className="stat-card">
          <p className="stat-card-value">{accountActivity.renewals}</p>
          <p className="stat-card-label">Renewals</p>
        </div>
        <div className="stat-card">
          <p className="stat-card-value">{accountActivity.membershipExpirations}</p>
          <p className="stat-card-label">Expirations</p>
        </div>
      </div>

      <h2>Ticket circulation</h2>
      <div className="stat-grid">
        <div className="stat-card">
          <p className="stat-card-value">{ticketCirculation.outstandingCount}</p>
          <p className="stat-card-label">Outstanding tickets</p>
        </div>
        <div className="stat-card">
          <p className="stat-card-value">{ticketCirculation.transferableCount}</p>
          <p className="stat-card-label">Transferable tickets</p>
        </div>
        <div className="stat-card">
          <p className="stat-card-value">
            {ticketCirculation.avgCostBasis === null ? "—" : `$${ticketCirculation.avgCostBasis.toFixed(2)}`}
          </p>
          <p className="stat-card-label">Avg. cost basis</p>
        </div>
        <div className="stat-card">
          <p className="stat-card-value">${ticketCirculation.totalLiability.toFixed(2)}</p>
          <p className="stat-card-label">Total liability</p>
        </div>
      </div>

      <h2>Open flags (next 14 days)</h2>
      {openFlags.length === 0 ? (
        <p>Nothing flagged.</p>
      ) : (
        <div className="table-scroll">
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
                <td>{new Date(flag.start_time).toLocaleString("en-US", { timeZone: ORG_TIMEZONE })}</td>
                <td>{flag.session_type}</td>
                <td>{FLAG_LABELS[flag.reason]}</td>
              </tr>
            ))}
          </tbody>
          </table>
        </div>
      )}

      <h2>Attendance — trailing 12 weeks</h2>
      {attendanceTrend.length === 0 ? (
        <p>No completed sessions in this window.</p>
      ) : (
        <div className="table-scroll">
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
                <td>{new Date(week.weekStart).toLocaleDateString("en-US", { timeZone: ORG_TIMEZONE })}</td>
                <td>{week.sessionsRun}</td>
                <td>{week.totalBookings}</td>
                <td>{week.checkedInBookings}</td>
                <td>{week.attendanceRate === null ? "—" : `${Math.round(week.attendanceRate * 100)}%`}</td>
              </tr>
            ))}
          </tbody>
          </table>
        </div>
      )}

      <h2>Revenue — trailing 12 weeks</h2>
      {revenueTrend.length === 0 ? (
        <p>No successful transactions in this window.</p>
      ) : (
        <div className="table-scroll">
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
                <td>{new Date(week.weekStart).toLocaleDateString("en-US", { timeZone: ORG_TIMEZONE })}</td>
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
        </div>
      )}

      <h2>Recent activity</h2>
      <p>
        <Link href="/admin/audit-logs">View full audit log</Link>
      </p>
      <div className="table-scroll">
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
              <td>{new Date(entry.created_at).toLocaleString("en-US", { timeZone: ORG_TIMEZONE })}</td>
              <td>{entry.actor_username ? memberLabelWithUsername(entry.actor_display_name, entry.actor_username) : "—"}</td>
              <td>{entry.action_type}</td>
              <td>{entry.target_username ? memberLabelWithUsername(entry.target_display_name, entry.target_username) : "—"}</td>
            </tr>
          ))}
        </tbody>
        </table>
      </div>
    </main>
    </>
  );
}
