import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { pool } from "@/lib/db/pool";
import { getUserAuthContext } from "@/lib/auth/roles";
import { GrantTestPassButton } from "./GrantTestPassButton";

export default async function WalletPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/login?redirect=/app/wallet");

  const ctx = await getUserAuthContext(session.user.id);
  if (!ctx) redirect("/auth/login");

  const result = await pool.query<{ count: string }>(
    `SELECT count(*) FROM passes WHERE owner_id = $1 AND status = 'Available'`,
    [ctx.id],
  );
  const availablePasses = Number(result.rows[0].count);

  return (
    <main>
      <h1>Wallet</h1>
      <p>Available passes: {availablePasses}</p>
      {!ctx.emailVerified && <p role="alert">Verify your email before you can get or use passes.</p>}
      <GrantTestPassButton />
    </main>
  );
}
