import { expect, test } from "@playwright/test";
import { createTestUser, loginAsUser, pool } from "./helpers";

test("Admin views the reporting dashboard and sees every section", async ({ page }) => {
  const admin = await createTestUser({ username: `e2edashboard${Date.now()}`, baseRole: "Admin" });
  await loginAsUser(page, admin);

  await page.goto("/admin/dashboard");
  await expect(page.getByRole("heading", { name: "Accounts" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Open flags (next 14 days)" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Attendance — trailing 12 weeks" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Revenue — trailing 12 weeks" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recent activity" })).toBeVisible();
});

test("Admin creates a scoped API key and uses it to call the Stats API", async ({ page }) => {
  const admin = await createTestUser({ username: `e2eapikey${Date.now()}`, baseRole: "Admin" });
  await loginAsUser(page, admin);

  const keyName = `Full access ${Date.now()}`;
  await page.goto("/admin/api-keys");
  await page.getByLabel("Name").fill(keyName);
  await page.getByRole("checkbox", { name: "users" }).check();
  await page.getByRole("checkbox", { name: "attendance" }).check();
  await page.getByRole("button", { name: "Create key" }).click();
  await page.waitForURL(/newKey=/);

  const rawKey = new URL(page.url()).searchParams.get("newKey");
  expect(rawKey).toBeTruthy();
  await expect(page.getByText(rawKey!)).toBeVisible();

  const usersResponse = await page.request.get("/api/stats/users", {
    headers: { Authorization: `Bearer ${rawKey}` },
  });
  expect(usersResponse.ok()).toBe(true);
  const body = await usersResponse.json();
  expect(body).toHaveProperty("totalUsers");
  expect(body).toHaveProperty("byBaseRole");

  const row = page.locator("tr", { hasText: keyName });
  await expect(row).toBeVisible();
  await expect(row.getByText("Active")).toBeVisible();
});

test("a missing or invalid bearer token is rejected with 401", async ({ page }) => {
  const noAuthResponse = await page.request.get("/api/stats/users");
  expect(noAuthResponse.status()).toBe(401);

  const badTokenResponse = await page.request.get("/api/stats/users", {
    headers: { Authorization: "Bearer not-a-real-key" },
  });
  expect(badTokenResponse.status()).toBe(401);
});

test("a valid key without the required scope is rejected with 403", async ({ page }) => {
  const admin = await createTestUser({ username: `e2eapikeyscope${Date.now()}`, baseRole: "Admin" });
  await loginAsUser(page, admin);

  const keyName = `Users only ${Date.now()}`;
  await page.goto("/admin/api-keys");
  await page.getByLabel("Name").fill(keyName);
  await page.getByRole("checkbox", { name: "users" }).check();
  await page.getByRole("button", { name: "Create key" }).click();
  await page.waitForURL(/newKey=/);
  const rawKey = new URL(page.url()).searchParams.get("newKey");

  const revenueResponse = await page.request.get("/api/stats/revenue", {
    headers: { Authorization: `Bearer ${rawKey}` },
  });
  expect(revenueResponse.status()).toBe(403);

  const usersResponse = await page.request.get("/api/stats/users", {
    headers: { Authorization: `Bearer ${rawKey}` },
  });
  expect(usersResponse.ok()).toBe(true);
});

test("revoking a key makes subsequent API requests with it fail", async ({ page }) => {
  const admin = await createTestUser({ username: `e2eapikeyrevoke${Date.now()}`, baseRole: "Admin" });
  await loginAsUser(page, admin);

  const keyName = `Revoke me ${Date.now()}`;
  await page.goto("/admin/api-keys");
  await page.getByLabel("Name").fill(keyName);
  await page.getByRole("checkbox", { name: "users" }).check();
  await page.getByRole("button", { name: "Create key" }).click();
  await page.waitForURL(/newKey=/);
  const rawKey = new URL(page.url()).searchParams.get("newKey");

  await page.goto("/admin/api-keys");
  const row = page.locator("tr", { hasText: keyName });
  await row.getByRole("button", { name: "Revoke" }).click();

  await expect(async () => {
    const keyRow = await pool.query<{ revoked_at: Date | null }>(
      `SELECT revoked_at FROM api_keys WHERE name = $1`,
      [keyName],
    );
    expect(keyRow.rows[0].revoked_at).not.toBeNull();
  }).toPass({ timeout: 5000 });

  const response = await page.request.get("/api/stats/users", {
    headers: { Authorization: `Bearer ${rawKey}` },
  });
  expect(response.status()).toBe(401);
});
