import { pool } from "@/lib/db/pool";

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

  return notifications;
}
