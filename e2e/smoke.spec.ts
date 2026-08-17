import { expect, test } from "@playwright/test";
import { createTestUser, loginAsUser } from "./helpers";

test("home page renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Life Drawing Society" })).toBeVisible();
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

test("the staff nav (admin/ops links) is shown only to roles that hold it, not a plain member", async ({
  page,
}) => {
  const admin = await createTestUser({ username: `e2enavstaffadmin${Date.now()}`, baseRole: "Admin" });
  await loginAsUser(page, admin);
  await page.goto("/dashboard");
  await expect(page.getByRole("link", { name: "Sessions" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Settings" })).toBeVisible();

  const member = await createTestUser({ username: `e2enavstaffmember${Date.now()}` });
  await loginAsUser(page, member);
  await page.goto("/dashboard");
  await expect(page.getByRole("link", { name: "Sessions" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(0);
});

test("health check reports a connected database", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.ok()).toBe(true);
  await expect(response.json()).resolves.toMatchObject({ status: "ok", db: "connected" });
});
