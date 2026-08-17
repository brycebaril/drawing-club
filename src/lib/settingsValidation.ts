export type SettingDataType = "Integer" | "Decimal" | "Boolean" | "String";

export type ValidateSettingResult = { ok: true; value: string } | { ok: false; error: string };

/**
 * Pure validation/coercion core for /admin/settings edits, split out from
 * the Server Action so the per-data_type branching is unit-testable
 * without a DB round-trip — same pattern as computePayouts/slugify.
 */
export function validateSettingValue(dataType: SettingDataType, rawValue: string): ValidateSettingResult {
  switch (dataType) {
    case "Integer": {
      const parsed = Number(rawValue);
      if (!Number.isInteger(parsed)) {
        return { ok: false, error: "Must be a whole number." };
      }
      return { ok: true, value: String(parsed) };
    }
    case "Decimal": {
      const parsed = Number(rawValue);
      if (!Number.isFinite(parsed)) {
        return { ok: false, error: "Must be a number." };
      }
      return { ok: true, value: rawValue.trim() };
    }
    case "Boolean":
      if (rawValue !== "true" && rawValue !== "false") {
        return { ok: false, error: "Must be true or false." };
      }
      return { ok: true, value: rawValue };
    case "String":
      return { ok: true, value: rawValue.trim() };
  }
}
