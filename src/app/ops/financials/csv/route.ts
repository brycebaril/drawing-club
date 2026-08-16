import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserAuthContext } from "@/lib/auth/roles";
import { pool } from "@/lib/db/pool";
import { toDateOnly } from "@/lib/sessions/shared";

interface ReportRow {
  model_name: string;
  contact_info: string | null;
  week_start_date: Date;
  week_end_date: Date;
  sessions_worked: number;
  rate_applied: string;
  total_owed: string;
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * /ops/financials's CSV download, for the Treasurer specifically (the user
 * requesting this feature named the Treasurer as needing a downloadable
 * copy alongside the emailed report). `/api/*` routes are excluded from
 * src/proxy.ts's matcher, so this checks auth itself, same as every other
 * API route in this app.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }
  const ctx = await getUserAuthContext(session.user.id);
  if (!ctx || (!ctx.roles.includes("VOL_CTRL") && !ctx.roles.includes("ADMIN"))) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  const weekStart = new URL(request.url).searchParams.get("weekStart");
  if (!weekStart) {
    return NextResponse.json({ error: "weekStart query param is required." }, { status: 400 });
  }

  const result = await pool.query<ReportRow>(
    `SELECT m.name AS model_name, m.contact_info, r.week_start_date, r.week_end_date,
            r.sessions_worked, r.rate_applied, r.total_owed
     FROM model_payout_reports r
     JOIN models m ON m.id = r.model_id
     WHERE r.week_start_date = $1
     ORDER BY m.name`,
    [weekStart],
  );

  const lines = ["Model,Contact,Week Start,Week End,Sessions Worked,Rate Applied,Total Owed"];
  for (const row of result.rows) {
    lines.push(
      [
        csvEscape(row.model_name),
        csvEscape(row.contact_info ?? ""),
        toDateOnly(new Date(row.week_start_date)),
        toDateOnly(new Date(row.week_end_date)),
        String(row.sessions_worked),
        row.rate_applied,
        row.total_owed,
      ].join(","),
    );
  }

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="model-payout-${weekStart}.csv"`,
    },
  });
}
