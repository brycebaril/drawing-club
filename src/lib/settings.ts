import { pool } from "@/lib/db/pool";

/**
 * Reads a numeric (Integer or Decimal) System Setting (Design Doc §12.1).
 * No caching yet — traffic is low enough that a query per read is fine;
 * revisit if it ever matters (ArchitectureDocument.md).
 */
export async function getSettingNumber(key: string): Promise<number> {
  const result = await pool.query<{ value: string; data_type: string }>(
    `SELECT value, data_type FROM system_settings WHERE key = $1`,
    [key],
  );
  if (result.rowCount === 0) {
    throw new Error(`Missing system_settings row for key "${key}"`);
  }
  const { value, data_type: dataType } = result.rows[0];
  if (dataType !== "Integer" && dataType !== "Decimal") {
    throw new Error(`system_settings "${key}" is not numeric (data_type=${dataType})`);
  }
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`system_settings "${key}" has a non-numeric value: "${value}"`);
  }
  return parsed;
}
