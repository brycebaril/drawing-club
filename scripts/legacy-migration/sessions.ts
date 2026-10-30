import type { PoolClient } from "pg";
import type { RowDataPacket } from "mysql2/promise";
import { randomUUID } from "node:crypto";
import { legacyQuery } from "./mysqlSource";
import { emptyReport, type MigrationReport } from "./types";
import { legacyAttendeeIdToNewId, legacyAttendeeNameToIds, normalizeAttendeeName } from "./users";
import { legacyModelIdToNewId } from "./models";
import { resolveSessionType } from "./sessionTypes";
import { hashPassword } from "../../src/lib/auth/password";

const CANCELLED_SESSION_SENTINEL = 74;
const MODEL_NOT_YET_BOOKED_SENTINEL = 100;
const SENTINEL_MODEL_IDS = new Set([CANCELLED_SESSION_SENTINEL, MODEL_NOT_YET_BOOKED_SENTINEL]);

// sessions.status codes, confirmed by the org's former Robostrar admin
// (docs/LegacyDataAnalysis.md Appendix) — a model-confirmation-workflow
// status, not a booking/cancellation one. Only MODEL_NO_SHOW (4) is acted
// on directly by this script; the rest inform the comment above but don't
// change migration behavior.
const MODEL_NO_SHOW_STATUS = 4;

// Username for the synthetic fallback author sessions.comment segments land
// on when they can't be attributed to a real migrated user (no recognized
// "Name:" prefix, or the name matches 0 or 2+ legacy attendees — see
// parseCommentIntoNotes/resolveNoteAuthor). session_notes.author_user_id is
// NOT NULL, so every segment needs a real users row one way or another.
const LEGACY_IMPORT_USERNAME = "legacy-import";

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
  comment: string | null;
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

interface ParsedNoteSegment {
  /** The "Name" a segment was prefixed with, e.g. "Steven  Williams:"…"" — or
   * null when the segment had no `Name:` prefix at all (e.g. a plain
   * handoff note like "Alain out so reassigned to Christian"). Raw/untrimmed
   * for whitespace matching this app's real data (double spaces do occur). */
  rawName: string | null;
  content: string;
}

function stripSurroundingQuotes(text: string): string {
  const first = text.at(0);
  const last = text.at(-1);
  const isCurly = first === "“" && last === "”";
  const isStraight = first === '"' && last === '"';
  return isCurly || isStraight ? text.slice(1, -1) : text;
}

/**
 * sessions.comment is one free-text blob per session, written by whichever
 * session manager(s) checked in that day — legacy's own schema comment
 * calls it "shared/viewable by Session Manager; Registers; Admins". Multiple
 * people's notes on the same session are concatenated with literal `<br>`
 * separators, each usually (not always — see the unmatched-name/no-colon
 * fallback in migrateSessions) shaped `Name:"quoted text"` using curly
 * quotes. A real, previously-undiscovered migration gap — see CLAUDE.md's
 * migration notes — this column was never selected by the original script
 * and never even listed in docs/LegacyDataAnalysis.md's table-by-table
 * mapping.
 *
 * Deliberately lenient, not a strict "Name:"quote-matched-quote"" parser:
 * real entries have unterminated quotes, embedded straight quotes inside a
 * curly-quoted message, and even a second unquoted reply glued onto the
 * first with no `<br>` at all (all three confirmed against the actual
 * 2026-05-24 dump — see the migration notes). Splitting only on `<br>` and
 * taking "everything after the first colon" as content, with no requirement
 * that a trailing quote character close cleanly, survives all of those
 * without losing text — it just occasionally leaves a stray quote character
 * in the migrated content, which is harmless.
 */
export function parseCommentIntoNotes(comment: string): ParsedNoteSegment[] {
  return comment
    .split(/<br\s*\/?\s*>/i)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .map((segment): ParsedNoteSegment => {
      const match = segment.match(/^([^:]{2,50}?)\s*:\s*([\s\S]*)$/);
      if (!match) {
        return { rawName: null, content: stripLegacyHtml(segment) };
      }
      const [, rawName, rest] = match;
      const content = stripLegacyHtml(stripSurroundingQuotes(rest.trim()));
      // A colon match with nothing usable after it (e.g. "Name:" alone) is
      // more likely a false-positive name-like prefix than a real empty
      // note — fall back to the whole segment rather than write a blank row.
      return content.length > 0 ? { rawName: rawName.trim(), content } : { rawName: null, content: stripLegacyHtml(segment) };
    });
}

/**
 * Resolves a parsed segment's author against the real migrated user list.
 * Deliberately conservative: only a name matching *exactly one* legacy
 * attendee is trusted. A name matching zero attendees (a typo, a volunteer
 * who was never a member, a misleading false-positive "Name:" prefix like
 * "Duo Pose: Guy & Ann") or *more than one* (67 real duplicate full names
 * exist in the dump — misattributing to an arbitrarily-chosen one of them
 * would be worse than not attributing at all) both fall back to null.
 */
function resolveNoteAuthorId(rawName: string | null): string | null {
  if (!rawName) return null;
  const candidateIds = legacyAttendeeNameToIds.get(normalizeAttendeeName(rawName));
  if (!candidateIds || candidateIds.length !== 1) return null;
  return legacyAttendeeIdToNewId.get(candidateIds[0]) ?? null;
}

/**
 * The one fallback author for any session_notes row this migration can't
 * attribute to a real migrated user — session_notes.author_user_id is
 * NOT NULL, so *something* has to hold the row. Idempotent (ON CONFLICT DO
 * NOTHING + re-SELECT) so a --reset staging rehearsal, which wipes `users`
 * before re-running every migrate* step from scratch, never collides with
 * itself; the password is a random, permanently-unusable argon2id hash,
 * same "disabled account" pattern migrateUsers already uses for a legacy
 * account with no usable password hash.
 */
async function ensureLegacyImportUser(client: PoolClient): Promise<string> {
  const passwordHash = await hashPassword(randomUUID());
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO users (username, display_name, email, password_hash, base_role, status, email_verified_at)
     VALUES ($1, 'Legacy Import', 'legacy-import@legacy.invalid', $2, 'AccountHolder', 'Active', now())
     ON CONFLICT (username) DO NOTHING
     RETURNING id`,
    [LEGACY_IMPORT_USERNAME, passwordHash],
  );
  if (inserted.rowCount! > 0) return inserted.rows[0].id;
  const existing = await client.query<{ id: string }>(`SELECT id FROM users WHERE username = $1`, [
    LEGACY_IMPORT_USERNAME,
  ]);
  return existing.rows[0].id;
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

  const legacyImportUserId = await ensureLegacyImportUser(client);

  const [sessions, altDescriptions, capacityExceptions] = await Promise.all([
    legacyQuery<(LegacySessionRow & RowDataPacket)[]>(
      `SELECT s.id, s.modelId, s.date, s.status, s.typeId, s.mgrId, s.comment,
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

    if (row.comment) {
      const segments = parseCommentIntoNotes(row.comment);
      for (const [index, segment] of segments.entries()) {
        const matchedAuthorId = resolveNoteAuthorId(segment.rawName);
        const authorUserId = matchedAuthorId ?? legacyImportUserId;
        // Preserve the original name even when unmatched, so a segment like
        // "Duo Pose: Guy & Ann" (a false-positive "Name:" prefix, not a real
        // person) doesn't silently lose the "Duo Pose" half once it's
        // reattributed to the Legacy Import account.
        const content =
          matchedAuthorId || !segment.rawName ? segment.content : `${segment.rawName}: ${segment.content}`;
        if (!matchedAuthorId) {
          report.warnings.push(
            `sessions.id ${row.id}: comment segment${segment.rawName ? ` from "${segment.rawName}"` : ""} could not be attributed to exactly one migrated user — imported under "${LEGACY_IMPORT_USERNAME}" instead.`,
          );
        }
        // Staggered by a minute per segment (not all at startTime) so a
        // multi-reply thread still sorts in its original order under
        // src/lib/checkin/roster.ts's `ORDER BY created_at DESC` — the last
        // reply is the most recent, matching how session_notes ordering
        // reads everywhere else in the app.
        await client.query(
          `INSERT INTO session_notes (session_id, author_user_id, content, created_at) VALUES ($1, $2, $3, $4)`,
          [newSessionId, authorUserId, content, new Date(startTime.getTime() + index * 60_000)],
        );
      }
    }

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
