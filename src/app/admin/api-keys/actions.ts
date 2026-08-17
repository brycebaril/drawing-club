"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { pool } from "@/lib/db/pool";
import { writeAuditLog } from "@/lib/audit/log";
import { generateApiKey, hashApiKey } from "@/lib/auth/apiKey";
import { REPORT_SCOPES } from "@/lib/reporting/scopes";

export async function createApiKeyAction(formData: FormData): Promise<void> {
  const ctx = await requireAdmin();
  if (!ctx) return;

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;

  const scopes = REPORT_SCOPES.filter((scope) => formData.get(`scope-${scope}`) === "on");

  const rawKey = generateApiKey();
  const keyHash = hashApiKey(rawKey);
  const keyPrefix = rawKey.slice(0, 12);

  await pool.query(
    `INSERT INTO api_keys (name, key_hash, key_prefix, scopes, created_by) VALUES ($1, $2, $3, $4, $5)`,
    [name, keyHash, keyPrefix, scopes, ctx.id],
  );

  await writeAuditLog({
    actorId: ctx.id,
    actionType: "API_KEY_CREATED",
    metadata: { name, scopes },
  });

  revalidatePath("/admin/api-keys");
  // The raw key is only ever available right now — mirrors the gift/claim
  // wallet's "redirect with the one-time secret in a query param" fix
  // (src/app/app/wallet/actions.ts), needed for the same reason: the
  // component that rendered the form is about to unmount on this action's
  // route refresh, so returning it via useActionState alone would never
  // actually be seen.
  redirect(`/admin/api-keys?newKey=${encodeURIComponent(rawKey)}`);
}

export async function revokeApiKeyAction(formData: FormData): Promise<void> {
  const ctx = await requireAdmin();
  if (!ctx) return;

  const id = String(formData.get("id") ?? "");
  const updated = await pool.query(
    `UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`,
    [id],
  );
  if (updated.rowCount! > 0) {
    await writeAuditLog({
      actorId: ctx.id,
      actionType: "API_KEY_REVOKED",
      metadata: { id },
    });
  }

  revalidatePath("/admin/api-keys");
}
