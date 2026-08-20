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

  const pendingTransfersResult = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM passes WHERE pending_recipient_id = $1`,
    [userId],
  );
  const pendingCount = pendingTransfersResult.rows[0].count;
  if (pendingCount > 0) {
    notifications.push({
      message:
        pendingCount === 1
          ? "You have a pass waiting for you to accept."
          : `You have ${pendingCount} passes waiting for you to accept.`,
      ctaLabel: "Review in your wallet",
      ctaHref: "/app/wallet",
    });
  }

  const ticketsNeedingReplyResult = await pool.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM support_tickets
     WHERE requester_user_id = $1 AND status = 'Open' AND last_message_by_user_id != requester_user_id`,
    [userId],
  );
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
