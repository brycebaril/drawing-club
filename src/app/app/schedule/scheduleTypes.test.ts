import { describe, expect, it } from "vitest";
import { describeCellTooltip, type GridCellData } from "./scheduleTypes";

const BASE: GridCellData = {
  id: "s1",
  sessionType: "R",
  status: "Available",
  needsModel: false,
  description: null,
  startTime: new Date("2026-08-25T17:00:00.000Z"), // 10:00 AM PT in most test envs isn't guaranteed —
  endTime: new Date("2026-08-25T20:00:00.000Z"), //   assertions below only check the parts that don't depend on TZ.
  hostUsername: null,
  hostDisplayName: null,
  modelRequired: true,
  modelNames: null,
  bookedCount: 3,
  maxCapacity: 25,
  isTicketed: true,
};

describe("describeCellTooltip", () => {
  it("uses the description and session type label when a description is set", () => {
    const tooltip = describeCellTooltip({ ...BASE, description: "Tuesday Evening Regular" });
    expect(tooltip).toContain("Tuesday Evening Regular (Regular)");
  });

  it("falls back to the session type label alone with no description", () => {
    const tooltip = describeCellTooltip(BASE);
    expect(tooltip.split("\n")[0].startsWith("Regular ·")).toBe(true);
  });

  it("shows the assigned model's name", () => {
    const tooltip = describeCellTooltip({ ...BASE, modelNames: "Jane Doe" });
    expect(tooltip).toContain("Model: Jane Doe");
  });

  it("shows 'Not yet assigned' when a model is required but none is assigned", () => {
    expect(describeCellTooltip(BASE)).toContain("Model: Not yet assigned");
  });

  it("shows 'None required' when the session type doesn't need a model", () => {
    const tooltip = describeCellTooltip({ ...BASE, modelRequired: false });
    expect(tooltip).toContain("Model: None required");
  });

  it("shows the host username, or an 'Open' fallback", () => {
    expect(describeCellTooltip({ ...BASE, hostUsername: "alex" })).toContain("Host: alex");
    expect(describeCellTooltip(BASE)).toContain("Host: Open — needs a host");
  });

  it("prefers the host's display name over their username when both are known", () => {
    expect(
      describeCellTooltip({ ...BASE, hostUsername: "alex.smith47", hostDisplayName: "Alex Smith" }),
    ).toContain("Host: Alex Smith");
  });

  it("shows booked/capacity", () => {
    expect(describeCellTooltip(BASE)).toContain("3/25 booked");
  });

  it("shows a drop-in note instead of booked/capacity for a non-ticketed session", () => {
    const tooltip = describeCellTooltip({ ...BASE, isTicketed: false });
    expect(tooltip).toContain("Drop in — no ticket needed");
    expect(tooltip).not.toContain("booked");
  });
});
