"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { generateSessionsForRule } from "@/lib/recurrence/generate";
import { cancelEntireSeriesByRuleId } from "@/lib/recurrence/actions";
import { writeAuditLog } from "@/lib/audit/log";

function revalidateRecurringPages() {
  revalidatePath("/admin/sessions/recurring");
  revalidatePath("/admin/sessions");
  revalidatePath("/admin/audit-logs");
}

export async function generateMoreSessionsAction(formData: FormData): Promise<void> {
  const ctx = await requireAdmin();
  if (!ctx) return;

  const ruleId = String(formData.get("ruleId") ?? "");
  const created = await generateSessionsForRule(ruleId);

  await writeAuditLog({
    actorId: ctx.id,
    actionType: "RECURRENCE_RULE_ROLLED_FORWARD",
    metadata: { ruleId, sessionsGenerated: created },
  });

  revalidateRecurringPages();
}

export async function cancelSeriesFromListAction(formData: FormData): Promise<void> {
  const ctx = await requireAdmin();
  if (!ctx) return;

  const ruleId = String(formData.get("ruleId") ?? "");
  await cancelEntireSeriesByRuleId(ruleId);

  await writeAuditLog({
    actorId: ctx.id,
    actionType: "SESSION_SERIES_CANCELED",
    metadata: { ruleId },
  });

  revalidateRecurringPages();
}
