import { isStaticOnlyLaunch, LEGACY_BOOKING_URL } from "@/lib/launchMode";

/**
 * Public-facing, unlike NotificationBanner/EnvStatusBanner (both auth-gated)
 * — every visitor, logged in or not, should see this during the static-only
 * launch phase. Exists because SiteNav's own "Schedule" link already points
 * straight at LEGACY_BOOKING_URL in this mode (no silent redirect there),
 * but a visitor who bookmarks/types a gated internal URL directly
 * (/dashboard, /app/schedule, /auth/register) still hits src/proxy.ts's
 * bare 307 with zero explanation — this sets expectations up front instead.
 * No dismiss/localStorage: it's temporary by construction (disappears the
 * moment LAUNCH_MODE flips), so there's nothing to persist.
 */
export function LaunchModeBanner() {
  if (!isStaticOnlyLaunch()) return null;

  return (
    <div className="notification-banner">
      <p>
        We're building a new look for this site, along with a new registration & booking system. For now, booking
        continues on our current system —{" "}
        <a href={LEGACY_BOOKING_URL} target="_blank" rel="noopener noreferrer">
          click here to schedule
        </a>
        . Nothing changes for current members: your account, history, and tickets will all carry over when we
        switch.
      </p>
    </div>
  );
}
