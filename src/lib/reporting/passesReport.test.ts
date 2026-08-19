import { describe, expect, it } from "vitest";
import { buildPassesQuery } from "./passesReport";

describe("buildPassesQuery", () => {
  it("builds an unfiltered, ungrouped query with no bound values beyond the no-op date clause", () => {
    const { sql, values } = buildPassesQuery({});
    expect(sql).toContain("FROM passes p");
    expect(sql).toContain("LEFT JOIN users u ON u.id = p.owner_id");
    expect(sql).toContain("WHERE 1=1");
    expect(sql).toContain("count(*)::int AS count");
    expect(values).toEqual([]);
  });

  it("binds status filter as a parameterized array, never interpolated", () => {
    const { sql, values } = buildPassesQuery({ filters: { status: ["Available", "Used"] } });
    expect(sql).toContain("p.status::text = ANY($1::text[])");
    expect(values).toEqual([["Available", "Used"]]);
  });

  it("binds cost-basis min/max as separate sequential params", () => {
    const { sql, values } = buildPassesQuery({ filters: { costBasisMin: 10, costBasisMax: 20 } });
    expect(sql).toContain("p.effective_price >= $1");
    expect(sql).toContain("p.effective_price <= $2");
    expect(values).toEqual([10, 20]);
  });

  it("only selects/groups by dimensions present in the allowlist, dropping unknown keys silently", () => {
    // @ts-expect-error -- deliberately passing an invalid dimension key to prove it's dropped, not injected
    const { sql } = buildPassesQuery({ groupBy: ["status", "dropTable); --"] });
    expect(sql).toContain('p.status AS "status"');
    expect(sql).not.toContain("dropTable");
  });

  it("includes a bucketed (not exact-value) cost-basis expression when grouping by it", () => {
    const { sql } = buildPassesQuery({ groupBy: ["costBasis"] });
    expect(sql).toContain("CASE");
    expect(sql).toContain("WHEN p.effective_price < 12 THEN '<$12'");
  });

  it("adds a time-bucket column ahead of other group-by dimensions when granularity is set", () => {
    const { sql } = buildPassesQuery({ groupBy: ["status"], granularity: "month" });
    const periodIndex = sql.indexOf("date_trunc('month', p.created_at) AS period");
    const statusIndex = sql.indexOf('p.status AS "status"');
    expect(periodIndex).toBeGreaterThan(-1);
    expect(periodIndex).toBeLessThan(statusIndex);
  });

  it("derives origin from a CASE expression referencing the joined transaction's gateway_ref_id", () => {
    const { sql, values } = buildPassesQuery({ filters: { origin: ["legacy"] } });
    expect(sql).toContain("t.gateway_ref_id LIKE 'legacy-%'");
    expect(values).toEqual([["legacy"]]);
  });

  it("casts the enum column, not the value, for cost-basis-source filtering", () => {
    const { sql, values } = buildPassesQuery({ filters: { costBasisSource: ["Estimated"] } });
    expect(sql).toContain("p.cost_basis_source::text = ANY($1::text[])");
    expect(values).toEqual([["Estimated"]]);
  });

  it("combines multiple filters with sequential, non-colliding param numbers", () => {
    const { sql, values } = buildPassesQuery({
      filters: { status: ["Available"], isTransferable: false, ownerRole: ["Admin"] },
      dateRange: { from: new Date("2026-01-01") },
    });
    expect(sql).toContain("p.status::text = ANY($1::text[])");
    expect(sql).toContain("p.is_transferable = $2");
    expect(sql).toContain("u.base_role::text = ANY($3::text[])");
    expect(sql).toContain("p.created_at >= $4");
    expect(values).toEqual([["Available"], false, ["Admin"], new Date("2026-01-01")]);
  });
});
