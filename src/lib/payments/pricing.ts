import { getSettingNumber } from "@/lib/settings";

export type PurchasableItem = "SinglePass" | "Pack5" | "Pack10" | "MembershipRenewal";

const PURCHASABLE_ITEMS: readonly PurchasableItem[] = [
  "SinglePass",
  "Pack5",
  "Pack10",
  "MembershipRenewal",
];

export function isPurchasableItem(value: string): value is PurchasableItem {
  return (PURCHASABLE_ITEMS as readonly string[]).includes(value);
}

export interface ResolvedPrice {
  /** Total dollar amount to charge for this purchase. */
  totalPrice: number;
  /** Number of passes this purchase produces (0 for MembershipRenewal). */
  passCount: number;
  /** Per-pass effective_price to stamp on each resulting pass (Design Doc §6.6) — null for MembershipRenewal, which produces no passes. */
  effectivePricePerPass: number | null;
}

const PASS_COUNT: Record<"SinglePass" | "Pack5" | "Pack10", number> = {
  SinglePass: 1,
  Pack5: 5,
  Pack10: 10,
};

/**
 * Resolves what a purchase actually costs, reading current prices from the
 * system_settings store (Design Doc §12.1) — never trust a client-submitted
 * price. `isMember` should come from a fresh membership_expires_at check
 * (src/lib/auth/roles.ts's MBR derivation), not a cached role.
 */
export async function resolvePrice(item: PurchasableItem, isMember: boolean): Promise<ResolvedPrice> {
  if (item === "MembershipRenewal") {
    const totalPrice = await getSettingNumber("MEMBERSHIP_ANNUAL_FEE");
    return { totalPrice, passCount: 0, effectivePricePerPass: null };
  }

  if (item === "Pack10" && !isMember) {
    throw new Error("Pack10 is only available to active members");
  }

  const totalPrice = await getSettingNumber(settingKeyFor(item, isMember));
  const passCount = PASS_COUNT[item];
  return { totalPrice, passCount, effectivePricePerPass: roundToCents(totalPrice / passCount) };
}

function settingKeyFor(item: "SinglePass" | "Pack5" | "Pack10", isMember: boolean): string {
  switch (item) {
    case "SinglePass":
      return isMember ? "PRICE_SINGLE_PASS_MEMBER" : "PRICE_SINGLE_PASS_STANDARD";
    case "Pack5":
      return isMember ? "PRICE_PACK_5_MEMBER" : "PRICE_PACK_5_STANDARD";
    case "Pack10":
      // Member-only — no PRICE_PACK_10_STANDARD setting exists (Design Doc §7.1).
      return "PRICE_PACK_10_MEMBER";
  }
}

function roundToCents(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Display label for a stored transactions.item_type value (the
 * transaction_item_type enum: SinglePass/PassPack/MembershipRenewal) —
 * shared by /admin/transactions, /ops/financials, its payout drill-down, and
 * both CSV exports, so the raw enum value is never shown on screen again.
 * Deliberately a separate function from describeItem() (wallet/actions.ts,
 * Stripe checkout naming): that one distinguishes Pack5 vs Pack10 because
 * Stripe needs the real price at that point, but item_type itself only ever
 * stores "PassPack" for both — this can't invent a distinction the data
 * doesn't have.
 */
export function describeTransactionItemType(itemType: string): string {
  switch (itemType) {
    case "SinglePass":
      return "Single Session Ticket";
    case "PassPack":
      return "Ticket Pack";
    case "MembershipRenewal":
      return "Membership Renewal";
    default:
      return itemType;
  }
}
