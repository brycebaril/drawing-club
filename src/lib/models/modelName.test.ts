import { describe, expect, it } from "vitest";
import { displayModelNames, truncateModelName } from "./modelName";

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
    expect(displayModelNames(null)).toBeNull();
  });

  it("truncates each name in a comma-joined multi-model string", () => {
    expect(displayModelNames("Jane Doe, John Smith")).toBe("Jane, John");
  });

  it("passes a single-word name through unchanged", () => {
    expect(displayModelNames("Cher")).toBe("Cher");
  });
});
