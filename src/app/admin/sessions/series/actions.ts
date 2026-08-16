"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { cancelEntireSeriesById } from "@/lib/series/actions";
import { writeAuditLog } from "@/lib/audit/log";

function revalidateSeriesPages() {
  revalidatePath("/admin/sessions/series");
  revalidatePath("/admin/sessions");
  revalidatePath("/admin/audit-logs");
}

export async function cancelSeriesFromListAction(formData: FormData): Promise<void> {
  const ctx = await requireAdmin();
  if (!ctx) return;

  const seriesId = String(formData.get("seriesId") ?? "");
  await cancelEntireSeriesById(seriesId);

  await writeAuditLog({
    actorId: ctx.id,
    actionType: "MULTIWEEK_SERIES_CANCELED",
    metadata: { seriesId },
  });

  revalidateSeriesPages();
}
