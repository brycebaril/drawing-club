import { describe, expect, it } from "vitest";
import { canSeeFullModelName, displayModelNames, truncateModelName } from "./modelName";

describe("canSeeFullModelName", () => {
  it("allows ADMIN", () => {
    expect(canSeeFullModelName(["ACCT", "ADMIN"])).toBe(true);
  });

  it("allows VOL_MBR", () => {
    expect(canSeeFullModelName(["ACCT", "VOL_MBR"])).toBe(true);
  });

  it("denies a plain member", () => {
    expect(canSeeFullModelName(["ACCT", "MBR"])).toBe(false);
  });

  it("denies other volunteer roles, including VOL_CTRL (handled separately for payouts)", () => {
    expect(canSeeFullModelName(["ACCT", "VOL_HOST"])).toBe(false);
    expect(canSeeFullModelName(["ACCT", "VOL_CTRL"])).toBe(false);
  });

  it("denies a guest (null roles)", () => {
    expect(canSeeFullModelName(null)).toBe(false);
  });
});

describe("truncateModelName", () => {
  it("keeps only the first name", () => {
    expect(truncateModelName("Jane Doe")).toBe("Jane");
  });

  it("passes through a single-word name unchanged", () => {
    expect(truncateModelName("Jane")).toBe("Jane");
  });
});

describe("displayModelNames", () => {
  it("returns null unchanged", () => {
    expect(displayModelNames(null, null)).toBeNull();
  });

  it("truncates each name in a comma-joined multi-model string for an unprivileged viewer", () => {
    expect(displayModelNames("Jane Doe, John Smith", ["ACCT"])).toBe("Jane, John");
  });

  it("returns full names unchanged for a privileged viewer", () => {
    expect(displayModelNames("Jane Doe, John Smith", ["ACCT", "VOL_MBR"])).toBe("Jane Doe, John Smith");
  });
});
