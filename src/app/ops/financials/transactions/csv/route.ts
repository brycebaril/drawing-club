import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserAuthContext } from "@/lib/auth/roles";
import { pool } from "@/lib/db/pool";
import { describeTransactionItemType } from "@/lib/payments/pricing";

interface TransactionRow {
  username: string | null;
  item_type: string;
  amount_paid: string;
  processing_fee: string | null;
  net_amount: string | null;
  charge_status: string;
  payout_batch_id: string | null;
  payout_status: string;
  gateway_ref_id: string;
  created_at: Date;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * All succeeded transactions in an arbitrary date range, for tax
 * filings/an accountant handoff — the "transaction histories" deliverable
 * a VOL_CTRL user can get without /admin/transactions access. Mirrors
 * /ops/financials/csv/route.ts's exact shape; own auth check since /api/*
 * bypasses src/proxy.ts.
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

  const params = new URL(request.url).searchParams;
  const start = params.get("start");
  const end = params.get("end");
  if (!start || !end || !DATE_ONLY.test(start) || !DATE_ONLY.test(end)) {
    return NextResponse.json({ error: "start and end query params (YYYY-MM-DD) are required." }, { status: 400 });
  }

  const result = await pool.query<TransactionRow>(
    `SELECT u.username, t.item_type, t.amount_paid, t.processing_fee, t.net_amount,
            t.charge_status, t.payout_batch_id, t.payout_status, t.gateway_ref_id, t.created_at
     FROM transactions t
     LEFT JOIN users u ON u.id = t.user_id
     WHERE t.charge_status = 'Succeeded' AND t.created_at::date BETWEEN $1::date AND $2::date
     ORDER BY t.created_at`,
    [start, end],
  );

  const lines = [
    "Buyer,Item Type,Amount Paid,Fee,Net,Charge Status,Payout Batch,Payout Status,Gateway Reference,Date",
  ];
  for (const row of result.rows) {
    lines.push(
      [
        csvEscape(row.username ?? ""),
        csvEscape(describeTransactionItemType(row.item_type)),
        row.amount_paid,
        row.processing_fee ?? "",
        row.net_amount ?? "",
        row.charge_status,
        csvEscape(row.payout_batch_id ?? ""),
        row.payout_status,
        csvEscape(row.gateway_ref_id),
        new Date(row.created_at).toISOString(),
      ].join(","),
    );
  }

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="transactions-${start}-to-${end}.csv"`,
    },
  });
}
