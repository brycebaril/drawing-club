import { describe, expect, it } from "vitest";
import { validateSettingValue } from "./settingsValidation";

describe("validateSettingValue", () => {
  it("accepts a whole number for Integer", () => {
    expect(validateSettingValue("Integer", "30")).toEqual({ ok: true, value: "30" });
  });

  it("rejects a decimal for Integer", () => {
    const result = validateSettingValue("Integer", "30.5");
    expect(result.ok).toBe(false);
  });

  it("rejects non-numeric text for Integer", () => {
    const result = validateSettingValue("Integer", "not-a-number");
    expect(result.ok).toBe(false);
  });

  it("accepts a decimal for Decimal", () => {
    expect(validateSettingValue("Decimal", "17.50")).toEqual({ ok: true, value: "17.50" });
  });

  it("rejects non-numeric text for Decimal", () => {
    const result = validateSettingValue("Decimal", "free");
    expect(result.ok).toBe(false);
  });

  it("accepts true/false for Boolean", () => {
    expect(validateSettingValue("Boolean", "true")).toEqual({ ok: true, value: "true" });
    expect(validateSettingValue("Boolean", "false")).toEqual({ ok: true, value: "false" });
  });

  it("rejects anything else for Boolean", () => {
    const result = validateSettingValue("Boolean", "yes");
    expect(result.ok).toBe(false);
  });

  it("accepts any text, including blank, for String", () => {
    expect(validateSettingValue("String", "  hello@example.test  ")).toEqual({
      ok: true,
      value: "hello@example.test",
    });
    expect(validateSettingValue("String", "")).toEqual({ ok: true, value: "" });
  });
});
