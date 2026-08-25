import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { pool } from "@/lib/db/pool";
import { getUserAuthContext } from "@/lib/auth/roles";
import { PurchaseButtons } from "./PurchaseButtons";
import { ShareForm } from "./ShareForm";
import { CancelTransferButton } from "./CancelTransferButton";
import { AcceptDeclineButtons } from "./AcceptDeclineButtons";
import { SiteNav } from "@/components/SiteNav";

interface PassRow {
  id: string;
  status: string;
  effective_price: string;
  is_transferable: boolean;
}

interface OutgoingTransferRow {
  id: string;
  share_note: string | null;
  recipient_username: string;
}

interface IncomingTransferRow {
  id: string;
  share_note: string | null;
  sender_username: string | null;
}

export default async function WalletPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/login?redirect=/app/wallet");

  const ctx = await getUserAuthContext(session.user.id);
  if (!ctx) redirect("/auth/login");

  const { checkout } = await searchParams;

  const passResult = await pool.query<PassRow>(
    `SELECT id, status, effective_price, is_transferable FROM passes
     WHERE owner_id = $1 AND status = 'Available' ORDER BY id`,
    [ctx.id],
  );
  const standardPasses = passResult.rows.filter((p) => !p.is_transferable);
  const transferablePasses = passResult.rows.filter((p) => p.is_transferable);

  const outgoingResult = await pool.query<OutgoingTransferRow>(
    `SELECT p.id, p.share_note, u.username AS recipient_username
     FROM passes p
     JOIN users u ON u.id = p.pending_recipient_id
     WHERE p.owner_id = $1 AND p.pending_recipient_id IS NOT NULL
     ORDER BY p.id`,
    [ctx.id],
  );

  const incomingResult = await pool.query<IncomingTransferRow>(
    `SELECT p.id, p.share_note, u.username AS sender_username
     FROM passes p
     LEFT JOIN users u ON u.id = p.sender_user_id
     WHERE p.pending_recipient_id = $1
     ORDER BY p.id`,
    [ctx.id],
  );

  const isMember = ctx.roles.includes("MBR");

  return (
    <>
      <SiteNav />
      <main>
        <h1>Wallet</h1>
        {checkout === "success" && (
          <p role="status">
            Payment received — your purchase is being processed and will appear below shortly.
          </p>
        )}
        {checkout === "cancelled" && <p role="status">Checkout cancelled — nothing was charged.</p>}
        {!ctx.emailVerified && <p role="alert">Verify your email before you can get or use tickets.</p>}

        {incomingResult.rowCount! > 0 && (
          <>
            <h2>Shared with you</h2>
            <p>Tickets other members want to share with you — accept to add to your wallet, or decline.</p>
            <div className="table-scroll">
              <table>
              <thead>
                <tr>
                  <th>From</th>
                  <th>Note</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {incomingResult.rows.map((transfer) => (
                  <tr key={transfer.id}>
                    <td>{transfer.sender_username ?? "—"}</td>
                    <td>{transfer.share_note ?? "—"}</td>
                    <td>
                      <AcceptDeclineButtons passId={transfer.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
              </table>
            </div>
          </>
        )}

        <h2>Standard tickets</h2>
        <p>Available tickets: {standardPasses.length}</p>
        {standardPasses.length > 0 && (
          <div className="table-scroll">
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
          </div>
        )}

        <h2>Transferable tickets</h2>
        <p>Available: {transferablePasses.length}</p>
        {transferablePasses.length > 0 && (
          <div className="table-scroll">
            <table>
            <thead>
              <tr>
                <th>Price paid</th>
                <th>Share it</th>
              </tr>
            </thead>
            <tbody>
              {transferablePasses.map((pass) => (
                <tr key={pass.id}>
                  <td>${pass.effective_price}</td>
                  <td>
                    <ShareForm passId={pass.id} disabled={!ctx.emailVerified} />
                  </td>
                </tr>
              ))}
            </tbody>
            </table>
          </div>
        )}

        {outgoingResult.rowCount! > 0 && (
          <>
            <h2>Pending — you&apos;re sharing</h2>
            <p>Tickets you&apos;ve offered to someone who hasn&apos;t responded yet.</p>
            <div className="table-scroll">
              <table>
              <thead>
                <tr>
                  <th>To</th>
                  <th>Note</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {outgoingResult.rows.map((transfer) => (
                  <tr key={transfer.id}>
                    <td>{transfer.recipient_username}</td>
                    <td>{transfer.share_note ?? "—"}</td>
                    <td>
                      <CancelTransferButton passId={transfer.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
              </table>
            </div>
          </>
        )}

        <h2>Buy tickets</h2>
        <PurchaseButtons isMember={isMember} disabled={!ctx.emailVerified} />
      </main>
    </>
  );
}
