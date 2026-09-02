import Link from "next/link";
import { pool } from "@/lib/db/pool";
import { SiteNav } from "@/components/SiteNav";
import { DAYS_OF_WEEK } from "@/lib/sessions/shared";
import { cancelSeriesFromListAction, generateMoreSessionsAction } from "./actions";
import { ORG_TIMEZONE } from "@/lib/org";
import { memberLabel } from "@/lib/users/memberLabel";

interface RuleRow {
  id: string;
  session_type: string;
  day_of_week: number;
  start_time_of_day: string;
  end_time_of_day: string;
  start_date: Date;
  end_date: Date | null;
  host_username: string | null;
  host_display_name: string | null;
  upcoming_count: string;
}

export default async function RecurringRulesPage() {
  const result = await pool.query<RuleRow>(
    `SELECT r.id, r.session_type, r.day_of_week, r.start_time_of_day, r.end_time_of_day,
            r.start_date, r.end_date, h.username AS host_username, h.display_name AS host_display_name,
            (SELECT count(*) FROM sessions s
             WHERE s.recurrence_rule_id = r.id AND s.status = 'Scheduled' AND s.start_time > now()
            ) AS upcoming_count
     FROM recurrence_rules r
     LEFT JOIN users h ON h.id = r.default_host_user_id
     ORDER BY r.start_date DESC`,
  );

  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <SiteNav />
      <main className="main--wide">
      <h1>Recurring rules</h1>
      <p>
        <Link href="/admin/sessions/new-recurring">+ Create recurring session</Link>
      </p>
      <div className="table-scroll">
        <table>
        <thead>
          <tr>
            <th>Type</th>
            <th>Pattern</th>
            <th>Start date</th>
            <th>End date</th>
            <th>Host</th>
            <th>Upcoming occurrences</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {result.rows.map((rule) => {
            const dayLabel = DAYS_OF_WEEK.find((d) => d.value === rule.day_of_week)?.label ?? rule.day_of_week;
            const endDateStr = rule.end_date ? new Date(rule.end_date).toISOString().slice(0, 10) : null;
            const isEnded = endDateStr !== null && endDateStr < today;

            return (
              <tr key={rule.id}>
                <td>{rule.session_type}</td>
                <td>
                  {dayLabel} {rule.start_time_of_day}–{rule.end_time_of_day}
                </td>
                <td>{new Date(rule.start_date).toLocaleDateString("en-US", { timeZone: ORG_TIMEZONE })}</td>
                <td>{rule.end_date ? new Date(rule.end_date).toLocaleDateString("en-US", { timeZone: ORG_TIMEZONE }) : "Perpetual"}</td>
                <td>{rule.host_username ? memberLabel(rule.host_display_name, rule.host_username) : "Open — needs a host"}</td>
                <td>{rule.upcoming_count}</td>
                <td>{isEnded ? "Ended" : "Active"}</td>
                <td>
                  <Link href={`/admin/sessions/recurring/${rule.id}`}>Edit</Link>
                  {!isEnded && (
                    <>
                      {" "}
                      <form action={generateMoreSessionsAction}>
                        <input type="hidden" name="ruleId" value={rule.id} />
                        <button type="submit">Generate more sessions</button>
                      </form>
                      <form action={cancelSeriesFromListAction}>
                        <input type="hidden" name="ruleId" value={rule.id} />
                        <button type="submit">Cancel entire series</button>
                      </form>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
        </table>
      </div>
    </main>
    </>
  );
}
