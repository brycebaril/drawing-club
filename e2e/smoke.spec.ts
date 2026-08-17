import { expect, test } from "@playwright/test";
import { createTestUser, loginAsUser } from "./helpers";

test("home page renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Life Drawing Society" })).toBeVisible();
});

test("the public nav reflects an existing session instead of always showing Log in", async ({
  page,
}) => {
  // Regression test: PublicNav previously never checked auth state at all,
  // so a logged-in visitor landing on a public page (e.g. via a bookmark)
  // saw "Log in"/"Sign up" even though they were already authenticated.
  const member = await createTestUser({ username: `e2enavauth${Date.now()}` });
  await loginAsUser(page, member);

  await page.goto("/");
  await expect(page.getByRole("link", { name: "Log in" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
});

test("health check reports a connected database", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.ok()).toBe(true);
  await expect(response.json()).resolves.toMatchObject({ status: "ok", db: "connected" });
});
