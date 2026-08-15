import { describe, expect, it } from "vitest";
import { isCancellable } from "./cancellation";

describe("isCancellable", () => {
  const sessionStart = new Date("2026-01-15T18:00:00Z");

  it("is cancellable more than the cutoff before start", () => {
    const now = new Date("2026-01-14T17:59:59Z"); // 25h1s before start
    expect(isCancellable(sessionStart, 24, now)).toBe(true);
  });

  it("is not cancellable inside the cutoff window", () => {
    const now = new Date("2026-01-15T00:00:01Z"); // ~17h59m before start
    expect(isCancellable(sessionStart, 24, now)).toBe(false);
  });

  it("is not cancellable exactly at the cutoff boundary", () => {
    const now = new Date("2026-01-14T18:00:00Z"); // exactly 24h before start
    expect(isCancellable(sessionStart, 24, now)).toBe(false);
  });
});
