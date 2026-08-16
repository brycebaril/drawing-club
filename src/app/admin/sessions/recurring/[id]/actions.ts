"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { pool } from "@/lib/db/pool";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { writeAuditLog } from "@/lib/audit/log";
import { SESSION_TYPES, parseDateOnly } from "@/lib/sessions/shared";
import { resolveHostUsername } from "@/lib/sessions/host";
import { updateRecurrenceRule, type RuleEditScope } from "@/lib/recurrence/actions";

export interface EditRecurrenceRuleState {
  error?: string;
}

function revalidateRulePages(ruleId: string) {
  revalidatePath(`/admin/sessions/recurring/${ruleId}`);
  revalidatePath("/admin/sessions/recurring");
  revalidatePath("/admin/sessions");
  revalidatePath("/admin/audit-logs");
}

export async function editRecurrenceRuleAction(
  _prevState: EditRecurrenceRuleState,
  formData: FormData,
): Promise<EditRecurrenceRuleState> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Not authorized." };

  const ruleId = String(formData.get("ruleId") ?? "");

  const sessionType = String(formData.get("sessionType") ?? "");
  if (!(SESSION_TYPES as readonly string[]).includes(sessionType)) {
    return { error: "Choose a valid session type." };
  }

  const description = String(formData.get("description") ?? "").trim();

  const dayOfWeek = Number(formData.get("dayOfWeek"));
  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
    return { error: "Choose a valid day of week." };
  }

  const startTimeOfDay = String(formData.get("startTimeOfDay") ?? "");
  const endTimeOfDay = String(formData.get("endTimeOfDay") ?? "");
  if (!/^\d{2}:\d{2}$/.test(startTimeOfDay) || !/^\d{2}:\d{2}$/.test(endTimeOfDay)) {
    return { error: "Enter valid start and end times." };
  }
  if (endTimeOfDay <= startTimeOfDay) {
    return { error: "End time must be after start time." };
  }

  const maxCapacityRaw = String(formData.get("maxCapacity") ?? "").trim();
  let maxCapacity: number | null = null;
  if (maxCapacityRaw) {
    maxCapacity = Number(maxCapacityRaw);
    if (!Number.isInteger(maxCapacity) || maxCapacity < 1) {
      return { error: "Capacity must be a positive whole number, or left blank for the default." };
    }
  }

  const hostResult = await resolveHostUsername(String(formData.get("hostUsername") ?? ""));
  if (!hostResult.ok) return { error: hostResult.error };

  const startDateRaw = String(formData.get("startDate") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDateRaw)) {
    return { error: "Enter a valid start date." };
  }
  const startDate = parseDateOnly(startDateRaw);
  if (Number.isNaN(startDate.getTime())) {
    return { error: "Enter a valid start date." };
  }

  const endDateRaw = String(formData.get("endDate") ?? "").trim();
  let endDate: Date | null = null;
  if (endDateRaw) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(endDateRaw)) {
      return { error: "Enter a valid end date, or leave it blank for a perpetual series." };
    }
    endDate = parseDateOnly(endDateRaw);
    if (Number.isNaN(endDate.getTime())) {
      return { error: "Enter a valid end date, or leave it blank for a perpetual series." };
    }
    if (endDate < startDate) {
      return { error: "End date must be on or after the start date." };
    }
  }

  const scopeType = String(formData.get("scopeType") ?? "");
  let scope: RuleEditScope;
  if (scopeType === "entire") {
    scope = { type: "entire" };
  } else if (scopeType === "this-and-future") {
    const scopeFromDateRaw = String(formData.get("scopeFromDate") ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(scopeFromDateRaw)) {
      return { error: 'Choose a valid date for "from this date forward".' };
    }
    const scopeFromDate = parseDateOnly(scopeFromDateRaw);
    if (Number.isNaN(scopeFromDate.getTime())) {
      return { error: 'Choose a valid date for "from this date forward".' };
    }
    scope = { type: "this-and-future", fromDate: scopeFromDate };
  } else {
    return { error: "Choose an edit scope." };
  }

  const beforeResult = await pool.query(
    `SELECT session_type, description, day_of_week, start_time_of_day, end_time_of_day,
            max_capacity, default_host_user_id, start_date, end_date
     FROM recurrence_rules WHERE id = $1`,
    [ruleId],
  );
  if (beforeResult.rowCount === 0) return { error: "Rule not found." };
  const before = beforeResult.rows[0];

  const { sessionsCanceled, sessionsGenerated } = await updateRecurrenceRule(
    ruleId,
    {
      sessionType,
      description: description || null,
      dayOfWeek,
      startTimeOfDay,
      endTimeOfDay,
      maxCapacity,
      defaultHostUserId: hostResult.hostUserId,
      startDate,
      endDate,
    },
    scope,
  );

  await writeAuditLog({
    actorId: ctx.id,
    actionType: "RECURRENCE_RULE_UPDATED",
    metadata: {
      ruleId,
      scope,
      before,
      after: {
        sessionType,
        description: description || null,
        dayOfWeek,
        startTimeOfDay,
        endTimeOfDay,
        maxCapacity,
        hostUserId: hostResult.hostUserId,
        startDate,
        endDate,
      },
      sessionsCanceled,
      sessionsGenerated,
    },
  });

  revalidateRulePages(ruleId);
  redirect(`/admin/sessions/recurring/${ruleId}`);
}
