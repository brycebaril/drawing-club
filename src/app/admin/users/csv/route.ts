import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserAuthContext } from "@/lib/auth/roles";
import { pool } from "@/lib/db/pool";
import { filterUserRows, isMemberTier, mappedRolesFor, type UserRow } from "@/lib/users/filterUsers";

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Mirrors /ops/financials/csv/route.ts's shape. Reuses filterUserRows so
 * this always reflects exactly the filters the /admin/users page is
 * currently showing, passed through as the same query params.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }
  const ctx = await getUserAuthContext(session.user.id);
  if (!ctx || !ctx.roles.includes("ADMIN")) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  const params = new URL(request.url).searchParams;
  const status = params.get("status") ?? undefined;
  const tier = params.get("tier") ?? undefined;
  const role = params.get("role") ?? undefined;

  const result = await pool.query<UserRow>(
    `SELECT u.id, u.username, u.email, u.status, u.base_role, u.membership_expires_at,
            COALESCE(array_agg(vr.role::text) FILTER (WHERE vr.role IS NOT NULL), '{}') AS volunteer_roles
     FROM users u
     LEFT JOIN volunteer_roles vr ON vr.user_id = u.id
     GROUP BY u.id
     ORDER BY u.username ASC`,
  );

  const now = new Date();
  const rows = filterUserRows(result.rows, { status, tier, role }, now);

  const lines = ["Username,Email,Status,Tier,Roles"];
  for (const row of rows) {
    lines.push(
      [
        csvEscape(row.username),
        csvEscape(row.email),
        row.status,
        isMemberTier(row, now) ? "MBR" : "ACCT",
        csvEscape(mappedRolesFor(row).join("; ")),
      ].join(","),
    );
  }

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="users.csv"`,
    },
  });
}
