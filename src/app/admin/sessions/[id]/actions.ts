"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { writeAuditLog } from "@/lib/audit/log";
import { pool } from "@/lib/db/pool";
import { releaseAllBookingsForSession } from "@/lib/booking/actions";
import { SESSION_TYPES, sessionTypeNeedsModel } from "@/lib/sessions/shared";
import { resolveHostUsername } from "@/lib/sessions/host";
import {
  cancelEntireSeries,
  cancelThisAndFutureOccurrences,
} from "@/lib/recurrence/actions";
import {
  cancelEntireSeriesForSession,
  cancelSeriesThisAndFuture,
} from "@/lib/series/actions";

export interface SessionDetail {
  id: string;
  session_type: string;
  description: string | null;
  start_time: Date;
  end_time: Date;
  max_capacity: number;
  status: "Scheduled" | "Canceled";
  host_username: string | null;
  host_display_name: string | null;
  recurrence_rule_id: string | null;
  series_id: string | null;
}

export interface AttendeeRow {
  username: string;
  display_name: string | null;
}

export interface SeatRow {
  seat_number: number;
  username: string;
  display_name: string | null;
}

export interface SessionDetailData {
  session: SessionDetail;
  attendees: AttendeeRow[];
  seats: SeatRow[];
}

/**
 * Shared by the standalone /admin/sessions/[id] page and EditSessionModal
 * (the admin/sessions calendar grid's "click a filled cell" flow) — a
 * Server Function rather than a plain server-only module, specifically so
 * the modal (a client component) can call it directly as an RPC. That's
 * also why it re-checks requireAdmin() itself even though the standalone
 * page's render is already covered by src/proxy.ts's /admin/* rule: a
 * Server Function invoked this way isn't a page render Proxy matches
 * against — same "Server Functions must re-check auth themselves" rule
 * every mutation in this codebase already follows, just for a read instead.
 */
export async function getSessionDetail(sessionId: string): Promise<SessionDetailData | null> {
  const ctx = await requireAdmin();
  if (!ctx) return null;

  const sessionResult = await pool.query<SessionDetail>(
    `SELECT s.id, s.session_type, s.description, s.start_time, s.end_time, s.max_capacity, s.status,
            u.username AS host_username, u.display_name AS host_display_name, s.recurrence_rule_id, s.series_id
     FROM sessions s
     LEFT JOIN users u ON u.id = s.host_user_id
     WHERE s.id = $1`,
    [sessionId],
  );
  if (sessionResult.rowCount === 0) return null;
  const session = sessionResult.rows[0];
  const isSeries = session.series_id !== null;

  const attendeesResult = isSeries
    ? { rows: [] as AttendeeRow[] }
    : await pool.query<AttendeeRow>(
        `SELECT u.username, u.display_name
         FROM passes p
         JOIN users u ON u.id = p.owner_id
         WHERE p.session_id = $1 AND p.status = 'Used'
         ORDER BY u.username`,
        [sessionId],
      );

  const seatsResult = isSeries
    ? await pool.query<SeatRow>(
        `SELECT sr.seat_number, u.username, u.display_name
         FROM seat_reservations sr
         JOIN users u ON u.id = sr.user_id
         WHERE sr.session_id = $1
         ORDER BY sr.seat_number`,
        [sessionId],
      )
    : { rows: [] as SeatRow[] };

  return { session, attendees: attendeesResult.rows, seats: seatsResult.rows };
}

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

  // Locking the session row first — same as bookSession's own first step —
  // means any concurrent booking attempt blocks on its own FOR UPDATE until
  // this transaction commits or rolls back, so the booked-count read below
  // can't go stale between checking it and applying the new capacity
  // (the capacity-touching locking pattern CLAUDE.md documents elsewhere).
  const client = await pool.connect();
  let before: {
    session_type: string;
    description: string | null;
    max_capacity: number;
    host_user_id: string | null;
    model_required: boolean;
  };
  let modelRequired: boolean;
  try {
    await client.query("BEGIN");

    const sessionRow = await client.query<{
      session_type: string;
      description: string | null;
      max_capacity: number;
      host_user_id: string | null;
      status: string;
      model_required: boolean;
    }>(
      `SELECT session_type, description, max_capacity, host_user_id, status, model_required FROM sessions WHERE id = $1 FOR UPDATE`,
      [sessionId],
    );
    if (sessionRow.rowCount === 0) {
      await client.query("ROLLBACK");
      return { error: "Session not found." };
    }
    const { status, ...beforeFields } = sessionRow.rows[0];
    if (status === "Canceled") {
      await client.query("ROLLBACK");
      return { error: "This session has been canceled and can't be edited." };
    }
    before = beforeFields;

    // Booking's own capacity check (bookSession) only blocks *new* bookings
    // once count >= max_capacity — it never notices an admin dropping
    // max_capacity below the count already booked. Guard it here instead.
    const bookedCountResult = await client.query<{ count: string }>(
      `SELECT count(*) FROM passes WHERE session_id = $1 AND status = 'Used'`,
      [sessionId],
    );
    const bookedCount = Number(bookedCountResult.rows[0].count);
    if (maxCapacity < bookedCount) {
      await client.query("ROLLBACK");
      return { error: `Capacity can't be less than the ${bookedCount} ticket(s) already booked.` };
    }

    // Only re-derive model_required when the type actually changes — a
    // same-type edit (capacity, host, description) must never clobber a
    // Model Booker's own manual override (the "No model required" / "Actually,
    // this needs a model" toggle on /ops/model-booking) for an unrelated
    // reason. But a genuine type change (e.g. into/out of Gallery/Party) has
    // to follow sessionTypeNeedsModel() the same way session creation does —
    // otherwise editing a Regular session into a Gallery Hours session left
    // model_required stuck at its old value, silently wrong either direction.
    modelRequired = sessionType === before.session_type ? before.model_required : sessionTypeNeedsModel(sessionType);

    await client.query(
      `UPDATE sessions SET session_type = $1, description = $2, max_capacity = $3, host_user_id = $4, model_required = $5
       WHERE id = $6 AND status = 'Scheduled'`,
      [sessionType, description || null, maxCapacity, hostResult.hostUserId, modelRequired, sessionId],
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  await writeAuditLog({
    actorId: ctx.id,
    actionType: "SESSION_DETAILS_UPDATED",
    metadata: {
      sessionId,
      before,
      after: {
        sessionType,
        modelRequired,
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
