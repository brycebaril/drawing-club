import { expect, test } from "@playwright/test";
import { createTestUser, loginAsUser, pool } from "./helpers";

test("admin generates a batch with an owner, passes land directly in that owner's wallet, and the owner shares one onward", async ({
  page,
}) => {
  const owner = await createTestUser({ username: `e2epassesowner${Date.now()}` });
  const admin = await createTestUser({ username: `e2epassesbatch${Date.now()}`, baseRole: "Admin" });
  await loginAsUser(page, admin);

  const orgName = `Acme Studios ${Date.now()}`;
  await page.goto("/admin/passes/new-batch");
  await page.getByLabel("Organization name").fill(orgName);
  await page.getByPlaceholder("Search by name or username").fill(owner.username);
  await page.getByRole("option", { name: new RegExp(owner.username) }).click();
  await page.getByLabel("Quantity (1–100)").fill("2");
  await page.getByLabel("Effective price per ticket").fill("15.00");
  await page.getByRole("button", { name: "Generate batch" }).click();

  await expect(
    page.getByText(`Batch created for ${orgName} — all tickets are already in ${owner.username}'s wallet`),
  ).toBeVisible();

  const batchRows = await pool.query<{ id: string; status: string; owner_id: string }>(
    `SELECT p.id, p.status, p.owner_id FROM passes p JOIN pass_batches pb ON pb.id = p.batch_id WHERE pb.organization_name = $1`,
    [orgName],
  );
  expect(batchRows.rowCount).toBe(2);
  for (const row of batchRows.rows) {
    expect(row.status).toBe("Available");
    expect(row.owner_id).toBe(owner.id);
  }

  // The owner immediately shares one onward via the same mechanism any
  // member uses — proving batches and peer sharing are one mechanism.
  const recipient = await createTestUser({ username: `e2epassesownerrecip${Date.now()}` });
  await loginAsUser(page, owner);
  await page.goto("/app/wallet");
  // Batch quantity is 2, so two identical Share forms render — scope to one.
  await page.getByPlaceholder("Search by name or username").first().fill(recipient.username);
  await page.getByRole("option", { name: new RegExp(recipient.username) }).first().click();
  await page.getByRole("button", { name: "Share" }).first().click();
  await page.waitForURL("**/app/wallet");

  await expect(async () => {
    const shared = await pool.query<{ count: string }>(
      `SELECT count(*) FROM passes WHERE id = ANY($1) AND pending_recipient_id = $2`,
      [batchRows.rows.map((r) => r.id), recipient.id],
    );
    expect(Number(shared.rows[0].count)).toBe(1);
  }).toPass({ timeout: 5000 });
});

test("batch creation requires an existing owner — searching a nonexistent name keeps Generate disabled", async ({
  page,
}) => {
  const admin = await createTestUser({ username: `e2epassesnoowner${Date.now()}`, baseRole: "Admin" });
  await loginAsUser(page, admin);

  await page.goto("/admin/passes/new-batch");
  await page.getByLabel("Organization name").fill(`No Owner Org ${Date.now()}`);
  await page.getByPlaceholder("Search by name or username").fill("no-such-member-anywhere");
  await page.getByLabel("Quantity (1–100)").fill("1");
  await page.getByLabel("Effective price per ticket").fill("10.00");

  await expect(page.getByText("No members found.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Generate batch" })).toBeDisabled();
});

test("revoking an available transferable pass blocks it from being shared or used again", async ({
  page,
}) => {
  const owner = await createTestUser({ username: `e2epassesrevokeowner${Date.now()}` });
  const admin = await createTestUser({ username: `e2epassesrevoke${Date.now()}`, baseRole: "Admin" });
  await loginAsUser(page, admin);

  const orgName = `Revoke Test Org ${Date.now()}`;
  await page.goto("/admin/passes/new-batch");
  await page.getByLabel("Organization name").fill(orgName);
  await page.getByPlaceholder("Search by name or username").fill(owner.username);
  await page.getByRole("option", { name: new RegExp(owner.username) }).click();
  await page.getByLabel("Quantity (1–100)").fill("1");
  await page.getByLabel("Effective price per ticket").fill("10.00");
  await page.getByRole("button", { name: "Generate batch" }).click();
  await expect(page.getByText(`Batch created for ${orgName}`)).toBeVisible();

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

  // A revoked pass no longer shows a Revoke action and can't be shared.
  await page.goto("/admin/passes");
  await expect(page.locator("tr", { hasText: passId.slice(0, 8) })).toContainText("Revoked");

  await loginAsUser(page, owner);
  await page.goto("/app/wallet");
  await expect(page.getByText("Available: 0")).toBeVisible();
  await expect(page.getByPlaceholder("Search by name or username")).not.toBeVisible();
});

test("the status and batch filters on /admin/passes narrow the list", async ({ page }) => {
  const owner = await createTestUser({ username: `e2epassesfilterowner${Date.now()}` });
  const admin = await createTestUser({ username: `e2epassesfilter${Date.now()}`, baseRole: "Admin" });
  await loginAsUser(page, admin);

  const orgName = `Filter Test Org ${Date.now()}`;
  await page.goto("/admin/passes/new-batch");
  await page.getByLabel("Organization name").fill(orgName);
  await page.getByPlaceholder("Search by name or username").fill(owner.username);
  await page.getByRole("option", { name: new RegExp(owner.username) }).click();
  await page.getByLabel("Quantity (1–100)").fill("1");
  await page.getByLabel("Effective price per ticket").fill("10.00");
  await page.getByRole("button", { name: "Generate batch" }).click();
  await expect(page.getByText(`Batch created for ${orgName}`)).toBeVisible();

  await page.goto("/admin/passes?status=Available");
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
