"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { bookSession, cancelBooking, joinWaitlist } from "@/lib/booking/actions";
import { bookSeriesSeat, cancelSeriesSeatDate } from "@/lib/series/actions";

// Server Functions are POSTs to the page they're defined on — Proxy's RBAC
// gate covers the page render but not these individually, so each derives
// the acting user from the authenticated session itself (never trust a
// client-supplied userId) and re-checks auth (docs/SecurityDocument.md §3;
// node_modules/next/dist/docs/.../proxy.md "Execution order").
async function requireUserId(sessionId: string): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) redirect(`/auth/login?redirect=/app/schedule?session_id=${sessionId}`);
  return session.user.id;
}

function backToSession(sessionId: string, errorReason?: string) {
  // Reachable via a prefetched <Link> on /dashboard — see
  // src/app/admin/users/[id]/actions.ts's revalidateUserPages for why this
  // matters (Router Cache can otherwise serve pre-mutation booking status).
  revalidatePath("/app/schedule");
  const params = new URLSearchParams({ session_id: sessionId });
  if (errorReason) params.set("bookingError", errorReason);
  redirect(`/app/schedule?${params.toString()}`);
}

export async function bookSessionAction(formData: FormData) {
  const sessionId = String(formData.get("sessionId"));
  const userId = await requireUserId(sessionId);
  const result = await bookSession(userId, sessionId);
  backToSession(sessionId, result.ok ? undefined : result.reason);
}

export async function cancelBookingAction(formData: FormData) {
  const sessionId = String(formData.get("sessionId"));
  const userId = await requireUserId(sessionId);
  const result = await cancelBooking(userId, sessionId);
  backToSession(sessionId, result.ok ? undefined : result.reason);
}

export async function joinWaitlistAction(formData: FormData) {
  const sessionId = String(formData.get("sessionId"));
  const userId = await requireUserId(sessionId);
  const result = await joinWaitlist(userId, sessionId);
  backToSession(sessionId, result.ok ? undefined : result.reason);
}

function backToSeries(clickedSessionId: string, seatNumber?: number, errorReason?: string) {
  revalidatePath("/app/schedule");
  const params = new URLSearchParams({ session_id: clickedSessionId });
  if (seatNumber) params.set("seat", String(seatNumber));
  if (errorReason) params.set("bookingError", errorReason);
  redirect(`/app/schedule?${params.toString()}`);
}

export async function bookSeriesSeatAction(formData: FormData) {
  const seriesId = String(formData.get("seriesId"));
  const clickedSessionId = String(formData.get("clickedSessionId"));
  const seatNumber = Number(formData.get("seatNumber"));
  const sessionIds = formData.getAll("sessionIds").map(String);

  const userId = await requireUserId(clickedSessionId);
  const result = await bookSeriesSeat(userId, seriesId, seatNumber, sessionIds);
  backToSeries(clickedSessionId, seatNumber, result.ok ? undefined : result.reason);
}

export async function cancelSeriesSeatDateAction(formData: FormData) {
  const sessionId = String(formData.get("sessionId"));
  const clickedSessionId = String(formData.get("clickedSessionId"));

  const userId = await requireUserId(clickedSessionId);
  const result = await cancelSeriesSeatDate(userId, sessionId);
  backToSeries(clickedSessionId, undefined, result.ok ? undefined : result.reason);
}
