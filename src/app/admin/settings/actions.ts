"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { pool } from "@/lib/db/pool";
import { writeAuditLog } from "@/lib/audit/log";
import { validateSettingValue, type SettingDataType } from "@/lib/settingsValidation";

export interface UpdateSettingState {
  error?: string;
}

export async function updateSettingAction(
  _prevState: UpdateSettingState,
  formData: FormData,
): Promise<UpdateSettingState> {
  const ctx = await requireAdmin();
  if (!ctx) return { error: "Not authorized." };

  const key = String(formData.get("key") ?? "");

  // dataType must come from the setting's own row, never from the client —
  // a submitted request that claims a different dataType than what's
  // actually stored would skip validateSettingValue's real check (e.g.
  // "String" for what's really "Integer") and let a non-numeric value land
  // in a setting every getSettingNumber() caller assumes is parseable.
  const existing = await pool.query<{ value: string; data_type: SettingDataType }>(
    `SELECT value, data_type FROM system_settings WHERE key = $1`,
    [key],
  );
  if (existing.rowCount === 0) {
    return { error: "Unknown setting." };
  }
  const { value: oldValue, data_type: dataType } = existing.rows[0];

  const rawValue =
    dataType === "Boolean" ? (formData.get("value") === "on" ? "true" : "false") : String(formData.get("value") ?? "");

  const validated = validateSettingValue(dataType, rawValue);
  if (!validated.ok) {
    return { error: validated.error };
  }

  if (oldValue !== validated.value) {
    await pool.query(
      `UPDATE system_settings SET value = $1, updated_at = now(), updated_by = $2 WHERE key = $3`,
      [validated.value, ctx.id, key],
    );

    await writeAuditLog({
      actorId: ctx.id,
      actionType: "SETTING_UPDATED",
      metadata: { key, oldValue, newValue: validated.value },
    });
  }

  revalidatePath("/admin/settings");
  redirect("/admin/settings");
}
