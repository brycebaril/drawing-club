"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { pool } from "@/lib/db/pool";
import { getUserAuthContext } from "@/lib/auth/roles";

export interface GrantTestPassState {
  error?: string;
}

/**
 * Dev-only stand-in for Stripe Checkout (Phase 3 plan's payments decision —
 * stubbed until real Stripe integration lands). Grants a comp pass
 * (effective_price = 0) directly, behind the same email-verification gate
 * a real purchase would have.
 */
export async function grantTestPassAction(
  _prevState: GrantTestPassState,
  _formData: FormData,
): Promise<GrantTestPassState> {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/login?redirect=/app/wallet");

  const ctx = await getUserAuthContext(session.user.id);
  if (!ctx || ctx.status !== "Active") redirect("/auth/login");
  if (!ctx.emailVerified) {
    return { error: "Verify your email before getting a pass." };
  }

  await pool.query(
    `INSERT INTO passes (owner_id, status, is_transferable, effective_price)
     VALUES ($1, 'Available', false, 0)`,
    [ctx.id],
  );

  redirect("/app/wallet");
}
