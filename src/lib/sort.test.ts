import { describe, expect, it } from "vitest";
import { resolveSort, sortHref, sortIndicator } from "./sort";

const COLUMNS = { start: "s.start_time", end: "s.end_time", type: "s.session_type" } as const;

describe("resolveSort", () => {
  it("falls back to the default key/direction when nothing is requested", () => {
    const { state, orderBy } = resolveSort(undefined, undefined, COLUMNS, "start");
    expect(state).toEqual({ key: "start", dir: "asc" });
    expect(orderBy).toBe("s.start_time ASC");
  });

  it("uses a recognized requested key/direction", () => {
    const { state, orderBy } = resolveSort("end", "desc", COLUMNS, "start");
    expect(state).toEqual({ key: "end", dir: "desc" });
    expect(orderBy).toBe("s.end_time DESC");
  });

  it("falls back to the default key for an unrecognized column, never reaching SQL", () => {
    const { state, orderBy } = resolveSort("DROP TABLE users; --", "desc", COLUMNS, "start");
    expect(state.key).toBe("start");
    // Direction is independent of key validity — a valid requested dir still applies.
    expect(orderBy).toBe("s.start_time DESC");
  });

  it("falls back to the default direction for an unrecognized dir value", () => {
    const { state } = resolveSort("end", "sideways", COLUMNS, "start");
    expect(state.dir).toBe("asc");
  });

  it("respects a non-asc default direction", () => {
    const { state, orderBy } = resolveSort(undefined, undefined, COLUMNS, "start", "desc");
    expect(state).toEqual({ key: "start", dir: "desc" });
    expect(orderBy).toBe("s.start_time DESC");
  });
});

describe("sortHref", () => {
  it("sorts a newly-clicked column ascending", () => {
    const href = sortHref("/admin/sessions", new URLSearchParams(), "end", { key: "start", dir: "asc" });
    expect(href).toBe("/admin/sessions?sort=end&dir=asc");
  });

  it("flips direction when the same column is clicked again", () => {
    const href = sortHref("/admin/sessions", new URLSearchParams(), "start", { key: "start", dir: "asc" });
    expect(href).toBe("/admin/sessions?sort=start&dir=desc");
  });

  it("resets to ascending when clicking a column while currently descending", () => {
    const href = sortHref("/admin/sessions", new URLSearchParams(), "end", { key: "start", dir: "desc" });
    expect(href).toBe("/admin/sessions?sort=end&dir=asc");
  });

  it("preserves other existing query params", () => {
    const href = sortHref("/admin/sessions", new URLSearchParams("status=Active"), "end", {
      key: "start",
      dir: "asc",
    });
    expect(href).toBe("/admin/sessions?status=Active&sort=end&dir=asc");
  });
});

describe("sortIndicator", () => {
  it("shows nothing for a column that isn't the active sort", () => {
    expect(sortIndicator("end", { key: "start", dir: "asc" })).toBe("");
  });

  it("shows an up arrow for ascending", () => {
    expect(sortIndicator("start", { key: "start", dir: "asc" })).toBe(" ▲");
  });

  it("shows a down arrow for descending", () => {
    expect(sortIndicator("start", { key: "start", dir: "desc" })).toBe(" ▼");
  });
});
