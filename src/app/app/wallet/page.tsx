import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { pool } from "@/lib/db/pool";
import { getUserAuthContext } from "@/lib/auth/roles";
import { PurchaseButtons } from "./PurchaseButtons";

interface PassRow {
  id: string;
  status: string;
  effective_price: string;
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

  const result = await pool.query<PassRow>(
    `SELECT id, status, effective_price FROM passes WHERE owner_id = $1 AND status = 'Available' ORDER BY id`,
    [ctx.id],
  );
  const isMember = ctx.roles.includes("MBR");

  return (
    <main>
      <h1>Wallet</h1>
      {checkout === "success" && (
        <p role="status">
          Payment received — your purchase is being processed and will appear below shortly.
        </p>
      )}
      {checkout === "cancelled" && <p role="status">Checkout cancelled — nothing was charged.</p>}
      {!ctx.emailVerified && <p role="alert">Verify your email before you can get or use passes.</p>}

      <p>Available passes: {result.rowCount}</p>
      {result.rowCount! > 0 && (
        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>Price paid</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((pass) => (
              <tr key={pass.id}>
                <td>{pass.status}</td>
                <td>${pass.effective_price}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Buy passes</h2>
      <PurchaseButtons isMember={isMember} disabled={!ctx.emailVerified} />
    </main>
  );
}
