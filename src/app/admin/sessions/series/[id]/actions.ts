"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { pool } from "@/lib/db/pool";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { writeAuditLog } from "@/lib/audit/log";
import { SESSION_TYPES } from "@/lib/sessions/shared";
import { resolveHostUsername } from "@/lib/sessions/host";
import { parseSlotValues, checkSlotConflicts } from "@/lib/sessions/slots";

function revalidateSeriesPages(seriesId: string) {
  revalidatePath(`/admin/sessions/series/${seriesId}`);
  revalidatePath("/admin/sessions/series");
  revalidatePath("/admin/sessions");
  revalidatePath("/admin/audit-logs");
}

export interface UpdateSeriesMetadataState {
  error?: string;
}

export async function updateSeriesMetadataAction(
  _prevState: UpdateSeriesMetadataState,
  formData: FormData,
): Promise<UpdateSeriesMetadataState> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Not authorized." };

  const seriesId = String(formData.get("seriesId") ?? "");

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Enter a series name." };

  const seatCount = Number(formData.get("seatCount"));
  if (!Number.isInteger(seatCount) || seatCount < 1) {
    return { error: "Seat count must be a positive whole number." };
  }

  const beforeResult = await pool.query<{ name: string; seat_count: number }>(
    `SELECT name, seat_count FROM series WHERE id = $1`,
    [seriesId],
  );
  if (beforeResult.rowCount === 0) return { error: "Series not found." };
  const before = beforeResult.rows[0];

  const highestSeatResult = await pool.query<{ max: number | null }>(
    `SELECT max(sr.seat_number) AS max
     FROM seat_reservations sr
     JOIN sessions s ON s.id = sr.session_id
     WHERE s.series_id = $1`,
    [seriesId],
  );
  const highestReservedSeat = highestSeatResult.rows[0].max;
  if (highestReservedSeat !== null && seatCount < highestReservedSeat) {
    return {
      error: `Can't reduce seat count below ${highestReservedSeat} — seat ${highestReservedSeat} is already reserved.`,
    };
  }

  await pool.query(`UPDATE series SET name = $1, seat_count = $2 WHERE id = $3`, [name, seatCount, seriesId]);

  // Keeps displayed capacity consistent with the series' seat count — but
  // only for sessions still at the *old* seat count. A session an admin
  // already gave its own capacity via the single-session instance editor
  // (src/app/admin/sessions/[id]/actions.ts) is no longer at that old
  // value, so it's left alone rather than silently clobbered by an
  // unrelated edit (e.g. just fixing the series name). Past and canceled
  // sessions are untouched either way, matching how cancellation never
  // rewrites history elsewhere in this app.
  await pool.query(
    `UPDATE sessions SET max_capacity = $1 WHERE series_id = $2 AND status = 'Scheduled' AND max_capacity = $3`,
    [seatCount, seriesId, before.seat_count],
  );

  await writeAuditLog({
    actorId: ctx.id,
    actionType: "MULTIWEEK_SERIES_UPDATED",
    metadata: { seriesId, before, after: { name, seatCount } },
  });

  revalidateSeriesPages(seriesId);
  redirect(`/admin/sessions/series/${seriesId}`);
}

export interface AddSeriesSlotsState {
  error?: string;
}

export async function addSeriesSlotsAction(
  _prevState: AddSeriesSlotsState,
  formData: FormData,
): Promise<AddSeriesSlotsState> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Not authorized." };

  const seriesId = String(formData.get("seriesId") ?? "");

  const seriesResult = await pool.query<{ seat_count: number }>(`SELECT seat_count FROM series WHERE id = $1`, [
    seriesId,
  ]);
  if (seriesResult.rowCount === 0) return { error: "Series not found." };
  const seatCount = seriesResult.rows[0].seat_count;

  const sessionType = String(formData.get("sessionType") ?? "");
  if (!(SESSION_TYPES as readonly string[]).includes(sessionType)) {
    return { error: "Choose a valid session type." };
  }

  const description = String(formData.get("description") ?? "").trim();

  const hostResult = await resolveHostUsername(String(formData.get("hostUsername") ?? ""));
  if (!hostResult.ok) return { error: hostResult.error };

  const slotsResult = parseSlotValues(formData.getAll("slots").map(String));
  if (!slotsResult.ok) return { error: slotsResult.error };
  const parsedSlots = slotsResult.slots;

  const client = await pool.connect();
  const sessionIds: string[] = [];
  try {
    await client.query("BEGIN");

    const conflictError = await checkSlotConflicts(client, parsedSlots);
    if (conflictError) {
      await client.query("ROLLBACK");
      return { error: conflictError };
    }

    for (const slot of parsedSlots) {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO sessions
           (session_type, description, start_time, end_time, max_capacity, host_user_id, is_ticketed, series_id)
         VALUES ($1, $2, $3, $4, $5, $6, true, $7)
         RETURNING id`,
        [sessionType, description || null, slot.startTime, slot.endTime, seatCount, hostResult.hostUserId, seriesId],
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
    actionType: "MULTIWEEK_SERIES_EXTENDED",
    metadata: { seriesId, sessionType, sessionIds },
  });

  revalidateSeriesPages(seriesId);
  redirect(`/admin/sessions/series/${seriesId}`);
}
