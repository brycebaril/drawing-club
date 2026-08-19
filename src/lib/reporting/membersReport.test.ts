import { describe, expect, it } from "vitest";
import { buildMembersQuery } from "./membersReport";

describe("buildMembersQuery", () => {
  it("builds an unfiltered, ungrouped query counting distinct users", () => {
    const { sql, values } = buildMembersQuery({});
    expect(sql).toContain("FROM users u");
    expect(sql).toContain("count(DISTINCT u.id)::int AS count");
    expect(sql).not.toContain("LEFT JOIN volunteer_roles");
    expect(sql).not.toContain("LEFT JOIN membership_history");
    expect(values).toEqual([]);
  });

  it("expresses hasVolunteerRole as an EXISTS subquery, not a join, when only filtering", () => {
    const { sql } = buildMembersQuery({ filters: { hasVolunteerRole: true } });
    expect(sql).toContain("EXISTS (SELECT 1 FROM volunteer_roles vre WHERE vre.user_id = u.id)");
    expect(sql).not.toContain("LEFT JOIN volunteer_roles");
  });

  it("negates the EXISTS clause for hasVolunteerRole: false", () => {
    const { sql } = buildMembersQuery({ filters: { hasVolunteerRole: false } });
    expect(sql).toContain("NOT EXISTS (SELECT 1 FROM volunteer_roles vre WHERE vre.user_id = u.id)");
  });

  it("only adds the volunteer_roles join when grouping by volunteerRole", () => {
    const { sql } = buildMembersQuery({ groupBy: ["volunteerRole"] });
    expect(sql).toContain("LEFT JOIN volunteer_roles vr ON vr.user_id = u.id");
    expect(sql).toContain('vr.role AS "volunteerRole"');
  });

  it("builds the staffWithoutActiveMembership composite filter as an OR across role checks", () => {
    const { sql } = buildMembersQuery({ filters: { staffWithoutActiveMembership: true } });
    expect(sql).toContain("EXISTS (SELECT 1 FROM volunteer_roles vrs WHERE vrs.user_id = u.id) OR u.base_role = 'Admin'");
    expect(sql).toContain("u.membership_expires_at IS NULL OR u.membership_expires_at <= now()");
  });

  it("derives membershipStatus from a CASE expression, not a stored column", () => {
    const { sql, values } = buildMembersQuery({ filters: { membershipStatus: ["active"] } });
    expect(sql).toContain("WHEN u.membership_expires_at > now() THEN 'active'");
    expect(values).toEqual([["active"]]);
  });

  it("joins membership_history for time segmentation, keyed off valid_from not a user creation date", () => {
    const { sql } = buildMembersQuery({ granularity: "month" });
    expect(sql).toContain("LEFT JOIN membership_history mh ON mh.user_id = u.id");
    expect(sql).toContain("date_trunc('month', mh.valid_from) AS period");
  });

  it("drops unrecognized group-by keys rather than passing them through", () => {
    // @ts-expect-error -- deliberately invalid dimension key to prove it's dropped
    const { sql } = buildMembersQuery({ groupBy: ["baseRole", "'; DROP TABLE users; --"] });
    expect(sql).toContain('u.base_role AS "baseRole"');
    expect(sql).not.toContain("DROP TABLE");
  });
});
