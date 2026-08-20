import Link from "next/link";
import { auth } from "@/auth";
import { getPendingNotifications } from "@/lib/notifications/getPendingNotifications";

/**
 * Self-contained — calls auth() itself rather than taking props, so it
 * drops into SiteNav (src/components/SiteNav.tsx) without needing a prop
 * threaded down. Renders nothing for a guest or a user with nothing
 * pending, so it's always safe to include.
 */
export async function NotificationBanner() {
  const session = await auth();
  if (!session?.user?.id) return null;

  const notifications = await getPendingNotifications(session.user.id);
  if (notifications.length === 0) return null;

  const hasUrgent = notifications.some((notification) => notification.urgent);

  return (
    <div className={hasUrgent ? "notification-banner notification-banner--urgent" : "notification-banner"}>
      {notifications.map((notification) => (
        <p key={notification.message}>
          {notification.message} <Link href={notification.ctaHref}>{notification.ctaLabel}</Link>
        </p>
      ))}
    </div>
  );
}
