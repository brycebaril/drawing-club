import { describe, expect, it } from "vitest";
import { sessionTypeNeedsModel } from "./shared";

describe("sessionTypeNeedsModel", () => {
  it("is false for the two drop-in types", () => {
    expect(sessionTypeNeedsModel("Gallery")).toBe(false);
    expect(sessionTypeNeedsModel("Party")).toBe(false);
  });

  it("is true for every drawing session type", () => {
    for (const type of ["L", "R", "G", "P", "S", "X"]) {
      expect(sessionTypeNeedsModel(type)).toBe(true);
    }
  });
});
