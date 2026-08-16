import { describe, expect, it } from "vitest";
import { computeSeatGrid } from "./seatStatus";

const S1 = "11111111-1111-1111-1111-111111111111";
const S2 = "22222222-2222-2222-2222-222222222222";
const S3 = "33333333-3333-3333-3333-333333333333";
const VIEWER = "viewer";
const OTHER = "other";

const SESSIONS = [
  { sessionId: S1, startTime: new Date("2026-01-05T18:00:00Z"), status: "Scheduled" },
  { sessionId: S2, startTime: new Date("2026-01-12T18:00:00Z"), status: "Scheduled" },
  { sessionId: S3, startTime: new Date("2026-01-19T18:00:00Z"), status: "Scheduled" },
];

describe("computeSeatGrid", () => {
  it("FullSeriesAvailable: a seat with no reservations on any date", () => {
    const rows = computeSeatGrid({ sessions: SESSIONS, reservations: [], seatCount: 1, viewerId: VIEWER });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("FullSeriesAvailable");
    expect(rows[0].cells.every((c) => c.state === "Open")).toBe(true);
  });

  it("FullyReserved: a seat taken by someone else on every date", () => {
    const rows = computeSeatGrid({
      sessions: SESSIONS,
      reservations: [
        { sessionId: S1, seatNumber: 1, userId: OTHER },
        { sessionId: S2, seatNumber: 1, userId: OTHER },
        { sessionId: S3, seatNumber: 1, userId: OTHER },
      ],
      seatCount: 1,
      viewerId: VIEWER,
    });
    expect(rows[0].status).toBe("FullyReserved");
    expect(rows[0].cells.every((c) => c.state === "TakenByOther")).toBe(true);
  });

  it("PartialSeriesAvailable: a seat taken by someone else on some dates, open on others", () => {
    const rows = computeSeatGrid({
      sessions: SESSIONS,
      reservations: [{ sessionId: S2, seatNumber: 1, userId: OTHER }],
      seatCount: 1,
      viewerId: VIEWER,
    });
    expect(rows[0].status).toBe("PartialSeriesAvailable");
    expect(rows[0].cells.map((c) => c.state)).toEqual(["Open", "TakenByOther", "Open"]);
  });

  it("UserReserved: viewer holds the seat on a subset of dates, even though other dates are open", () => {
    const rows = computeSeatGrid({
      sessions: SESSIONS,
      reservations: [{ sessionId: S1, seatNumber: 1, userId: VIEWER }],
      seatCount: 1,
      viewerId: VIEWER,
    });
    expect(rows[0].status).toBe("UserReserved");
    expect(rows[0].cells.map((c) => c.state)).toEqual(["Yours", "Open", "Open"]);
  });

  it("UserReserved takes priority even when the viewer's seat is also taken by someone else on another date", () => {
    const rows = computeSeatGrid({
      sessions: SESSIONS,
      reservations: [
        { sessionId: S1, seatNumber: 1, userId: VIEWER },
        { sessionId: S2, seatNumber: 1, userId: OTHER },
      ],
      seatCount: 1,
      viewerId: VIEWER,
    });
    expect(rows[0].status).toBe("UserReserved");
    expect(rows[0].cells.map((c) => c.state)).toEqual(["Yours", "TakenByOther", "Open"]);
  });

  it("produces one row per seat 1..seatCount, independently evaluated", () => {
    const rows = computeSeatGrid({
      sessions: SESSIONS,
      reservations: [{ sessionId: S1, seatNumber: 2, userId: OTHER }],
      seatCount: 3,
      viewerId: VIEWER,
    });
    expect(rows.map((r) => r.seatNumber)).toEqual([1, 2, 3]);
    expect(rows[0].status).toBe("FullSeriesAvailable");
    expect(rows[1].status).toBe("PartialSeriesAvailable");
    expect(rows[2].status).toBe("FullSeriesAvailable");
  });

  it("ignores Canceled sessions entirely (not shown as columns)", () => {
    const rows = computeSeatGrid({
      sessions: [...SESSIONS, { sessionId: "canceled", startTime: new Date("2026-01-26T18:00:00Z"), status: "Canceled" }],
      reservations: [],
      seatCount: 1,
      viewerId: VIEWER,
    });
    expect(rows[0].cells).toHaveLength(3);
  });

  it("sorts cells by start time regardless of input session order", () => {
    const rows = computeSeatGrid({
      sessions: [SESSIONS[2], SESSIONS[0], SESSIONS[1]],
      reservations: [],
      seatCount: 1,
      viewerId: VIEWER,
    });
    expect(rows[0].cells.map((c) => c.sessionId)).toEqual([S1, S2, S3]);
  });

  it("treats a null viewerId (guest) as never holding a seat", () => {
    const rows = computeSeatGrid({
      sessions: SESSIONS,
      reservations: [{ sessionId: S1, seatNumber: 1, userId: OTHER }],
      seatCount: 1,
      viewerId: null,
    });
    expect(rows[0].status).toBe("PartialSeriesAvailable");
  });
});
