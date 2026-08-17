import { pool } from "@/lib/db/pool";

export interface FlaggedSessionRow {
  id: string;
  session_type: string;
  start_time: Date;
  reason: "needs_model" | "full";
}

const WINDOW_DAYS = 14;

/**
 * Design Doc §10's admin-dashboard "open flags (missing models, full
 * sessions)". Reuses /ops/model-booking's needs-a-model query shape;
 * "full" sums both booking mechanisms (passes for generic sessions,
 * seat_reservations for series ones) against max_capacity — a session is
 * only ever linked to one of the two, so summing both is safe.
 */
export async function getOpenFlags(): Promise<FlaggedSessionRow[]> {
  const needsModelResult = await pool.query<Omit<FlaggedSessionRow, "reason">>(
    `SELECT s.id, s.session_type, s.start_time
     FROM sessions s
     LEFT JOIN session_model_mapping smm ON smm.session_id = s.id
     WHERE s.status = 'Scheduled' AND s.model_required = true
       AND s.start_time >= now() AND s.start_time <= now() + interval '${WINDOW_DAYS} days'
     GROUP BY s.id, s.session_type, s.start_time
     HAVING count(smm.model_id) = 0
     ORDER BY s.start_time`,
  );

  const fullResult = await pool.query<Omit<FlaggedSessionRow, "reason">>(
    `SELECT s.id, s.session_type, s.start_time
     FROM sessions s
     WHERE s.status = 'Scheduled'
       AND s.start_time >= now() AND s.start_time <= now() + interval '${WINDOW_DAYS} days'
       AND (
         (SELECT count(*) FROM passes p WHERE p.session_id = s.id AND p.status = 'Used') +
         (SELECT count(*) FROM seat_reservations sr WHERE sr.session_id = s.id)
       ) >= s.max_capacity
     ORDER BY s.start_time`,
  );

  return [
    ...needsModelResult.rows.map((row) => ({ ...row, reason: "needs_model" as const })),
    ...fullResult.rows.map((row) => ({ ...row, reason: "full" as const })),
  ];
}
