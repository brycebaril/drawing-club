"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { pool } from "@/lib/db/pool";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { writeAuditLog } from "@/lib/audit/log";
import { SESSION_TYPES, parseDateOnly, sessionTypeNeedsModel } from "@/lib/sessions/shared";
import { resolveHostUsername } from "@/lib/sessions/host";
import { generateSessionsForRule } from "@/lib/recurrence/generate";
import { parseSlotValues, checkSlotConflicts } from "@/lib/sessions/slots";
import { parseOrgDateTimeLocal } from "@/lib/timezone";

export interface CreateSessionState {
  error?: string;
}

export async function createSessionAction(
  _prevState: CreateSessionState,
  formData: FormData,
): Promise<CreateSessionState> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Not authorized." };

  const sessionType = String(formData.get("sessionType") ?? "");
  if (!(SESSION_TYPES as readonly string[]).includes(sessionType)) {
    return { error: "Choose a valid session type." };
  }

  const description = String(formData.get("description") ?? "").trim();

  // parseOrgDateTimeLocal, not `new Date(string)` — the raw <input
  // type="datetime-local"> value has no timezone/offset, so native Date
  // parsing would read it in the *process's* local timezone rather than
  // ORG_TIMEZONE (fine on a Pacific-timezone dev machine, wrong by ~7-8
  // hours on Amplify's UTC-running Lambda). See src/lib/timezone.ts.
  const startTime = parseOrgDateTimeLocal(String(formData.get("startTime") ?? ""));
  const endTime = parseOrgDateTimeLocal(String(formData.get("endTime") ?? ""));
  if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) {
    return { error: "Enter valid start and end times." };
  }
  if (endTime <= startTime) {
    return { error: "End time must be after start time." };
  }

  const maxCapacity = Number(formData.get("maxCapacity"));
  if (!Number.isInteger(maxCapacity) || maxCapacity < 1) {
    return { error: "Capacity must be a positive whole number." };
  }

  const hostResult = await resolveHostUsername(String(formData.get("hostUsername") ?? ""));
  if (!hostResult.ok) return { error: hostResult.error };
  const hostUserId = hostResult.hostUserId;

  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO sessions (session_type, description, start_time, end_time, max_capacity, host_user_id, is_ticketed, model_required)
     VALUES ($1, $2, $3, $4, $5, $6, true, $7)
     RETURNING id`,
    [sessionType, description || null, startTime, endTime, maxCapacity, hostUserId, sessionTypeNeedsModel(sessionType)],
  );

  await writeAuditLog({
    actorId: ctx.id,
    actionType: "SESSION_CREATED",
    metadata: { sessionId: inserted.rows[0].id, sessionType, startTime, maxCapacity, hostUserId },
  });

  // Reachable via a prefetched <Link> in SiteNav's staff-nav — without this, the
  // client Router Cache can serve the pre-creation list after the redirect
  // (see src/app/admin/users/[id]/actions.ts's revalidateUserPages).
  revalidatePath("/admin/sessions");
  redirect("/admin/sessions");
}

export interface CreateRecurrenceRuleState {
  error?: string;
}

export async function createRecurrenceRuleAction(
  _prevState: CreateRecurrenceRuleState,
  formData: FormData,
): Promise<CreateRecurrenceRuleState> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Not authorized." };

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

  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO recurrence_rules
       (session_type, description, day_of_week, start_time_of_day, end_time_of_day,
        max_capacity, default_host_user_id, start_date, end_date, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      sessionType,
      description || null,
      dayOfWeek,
      startTimeOfDay,
      endTimeOfDay,
      maxCapacity,
      hostResult.hostUserId,
      startDate,
      endDate,
      ctx.id,
    ],
  );
  const ruleId = inserted.rows[0].id;

  const created = await generateSessionsForRule(ruleId);

  await writeAuditLog({
    actorId: ctx.id,
    actionType: "RECURRENCE_RULE_CREATED",
    metadata: { ruleId, sessionType, dayOfWeek, startTimeOfDay, endTimeOfDay, startDate, endDate, sessionsGenerated: created },
  });

  revalidatePath("/admin/sessions");
  revalidatePath("/admin/sessions/recurring");
  redirect("/admin/sessions/recurring");
}

export interface CreateSeriesState {
  error?: string;
}

export async function createSeriesAction(
  _prevState: CreateSeriesState,
  formData: FormData,
): Promise<CreateSeriesState> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Not authorized." };

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Enter a series name." };

  const sessionType = String(formData.get("sessionType") ?? "");
  if (!(SESSION_TYPES as readonly string[]).includes(sessionType)) {
    return { error: "Choose a valid session type." };
  }

  const description = String(formData.get("description") ?? "").trim();

  const seatCount = Number(formData.get("seatCount"));
  if (!Number.isInteger(seatCount) || seatCount < 1) {
    return { error: "Seat count must be a positive whole number." };
  }

  const hostResult = await resolveHostUsername(String(formData.get("hostUsername") ?? ""));
  if (!hostResult.ok) return { error: hostResult.error };

  const slotsResult = parseSlotValues(formData.getAll("slots").map(String));
  if (!slotsResult.ok) return { error: slotsResult.error };
  const parsedSlots = slotsResult.slots;

  const client = await pool.connect();
  let seriesId = "";
  const sessionIds: string[] = [];
  try {
    await client.query("BEGIN");

    const conflictError = await checkSlotConflicts(client, parsedSlots);
    if (conflictError) {
      await client.query("ROLLBACK");
      return { error: conflictError };
    }

    const seriesResult = await client.query<{ id: string }>(
      `INSERT INTO series (name, seat_count, created_by) VALUES ($1, $2, $3) RETURNING id`,
      [name, seatCount, ctx.id],
    );
    seriesId = seriesResult.rows[0].id;

    for (const slot of parsedSlots) {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO sessions
           (session_type, description, start_time, end_time, max_capacity, host_user_id, is_ticketed, series_id, model_required)
         VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8)
         RETURNING id`,
        [
          sessionType,
          description || null,
          slot.startTime,
          slot.endTime,
          seatCount,
          hostResult.hostUserId,
          seriesId,
          sessionTypeNeedsModel(sessionType),
        ],
      );
      sessionIds.push(inserted.rows[0].id);
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  await writeAuditLog({
    actorId: ctx.id,
    actionType: "MULTIWEEK_SERIES_CREATED",
    metadata: { seriesId, name, sessionType, seatCount, sessionIds },
  });

  revalidatePath("/admin/sessions");
  revalidatePath("/admin/sessions/series");
  redirect("/admin/sessions/series");
}
