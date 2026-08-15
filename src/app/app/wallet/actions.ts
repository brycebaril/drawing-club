"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { pool } from "@/lib/db/pool";
import { getUserAuthContext } from "@/lib/auth/roles";
import { writeAuditLog } from "@/lib/audit/log";

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

  await writeAuditLog({
    actorId: ctx.id,
    actionType: "PASS_GRANTED",
    targetUserId: ctx.id,
    metadata: { source: "dev-stub-checkout", effectivePrice: 0 },
  });

  // Reachable via a prefetched <Link> on /dashboard — see
  // src/app/admin/users/[id]/actions.ts's revalidateUserPages for why this
  // matters (Router Cache can otherwise serve the pre-grant balance).
  revalidatePath("/app/wallet");
  redirect("/app/wallet");
}
