"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { writeAuditLog } from "@/lib/audit/log";
import { releaseAllBookingsForSession } from "@/lib/booking/actions";
import {
  cancelEntireSeries,
  cancelThisAndFutureOccurrences,
} from "@/lib/recurrence/actions";
import {
  cancelEntireSeriesForSession,
  cancelSeriesThisAndFuture,
} from "@/lib/series/actions";

function revalidateSessionPages(sessionId: string) {
  revalidatePath(`/admin/sessions/${sessionId}`);
  revalidatePath("/admin/sessions");
  revalidatePath("/admin/sessions/recurring");
  revalidatePath("/admin/sessions/series");
  revalidatePath("/admin/audit-logs");
}

/** Also used for a plain one-off session — "cancel this occurrence" either way. */
export async function cancelOccurrenceAction(formData: FormData): Promise<void> {
  const ctx = await requireAdmin();
  if (!ctx) redirect("/auth/login");

  const sessionId = String(formData.get("sessionId") ?? "");
  await releaseAllBookingsForSession(sessionId);

  await writeAuditLog({
    actorId: ctx.id,
    actionType: "SESSION_OCCURRENCE_CANCELED",
    metadata: { sessionId },
  });

  revalidateSessionPages(sessionId);
  redirect(`/admin/sessions/${sessionId}`);
}

export async function cancelThisAndFutureAction(formData: FormData): Promise<void> {
  const ctx = await requireAdmin();
  if (!ctx) redirect("/auth/login");

  const sessionId = String(formData.get("sessionId") ?? "");
  await cancelThisAndFutureOccurrences(sessionId);

  await writeAuditLog({
    actorId: ctx.id,
    actionType: "SESSION_SERIES_CANCELED_FORWARD",
    metadata: { fromSessionId: sessionId },
  });

  revalidateSessionPages(sessionId);
  redirect(`/admin/sessions/${sessionId}`);
}

export async function cancelSeriesAction(formData: FormData): Promise<void> {
  const ctx = await requireAdmin();
  if (!ctx) redirect("/auth/login");

  const sessionId = String(formData.get("sessionId") ?? "");
  await cancelEntireSeries(sessionId);

  await writeAuditLog({
    actorId: ctx.id,
    actionType: "SESSION_SERIES_CANCELED",
    metadata: { fromSessionId: sessionId },
  });

  revalidateSessionPages(sessionId);
  redirect(`/admin/sessions/${sessionId}`);
}

export async function cancelSeriesThisAndFutureAction(formData: FormData): Promise<void> {
  const ctx = await requireAdmin();
  if (!ctx) redirect("/auth/login");

  const sessionId = String(formData.get("sessionId") ?? "");
  await cancelSeriesThisAndFuture(sessionId);

  await writeAuditLog({
    actorId: ctx.id,
    actionType: "MULTIWEEK_SERIES_CANCELED_FORWARD",
    metadata: { fromSessionId: sessionId },
  });

  revalidateSessionPages(sessionId);
  redirect(`/admin/sessions/${sessionId}`);
}

export async function cancelSeriesEntireSeriesAction(formData: FormData): Promise<void> {
  const ctx = await requireAdmin();
  if (!ctx) redirect("/auth/login");

  const sessionId = String(formData.get("sessionId") ?? "");
  await cancelEntireSeriesForSession(sessionId);

  await writeAuditLog({
    actorId: ctx.id,
    actionType: "MULTIWEEK_SERIES_CANCELED",
    metadata: { fromSessionId: sessionId },
  });

  revalidateSessionPages(sessionId);
  redirect(`/admin/sessions/${sessionId}`);
}
