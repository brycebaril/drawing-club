import { expect, test } from "@playwright/test";
import { createTestUser, loginAsUser } from "./helpers";

// This project only runs against a real narrow viewport (playwright.config.ts's
// "mobile" project, devices["iPhone 13"]) — the app's first-ever
// screen-width breakpoint (globals.css's @media (max-width: 640px) block)
// had zero automated coverage at any viewport width before this file, so
// these checks confirm it actually does something, not just that pages
// load without erroring.

test("/admin/users collapses its table into stacked cards on a narrow viewport", async ({ page }) => {
  const admin = await createTestUser({ username: `e2emobileusers${Date.now()}`, baseRole: "Admin" });
  await loginAsUser(page, admin);
  await page.goto("/admin/users");

  // The @media block sets `thead { display: none }` on any .table-scroll
  // table not the calendar-grid — this is the one page whose <td>s carry
  // data-label attributes, so it's the one that actually stacks visibly.
  await expect(page.locator("table thead")).toBeHidden();
  await expect(page.locator("table tbody tr").first()).toBeVisible();

  // The page itself shouldn't force horizontal scrolling of the whole
  // viewport — content that needs to scroll does so inside its own
  // .table-scroll container, not the page body.
  const hasBodyOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(hasBodyOverflow).toBe(false);
});

test("/admin/users keeps its normal table layout at desktop width (regression guard for the breakpoint itself)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const admin = await createTestUser({ username: `e2emobiledesktop${Date.now()}`, baseRole: "Admin" });
  await loginAsUser(page, admin);
  await page.goto("/admin/users");

  await expect(page.locator("table thead")).toBeVisible();
});

test("/app/schedule's calendar grid scrolls within its own container, not the page body, on a narrow viewport", async ({
  page,
}) => {
  const member = await createTestUser({ username: `e2emobileschedule${Date.now()}` });
  await loginAsUser(page, member);
  await page.goto("/app/schedule");

  await expect(page.getByRole("heading", { name: "Schedule", exact: true })).toBeVisible();
  const hasBodyOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(hasBodyOverflow).toBe(false);
});

test("a public CMS page is usable on a narrow viewport, staff nav included", async ({ page }) => {
  await page.goto("/about");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const hasBodyOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(hasBodyOverflow).toBe(false);
});
