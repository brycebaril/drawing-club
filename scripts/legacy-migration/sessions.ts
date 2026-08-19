import type { PoolClient } from "pg";
import type { RowDataPacket } from "mysql2/promise";
import { legacyQuery } from "./mysqlSource";
import { emptyReport, type MigrationReport } from "./types";
import { legacyAttendeeIdToNewId } from "./users";
import { legacyModelIdToNewId } from "./models";
import { resolveSessionType } from "./sessionTypes";

const CANCELLED_SESSION_SENTINEL = 74;
const MODEL_NOT_YET_BOOKED_SENTINEL = 100;
const SENTINEL_MODEL_IDS = new Set([CANCELLED_SESSION_SENTINEL, MODEL_NOT_YET_BOOKED_SENTINEL]);

// sessions.status codes, confirmed by the org's former Robostrar admin
// (docs/LegacyDataAnalysis.md Appendix) — a model-confirmation-workflow
// status, not a booking/cancellation one. Only MODEL_NO_SHOW (4) is acted
// on directly by this script; the rest inform the comment above but don't
// change migration behavior.
const MODEL_NO_SHOW_STATUS = 4;

interface LegacySessionRow {
  id: number;
  modelId: number;
  date: string; // YYYY-MM-DD
  status: number;
  typeId: number;
  mgrId: number | null;
  sessionTime: number;
  googleCalEventStart: number;
  duration: number;
}

interface LegacyAltDescriptionRow {
  sessionId: number;
  altDesc: string;
}

interface LegacyCapacityExceptionRow {
  id: number;
  beginDate: string;
  endDate: string;
  optSessionType: number | null;
  optSessionTime: number | null;
  exceptionalCapacity: number;
}

/** legacy sessions.id -> { newId, startTime } — task #256 (attendance
 * history / future registrations) needs both the new id and the computed
 * start time, to decide the future-vs-historical split per session. */
export const legacySessionIdToNew = new Map<number, { id: string; startTime: Date }>();

function stripLegacyHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(strong|b|i|em)\s*\/?>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function computeStartEnd(dateStr: string, googleCalEventStart: number, durationMinutes: number) {
  const hours = Math.floor(googleCalEventStart / 100);
  const minutes = googleCalEventStart % 100;
  const [year, month, day] = dateStr.split("-").map(Number);
  const startTime = new Date(year, month - 1, day, hours, minutes, 0, 0);
  const endTime = new Date(startTime.getTime() + durationMinutes * 60_000);
  return { startTime, endTime };
}

function resolveCapacity(
  exceptions: (LegacyCapacityExceptionRow & RowDataPacket)[],
  dateStr: string,
  typeId: number,
  sessionTimeId: number,
): number | null {
  const matches = exceptions.filter((exc) => {
    const inRange = dateStr >= exc.beginDate && dateStr <= exc.endDate;
    const typeOk = exc.optSessionType === null || exc.optSessionType === typeId;
    const timeOk = exc.optSessionTime === null || exc.optSessionTime === sessionTimeId;
    return inRange && typeOk && timeOk;
  });
  if (matches.length === 0) return null;
  // Legacy's own tie-break for overlapping exceptions: highest id wins.
  return matches.reduce((best, m) => (m.id > best.id ? m : best)).exceptionalCapacity;
}

export async function migrateSessions(client: PoolClient): Promise<MigrationReport> {
  const report = emptyReport("sessions");

  const [sessions, altDescriptions, capacityExceptions] = await Promise.all([
    legacyQuery<(LegacySessionRow & RowDataPacket)[]>(
      `SELECT s.id, s.modelId, s.date, s.status, s.typeId, s.mgrId,
              st.googleCalEventStart, st.duration, s.sessionTime
       FROM sessions s JOIN session_times st ON st.id = s.sessionTime`,
    ),
    legacyQuery<(LegacyAltDescriptionRow & RowDataPacket)[]>(
      `SELECT sessionId, altDesc FROM session_alt_descriptions`,
    ),
    legacyQuery<(LegacyCapacityExceptionRow & RowDataPacket)[]>(
      `SELECT id, beginDate, endDate, optSessionType, optSessionTime, exceptionalCapacity
       FROM session_seating_capacity_exceptions`,
    ),
  ]);

  const altDescriptionBySession = new Map(altDescriptions.map((row) => [row.sessionId, row.altDesc]));

  for (const row of sessions) {
    const { code: sessionType, needsReview: typeNeedsReview } = resolveSessionType(row.typeId);
    if (typeNeedsReview) {
      report.warnings.push(
        `sessions.id ${row.id}: session type (legacy typeId ${row.typeId}) has no clean destination — needs manual review (docs/MigrationPlan.md §6).`,
      );
    }

    const { startTime, endTime } = computeStartEnd(row.date, row.googleCalEventStart, row.duration);

    // A CANCELLED_SESSION sentinel model is legacy's own unambiguous "this
    // slot is deliberately blocked" marker (per its schema comment) —
    // always Canceled. Every other status code (confirmed by the org's
    // former admin, docs/LegacyDataAnalysis.md Appendix) tracks the
    // model-confirmation daemon's workflow (unprocessed / confirmation
    // requested / warned-unconfirmed / no-show / confirmed / confirmed
    // late) — it says nothing about whether the session itself was ever
    // cancelled as a bookable slot, so none of those codes make a session
    // Canceled. An earlier version of this script wrongly treated any
    // non-"confirmed" code as Canceled before this was confirmed.
    const status: "Scheduled" | "Canceled" = row.modelId === CANCELLED_SESSION_SENTINEL ? "Canceled" : "Scheduled";

    const rawDescription = altDescriptionBySession.get(row.id);
    let description = rawDescription ? stripLegacyHtml(rawDescription) : null;
    if (row.status === MODEL_NO_SHOW_STATUS) {
      // Real, useful historical signal worth preserving even though this
      // app's session_status enum has no "no-show" concept of its own.
      const note = "[Legacy record: model did not show up for this session.]";
      description = description ? `${description}\n\n${note}` : note;
    }

    const hostUserId = row.mgrId !== null ? (legacyAttendeeIdToNewId.get(row.mgrId) ?? null) : null;
    if (row.mgrId !== null && !hostUserId) {
      report.warnings.push(`sessions.id ${row.id}: mgrId ${row.mgrId} has no migrated user — host left unset.`);
    }

    const capacity = resolveCapacity(capacityExceptions, row.date, row.typeId, row.sessionTime) ?? 25;

    const insertResult = await client.query<{ id: string }>(
      `INSERT INTO sessions (status, session_type, description, start_time, end_time, max_capacity, is_ticketed, host_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, true, $7)
       RETURNING id`,
      [status, sessionType, description, startTime, endTime, capacity, hostUserId],
    );
    const newSessionId = insertResult.rows[0].id;
    legacySessionIdToNew.set(row.id, { id: newSessionId, startTime });
    report.migrated += 1;

    if (!SENTINEL_MODEL_IDS.has(row.modelId)) {
      const newModelId = legacyModelIdToNewId.get(row.modelId);
      if (newModelId) {
        await client.query(`INSERT INTO session_model_mapping (session_id, model_id) VALUES ($1, $2)`, [
          newSessionId,
          newModelId,
        ]);
      } else {
        report.warnings.push(`sessions.id ${row.id}: modelId ${row.modelId} has no migrated model.`);
      }
    } else if (row.modelId === MODEL_NOT_YET_BOOKED_SENTINEL) {
      await client.query(`UPDATE sessions SET model_required = true WHERE id = $1`, [newSessionId]);
    }
  }

  return report;
}
