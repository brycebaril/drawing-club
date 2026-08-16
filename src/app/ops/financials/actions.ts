"use server";

import { revalidatePath } from "next/cache";
import { requireOpsRole } from "@/lib/auth/requireOpsRole";
import { writeAuditLog } from "@/lib/audit/log";
import { generatePayoutReports, sendPayoutReportEmail } from "@/lib/ops/payouts";
import { parseDateOnly } from "@/lib/sessions/shared";

export interface GenerateReportState {
  error?: string;
}

/**
 * On-demand equivalent of `pnpm generate-payouts` (scripts/generate-payouts.ts)
 * — both call the same generatePayoutReports/sendPayoutReportEmail
 * functions, same split this app already uses for recurring-session
 * rollforward.
 */
export async function generateReportAction(
  _prevState: GenerateReportState,
  formData: FormData,
): Promise<GenerateReportState> {
  const ctx = await requireOpsRole(["VOL_CTRL"]);
  if (!ctx) return { error: "Not authorized." };

  const weekStartInput = String(formData.get("weekStart") ?? "");
  const weekStart = parseDateOnly(weekStartInput);
  if (Number.isNaN(weekStart.getTime()) || weekStart.getDay() !== 1) {
    return { error: "Choose a Monday as the week start." };
  }

  const result = await generatePayoutReports(weekStart);
  await sendPayoutReportEmail(result);

  await writeAuditLog({
    actorId: ctx.id,
    actionType: "MODEL_PAYOUT_REPORT_GENERATED",
    metadata: {
      weekStart: weekStartInput,
      modelsGenerated: result.generated.length,
      modelsSkipped: result.skipped.length,
    },
  });

  revalidatePath("/ops/financials");
  return {};
}
