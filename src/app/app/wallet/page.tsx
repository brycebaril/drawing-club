import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { pool } from "@/lib/db/pool";
import { getUserAuthContext } from "@/lib/auth/roles";
import { PurchaseButtons } from "./PurchaseButtons";
import { GiftForm } from "./GiftForm";
import { RevokeGiftButton } from "./RevokeGiftButton";
import { AppNav } from "@/components/AppNav";

interface PassRow {
  id: string;
  status: string;
  effective_price: string;
  is_transferable: boolean;
}

interface PendingGiftRow {
  id: string;
  claim_note: string | null;
}

export default async function WalletPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string; claimed?: string; giftLink?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/login?redirect=/app/wallet");

  const ctx = await getUserAuthContext(session.user.id);
  if (!ctx) redirect("/auth/login");

  const { checkout, claimed, giftLink } = await searchParams;

  const passResult = await pool.query<PassRow>(
    `SELECT id, status, effective_price, is_transferable FROM passes
     WHERE owner_id = $1 AND status = 'Available' ORDER BY id`,
    [ctx.id],
  );
  const standardPasses = passResult.rows.filter((p) => !p.is_transferable);
  const transferablePasses = passResult.rows.filter((p) => p.is_transferable);

  const pendingGiftsResult = await pool.query<PendingGiftRow>(
    `SELECT id, claim_note FROM passes
     WHERE sender_user_id = $1 AND status = 'Assigned' AND claimed_at IS NULL ORDER BY id`,
    [ctx.id],
  );

  const isMember = ctx.roles.includes("MBR");

  return (
    <>
      <AppNav roles={ctx.roles} />
      <main>
        <h1>Wallet</h1>
      {checkout === "success" && (
        <p role="status">
          Payment received — your purchase is being processed and will appear below shortly.
        </p>
      )}
      {checkout === "cancelled" && <p role="status">Checkout cancelled — nothing was charged.</p>}
      {claimed === "1" && <p role="status">Pass claimed and added to your wallet.</p>}
      {giftLink && (
        <p role="status">
          Gift sent! Claim link (shown once — copy it now): <code>{giftLink}</code>
        </p>
      )}
      {!ctx.emailVerified && <p role="alert">Verify your email before you can get or use passes.</p>}

      <h2>Standard passes</h2>
      <p>Available passes: {standardPasses.length}</p>
      {standardPasses.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>Price paid</th>
            </tr>
          </thead>
          <tbody>
            {standardPasses.map((pass) => (
              <tr key={pass.id}>
                <td>{pass.status}</td>
                <td>${pass.effective_price}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Transferable passes</h2>
      <p>Available: {transferablePasses.length}</p>
      {transferablePasses.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Price paid</th>
              <th>Gift it</th>
            </tr>
          </thead>
          <tbody>
            {transferablePasses.map((pass) => (
              <tr key={pass.id}>
                <td>${pass.effective_price}</td>
                <td>
                  <GiftForm passId={pass.id} disabled={!ctx.emailVerified} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {pendingGiftsResult.rowCount! > 0 && (
        <>
          <h2>Pending gifts</h2>
          <p>
            Gifts you&apos;ve sent that haven&apos;t been claimed yet. The claim link is only shown once,
            right after sending — if you&apos;ve lost it, revoke and re-send instead.
          </p>
          <table>
            <thead>
              <tr>
                <th>Note</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pendingGiftsResult.rows.map((gift) => (
                <tr key={gift.id}>
                  <td>{gift.claim_note ?? "—"}</td>
                  <td>
                    <RevokeGiftButton passId={gift.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <p>
        Have a claim code? <Link href="/app/wallet/claim">Claim a pass</Link>
      </p>

        <h2>Buy passes</h2>
        <PurchaseButtons isMember={isMember} disabled={!ctx.emailVerified} />
      </main>
    </>
  );
}
