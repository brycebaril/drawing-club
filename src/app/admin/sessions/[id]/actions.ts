"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { writeAuditLog } from "@/lib/audit/log";
import { pool } from "@/lib/db/pool";
import { releaseAllBookingsForSession } from "@/lib/booking/actions";
import { SESSION_TYPES } from "@/lib/sessions/shared";
import { resolveHostUsername } from "@/lib/sessions/host";
import {
  cancelEntireSeries,
  cancelThisAndFutureOccurrences,
} from "@/lib/recurrence/actions";
import {
  cancelEntireSeriesForSession,
  cancelSeriesThisAndFuture,
} from "@/lib/series/actions";

function revalidateSessionPages(sessionId: string) {
  revalidatePath(`/admin/sessions/${sessionId}`);
  revalidatePath("/admin/sessions");
  revalidatePath("/admin/sessions/recurring");
  revalidatePath("/admin/sessions/series");
  revalidatePath("/admin/audit-logs");
}

/** Also used for a plain one-off session — "cancel this occurrence" either way. */
export async function cancelOccurrenceAction(formData: FormData): Promise<void> {
  const ctx = await requireAdmin();
  if (!ctx) redirect("/auth/login");

  const sessionId = String(formData.get("sessionId") ?? "");
  await releaseAllBookingsForSession(sessionId);

  await writeAuditLog({
    actorId: ctx.id,
    actionType: "SESSION_OCCURRENCE_CANCELED",
    metadata: { sessionId },
  });

  revalidateSessionPages(sessionId);
  redirect(`/admin/sessions/${sessionId}`);
}

export async function cancelThisAndFutureAction(formData: FormData): Promise<void> {
  const ctx = await requireAdmin();
  if (!ctx) redirect("/auth/login");

  const sessionId = String(formData.get("sessionId") ?? "");
  await cancelThisAndFutureOccurrences(sessionId);

  await writeAuditLog({
    actorId: ctx.id,
    actionType: "SESSION_SERIES_CANCELED_FORWARD",
    metadata: { fromSessionId: sessionId },
  });

  revalidateSessionPages(sessionId);
  redirect(`/admin/sessions/${sessionId}`);
}

export async function cancelSeriesAction(formData: FormData): Promise<void> {
  const ctx = await requireAdmin();
  if (!ctx) redirect("/auth/login");

  const sessionId = String(formData.get("sessionId") ?? "");
  await cancelEntireSeries(sessionId);

  await writeAuditLog({
    actorId: ctx.id,
    actionType: "SESSION_SERIES_CANCELED",
    metadata: { fromSessionId: sessionId },
  });

  revalidateSessionPages(sessionId);
  redirect(`/admin/sessions/${sessionId}`);
}

export async function cancelSeriesThisAndFutureAction(formData: FormData): Promise<void> {
  const ctx = await requireAdmin();
  if (!ctx) redirect("/auth/login");

  const sessionId = String(formData.get("sessionId") ?? "");
  await cancelSeriesThisAndFuture(sessionId);

  await writeAuditLog({
    actorId: ctx.id,
    actionType: "MULTIWEEK_SERIES_CANCELED_FORWARD",
    metadata: { fromSessionId: sessionId },
  });

  revalidateSessionPages(sessionId);
  redirect(`/admin/sessions/${sessionId}`);
}

export interface UpdateSessionDetailsState {
  error?: string;
}

/**
 * Instance editor (Phase 7, Design Doc §5.4's "Capacity & Details Override
 * Modal"): edits one session's own type/description/capacity/host in
 * place. No cancellation, no rule/series involvement — works identically
 * whether the session is one-off, a recurring occurrence, or a series
 * occurrence.
 */
export async function updateSessionDetailsAction(
  _prevState: UpdateSessionDetailsState,
  formData: FormData,
): Promise<UpdateSessionDetailsState> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Not authorized." };

  const sessionId = String(formData.get("sessionId") ?? "");

  const sessionType = String(formData.get("sessionType") ?? "");
  if (!(SESSION_TYPES as readonly string[]).includes(sessionType)) {
    return { error: "Choose a valid session type." };
  }

  const description = String(formData.get("description") ?? "").trim();

  const maxCapacity = Number(formData.get("maxCapacity"));
  if (!Number.isInteger(maxCapacity) || maxCapacity < 1) {
    return { error: "Capacity must be a positive whole number." };
  }

  const hostResult = await resolveHostUsername(String(formData.get("hostUsername") ?? ""));
  if (!hostResult.ok) return { error: hostResult.error };

  const beforeResult = await pool.query<{
    session_type: string;
    description: string | null;
    max_capacity: number;
    host_user_id: string | null;
  }>(`SELECT session_type, description, max_capacity, host_user_id FROM sessions WHERE id = $1`, [sessionId]);
  if (beforeResult.rowCount === 0) return { error: "Session not found." };
  const before = beforeResult.rows[0];

  await pool.query(
    `UPDATE sessions SET session_type = $1, description = $2, max_capacity = $3, host_user_id = $4 WHERE id = $5`,
    [sessionType, description || null, maxCapacity, hostResult.hostUserId, sessionId],
  );

  await writeAuditLog({
    actorId: ctx.id,
    actionType: "SESSION_DETAILS_UPDATED",
    metadata: {
      sessionId,
      before,
      after: {
        sessionType,
        description: description || null,
        maxCapacity,
        hostUserId: hostResult.hostUserId,
      },
    },
  });

  revalidateSessionPages(sessionId);
  redirect(`/admin/sessions/${sessionId}`);
}

export async function cancelSeriesEntireSeriesAction(formData: FormData): Promise<void> {
  const ctx = await requireAdmin();
  if (!ctx) redirect("/auth/login");

  const sessionId = String(formData.get("sessionId") ?? "");
  await cancelEntireSeriesForSession(sessionId);

  await writeAuditLog({
    actorId: ctx.id,
    actionType: "MULTIWEEK_SERIES_CANCELED",
    metadata: { fromSessionId: sessionId },
  });

  revalidateSessionPages(sessionId);
  redirect(`/admin/sessions/${sessionId}`);
}
