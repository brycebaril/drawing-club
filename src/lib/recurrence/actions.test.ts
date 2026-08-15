import { describe, expect, it } from "vitest";
import { selectSessionIdsToCancel, type CancelableSession } from "./actions";

const NOW = new Date("2026-01-15T12:00:00Z");

// A fixed fixture: five weekly occurrences on one rule, two already in the
// past, one already canceled, two still upcoming plus the "clicked" one.
const FIXTURE: CancelableSession[] = [
  { id: "past-1", startTime: new Date("2026-01-01T18:00:00Z"), status: "Scheduled" },
  { id: "past-2", startTime: new Date("2026-01-08T18:00:00Z"), status: "Scheduled" },
  { id: "already-canceled", startTime: new Date("2026-01-22T18:00:00Z"), status: "Canceled" },
  { id: "clicked", startTime: new Date("2026-01-22T18:00:00Z"), status: "Scheduled" },
  { id: "future-1", startTime: new Date("2026-01-29T18:00:00Z"), status: "Scheduled" },
  { id: "future-2", startTime: new Date("2026-02-05T18:00:00Z"), status: "Scheduled" },
];

describe("selectSessionIdsToCancel", () => {
  it("this-and-future: cancels the clicked occurrence and everything after it, leaves earlier upcoming ones alone", () => {
    const clickedStart = new Date("2026-01-22T18:00:00Z");
    const ids = selectSessionIdsToCancel(FIXTURE, clickedStart, NOW);
    expect(ids.sort()).toEqual(["clicked", "future-1", "future-2"]);
  });

  it("entire series: cancels every still-upcoming occurrence regardless of which one was clicked", () => {
    const ids = selectSessionIdsToCancel(FIXTURE, null, NOW);
    expect(ids.sort()).toEqual(["clicked", "future-1", "future-2"]);
  });

  it("never touches already-canceled sessions", () => {
    const ids = selectSessionIdsToCancel(FIXTURE, null, NOW);
    expect(ids).not.toContain("already-canceled");
  });

  it("entire series never touches sessions before now, even ones on the same rule", () => {
    const ids = selectSessionIdsToCancel(FIXTURE, null, NOW);
    expect(ids).not.toContain("past-1");
    expect(ids).not.toContain("past-2");
  });

  it("this-and-future differs from entire-series when clicked mid-series with an earlier still-upcoming occurrence", () => {
    const laterFixture: CancelableSession[] = [
      { id: "upcoming-early", startTime: new Date("2026-01-16T18:00:00Z"), status: "Scheduled" },
      { id: "clicked-mid", startTime: new Date("2026-01-23T18:00:00Z"), status: "Scheduled" },
      { id: "upcoming-late", startTime: new Date("2026-01-30T18:00:00Z"), status: "Scheduled" },
    ];
    const thisAndFuture = selectSessionIdsToCancel(laterFixture, new Date("2026-01-23T18:00:00Z"), NOW);
    const entireSeries = selectSessionIdsToCancel(laterFixture, null, NOW);

    expect(thisAndFuture.sort()).toEqual(["clicked-mid", "upcoming-late"]);
    expect(entireSeries.sort()).toEqual(["clicked-mid", "upcoming-early", "upcoming-late"]);
  });
});
