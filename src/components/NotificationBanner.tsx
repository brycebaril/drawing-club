import Link from "next/link";
import { auth } from "@/auth";
import { getPendingNotifications } from "@/lib/notifications/getPendingNotifications";

/**
 * Self-contained — calls auth() itself (same pattern PublicNav uses) rather
 * than taking props, specifically so it drops into AppNav/AdminNav/OpsNav
 * without changing any of their existing signatures (AdminNav takes no
 * props at all). Renders nothing for a guest or a user with nothing
 * pending, so it's always safe to include.
 */
export async function NotificationBanner() {
  const session = await auth();
  if (!session?.user?.id) return null;

  const notifications = await getPendingNotifications(session.user.id);
  if (notifications.length === 0) return null;

  return (
    <div className="notification-banner">
      {notifications.map((notification) => (
        <p key={notification.message}>
          {notification.message} <Link href={notification.ctaHref}>{notification.ctaLabel}</Link>
        </p>
      ))}
    </div>
  );
}
