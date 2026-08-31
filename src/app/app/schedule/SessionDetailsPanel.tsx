import { Info, Lock, UserX } from "lucide-react";
import { bookSessionAction, cancelBookingAction, joinWaitlistAction } from "./actions";
import { describeBookingErrorReason, sessionTypeInfo } from "./scheduleTypes";
import type { SessionStatus } from "@/lib/booking/sessionStatus";

interface SessionInfo {
  id: string;
  session_type: string;
  description: string | null;
  start_time: Date;
  end_time: Date;
  max_capacity: number;
  host_username: string | null;
  booked_count: number;
}

export function SessionDetailsPanel({
  session,
  status,
  needsModel,
  bookingError,
  loggedIn,
}: {
  session: SessionInfo;
  status: SessionStatus;
  needsModel: boolean;
  bookingError?: string;
  /**
   * Registered/CancelableNoRefund/OnWaitlist are unreachable for a guest
   * (computeSessionStatus never produces them without a viewer identity),
   * so only the Available/Full branches below need a guest variant — a
   * "Log in to..." link in place of the real booking form.
   */
  loggedIn: boolean;
}) {
  // Matches requireUserId's own redirect shape in actions.ts (unencoded —
  // the embedded "?" is a literal character within the redirect param's
  // value, not a second query-string boundary).
  const loginHref = `/auth/login?redirect=/app/schedule?session_id=${session.id}`;
  const info = sessionTypeInfo(session.session_type);
  const dateStr = new Date(session.start_time).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const timeStr = `${new Date(session.start_time).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}–${new Date(session.end_time).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;

  return (
    <>
      <div className="border-b border-line bg-canvas p-6">
        <div className="flex items-center gap-4">
          <div
            className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-line bg-panel text-3xl font-black shadow-sm ${info.textClass}`}
          >
            {info.display}
          </div>
          <div>
            <h2 className="text-xl font-bold text-ink">{info.label}</h2>
            <p className="text-sm font-medium text-ink-soft">
              {dateStr} · {timeStr}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-5 p-6">
        {status === "TooFarFuture" && (
          <div className="flex items-center gap-2 rounded-lg bg-canvas p-3 text-sm font-medium text-ink">
            <Info className="h-4 w-4 shrink-0" />
            <span>
              Not yet bookable for your account tier —{" "}
              <a href="/pricing" className="text-linktext hover:text-linktext-hover hover:underline">
                members book further ahead
              </a>
              .
            </span>
          </div>
        )}
        {needsModel && (
          <div className="flex items-center gap-2 rounded-lg border border-warn-line bg-warn-bg p-3 text-sm font-medium text-warn">
            <UserX className="h-4 w-4 shrink-0" /> We&rsquo;re still confirming a model for this session.
          </div>
        )}
        {status === "CancelableNoRefund" && (
          <div className="flex items-start gap-2 rounded-lg border border-warn-line bg-warn-bg p-3 text-sm font-medium text-warn">
            <Lock className="mt-0.5 h-4 w-4 shrink-0" />
            <span>You&rsquo;re booked. It&rsquo;s too close to start for a refund, but you can still cancel below.</span>
          </div>
        )}
        {bookingError && (
          <p role="alert" className="rounded-lg border border-warn-line bg-warn-bg p-3 text-sm font-medium text-warn">
            {describeBookingErrorReason(bookingError)}
          </p>
        )}

        {session.description && <p className="text-sm leading-relaxed text-ink-soft">{session.description}</p>}

        <p className="text-sm text-ink-soft">
          Host: {session.host_username ?? "Open — needs a host"} · Capacity: {session.booked_count}/
          {session.max_capacity}
        </p>

        {status === "Available" && loggedIn && (
          <form action={bookSessionAction}>
            <input type="hidden" name="sessionId" value={session.id} />
            <button
              type="submit"
              className="w-full rounded-lg bg-brand py-3.5 font-bold text-white shadow-sm transition-all hover:bg-brand-strong hover:shadow-md"
            >
              Book (uses 1 ticket)
            </button>
          </form>
        )}
        {status === "Available" && !loggedIn && (
          <a
            href={loginHref}
            className="block w-full rounded-lg bg-brand py-3.5 text-center font-bold text-white shadow-sm transition-all hover:bg-brand-strong hover:shadow-md"
          >
            Log in to book
          </a>
        )}
        {status === "Registered" && (
          <form action={cancelBookingAction}>
            <input type="hidden" name="sessionId" value={session.id} />
            <button
              type="submit"
              className="w-full rounded-lg bg-brand py-3.5 font-bold text-white shadow-sm transition-all hover:bg-brand-strong hover:shadow-md"
            >
              Cancel registration
            </button>
          </form>
        )}
        {status === "CancelableNoRefund" && (
          <form action={cancelBookingAction} className="space-y-3">
            <input type="hidden" name="sessionId" value={session.id} />
            <label className="flex items-start gap-2 text-sm text-ink-soft">
              <input type="checkbox" required className="mt-1" />
              <span>I understand I won&rsquo;t get my ticket back if I cancel now.</span>
            </label>
            <button
              type="submit"
              className="w-full rounded-lg bg-brand py-3.5 font-bold text-white shadow-sm transition-all hover:bg-brand-strong hover:shadow-md"
            >
              Cancel without refund
            </button>
          </form>
        )}
        {status === "Full" && loggedIn && (
          <form action={joinWaitlistAction}>
            <input type="hidden" name="sessionId" value={session.id} />
            <button
              type="submit"
              className="w-full rounded-lg bg-brand py-3.5 font-bold text-white shadow-sm transition-all hover:bg-brand-strong hover:shadow-md"
            >
              Join waitlist
            </button>
          </form>
        )}
        {status === "Full" && !loggedIn && (
          <a
            href={loginHref}
            className="block w-full rounded-lg bg-brand py-3.5 text-center font-bold text-white shadow-sm transition-all hover:bg-brand-strong hover:shadow-md"
          >
            Log in to join the waitlist
          </a>
        )}
        {status === "OnWaitlist" && (
          <p className="text-sm text-ink-soft">You&rsquo;re on the waitlist — we&rsquo;ll email you if a spot opens.</p>
        )}
      </div>
    </>
  );
}
