import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserAuthContext } from "@/lib/auth/roles";
import { pool } from "@/lib/db/pool";
import { describeTransactionItemType } from "@/lib/payments/pricing";

interface BatchTransactionRow {
  username: string | null;
  display_name: string | null;
  item_type: string;
  amount_paid: string;
  processing_fee: string | null;
  net_amount: string | null;
  gateway_ref_id: string;
  created_at: Date;
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * One payout batch's transactions, for matching against a specific bank
 * deposit line — mirrors /ops/financials/csv/route.ts's exact shape.
 * `/api/*` routes are excluded from src/proxy.ts's matcher, so this checks
 * auth itself, same as every other API route in this app.
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

  const payoutBatchId = new URL(request.url).searchParams.get("payoutBatchId");
  if (!payoutBatchId) {
    return NextResponse.json({ error: "payoutBatchId query param is required." }, { status: 400 });
  }

  const result = await pool.query<BatchTransactionRow>(
    `SELECT u.username, u.display_name, t.item_type, t.amount_paid, t.processing_fee, t.net_amount,
            t.gateway_ref_id, t.created_at
     FROM transactions t
     LEFT JOIN users u ON u.id = t.user_id
     WHERE t.payout_batch_id = $1
     ORDER BY t.created_at`,
    [payoutBatchId],
  );

  const lines = ["Buyer,Buyer Display Name,Item Type,Amount Paid,Fee,Net,Gateway Reference,Date"];
  for (const row of result.rows) {
    lines.push(
      [
        csvEscape(row.username ?? ""),
        csvEscape(row.display_name ?? ""),
        csvEscape(describeTransactionItemType(row.item_type)),
        row.amount_paid,
        row.processing_fee ?? "",
        row.net_amount ?? "",
        csvEscape(row.gateway_ref_id),
        new Date(row.created_at).toISOString(),
      ].join(","),
    );
  }

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="payout-${payoutBatchId}.csv"`,
    },
  });
}
