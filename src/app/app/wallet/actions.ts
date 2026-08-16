"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getUserAuthContext } from "@/lib/auth/roles";
import { stripe } from "@/lib/stripe/client";
import { resolvePrice, isPurchasableItem, type PurchasableItem } from "@/lib/payments/pricing";

export interface CreateCheckoutSessionState {
  error?: string;
}

function describeItem(item: PurchasableItem): string {
  switch (item) {
    case "SinglePass":
      return "Single Session Pass";
    case "Pack5":
      return "5-Pass Pack";
    case "Pack10":
      return "10-Pass Pack";
    case "MembershipRenewal":
      return "Annual Membership Renewal";
  }
}

/**
 * Creates a Stripe Checkout Session and redirects the browser to it
 * (Design Doc §7, ArchitectureDocument.md §7). Price is resolved entirely
 * server-side from the viewer's current membership status and the
 * system_settings store — the client only ever picks *which* item, never
 * how much it costs. Fulfillment (creating passes / extending membership)
 * happens later, in src/app/api/webhooks/stripe/route.ts, once Stripe
 * confirms the charge — not here, since the user hasn't paid yet at the
 * point this action runs.
 */
export async function createCheckoutSessionAction(
  _prevState: CreateCheckoutSessionState,
  formData: FormData,
): Promise<CreateCheckoutSessionState> {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/login?redirect=/app/wallet");

  const ctx = await getUserAuthContext(session.user.id);
  if (!ctx || ctx.status !== "Active") redirect("/auth/login");
  if (!ctx.emailVerified) {
    return { error: "Verify your email before buying a pass." };
  }

  const item = String(formData.get("item") ?? "");
  if (!isPurchasableItem(item)) {
    return { error: "Choose something to buy." };
  }

  const isMember = ctx.roles.includes("MBR");
  const resolved = await resolvePrice(item, isMember).catch(() => null);
  if (!resolved) {
    return { error: "That item isn't available to you." };
  }

  const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const checkoutSession = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: { name: describeItem(item) },
          unit_amount: Math.round(resolved.totalPrice * 100),
        },
        quantity: 1,
      },
    ],
    client_reference_id: ctx.id,
    metadata: {
      userId: ctx.id,
      item,
      passCount: String(resolved.passCount),
      effectivePricePerPass:
        resolved.effectivePricePerPass !== null ? String(resolved.effectivePricePerPass) : "",
    },
    success_url: `${baseUrl}/app/wallet?checkout=success`,
    cancel_url: `${baseUrl}/app/wallet?checkout=cancelled`,
  });

  if (!checkoutSession.url) {
    return { error: "Could not start checkout. Try again." };
  }

  redirect(checkoutSession.url);
}
