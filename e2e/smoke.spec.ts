import { expect, test } from "@playwright/test";
import { createTestUser, loginAsUser, pool } from "./helpers";
import { ORG_DBA_NAME } from "@/lib/org";

test("home page renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: ORG_DBA_NAME })).toBeVisible();
});

test("the nav reflects an existing session and keeps public pages reachable while logged in", async ({
  page,
}) => {
  // Regression test, now covering two historical bugs: (1) the old
  // PublicNav never checked auth state at all, so a logged-in visitor
  // landing on a public page (e.g. via a bookmark) saw "Log in"/"Sign up"
  // even though already authenticated; (2) once logged in, PublicNav
  // delegated entirely to AppNav, which never showed the public links at
  // all — a member had no way back to /about, /news, or /contact short of
  // typing the URL. SiteNav fixes both: one nav, always showing the public
  // links, with an auth-dependent tail.
  const member = await createTestUser({ username: `e2enavauth${Date.now()}` });
  await loginAsUser(page, member);

  await page.goto("/");
  await expect(page.getByRole("link", { name: "Log in" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByRole("link", { name: "About" })).toBeVisible();
  await expect(page.getByRole("link", { name: "News" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Contact" })).toBeVisible();

  // Prove reachability, not just visibility — click through.
  await page.getByRole("link", { name: "About" }).click();
  await page.waitForURL("**/about");
});

test("the staff menu (admin/ops links, behind a hamburger) is shown only to roles that hold it, not a plain member", async ({
  page,
}) => {
  const admin = await createTestUser({ username: `e2enavstaffadmin${Date.now()}`, baseRole: "Admin" });
  await loginAsUser(page, admin);
  await page.goto("/dashboard");
  const staffToggle = page.getByRole("button", { name: "☰ Staff" });
  await expect(staffToggle).toBeVisible();
  // Links live inside the closed <details> disclosure — not visible/clickable until opened.
  await expect(page.getByRole("link", { name: "Sessions" })).toHaveCount(0);
  await staffToggle.click();
  await expect(page.getByRole("link", { name: "Sessions" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Settings" })).toBeVisible();

  const member = await createTestUser({ username: `e2enavstaffmember${Date.now()}` });
  await loginAsUser(page, member);
  await page.goto("/dashboard");
  await expect(page.getByRole("button", { name: "☰ Staff" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Sessions" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(0);
});

// opsLinksFor's exact mapping (src/components/SiteNav.tsx): each ops role
// grants its own link(s) and none of the others, and none of ADMIN_LINKS'
// admin-only links. The one above (admin-vs-plain-member) never exercised
// any of these five roles in isolation. ModelBooker gets *two* links, not
// one — it's unscoped for check-in too (matches requireCheckInAccess's own
// "VOL_MBR/ADMIN are unscoped" rule), a real behavior an earlier draft of
// this test got wrong by assuming one role -> one link.
const OPS_ROLE_CASES: { dbRole: string; ownLinks: string[]; ownLinkPatterns: RegExp[] }[] = [
  { dbRole: "SessionManager", ownLinks: ["Check-in"], ownLinkPatterns: [/^Check-in$/] },
  {
    dbRole: "ModelBooker",
    ownLinks: ["Check-in", "Model Booking"],
    ownLinkPatterns: [/^Check-in$/, /^Model Booking$/],
  },
  { dbRole: "ContentEditor", ownLinks: ["CMS"], ownLinkPatterns: [/^CMS$/] },
  { dbRole: "Controller", ownLinks: ["Financials"], ownLinkPatterns: [/^Financials$/] },
  // Support's own label carries a live unread-reply count ("Support (3)")
  // — a bare "Support" name match would miss it whenever this dev DB has
  // any open tickets, so match the prefix instead.
  { dbRole: "SupportAgent", ownLinks: ["Support"], ownLinkPatterns: [/^Support/] },
];
const ALL_OPS_LINKS = ["Check-in", "Model Booking", "CMS", "Financials"];
const ADMIN_ONLY_LINKS = ["Sessions", "Users", "Transactions", "Tickets", "Audit Logs", "Reporting", "API Keys", "Settings"];

for (const { dbRole, ownLinks, ownLinkPatterns } of OPS_ROLE_CASES) {
  test(`staff menu shows only ${ownLinks.join(" + ")} for a ${dbRole}-only account`, async ({ page }) => {
    const user = await createTestUser({ username: `e2estaffmenu${dbRole.toLowerCase()}${Date.now()}` });
    await pool.query(`INSERT INTO volunteer_roles (user_id, role) VALUES ($1, $2)`, [user.id, dbRole]);
    await loginAsUser(page, user);
    await page.goto("/dashboard");

    const staffToggle = page.getByRole("button", { name: "☰ Staff" });
    await expect(staffToggle).toBeVisible();
    await staffToggle.click();

    const panel = page.locator(".staff-menu-panel");
    for (const pattern of ownLinkPatterns) {
      await expect(panel.getByRole("link", { name: pattern })).toBeVisible();
    }

    for (const label of ADMIN_ONLY_LINKS) {
      await expect(panel.getByRole("link", { name: label, exact: true })).toHaveCount(0);
    }
    for (const otherLink of ALL_OPS_LINKS) {
      if (ownLinks.includes(otherLink)) continue;
      await expect(panel.getByRole("link", { name: otherLink, exact: true })).toHaveCount(0);
    }
    if (!ownLinks.includes("Support")) {
      await expect(panel.getByRole("link", { name: /^Support/ })).toHaveCount(0);
    }
  });
}

test("health check reports a connected database", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.ok()).toBe(true);
  await expect(response.json()).resolves.toMatchObject({ status: "ok", db: "connected" });
});
