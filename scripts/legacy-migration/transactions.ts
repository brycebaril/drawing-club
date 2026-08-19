import type { PoolClient } from "pg";
import type { RowDataPacket } from "mysql2/promise";
import { legacyQuery } from "./mysqlSource";
import { emptyReport, type MigrationReport } from "./types";
import { legacyAttendeeIdToNewId } from "./users";

interface LegacyOrderComponentRow {
  id: number;
  invoiceId: number;
  sku: number;
  price: string;
  passId: number | null;
  customerId: number;
  orderDate: Date;
}

const SINGLE_PASS_SKUS = new Set([1, 101]);
const PASS_PACK_SKUS = new Set([5, 7, 105]);
const MEMBERSHIP_SKUS = new Set([500, 501, 502]);

function itemTypeForSku(sku: number): "SinglePass" | "PassPack" | "MembershipRenewal" | null {
  if (SINGLE_PASS_SKUS.has(sku)) return "SinglePass";
  if (PASS_PACK_SKUS.has(sku)) return "PassPack";
  if (MEMBERSHIP_SKUS.has(sku)) return "MembershipRenewal";
  return null;
}

/** legacy owned_passes.id (via store_order_components.passId) -> migrated
 * transactions.id — membership_history uses this to link a migrated
 * membership pass back to the transaction that paid for it. */
export const legacyPassIdToTransactionId = new Map<number, string>();

export async function migrateTransactions(client: PoolClient): Promise<MigrationReport> {
  const report = emptyReport("transactions");

  // One row per store_order_components line item, not per store_orders row —
  // ~1% of fulfilled orders bundle more than one line item (e.g. a ticket +
  // a membership in one checkout, verified against the real dump), and each
  // needs its own correctly-typed, correctly-priced transaction so a
  // migrated pass/membership row can link to the specific purchase that
  // paid for it. Component prices were verified to sum exactly to their
  // order's total for every fulfilled order, so no data is lost by
  // splitting this way.
  const components = await legacyQuery<(LegacyOrderComponentRow & RowDataPacket)[]>(
    `SELECT soc.id, soc.invoiceId, soc.sku, soc.price, soc.passId, so.customerId, so.date AS orderDate
     FROM store_order_components soc
     JOIN store_orders so ON so.invoiceId = soc.invoiceId
     WHERE so.status = 10
     ORDER BY soc.invoiceId, soc.id`,
  );

  for (const row of components) {
    const userId = legacyAttendeeIdToNewId.get(row.customerId);
    if (!userId) {
      report.skipped += 1;
      report.warnings.push(
        `store_order_components.id ${row.id}: customerId ${row.customerId} has no migrated user — skipped.`,
      );
      continue;
    }

    const itemType = itemTypeForSku(row.sku);
    if (!itemType) {
      report.skipped += 1;
      report.warnings.push(`store_order_components.id ${row.id}: unrecognized sku ${row.sku} — skipped.`);
      continue;
    }

    // Reserved prefix (docs/MigrationPlan.md §5) so revenue/reconciliation
    // reporting can exclude legacy PayPal-era activity from Stripe-specific
    // logic (fee lookups, payout-batch matching) without a new column.
    const gatewayRefId = `legacy-invoice-${row.invoiceId}-${row.id}`;

    const result = await client.query<{ id: string }>(
      `INSERT INTO transactions (user_id, gateway_ref_id, amount_paid, charge_status, item_type, created_at)
       VALUES ($1, $2, $3, 'Succeeded', $4, $5)
       RETURNING id`,
      [userId, gatewayRefId, row.price, itemType, row.orderDate],
    );

    if (row.passId !== null) {
      legacyPassIdToTransactionId.set(row.passId, result.rows[0].id);
    }
    report.migrated += 1;
  }

  return report;
}
