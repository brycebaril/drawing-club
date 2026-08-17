import Link from "next/link";
import { auth } from "@/auth";
import { getUserAuthContext, type Role } from "@/lib/auth/roles";
import { LogoutForm } from "./LogoutForm";
import { NotificationBanner } from "./NotificationBanner";

interface StaffLink {
  href: string;
  label: string;
}

const ADMIN_LINKS: StaffLink[] = [
  { href: "/admin/sessions", label: "Sessions" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/transactions", label: "Transactions" },
  { href: "/admin/passes", label: "Passes" },
  { href: "/admin/audit-logs", label: "Audit Logs" },
  { href: "/admin/dashboard", label: "Reporting" },
  { href: "/admin/api-keys", label: "API Keys" },
  { href: "/admin/settings", label: "Settings" },
];

function opsLinksFor(roles: Role[], isAdmin: boolean): StaffLink[] {
  const links: StaffLink[] = [];
  if (isAdmin || roles.includes("VOL_MBR")) links.push({ href: "/ops/model-booking", label: "Model Booking" });
  if (isAdmin || roles.includes("VOL_MKT")) links.push({ href: "/ops/cms", label: "CMS" });
  if (isAdmin || roles.includes("VOL_CTRL")) links.push({ href: "/ops/financials", label: "Financials" });
  return links;
}

/**
 * Single site-wide nav, self-contained like PublicNav/NotificationBanner
 * used to be — calls auth() + getUserAuthContext() itself, no props, so
 * every page just renders <SiteNav />. Replaces the old PublicNav / AppNav /
 * AdminNav / OpsNav split, which had drifted (AppNav's inline "if admin"
 * links only covered 3 of AdminNav's 8) and never showed the public links
 * (Home/About/News/Contact) once a visitor was logged in.
 *
 * Two tiers: a primary nav that's always the same shape (public links plus
 * an auth-dependent tail) so public pages stay reachable regardless of
 * login state, and a second, visually distinct staff-nav for admin/ops
 * capabilities — an admin is a participant first, with admin capabilities
 * layered on top, not a different kind of user, so those options are kept
 * out of the primary nav entirely rather than just labeled differently.
 */
export async function SiteNav() {
  const session = await auth();
  const ctx = session?.user?.id ? await getUserAuthContext(session.user.id) : null;

  const isAdmin = ctx?.roles.includes("ADMIN") ?? false;
  const opsLinks = ctx ? opsLinksFor(ctx.roles, isAdmin) : [];
  const showStaffNav = isAdmin || opsLinks.length > 0;

  return (
    <>
      <nav>
        <ul>
          <li>
            <Link href="/">Home</Link>
          </li>
          <li>
            <Link href="/about">About</Link>
          </li>
          <li>
            <Link href="/news">News</Link>
          </li>
          <li>
            <Link href="/contact">Contact</Link>
          </li>
          <li>
            <Link href={ctx ? "/app/schedule" : "/auth/login?redirect=/app/schedule"}>Schedule</Link>
          </li>
          {ctx ? (
            <>
              <li>
                <Link href="/dashboard">Dashboard</Link>
              </li>
              <li>
                <Link href="/app/wallet">Wallet</Link>
              </li>
              <li>
                <LogoutForm />
              </li>
            </>
          ) : (
            <>
              <li>
                <Link href="/auth/login">Log in</Link>
              </li>
              <li>
                <Link href="/auth/register">Sign up</Link>
              </li>
            </>
          )}
        </ul>
      </nav>
      <NotificationBanner />
      {showStaffNav && (
        <nav className="staff-nav">
          <ul>
            {isAdmin && (
              <>
                <li className="nav-group-label">Admin</li>
                {ADMIN_LINKS.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href}>{link.label}</Link>
                  </li>
                ))}
              </>
            )}
            {opsLinks.length > 0 && (
              <>
                <li className="nav-group-label">Ops</li>
                {opsLinks.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href}>{link.label}</Link>
                  </li>
                ))}
              </>
            )}
          </ul>
        </nav>
      )}
    </>
  );
}
