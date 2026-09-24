import { describe, expect, it } from "vitest";
import { computeGrantDecisions } from "./volunteerPasses";

describe("computeGrantDecisions", () => {
  it("grants the weekly allowance to a volunteer under the cap", () => {
    const result = computeGrantDecisions([{ userId: "u1", currentAvailableCount: 3 }], 1, 50);
    expect(result).toEqual([{ userId: "u1", grantedCount: 1 }]);
  });

  it("skips a volunteer already at the cap — does not top up", () => {
    const result = computeGrantDecisions([{ userId: "u1", currentAvailableCount: 50 }], 1, 50);
    expect(result).toEqual([{ userId: "u1", grantedCount: 0 }]);
  });

  it("skips a volunteer already above the cap", () => {
    const result = computeGrantDecisions([{ userId: "u1", currentAvailableCount: 60 }], 1, 50);
    expect(result).toEqual([{ userId: "u1", grantedCount: 0 }]);
  });

  it("grants right up to one below the cap", () => {
    const result = computeGrantDecisions([{ userId: "u1", currentAvailableCount: 49 }], 1, 50);
    expect(result).toEqual([{ userId: "u1", grantedCount: 1 }]);
  });

  it("handles multiple volunteers independently", () => {
    const result = computeGrantDecisions(
      [
        { userId: "u1", currentAvailableCount: 0 },
        { userId: "u2", currentAvailableCount: 50 },
      ],
      1,
      50,
    );
    expect(result).toEqual([
      { userId: "u1", grantedCount: 1 },
      { userId: "u2", grantedCount: 0 },
    ]);
  });

  it("respects a weekly allowance greater than one", () => {
    const result = computeGrantDecisions([{ userId: "u1", currentAvailableCount: 0 }], 3, 50);
    expect(result).toEqual([{ userId: "u1", grantedCount: 3 }]);
  });
});
