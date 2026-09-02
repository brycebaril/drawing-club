import Link from "next/link";
import { auth } from "@/auth";
import { getUserAuthContext, type Role } from "@/lib/auth/roles";
import { pool } from "@/lib/db/pool";
import { RESERVED_STATIC_PAGE_SLUGS } from "@/lib/cms/slugify";
import { LogoutForm } from "./LogoutForm";
import { NotificationBanner } from "./NotificationBanner";
import { EnvStatusBanner } from "./EnvStatusBanner";

interface StaffLink {
  href: string;
  label: string;
}

const ADMIN_LINKS: StaffLink[] = [
  { href: "/admin/sessions", label: "Sessions" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/transactions", label: "Transactions" },
  { href: "/admin/passes", label: "Tickets" },
  { href: "/admin/audit-logs", label: "Audit Logs" },
  { href: "/admin/dashboard", label: "Reporting" },
  { href: "/admin/api-keys", label: "API Keys" },
  { href: "/admin/settings", label: "Settings" },
];

function opsLinksFor(roles: Role[], isAdmin: boolean, supportNeedsReplyCount: number): StaffLink[] {
  const links: StaffLink[] = [];
  if (isAdmin || roles.includes("VOL_HOST") || roles.includes("VOL_MBR")) {
    links.push({ href: "/ops/check-in", label: "Check-in" });
  }
  if (isAdmin || roles.includes("VOL_MBR")) links.push({ href: "/ops/model-booking", label: "Model Booking" });
  if (isAdmin || roles.includes("VOL_MKT")) links.push({ href: "/ops/cms", label: "CMS" });
  if (isAdmin || roles.includes("VOL_CTRL")) links.push({ href: "/ops/financials", label: "Financials" });
  if (isAdmin || roles.includes("VOL_SUPPORT")) {
    links.push({
      href: "/ops/support",
      label: supportNeedsReplyCount > 0 ? `Support (${supportNeedsReplyCount})` : "Support",
    });
  }
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
 * Public items stay a plain visible list; being authenticated with an
 * Admin/Ops role adds one more trailing item — a hamburger disclosure
 * holding those role-gated links, kept out of the visible list entirely
 * rather than just styled differently, since an admin is a participant
 * first with admin capabilities layered on top, not a different kind of
 * user. Built with <details>/<summary> rather than a client component +
 * useState — a native disclosure needs no JS at all, keeping SiteNav a
 * plain Server Component (this app has no client-side nav interactivity
 * anywhere else). Trade-off: it won't auto-close on an outside click the
 * way a JS-driven dropdown would; toggling the summary again or navigating
 * away (any link click) closes it.
 */
export async function SiteNav() {
  const session = await auth();
  const ctx = session?.user?.id ? await getUserAuthContext(session.user.id) : null;

  // Admin-created pages (src/app/pages/[slug]/page.tsx) have no other way
  // to be reachable except by typing the URL directly, so they're listed
  // here too. home/about/contact are excluded — already linked above.
  const extraPagesResult = await pool.query<{ slug: string; title: string }>(
    `SELECT slug, title FROM static_pages WHERE slug != ALL($1::text[]) ORDER BY title`,
    [RESERVED_STATIC_PAGE_SLUGS],
  );

  const isAdmin = ctx?.roles.includes("ADMIN") ?? false;
  const canSeeSupportInbox = isAdmin || (ctx?.roles.includes("VOL_SUPPORT") ?? false);
  // Gated behind the role check above, unlike extraPagesResult's unconditional
  // query — this is only relevant to admins/support agents, so there's no
  // reason to pay for it on every ordinary member/guest page view.
  const supportNeedsReplyCount = canSeeSupportInbox
    ? (
        await pool.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM support_tickets
           WHERE status = 'Open' AND last_message_by_user_id = requester_user_id`,
        )
      ).rows[0].count
    : 0;
  const opsLinks = ctx ? opsLinksFor(ctx.roles, isAdmin, supportNeedsReplyCount) : [];
  const showStaffMenu = isAdmin || opsLinks.length > 0;

  return (
    <>
      <EnvStatusBanner />
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
          {extraPagesResult.rows.map((page) => (
            <li key={page.slug}>
              <Link href={`/pages/${page.slug}`}>{page.title}</Link>
            </li>
          ))}
          <li>
            <Link href="/pricing">Pricing</Link>
          </li>
          <li>
            {/* /app/schedule is the unified public + member page (src/lib/auth/rbac.ts
                has a dedicated public rule for it) — no more conditional login redirect. */}
            <Link href="/app/schedule">Schedule</Link>
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
                <Link href="/app/support">Support</Link>
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
          {showStaffMenu && (
            <li className="staff-menu">
              <details>
                <summary role="button">☰ Staff</summary>
                <div className="staff-menu-panel">
                  {isAdmin && (
                    <>
                      <p className="nav-group-label">Admin</p>
                      <ul>
                        {ADMIN_LINKS.map((link) => (
                          <li key={link.href}>
                            <Link href={link.href}>{link.label}</Link>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {opsLinks.length > 0 && (
                    <>
                      <p className="nav-group-label">Ops</p>
                      <ul>
                        {opsLinks.map((link) => (
                          <li key={link.href}>
                            <Link href={link.href}>{link.label}</Link>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              </details>
            </li>
          )}
        </ul>
      </nav>
      <NotificationBanner />
    </>
  );
}
