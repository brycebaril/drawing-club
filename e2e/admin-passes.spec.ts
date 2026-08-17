import { expect, test } from "@playwright/test";
import { createTestUser, loginAsUser, pool } from "./helpers";

test("Admin generates a batch and a member claims one of the codes", async ({ page }) => {
  const admin = await createTestUser({ username: `e2epassesbatch${Date.now()}`, baseRole: "Admin" });
  await loginAsUser(page, admin);

  const orgName = `Acme Studios ${Date.now()}`;
  await page.goto("/admin/passes/new-batch");
  await page.getByLabel("Organization name").fill(orgName);
  await page.getByLabel("Quantity (1–100)").fill("2");
  await page.getByLabel("Effective price per pass").fill("15.00");
  await page.getByRole("button", { name: "Generate batch" }).click();

  await expect(page.getByText(`Batch created for ${orgName}`)).toBeVisible();
  const codes = await page.locator("li code").allTextContents();
  expect(codes).toHaveLength(2);

  const batchRow = await pool.query<{ count: string }>(
    `SELECT count(*) FROM passes p JOIN pass_batches pb ON pb.id = p.batch_id WHERE pb.organization_name = $1`,
    [orgName],
  );
  expect(Number(batchRow.rows[0].count)).toBe(2);

  const member = await createTestUser({ username: `e2epassesclaimer${Date.now()}` });
  await loginAsUser(page, member);
  await page.goto("/app/wallet/claim");
  await page.getByLabel("Claim code").fill(codes[0]);
  await page.getByRole("button", { name: "Claim & Add Pass to My Account" }).click();

  await expect(async () => {
    const claimed = await pool.query<{ count: string }>(
      `SELECT count(*) FROM passes WHERE owner_id = $1`,
      [member.id],
    );
    expect(Number(claimed.rows[0].count)).toBe(1);
  }).toPass({ timeout: 5000 });
});

test("reissuing a claim code invalidates the old code and the new one claims successfully", async ({
  page,
}) => {
  const admin = await createTestUser({ username: `e2epassesreissue${Date.now()}`, baseRole: "Admin" });
  await loginAsUser(page, admin);

  const orgName = `Reissue Test Org ${Date.now()}`;
  await page.goto("/admin/passes/new-batch");
  await page.getByLabel("Organization name").fill(orgName);
  await page.getByLabel("Quantity (1–100)").fill("1");
  await page.getByLabel("Effective price per pass").fill("10.00");
  await page.getByRole("button", { name: "Generate batch" }).click();
  await expect(page.getByText(`Batch created for ${orgName}`)).toBeVisible();
  const oldCode = (await page.locator("li code").first().textContent())!;

  const passRow = await pool.query<{ id: string }>(
    `SELECT p.id FROM passes p JOIN pass_batches pb ON pb.id = p.batch_id WHERE pb.organization_name = $1`,
    [orgName],
  );
  const passId = passRow.rows[0].id;

  await page.goto("/admin/passes");
  const row = page.locator("tr", { hasText: passId.slice(0, 8) });
  await row.getByRole("button", { name: "Reissue code" }).click();
  await expect(row.getByText("New code (shown once)")).toBeVisible();
  const newCode = (await row.locator("code").last().textContent())!;
  expect(newCode).not.toBe(oldCode);

  const member = await createTestUser({ username: `e2epassesreissuemember${Date.now()}` });
  await loginAsUser(page, member);

  await page.goto("/app/wallet/claim");
  await page.getByLabel("Claim code").fill(oldCode);
  await page.getByRole("button", { name: "Claim & Add Pass to My Account" }).click();
  await expect(page.getByRole("alert")).toBeVisible();

  await page.goto("/app/wallet/claim");
  await page.getByLabel("Claim code").fill(newCode);
  await page.getByRole("button", { name: "Claim & Add Pass to My Account" }).click();

  await expect(async () => {
    const claimed = await pool.query<{ status: string }>(`SELECT status FROM passes WHERE id = $1`, [passId]);
    expect(claimed.rows[0].status).toBe("Available");
  }).toPass({ timeout: 5000 });
});

test("revoking an unclaimed batch pass blocks it from ever being claimed", async ({ page }) => {
  const admin = await createTestUser({ username: `e2epassesrevoke${Date.now()}`, baseRole: "Admin" });
  await loginAsUser(page, admin);

  const orgName = `Revoke Test Org ${Date.now()}`;
  await page.goto("/admin/passes/new-batch");
  await page.getByLabel("Organization name").fill(orgName);
  await page.getByLabel("Quantity (1–100)").fill("1");
  await page.getByLabel("Effective price per pass").fill("10.00");
  await page.getByRole("button", { name: "Generate batch" }).click();
  await expect(page.getByText(`Batch created for ${orgName}`)).toBeVisible();
  const code = (await page.locator("li code").first().textContent())!;

  const passRow = await pool.query<{ id: string }>(
    `SELECT p.id FROM passes p JOIN pass_batches pb ON pb.id = p.batch_id WHERE pb.organization_name = $1`,
    [orgName],
  );
  const passId = passRow.rows[0].id;

  await page.goto("/admin/passes");
  const row = page.locator("tr", { hasText: passId.slice(0, 8) });
  await row.getByRole("button", { name: "Revoke" }).click();
  await row.getByLabel("Reason").fill("Client canceled the order");
  await row.getByRole("button", { name: "Confirm revoke" }).click();

  await expect(async () => {
    const revoked = await pool.query<{ status: string }>(`SELECT status FROM passes WHERE id = $1`, [passId]);
    expect(revoked.rows[0].status).toBe("Revoked");
  }).toPass({ timeout: 5000 });

  const member = await createTestUser({ username: `e2epassesrevokedclaimer${Date.now()}` });
  await loginAsUser(page, member);
  await page.goto("/app/wallet/claim");
  await page.getByLabel("Claim code").fill(code);
  await page.getByRole("button", { name: "Claim & Add Pass to My Account" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
});

test("the status and batch filters on /admin/passes narrow the list", async ({ page }) => {
  const admin = await createTestUser({ username: `e2epassesfilter${Date.now()}`, baseRole: "Admin" });
  await loginAsUser(page, admin);

  const orgName = `Filter Test Org ${Date.now()}`;
  await page.goto("/admin/passes/new-batch");
  await page.getByLabel("Organization name").fill(orgName);
  await page.getByLabel("Quantity (1–100)").fill("1");
  await page.getByLabel("Effective price per pass").fill("10.00");
  await page.getByRole("button", { name: "Generate batch" }).click();
  await expect(page.getByText(`Batch created for ${orgName}`)).toBeVisible();

  await page.goto("/admin/passes?status=Assigned");
  await expect(page.getByRole("cell", { name: orgName })).toBeVisible();

  await page.goto("/admin/passes?status=Used");
  await expect(page.getByRole("cell", { name: orgName })).toHaveCount(0);

  const batchRow = await pool.query<{ id: string }>(
    `SELECT id FROM pass_batches WHERE organization_name = $1`,
    [orgName],
  );
  await page.goto(`/admin/passes?batchId=${batchRow.rows[0].id}`);
  await expect(page.getByRole("cell", { name: orgName })).toBeVisible();
});
