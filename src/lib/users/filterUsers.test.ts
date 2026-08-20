import { describe, expect, it } from "vitest";
import { filterUserRows, type UserRow } from "./filterUsers";

function makeRow(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: "1",
    username: "jdoe",
    display_name: "Jane Doe",
    email: "jane@example.test",
    status: "Active",
    base_role: "AccountHolder",
    membership_expires_at: null,
    volunteer_roles: [],
    ...overrides,
  };
}

const NOW = new Date("2026-01-01T00:00:00Z");

describe("filterUserRows — q (display name or email search)", () => {
  it("matches a substring of the display name, case-insensitively", () => {
    const rows = [
      makeRow({ display_name: "Jane Doe", email: "jane@example.test" }),
      makeRow({ id: "2", display_name: "Bob Smith", email: "bob@example.test" }),
    ];
    expect(filterUserRows(rows, { q: "jane" }, NOW)).toHaveLength(1);
    expect(filterUserRows(rows, { q: "DOE" }, NOW)).toHaveLength(1);
  });

  it("matches a substring of the email, case-insensitively", () => {
    const rows = [makeRow({ email: "jane@example.test" }), makeRow({ id: "2", email: "bob@example.test" })];
    expect(filterUserRows(rows, { q: "JANE@" }, NOW)).toHaveLength(1);
  });

  it("does not match against username", () => {
    const rows = [makeRow({ username: "jdoe", display_name: "Jane Doe", email: "jane@example.test" })];
    expect(filterUserRows(rows, { q: "jdoe" }, NOW)).toHaveLength(0);
  });

  it("trims whitespace from the query", () => {
    const rows = [makeRow({ display_name: "Jane Doe" })];
    expect(filterUserRows(rows, { q: "  jane  " }, NOW)).toHaveLength(1);
  });

  it("treats a null display name as never matching, falling back to email only", () => {
    const rows = [makeRow({ display_name: null, email: "jane@example.test" })];
    expect(filterUserRows(rows, { q: "jane" }, NOW)).toHaveLength(1);
    expect(filterUserRows(rows, { q: "nonexistent" }, NOW)).toHaveLength(0);
  });

  it("returns no rows when nothing matches", () => {
    const rows = [makeRow()];
    expect(filterUserRows(rows, { q: "zzzzz" }, NOW)).toHaveLength(0);
  });

  it("returns every row when q is empty/unset", () => {
    const rows = [makeRow(), makeRow({ id: "2" })];
    expect(filterUserRows(rows, {}, NOW)).toHaveLength(2);
    expect(filterUserRows(rows, { q: "" }, NOW)).toHaveLength(2);
    expect(filterUserRows(rows, { q: "   " }, NOW)).toHaveLength(2);
  });

  it("combines with status/tier/role filters (all must match)", () => {
    const rows = [
      makeRow({
        id: "1",
        display_name: "Jane Doe",
        status: "Active",
        membership_expires_at: new Date("2027-01-01T00:00:00Z"),
      }),
      makeRow({
        id: "2",
        display_name: "Jane Smith",
        status: "Suspended",
        membership_expires_at: new Date("2027-01-01T00:00:00Z"),
      }),
    ];
    const result = filterUserRows(rows, { q: "jane", status: "Active", tier: "MBR" }, NOW);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("1");
  });
});
