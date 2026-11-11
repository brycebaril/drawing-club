import { pool } from "@/lib/db/pool";

/**
 * The upcoming-session snapshot the legacy system polls. Canceled sessions are
 * included on purpose: a session dropping out of a later snapshot means it
 * moved out of the window, never that it was canceled.
 */

export interface FeedSession {
  id: string;
  legacyId: string | null;
  startTime: string;
  endTime: string;
  sessionType: string;
  description: string | null;
  status: "Scheduled" | "Canceled";
  modelRequired: boolean;
  seriesId: string | null;
  models: { id: string; legacyId: string | null; name: string }[];
}

interface FeedRow {
  id: string;
  legacy_id: string | null;
  start_time: Date;
  end_time: Date;
  session_type: string;
  description: string | null;
  status: "Scheduled" | "Canceled";
  model_required: boolean;
  series_id: string | null;
  models: FeedSession["models"];
}

export async function getSessionFeed(days: number): Promise<FeedSession[]> {
  const result = await pool.query<FeedRow>(
    `SELECT s.id, s.legacy_id, s.start_time, s.end_time, s.session_type, s.description, s.status,
            s.model_required, s.series_id,
            COALESCE(json_agg(json_build_object('id', m.id, 'legacyId', m.legacy_id, 'name', m.name) ORDER BY m.name)
                     FILTER (WHERE m.id IS NOT NULL), '[]') AS models
     FROM sessions s
     LEFT JOIN session_model_mapping smm ON smm.session_id = s.id
     LEFT JOIN models m ON m.id = smm.model_id
     WHERE s.start_time >= now() AND s.start_time <= now() + make_interval(days => $1)
     GROUP BY s.id
     ORDER BY s.start_time`,
    [days],
  );
  return result.rows.map((row) => ({
    id: row.id,
    legacyId: row.legacy_id,
    startTime: new Date(row.start_time).toISOString(),
    endTime: new Date(row.end_time).toISOString(),
    sessionType: row.session_type,
    description: row.description,
    status: row.status,
    modelRequired: row.model_required,
    seriesId: row.series_id,
    models: row.models,
  }));
}
