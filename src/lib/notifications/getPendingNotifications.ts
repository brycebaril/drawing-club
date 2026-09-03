import { headers } from "next/headers";
import { pool } from "@/lib/db/pool";
import { getUserAuthContext } from "@/lib/auth/roles";
import { startOfDay } from "@/lib/sessions/shared";
import { ORG_TIMEZONE } from "@/lib/org";

export interface PendingNotification {
  message: string;
  ctaLabel: string;
  ctaHref: string;
  /** Renders the whole banner in the red --urgent variant (NotificationBanner.tsx) — reserved for "it's your turn to act" cases, not routine FYIs. */
  urgent?: boolean;
}

/**
 * An appendable list, not a single hardcoded check — a future addition
 * (unverified email, an expiring membership, etc.) is just another entry
 * pushed onto the same array, no redesign needed.
 */
export async function getPendingNotifications(userId: string): Promise<PendingNotification[]> {
  const notifications: PendingNotification[] = [];

  // Independent, data-independent counts — run concurrently (this backs
  // NotificationBanner, rendered on every authenticated page view) but
  // still pushed in a fixed order below so the list itself stays
  // deterministic regardless of which query happens to resolve first.
  const [pendingTransfersResult, ticketsNeedingReplyResult] = await Promise.all([
    pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM passes WHERE pending_recipient_id = $1`, [
      userId,
    ]),
    pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM support_tickets
       WHERE requester_user_id = $1 AND status = 'Open' AND last_message_by_user_id != requester_user_id`,
      [userId],
    ),
  ]);

  const pendingCount = pendingTransfersResult.rows[0].count;
  if (pendingCount > 0) {
    notifications.push({
      message:
        pendingCount === 1
          ? "You have a session ticket waiting for you to accept."
          : `You have ${pendingCount} session tickets waiting for you to accept.`,
      ctaLabel: "Review in your wallet",
      ctaHref: "/app/wallet",
    });
  }

  const ticketsNeedingReply = ticketsNeedingReplyResult.rows[0].count;
  if (ticketsNeedingReply > 0) {
    notifications.push({
      message:
        ticketsNeedingReply === 1
          ? "You have a support ticket reply waiting for you."
          : `You have ${ticketsNeedingReply} support ticket replies waiting for you.`,
      ctaLabel: "View your tickets",
      ctaHref: "/app/support",
      urgent: true,
    });
  }

  // Staff-facing: the shared support inbox's own "needs reply" count
  // (SiteNav's "Support (N)" nav badge computes this identically), surfaced
  // here too since that badge lives behind the collapsed "☰ Staff"
  // disclosure and can go unnoticed. getUserAuthContext is cache()-wrapped,
  // so this reuses SiteNav's own same-request call rather than paying for a
  // second query on top of it.
  const ctx = await getUserAuthContext(userId);
  const canSeeSupportInbox = ctx ? ctx.roles.includes("ADMIN") || ctx.roles.includes("VOL_SUPPORT") : false;
  if (canSeeSupportInbox) {
    const staffNeedsReplyResult = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM support_tickets
       WHERE status = 'Open' AND last_message_by_user_id = requester_user_id`,
    );
    const staffNeedsReply = staffNeedsReplyResult.rows[0].count;
    if (staffNeedsReply > 0) {
      notifications.push({
        message:
          staffNeedsReply === 1
            ? "1 support ticket needs a reply."
            : `${staffNeedsReply} support tickets need a reply.`,
        ctaLabel: "Open support inbox",
        ctaHref: "/ops/support",
        urgent: true,
      });
    }
  }

  // Staff-facing: pending member-initiated cancellation requests
  // (requestCancellationAction, dashboard/actions.ts) — ADMIN-only, since
  // only an admin can act on one (anonymizeAccountAction). Same
  // extensibility this function's own doc comment already calls out.
  const canSeeCancellationRequests = ctx ? ctx.roles.includes("ADMIN") : false;
  if (canSeeCancellationRequests) {
    const cancellationRequestsResult = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM users WHERE cancellation_requested_at IS NOT NULL`,
    );
    const cancellationRequests = cancellationRequestsResult.rows[0].count;
    if (cancellationRequests > 0) {
      notifications.push({
        message:
          cancellationRequests === 1
            ? "1 account cancellation request is pending review."
            : `${cancellationRequests} account cancellation requests are pending review.`,
        ctaLabel: "Review requests",
        ctaHref: "/admin/users?filter=cancellation-requested",
        urgent: true,
      });
    }
  }

  // "You're hosting today" — reuses /ops/check-in/page.tsx's exact
  // startOfDay/+24h "today" window (the same cutoff that page already uses
  // to decide which roster card defaults open), not gated on still holding
  // VOL_HOST — this is about what the sessions table actually says, not the
  // viewer's current role set. Suppressed on that specific session's own
  // check-in page (no point nudging someone who's already there); the
  // /ops/check-in overview page still gets it, since it lists every hosted
  // session, not just this one. x-pathname is set by src/proxy.ts.
  const today = startOfDay(new Date());
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  const hostingTodayResult = await pool.query<{ id: string; session_type: string; start_time: Date }>(
    `SELECT id, session_type, start_time FROM sessions
     WHERE host_user_id = $1 AND status = 'Scheduled' AND start_time >= $2 AND start_time < $3
     ORDER BY start_time ASC LIMIT 1`,
    [userId, today, tomorrow],
  );
  if (hostingTodayResult.rowCount! > 0) {
    const session = hostingTodayResult.rows[0];
    const currentPathname = (await headers()).get("x-pathname");
    const checkInHref = `/ops/check-in/${session.id}`;
    if (currentPathname !== checkInHref) {
      const time = new Date(session.start_time).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        timeZone: ORG_TIMEZONE,
      });
      notifications.push({
        message: `You're hosting ${session.session_type} today at ${time}.`,
        ctaLabel: "Go to check-in",
        ctaHref: checkInHref,
      });
    }
  }

  return notifications;
}
