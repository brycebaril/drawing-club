import { describe, expect, it } from "vitest";
import { computePayouts } from "./payouts";

describe("computePayouts", () => {
  it("multiplies sessions worked by the flat rate", () => {
    const result = computePayouts(
      [
        {
          modelId: "m1",
          modelName: "Alex Rivera",
          modelContactInfo: "alex@example.test",
          sessionDates: [new Date("2026-08-03"), new Date("2026-08-06")],
        },
      ],
      115,
    );
    expect(result).toEqual([
      {
        modelId: "m1",
        modelName: "Alex Rivera",
        modelContactInfo: "alex@example.test",
        sessionsWorked: 2,
        rateApplied: 115,
        totalOwed: 230,
        sessionDates: [new Date("2026-08-03"), new Date("2026-08-06")],
      },
    ]);
  });

  it("drops models with zero sessions worked, matching the legacy report", () => {
    const result = computePayouts(
      [{ modelId: "m1", modelName: "Nobody Worked", modelContactInfo: null, sessionDates: [] }],
      115,
    );
    expect(result).toEqual([]);
  });

  it("computes each model independently", () => {
    const result = computePayouts(
      [
        { modelId: "m1", modelName: "One Session", modelContactInfo: null, sessionDates: [new Date()] },
        {
          modelId: "m2",
          modelName: "Three Sessions",
          modelContactInfo: null,
          sessionDates: [new Date(), new Date(), new Date()],
        },
      ],
      60,
    );
    expect(result.map((r) => ({ modelId: r.modelId, sessionsWorked: r.sessionsWorked, totalOwed: r.totalOwed }))).toEqual([
      { modelId: "m1", sessionsWorked: 1, totalOwed: 60 },
      { modelId: "m2", sessionsWorked: 3, totalOwed: 180 },
    ]);
  });

  it("rounds total_owed to the nearest cent for a fractional rate", () => {
    const result = computePayouts(
      [{ modelId: "m1", modelName: "Fractional Rate", modelContactInfo: null, sessionDates: [new Date(), new Date(), new Date()] }],
      33.33,
    );
    expect(result[0].totalOwed).toBe(99.99);
  });
});
