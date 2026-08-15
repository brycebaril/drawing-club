"use server";

import { redirect } from "next/navigation";
import { pool } from "@/lib/db/pool";
import { auth } from "@/auth";
import { getUserAuthContext } from "@/lib/auth/roles";

export interface CreateSessionState {
  error?: string;
}

const SESSION_TYPES = ["L", "R", "G", "P", "S", "X", "Gallery", "Party"] as const;

export async function createSessionAction(
  _prevState: CreateSessionState,
  formData: FormData,
): Promise<CreateSessionState> {
  // Next.js Server Functions are POSTs to the page they're defined on, not a
  // separately-matched route — Proxy's RBAC gate (src/proxy.ts) covers the
  // page render but each Server Function must re-check auth itself
  // (node_modules/next/dist/docs/.../proxy.md, "Execution order").
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/login?redirect=/admin/sessions/new");
  const ctx = await getUserAuthContext(session.user.id);
  if (!ctx || !ctx.roles.includes("ADMIN")) {
    return { error: "Not authorized." };
  }

  const sessionType = String(formData.get("sessionType") ?? "");
  if (!(SESSION_TYPES as readonly string[]).includes(sessionType)) {
    return { error: "Choose a valid session type." };
  }

  const description = String(formData.get("description") ?? "").trim();

  const startTime = new Date(String(formData.get("startTime") ?? ""));
  const endTime = new Date(String(formData.get("endTime") ?? ""));
  if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) {
    return { error: "Enter valid start and end times." };
  }
  if (endTime <= startTime) {
    return { error: "End time must be after start time." };
  }

  const maxCapacity = Number(formData.get("maxCapacity"));
  if (!Number.isInteger(maxCapacity) || maxCapacity < 1) {
    return { error: "Capacity must be a positive whole number." };
  }

  const hostUsername = String(formData.get("hostUsername") ?? "").trim();
  let hostUserId: string | null = null;
  if (hostUsername) {
    const hostRow = await pool.query<{ id: string }>(`SELECT id FROM users WHERE username = $1`, [
      hostUsername,
    ]);
    if (hostRow.rowCount === 0) {
      return { error: `No user found with username "${hostUsername}".` };
    }
    hostUserId = hostRow.rows[0].id;
  }

  await pool.query(
    `INSERT INTO sessions (session_type, description, start_time, end_time, max_capacity, host_user_id, is_ticketed)
     VALUES ($1, $2, $3, $4, $5, $6, true)`,
    [sessionType, description || null, startTime, endTime, maxCapacity, hostUserId],
  );

  redirect("/admin/sessions");
}
