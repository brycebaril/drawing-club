import { notFound } from "next/navigation";
import { pool } from "@/lib/db/pool";
import { AdminNav } from "@/components/AdminNav";
import { getSettingNumber } from "@/lib/settings";
import { toDateOnly } from "@/lib/sessions/shared";
import { RecurrenceRuleEditForm } from "./RecurrenceRuleEditForm";

interface RuleDetail {
  id: string;
  session_type: string;
  description: string | null;
  day_of_week: number;
  start_time_of_day: string;
  end_time_of_day: string;
  max_capacity: number | null;
  host_username: string | null;
  start_date: Date;
  end_date: Date | null;
}

export default async function RecurrenceRuleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const result = await pool.query<RuleDetail>(
    `SELECT r.id, r.session_type, r.description, r.day_of_week, r.start_time_of_day, r.end_time_of_day,
            r.max_capacity, h.username AS host_username, r.start_date, r.end_date
     FROM recurrence_rules r
     LEFT JOIN users h ON h.id = r.default_host_user_id
     WHERE r.id = $1`,
    [id],
  );
  if (result.rowCount === 0) notFound();
  const rule = result.rows[0];

  const defaultCapacity = await getSettingNumber("SESSION_DEFAULT_CAPACITY");

  return (
    <main>
      <AdminNav />
      <h1>Edit recurring rule</h1>
      <RecurrenceRuleEditForm
        ruleId={rule.id}
        defaultCapacity={defaultCapacity}
        rule={{
          sessionType: rule.session_type,
          description: rule.description ?? "",
          dayOfWeek: rule.day_of_week,
          startTimeOfDay: rule.start_time_of_day.slice(0, 5),
          endTimeOfDay: rule.end_time_of_day.slice(0, 5),
          maxCapacity: rule.max_capacity !== null ? String(rule.max_capacity) : "",
          hostUsername: rule.host_username ?? "",
          startDate: toDateOnly(new Date(rule.start_date)),
          endDate: rule.end_date ? toDateOnly(new Date(rule.end_date)) : "",
        }}
      />
    </main>
  );
}
