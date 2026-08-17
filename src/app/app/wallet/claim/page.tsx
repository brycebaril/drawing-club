import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getUserAuthContext } from "@/lib/auth/roles";
import { pool } from "@/lib/db/pool";
import { hashClaimCode } from "@/lib/payments/claimCode";
import { ClaimForm } from "./ClaimForm";
import { PublicNav } from "@/components/PublicNav";
import { AppNav } from "@/components/AppNav";

interface ClaimPreviewRow {
  claim_note: string | null;
  status: string;
  claimed_at: Date | null;
  sender_username: string | null;
}

export default async function ClaimPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;

  if (!code) {
    // Guest-reachable — no auth check happens until a code is present, so
    // there's no viewer role set yet to hand AppNav.
    return (
      <>
        <PublicNav />
        <main>
          <h1>Claim a pass</h1>
          <p>Enter the claim code from your gift link or email.</p>
          <ClaimForm />
        </main>
      </>
    );
  }

  // Public route (src/lib/auth/rbac.ts) — the page itself redirects guests,
  // same as /auth/verify-email, since it has to be reachable from a link
  // shared with someone who may not have an account yet (SiteOutline §3.1
  // notes /auth/register supports claiming on signup).
  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/auth/login?redirect=${encodeURIComponent(`/app/wallet/claim?code=${code}`)}`);
  }

  const ctx = await getUserAuthContext(session.user.id);
  if (!ctx) redirect("/auth/login");

  const codeHash = hashClaimCode(code);
  const result = await pool.query<ClaimPreviewRow>(
    `SELECT p.claim_note, p.status, p.claimed_at, u.username AS sender_username
     FROM passes p
     LEFT JOIN users u ON u.id = p.sender_user_id
     WHERE p.claim_code = $1`,
    [codeHash],
  );

  if (result.rowCount === 0 || result.rows[0].status !== "Assigned" || result.rows[0].claimed_at) {
    return (
      <>
        <AppNav roles={ctx.roles} />
        <main>
          <h1>Claim a pass</h1>
          <p role="alert">This claim link is invalid or has already been used.</p>
        </main>
      </>
    );
  }

  const { claim_note: note, sender_username: senderUsername } = result.rows[0];

  return (
    <>
      <AppNav roles={ctx.roles} />
      <main>
        <h1>Claim a pass</h1>
        <p>{senderUsername ?? "Someone"} sent you a session pass.</p>
        {note && <p>&ldquo;{note}&rdquo;</p>}
        <ClaimForm code={code} />
      </main>
    </>
  );
}
