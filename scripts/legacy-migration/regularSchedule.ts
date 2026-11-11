import { pool } from "../../src/lib/db/pool";
import { generateSessionsForRule } from "../../src/lib/recurrence/generate";
import { orgAddDays, orgDateOnly, orgDateParts, orgStartOfDay } from "../../src/lib/timezone";
import { emptyReport, type MigrationReport } from "./types";

interface RegularScheduleSlot {
  dayOfWeek: number; // 0=Sunday..6=Saturday, matches src/lib/sessions/shared.ts's DAYS_OF_WEEK
  sessionType: string;
  startTimeOfDay: string;
  endTimeOfDay: string;
  maxCapacity: number | null; // null = defer to the live SESSION_DEFAULT_CAPACITY setting
}

/**
 * The studio's current regular weekly schedule, confirmed with the org
 * 2026-08-19 (docs/MigrationPlan.md) by cross-referencing the migrated
 * historical sessions' day/time/type pattern near the end of the dump's
 * date range against what's still actually running. Update this list (not
 * the migrated data — there's nothing to re-derive it from) if the real
 * schedule changes before a production cutover.
 */
const REGULAR_SCHEDULE_SLOTS: RegularScheduleSlot[] = [
  { dayOfWeek: 1, sessionType: "R", startTimeOfDay: "18:00", endTimeOfDay: "21:00", maxCapacity: null }, // Mon evening
  { dayOfWeek: 2, sessionType: "R", startTimeOfDay: "10:00", endTimeOfDay: "13:00", maxCapacity: null }, // Tue morning
  { dayOfWeek: 2, sessionType: "P", startTimeOfDay: "18:00", endTimeOfDay: "21:00", maxCapacity: 17 }, // Tue evening Portrait
  { dayOfWeek: 3, sessionType: "G", startTimeOfDay: "19:00", endTimeOfDay: "22:00", maxCapacity: null }, // Wed evening
  { dayOfWeek: 4, sessionType: "R", startTimeOfDay: "10:00", endTimeOfDay: "13:00", maxCapacity: null }, // Thu morning
  { dayOfWeek: 4, sessionType: "R", startTimeOfDay: "19:00", endTimeOfDay: "22:00", maxCapacity: null }, // Thu evening
  { dayOfWeek: 5, sessionType: "L", startTimeOfDay: "19:00", endTimeOfDay: "22:00", maxCapacity: null }, // Fri evening Long Pose
  { dayOfWeek: 6, sessionType: "R", startTimeOfDay: "10:00", endTimeOfDay: "13:00", maxCapacity: null }, // Sat morning
  { dayOfWeek: 0, sessionType: "L", startTimeOfDay: "10:00", endTimeOfDay: "13:00", maxCapacity: null }, // Sun morning Long Pose
  { dayOfWeek: 0, sessionType: "G", startTimeOfDay: "14:00", endTimeOfDay: "17:00", maxCapacity: null }, // Sun afternoon
];

/**
 * Bootstraps the studio's current regular weekly schedule as real
 * `recurrence_rules`, so a fresh migration doesn't leave `/app/schedule`
 * permanently empty. Deliberately NOT "migrated data" in the same sense as
 * the rest of this pipeline — legacy had no recurring-rule concept of its
 * own (every legacy session is a flat one-off row); this is a snapshot of
 * confirmed real-world scheduling knowledge, reproduced here rather than
 * left as a manual post-migration step.
 *
 * Runs AFTER the orchestrator's main transaction commits, not inside it:
 * `generateSessionsForRule` manages its own transaction via the app's
 * shared `pool` (the same function `/admin/sessions/new-recurring` calls),
 * which can't participate in the orchestrator's single BEGIN/COMMIT
 * without risking orphaned `sessions` rows if a *later*, unrelated
 * migration step failed and rolled back the transaction these rules were
 * inserted under.
 */
export async function createRegularSchedule(): Promise<MigrationReport> {
  const report = emptyReport("regular schedule (recurrence_rules)");

  const adminResult = await pool.query<{ id: string }>(
    `SELECT id FROM users WHERE base_role = 'Admin' ORDER BY legacy_id::int ASC LIMIT 1`,
  );
  if (adminResult.rowCount === 0) {
    report.warnings.push("No migrated Admin user found to attribute the regular schedule to — not created.");
    return report;
  }
  const createdBy = adminResult.rows[0].id;

  // The dump already carries the legacy system's own scheduled sessions,
  // typically a month or so past the cutover. Starting every rule at the
  // cutover duplicated each of those (found in the 2026-11-08 dump
  // rehearsal: 20 same-instant legacy + generated pairs). Each rule now
  // starts the day after legacy's last session in its own weekly slot,
  // canceled ones included (legacy already decided that date), so the two
  // never overlap. "In its slot" means same weekday, starting within 3 hours
  // of the rule's start — not an exact time match, since legacy sometimes
  // replaces a regular session with a different one nearby (e.g. a 6pm ELP
  // in place of the 7pm Friday Long Pose).
  const today = orgStartOfDay(new Date());
  const legacyUpcoming = await pool.query<{ start_time: Date }>(
    `SELECT start_time FROM sessions WHERE legacy_id IS NOT NULL AND start_time >= $1`,
    [today],
  );

  for (const slot of REGULAR_SCHEDULE_SLOTS) {
    const [hour, minute] = slot.startTimeOfDay.split(":").map(Number);
    const slotMinutes = hour * 60 + minute;
    let lastLegacy: Date | null = null;
    for (const row of legacyUpcoming.rows) {
      const start = new Date(row.start_time);
      const p = orgDateParts(start);
      const inSlot = p.weekday === slot.dayOfWeek && Math.abs(p.hour * 60 + p.minute - slotMinutes) < 180;
      if (inSlot && (!lastLegacy || start > lastLegacy)) lastLegacy = start;
    }
    const startDate = orgDateOnly(lastLegacy ? orgAddDays(orgStartOfDay(lastLegacy), 1) : today);

    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO recurrence_rules
         (session_type, description, day_of_week, start_time_of_day, end_time_of_day,
          max_capacity, default_host_user_id, start_date, end_date, created_by)
       VALUES ($1, NULL, $2, $3, $4, $5, NULL, $6, NULL, $7)
       RETURNING id`,
      [
        slot.sessionType,
        slot.dayOfWeek,
        slot.startTimeOfDay,
        slot.endTimeOfDay,
        slot.maxCapacity,
        startDate,
        createdBy,
      ],
    );
    const ruleId = inserted.rows[0].id;
    const created = await generateSessionsForRule(ruleId);
    report.migrated += created;
  }

  return report;
}
