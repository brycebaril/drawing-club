"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { pool } from "@/lib/db/pool";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { writeAuditLog } from "@/lib/audit/log";

export interface CreateSessionState {
  error?: string;
}

const SESSION_TYPES = ["L", "R", "G", "P", "S", "X", "Gallery", "Party"] as const;

export async function createSessionAction(
  _prevState: CreateSessionState,
  formData: FormData,
): Promise<CreateSessionState> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Not authorized." };

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

  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO sessions (session_type, description, start_time, end_time, max_capacity, host_user_id, is_ticketed)
     VALUES ($1, $2, $3, $4, $5, $6, true)
     RETURNING id`,
    [sessionType, description || null, startTime, endTime, maxCapacity, hostUserId],
  );

  await writeAuditLog({
    actorId: ctx.id,
    actionType: "SESSION_CREATED",
    metadata: { sessionId: inserted.rows[0].id, sessionType, startTime, maxCapacity, hostUserId },
  });

  // Reachable via a prefetched <Link> in AdminNav — without this, the
  // client Router Cache can serve the pre-creation list after the redirect
  // (see src/app/admin/users/[id]/actions.ts's revalidateUserPages).
  revalidatePath("/admin/sessions");
  redirect("/admin/sessions");
}
