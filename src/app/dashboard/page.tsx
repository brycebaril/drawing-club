import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { pool } from "@/lib/db/pool";
import { getUserAuthContext } from "@/lib/auth/roles";
import { getSettingNumber } from "@/lib/settings";
import { getAvailableTicketCount } from "@/lib/payments/passes";
import { SiteNav } from "@/components/SiteNav";
import { RenewMembershipButton } from "./RenewMembershipButton";
import { ChangePasswordForm } from "./ChangePasswordForm";
import { MfaSettingsSection } from "./MfaSettingsSection";
import { UpdateProfileForm, UpdateEmailForm } from "./UpdateProfileForm";
import { CancelAccountForm } from "./CancelAccountForm";
import { MarketingOptInForm } from "./MarketingOptInForm";
import { memberLabel } from "@/lib/users/memberLabel";
import { ORG_TIMEZONE } from "@/lib/org";

// A membership expiring within this many days (or already lapsed) surfaces
// the renew CTA prominently — comfortably active memberships just show the
// expiry date, since renewing early only extends from the *later* of now()
// or the current expiry (src/app/api/webhooks/stripe/route.ts), so there's
// no urgency to act sooner than this.
const RENEWAL_REMINDER_DAYS = 30;

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: ORG_TIMEZONE });
}

function daysUntil(date: Date): number {
  return Math.ceil((date.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

/**
 * Design Doc §5.2's Account Holder vs. Paid Member split is the one thing a
 * new member most needs oriented on — this page surfaces membership status,
 * what membership actually buys them, and a renew/join action when it's
 * actually relevant (not a permanent fixture, per explicit design call: an
 * already-comfortably-active member doesn't need a nagging renew button).
 */
export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/login?redirect=/dashboard");

  const ctx = await getUserAuthContext(session.user.id);
  if (!ctx) redirect("/auth/login");

  const isMember = ctx.roles.includes("MBR");

  const [membershipRow, accountDays, memberDays, membershipFee, bonusPasses, ticketCount, isGenericVolunteerResult] =
    await Promise.all([
      pool.query<{
        membership_expires_at: Date | null;
        email: string;
        cancellation_requested_at: Date | null;
        cancellation_reason: string | null;
        marketing_email_opt_in: boolean;
      }>(
        `SELECT membership_expires_at, email, cancellation_requested_at, cancellation_reason, marketing_email_opt_in
         FROM users WHERE id = $1`,
        [ctx.id],
      ),
      getSettingNumber("BOOKING_WINDOW_ACCOUNT_DAYS"),
      getSettingNumber("BOOKING_WINDOW_MEMBER_DAYS"),
      getSettingNumber("MEMBERSHIP_ANNUAL_FEE"),
      getSettingNumber("MEMBERSHIP_BONUS_PASSES"),
      getAvailableTicketCount(ctx.id),
      // GenericVolunteer carries no RBAC code (see the migration that adds
      // it), so it never appears in ctx.roles — has to be checked against
      // the raw table directly, not the resolved role list.
      pool.query<{ is_generic_volunteer: boolean }>(
        `SELECT EXISTS(SELECT 1 FROM volunteer_roles WHERE user_id = $1 AND role = 'GenericVolunteer') AS is_generic_volunteer`,
        [ctx.id],
      ),
    ]);

  const {
    email,
    cancellation_requested_at: cancellationRequestedAt,
    cancellation_reason: cancellationReason,
    marketing_email_opt_in: marketingOptIn,
  } = membershipRow.rows[0];
  const expiresAt = membershipRow.rows[0].membership_expires_at;
  const isGenericVolunteer = isGenericVolunteerResult.rows[0].is_generic_volunteer;

  // Only fetched for the population the section actually renders for —
  // avoids two setting reads + a count query on every other dashboard view.
  const volunteerBenefits = isGenericVolunteer
    ? await (async () => {
        const [allowance, cap, countResult] = await Promise.all([
          getSettingNumber("VOLUNTEER_WEEKLY_PASS_ALLOWANCE"),
          getSettingNumber("VOLUNTEER_PASS_WALLET_CAP"),
          pool.query<{ count: string }>(
            `SELECT count(*) FROM passes WHERE owner_id = $1 AND status = 'Available' AND is_volunteer_grant = true`,
            [ctx.id],
          ),
        ]);
        return { allowance, cap, current: Number(countResult.rows[0].count) };
      })()
    : null;
  const expiresIn = expiresAt ? daysUntil(expiresAt) : null;
  // isMember (derived from membership_expires_at > now()) already rules out
  // a lapsed-but-still-set expiry date counting as "active" here — a
  // non-member with expiresIn <= 0 has genuinely lapsed, not just be mid-way
  // through a still-valid term.
  const showRenewalCta = !isMember || (expiresIn !== null && expiresIn <= RENEWAL_REMINDER_DAYS);
  // A lapsed member has real membership history (expiresAt is set, just in
  // the past) and should see "renew," not "become" — isMember alone can't
  // distinguish that from someone who's never been a member at all.
  const hasHadMembership = expiresAt !== null;

  return (
    <>
      <SiteNav />
      <main>
        <h1>Dashboard</h1>
        <p>Logged in as {memberLabel(ctx.displayName, ctx.username)}</p>

        {/* Top matter: buying a first ticket is the very first thing a new
            member needs to do before they can book a session — this is the
            single most prominent thing on the page, ahead of membership
            status. */}
        <div className="stat-callout">
          <p className="stat-callout-count">
            {ticketCount}
            <span>ticket{ticketCount === 1 ? "" : "s"} available</span>
          </p>
          <Link href="/app/wallet" className="button-link">
            {ticketCount === 0 ? "Buy your first ticket" : "Buy tickets"}
          </Link>
        </div>

        <h2>Membership</h2>
        {isMember ? (
          <p>
            You&rsquo;re a Paid Member{expiresAt && <> through {formatDate(expiresAt)}</>}
            {expiresIn !== null && expiresIn <= RENEWAL_REMINDER_DAYS && (
              <> — expires in {expiresIn} day{expiresIn === 1 ? "" : "s"}.</>
            )}
          </p>
        ) : expiresAt ? (
          <p role="alert">Your membership lapsed on {formatDate(expiresAt)}. Renew to get member pricing and booking window back.</p>
        ) : (
          <p>You&rsquo;re an Account Holder — you don&rsquo;t have an active membership yet.</p>
        )}

        <h2>Member benefits</h2>
        <ul>
          <li>
            Book up to {memberDays} days ahead, vs. {accountDays} days for Account Holders.
          </li>
          <li>Lower per-ticket prices on single tickets and 5-packs, plus access to 10-packs.</li>
          <li>
            {bonusPasses} free transferable ticket{bonusPasses === 1 ? "" : "s"} every time you join or renew.
          </li>
        </ul>
        <p>
          Annual membership is ${membershipFee.toFixed(2)}. See the full <Link href="/pricing">price comparison</Link>.
        </p>

        {showRenewalCta && (
          <>
            <h2>{hasHadMembership ? "Renew your membership" : "Become a Member"}</h2>
            <RenewMembershipButton
              label={hasHadMembership ? "Renew membership" : "Become a Member"}
              disabled={!ctx.emailVerified}
            />
          </>
        )}

        <h2>Account</h2>
        <p>Roles: {ctx.roles.join(", ")}</p>
        <p>Email verified: {ctx.emailVerified ? "yes" : "no"}</p>

        {volunteerBenefits && (
          <>
            <h2>Volunteer benefits</h2>
            <p>
              You receive {volunteerBenefits.allowance} free ticket{volunteerBenefits.allowance === 1 ? "" : "s"}{" "}
              every week you&rsquo;re under the {volunteerBenefits.cap}-ticket cap.
            </p>
            <p>
              You currently hold {volunteerBenefits.current} of your {volunteerBenefits.cap}-ticket cap.
            </p>
          </>
        )}

        <details>
          <summary role="button">Account settings</summary>

          <h3>Password</h3>
          <ChangePasswordForm />

          <h3>Two-factor authentication</h3>
          <MfaSettingsSection mfaEnabled={ctx.mfaEnabled} mfaRequired={ctx.mfaRequired} />

          <h3>Profile</h3>
          <UpdateProfileForm displayName={ctx.displayName ?? ""} username={ctx.username} />

          <h3>Email</h3>
          <UpdateEmailForm email={email} emailVerified={ctx.emailVerified} />

          <h3>Marketing email</h3>
          <MarketingOptInForm optedIn={marketingOptIn} />

          <h3>Cancel account</h3>
          <CancelAccountForm
            requestedAt={cancellationRequestedAt ? cancellationRequestedAt.toISOString() : null}
            reason={cancellationReason}
          />
        </details>
      </main>
    </>
  );
}
