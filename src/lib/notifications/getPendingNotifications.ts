import { pool } from "@/lib/db/pool";

export interface PendingNotification {
  message: string;
  ctaLabel: string;
  ctaHref: string;
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

  return notifications;
}
