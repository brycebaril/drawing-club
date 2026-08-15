import { afterAll, describe, expect, it } from "vitest";
import { pool } from "@/lib/db/pool";
import { getSettingNumber } from "./settings";

// Depends on the default-system-settings migration having been applied.

afterAll(() => pool.end());

describe("getSettingNumber", () => {
  it("reads an Integer setting", async () => {
    expect(await getSettingNumber("CANCELLATION_CUTOFF_HOURS")).toBe(24);
  });

  it("reads a Decimal setting", async () => {
    expect(await getSettingNumber("PRICE_SINGLE_PASS_STANDARD")).toBe(20);
  });

  it("throws for a missing key", async () => {
    await expect(getSettingNumber("NOT_A_REAL_KEY")).rejects.toThrow(/Missing system_settings/);
  });

  it("throws for a non-numeric setting", async () => {
    await pool.query(
      `INSERT INTO system_settings (key, value, data_type) VALUES ('TEST_STRING_SETTING', 'hello', 'String')
       ON CONFLICT (key) DO NOTHING`,
    );
    await expect(getSettingNumber("TEST_STRING_SETTING")).rejects.toThrow(/not numeric/);
    await pool.query(`DELETE FROM system_settings WHERE key = 'TEST_STRING_SETTING'`);
  });
});
