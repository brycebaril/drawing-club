import { describe, expect, it } from "vitest";
import {
  dateRangeClause,
  parseBooleanParam,
  parseDateParam,
  parseGranularityParam,
  parseListParam,
  parseNumberParam,
  resolveGroupBy,
  timeBucketExpression,
  toURLSearchParams,
} from "./queryFilters";

describe("dateRangeClause", () => {
  it("returns a no-op clause when no range is given", () => {
    expect(dateRangeClause("created_at", undefined, 0)).toEqual({ clause: "1=1", values: [] });
    expect(dateRangeClause("created_at", {}, 0)).toEqual({ clause: "1=1", values: [] });
  });

  it("builds a from-only clause", () => {
    const from = new Date("2026-01-01");
    expect(dateRangeClause("created_at", { from }, 0)).toEqual({
      clause: "created_at >= $1",
      values: [from],
    });
  });

  it("builds a to-only clause", () => {
    const to = new Date("2026-06-01");
    expect(dateRangeClause("created_at", { to }, 0)).toEqual({
      clause: "created_at <= $1",
      values: [to],
    });
  });

  it("builds a from-and-to clause with sequential params", () => {
    const from = new Date("2026-01-01");
    const to = new Date("2026-06-01");
    expect(dateRangeClause("created_at", { from, to }, 0)).toEqual({
      clause: "created_at >= $1 AND created_at <= $2",
      values: [from, to],
    });
  });

  it("offsets param numbers when other params already precede it", () => {
    const from = new Date("2026-01-01");
    expect(dateRangeClause("created_at", { from }, 3)).toEqual({
      clause: "created_at >= $4",
      values: [from],
    });
  });
});

describe("timeBucketExpression", () => {
  it("produces a date_trunc expression for the given granularity", () => {
    expect(timeBucketExpression("created_at", "week")).toBe("date_trunc('week', created_at)");
    expect(timeBucketExpression("p.created_at", "quarter")).toBe("date_trunc('quarter', p.created_at)");
  });
});

describe("resolveGroupBy", () => {
  const dimensions = { role: "u.base_role", status: "p.status" } as const;

  it("returns an empty list when nothing is requested", () => {
    expect(resolveGroupBy(undefined, dimensions)).toEqual({ keys: [], unknown: [] });
  });

  it("keeps only keys present in the dimension map, in requested order", () => {
    expect(resolveGroupBy(["status", "role"], dimensions)).toEqual({
      keys: ["status", "role"],
      unknown: [],
    });
  });

  it("separates out unrecognized keys rather than passing them through", () => {
    expect(resolveGroupBy(["role", "dropTable"], dimensions)).toEqual({
      keys: ["role"],
      unknown: ["dropTable"],
    });
  });
});

describe("parseListParam", () => {
  it("collects every value for a repeated query key", () => {
    const params = new URLSearchParams("status=Available&status=Used");
    expect(parseListParam(params, "status")).toEqual(["Available", "Used"]);
  });
  it("returns undefined when the key is absent", () => {
    expect(parseListParam(new URLSearchParams(""), "status")).toBeUndefined();
  });
});

describe("parseBooleanParam", () => {
  it("parses exact 'true'/'false', undefined otherwise", () => {
    expect(parseBooleanParam("true")).toBe(true);
    expect(parseBooleanParam("false")).toBe(false);
    expect(parseBooleanParam("yes")).toBeUndefined();
    expect(parseBooleanParam(null)).toBeUndefined();
  });
});

describe("parseNumberParam", () => {
  it("parses a finite number, undefined for junk or missing input", () => {
    expect(parseNumberParam("12.5")).toBe(12.5);
    expect(parseNumberParam("not-a-number")).toBeUndefined();
    expect(parseNumberParam(null)).toBeUndefined();
  });
});

describe("parseDateParam", () => {
  it("parses a valid date string, undefined for junk or missing input", () => {
    expect(parseDateParam("2026-01-01")).toEqual(new Date("2026-01-01"));
    expect(parseDateParam("not-a-date")).toBeUndefined();
    expect(parseDateParam(null)).toBeUndefined();
  });
});

describe("toURLSearchParams", () => {
  it("expands array values into repeated keys, matching parseListParam's expectation", () => {
    const params = toURLSearchParams({ status: ["Available", "Used"], dateFrom: "2026-01-01" });
    expect(parseListParam(params, "status")).toEqual(["Available", "Used"]);
    expect(params.get("dateFrom")).toBe("2026-01-01");
  });
  it("skips undefined values", () => {
    const params = toURLSearchParams({ status: undefined });
    expect(params.has("status")).toBe(false);
  });
});

describe("parseGranularityParam", () => {
  it("only accepts a real Granularity value", () => {
    expect(parseGranularityParam("month")).toBe("month");
    expect(parseGranularityParam("fortnight")).toBeUndefined();
    expect(parseGranularityParam(null)).toBeUndefined();
  });
});
