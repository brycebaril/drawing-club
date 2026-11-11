import { describe, expect, it } from "vitest";
import { isUuid, parseDays, parseModelInput } from "./api";

describe("isUuid", () => {
  it("accepts a UUID and rejects anything else", () => {
    expect(isUuid("3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b")).toBe(true);
    expect(isUuid("abc")).toBe(false);
    expect(isUuid("")).toBe(false);
    expect(isUuid("3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0bx")).toBe(false);
  });
});

describe("parseDays", () => {
  it("defaults to 60 when absent or empty", () => {
    expect(parseDays(null)).toEqual({ ok: true, days: 60 });
    expect(parseDays("")).toEqual({ ok: true, days: 60 });
  });

  it("accepts whole numbers from 1 to 120", () => {
    expect(parseDays("1")).toEqual({ ok: true, days: 1 });
    expect(parseDays("120")).toEqual({ ok: true, days: 120 });
  });

  it.each(["0", "121", "-5", "abc", "1.5"])("rejects %s", (raw) => {
    expect(parseDays(raw).ok).toBe(false);
  });
});

describe("parseModelInput (create)", () => {
  it("trims strings and turns empty optional fields into null", () => {
    expect(parseModelInput({ name: "  Ana  ", email: "", phone: " 555 " }, "create")).toEqual({
      ok: true,
      input: { name: "Ana", email: null, phone: "555" },
    });
  });

  it("accepts an integer legacyId and stores it as a string", () => {
    expect(parseModelInput({ legacyId: 57, name: "X" }, "create")).toEqual({
      ok: true,
      input: { legacyId: "57", name: "X" },
    });
  });

  it.each([
    ["missing name", {}],
    ["blank name", { name: "   " }],
    ["non-string name", { name: 42 }],
    ["256-char name", { name: "x".repeat(256) }],
    ["retired on create", { name: "X", retired: true }],
  ])("rejects %s", (_label, body) => {
    expect(parseModelInput(body, "create").ok).toBe(false);
  });

  it.each([["str"], [null], [[]]])("rejects a non-object body: %j", (body) => {
    expect(parseModelInput(body, "create").ok).toBe(false);
  });
});

describe("parseModelInput (update)", () => {
  it("accepts an empty body as a no-op", () => {
    expect(parseModelInput({}, "update")).toEqual({ ok: true, input: {} });
  });

  it("accepts retired as a boolean and legacyId as null", () => {
    expect(parseModelInput({ retired: true }, "update")).toEqual({ ok: true, input: { retired: true } });
    expect(parseModelInput({ legacyId: null }, "update")).toEqual({ ok: true, input: { legacyId: null } });
  });

  it.each([
    ["non-boolean retired", { retired: "yes" }],
    ["blank name", { name: "" }],
  ])("rejects %s", (_label, body) => {
    expect(parseModelInput(body, "update").ok).toBe(false);
  });
});
