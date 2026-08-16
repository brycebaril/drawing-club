import { pool } from "@/lib/db/pool";
import { getSettingNumber, getSettingString } from "@/lib/settings";
import { toDateOnly } from "@/lib/sessions/shared";
import { sendEmail } from "@/lib/email/sender";

export interface ModelSessionsWorked {
  modelId: string;
  modelName: string;
  modelContactInfo: string | null;
  sessionDates: Date[];
}

export interface ComputedPayout {
  modelId: string;
  modelName: string;
  modelContactInfo: string | null;
  sessionsWorked: number;
  rateApplied: number;
  totalOwed: number;
  sessionDates: Date[];
}

/**
 * Pure calculation core — Design Doc §10's "sessions_worked × rate_applied,"
 * a single global flat rate with no per-model tiers or deductions. Split out
 * from the DB-touching wrapper below so this can be unit tested directly
 * against fixture data, same reasoning as recurrence/actions.ts's
 * selectSessionIdsToCancel. Models with zero sessions worked are dropped —
 * matches the legacy report this replaces, which only lists models who
 * actually worked that week.
 */
export function computePayouts(
  modelsWorked: ModelSessionsWorked[],
  ratePerSession: number,
): ComputedPayout[] {
  return modelsWorked
    .filter((m) => m.sessionDates.length > 0)
    .map((m) => ({
      modelId: m.modelId,
      modelName: m.modelName,
      modelContactInfo: m.modelContactInfo,
      sessionsWorked: m.sessionDates.length,
      rateApplied: ratePerSession,
      totalOwed: Math.round(m.sessionDates.length * ratePerSession * 100) / 100,
      sessionDates: m.sessionDates,
    }));
}

export interface GeneratePayoutReportsResult {
  weekStart: Date;
  weekEnd: Date;
  generated: ComputedPayout[];
  /** Model IDs that already had a report for this week — a re-run is a safe no-op, not an error. */
  skipped: string[];
}

/**
 * `weekStart` must be a Monday — the week is always Monday through the
 * following Sunday (matching the legacy report this replaces, e.g.
 * "2026-08-03 - 2026-08-09"). Idempotent: relies on
 * model_payout_reports_model_id_week_start_date_unique
 * (migrations/1786920229751_model-payout-reports-unique.js) via
 * `ON CONFLICT ... DO NOTHING`, so calling this twice for the same week
 * (the on-demand button, then the CLI script, or vice versa) never produces
 * duplicate reports or double-counts a model's pay.
 */
export async function generatePayoutReports(weekStart: Date): Promise<GeneratePayoutReportsResult> {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const rangeEndExclusive = new Date(weekStart);
  rangeEndExclusive.setDate(rangeEndExclusive.getDate() + 7);

  const rate = await getSettingNumber("MODEL_FLAT_PAY_RATE");

  const rows = await pool.query<{
    model_id: string;
    model_name: string;
    model_contact_info: string | null;
    session_date: Date;
  }>(
    `SELECT m.id AS model_id, m.name AS model_name, m.contact_info AS model_contact_info, s.start_time AS session_date
     FROM session_model_mapping smm
     JOIN sessions s ON s.id = smm.session_id
     JOIN models m ON m.id = smm.model_id
     WHERE s.status != 'Canceled' AND s.start_time >= $1 AND s.start_time < $2
     ORDER BY m.name, s.start_time`,
    [weekStart, rangeEndExclusive],
  );

  const byModel = new Map<string, ModelSessionsWorked>();
  for (const row of rows.rows) {
    let entry = byModel.get(row.model_id);
    if (!entry) {
      entry = {
        modelId: row.model_id,
        modelName: row.model_name,
        modelContactInfo: row.model_contact_info,
        sessionDates: [],
      };
      byModel.set(row.model_id, entry);
    }
    entry.sessionDates.push(new Date(row.session_date));
  }

  const computed = computePayouts(Array.from(byModel.values()), rate);

  const generated: ComputedPayout[] = [];
  const skipped: string[] = [];
  for (const payout of computed) {
    const inserted = await pool.query(
      `INSERT INTO model_payout_reports (model_id, week_start_date, week_end_date, sessions_worked, rate_applied, total_owed)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (model_id, week_start_date) DO NOTHING
       RETURNING id`,
      [payout.modelId, toDateOnly(weekStart), toDateOnly(weekEnd), payout.sessionsWorked, payout.rateApplied, payout.totalOwed],
    );
    if (inserted.rowCount! > 0) {
      generated.push(payout);
    } else {
      skipped.push(payout.modelId);
    }
  }

  return { weekStart, weekEnd, generated, skipped };
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function formatReportBody(result: GeneratePayoutReportsResult, paymentNotes: string): string {
  const lines: string[] = [];
  lines.push(`Model Payroll Report: ${toDateOnly(result.weekStart)} - ${toDateOnly(result.weekEnd)}`);
  lines.push("");
  lines.push("Notes:");
  lines.push(
    "* The names and contact details in this report are CONFIDENTIAL and shared on a need-to-know basis only. Do not forward this report to anyone. Address concerns or questions to the current Model Booker.",
  );
  lines.push("* Please try to pay models within a week of their booked session.");
  lines.push(`* Current model rate is $${result.generated[0]?.rateApplied.toFixed(2) ?? "—"}.`);
  if (paymentNotes) lines.push(`* ${paymentNotes}`);
  lines.push("");
  lines.push("------------");
  lines.push("Date       Day        Model                Contact                        Sessions   Total Owed");
  for (const payout of result.generated) {
    for (const date of payout.sessionDates) {
      const dateStr = toDateOnly(date).padEnd(11);
      const dayStr = DAY_NAMES[date.getDay()].padEnd(11);
      const nameStr = payout.modelName.padEnd(21);
      const contactStr = (payout.modelContactInfo ?? "—").padEnd(31);
      lines.push(`${dateStr}${dayStr}${nameStr}${contactStr}`);
    }
    lines.push(
      `  Total for ${payout.modelName}: ${payout.sessionsWorked} session(s) × $${payout.rateApplied.toFixed(2)} = $${payout.totalOwed.toFixed(2)}`,
    );
  }
  return lines.join("\n");
}

/**
 * Emails every VOL_CTRL + VOL_MBR role-holder — the legacy report this
 * replaces went to "the Controller, Treasurer, and Model Booker volunteers,"
 * and this app has no distinct Treasurer role (Design Doc §7.3/§5.2 use
 * "Controller" and "Treasurer" interchangeably for the same person), so
 * VOL_CTRL covers both. Each send is isolated in its own try/catch — one bad
 * address shouldn't stop the rest, same reasoning as
 * releaseAllBookingsForSession's booker-notification loop.
 */
export async function sendPayoutReportEmail(result: GeneratePayoutReportsResult): Promise<void> {
  if (result.generated.length === 0) return;

  const paymentNotes = await getSettingString("MODEL_PAYOUT_PAYMENT_NOTES").catch(() => "");
  const body = formatReportBody(result, paymentNotes);
  const subject = `Model Payroll Report: ${toDateOnly(result.weekStart)} - ${toDateOnly(result.weekEnd)}`;

  const recipients = await pool.query<{ email: string }>(
    `SELECT DISTINCT u.email
     FROM volunteer_roles vr
     JOIN users u ON u.id = vr.user_id
     WHERE vr.role IN ('Controller', 'ModelBooker')`,
  );

  for (const recipient of recipients.rows) {
    try {
      await sendEmail({ to: recipient.email, subject, body });
    } catch {
      // Isolated per-recipient — see doc comment above.
    }
  }
}
