"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { bookSession, cancelBooking, joinWaitlist } from "@/lib/booking/actions";

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
