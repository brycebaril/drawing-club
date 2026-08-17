import { expect, test } from "@playwright/test";
import { createTestUser, loginAsUser, pool } from "./helpers";
import { toDateOnly } from "@/lib/sessions/shared";

async function seedTransaction(opts: {
  userId: string;
  gatewayRefId: string;
  amountPaid: string;
  processingFee: string;
  netAmount: string;
  payoutBatchId: string;
  createdAt?: Date;
}) {
  await pool.query(
    `INSERT INTO transactions
       (user_id, gateway_ref_id, amount_paid, processing_fee, net_amount, charge_status,
        payout_batch_id, payout_status, item_type, created_at)
     VALUES ($1, $2, $3, $4, $5, 'Succeeded', $6, 'Paid_Out', 'SinglePass', $7)`,
    [
      opts.userId,
      opts.gatewayRefId,
      opts.amountPaid,
      opts.processingFee,
      opts.netAmount,
      opts.payoutBatchId,
      opts.createdAt ?? new Date(),
    ],
  );
}

test("Controller sees a payout batch in the reconciliation list and drills into its transactions", async ({
  page,
}) => {
  const controller = await createTestUser({ username: `e2erecon${Date.now()}` });
  await pool.query(`INSERT INTO volunteer_roles (user_id, role) VALUES ($1, 'Controller')`, [
    controller.id,
  ]);
  const buyer = await createTestUser({ username: `e2ereconbuyer${Date.now()}` });

  const payoutBatchId = `po_e2e_${Date.now()}`;
  const gatewayRefId = `pi_e2e_${Date.now()}`;
  await seedTransaction({
    userId: buyer.id,
    gatewayRefId,
    amountPaid: "20.00",
    processingFee: "0.88",
    netAmount: "19.12",
    payoutBatchId,
  });

  await loginAsUser(page, controller);
  await page.goto("/ops/financials");

  const row = page.locator("tr", { hasText: payoutBatchId });
  await expect(row).toBeVisible();
  await expect(row.getByText("$20.00")).toBeVisible();

  await row.getByRole("link", { name: "View" }).click();
  await expect(page.getByRole("heading", { name: `Payout batch ${payoutBatchId}` })).toBeVisible();
  await expect(page.getByText(buyer.username)).toBeVisible();
  await expect(page.getByText(gatewayRefId)).toBeVisible();
});

test("the payout-batch CSV contains the right transaction", async ({ page }) => {
  const controller = await createTestUser({ username: `e2ereconcsv${Date.now()}` });
  await pool.query(`INSERT INTO volunteer_roles (user_id, role) VALUES ($1, 'Controller')`, [
    controller.id,
  ]);
  const buyer = await createTestUser({ username: `e2ereconcsvbuyer${Date.now()}` });

  const payoutBatchId = `po_e2ecsv_${Date.now()}`;
  await seedTransaction({
    userId: buyer.id,
    gatewayRefId: `pi_e2ecsv_${Date.now()}`,
    amountPaid: "17.00",
    processingFee: "0.79",
    netAmount: "16.21",
    payoutBatchId,
  });

  await loginAsUser(page, controller);
  const csvResponse = await page.request.get(
    `/ops/financials/payouts/csv?payoutBatchId=${encodeURIComponent(payoutBatchId)}`,
  );
  expect(csvResponse.ok()).toBe(true);
  const csvBody = await csvResponse.text();
  expect(csvBody).toContain(buyer.username);
  expect(csvBody).toContain("17.00");
  expect(csvBody).toContain("16.21");
});

test("the sales date-range filter narrows the summary and its CSV matches the same range", async ({
  page,
}) => {
  const controller = await createTestUser({ username: `e2ereconrange${Date.now()}` });
  await pool.query(`INSERT INTO volunteer_roles (user_id, role) VALUES ($1, 'Controller')`, [
    controller.id,
  ]);
  const buyer = await createTestUser({ username: `e2ereconrangebuyer${Date.now()}` });

  const inRangeDate = new Date();
  inRangeDate.setDate(inRangeDate.getDate() - 1);
  const outOfRangeDate = new Date();
  outOfRangeDate.setDate(outOfRangeDate.getDate() - 200);

  const inRangeRef = `pi_e2erange_in_${Date.now()}`;
  await seedTransaction({
    userId: buyer.id,
    gatewayRefId: inRangeRef,
    amountPaid: "20.00",
    processingFee: "0.88",
    netAmount: "19.12",
    payoutBatchId: `po_e2erange_in_${Date.now()}`,
    createdAt: inRangeDate,
  });
  const outOfRangeRef = `pi_e2erange_out_${Date.now()}`;
  await seedTransaction({
    userId: buyer.id,
    gatewayRefId: outOfRangeRef,
    amountPaid: "20.00",
    processingFee: "0.88",
    netAmount: "19.12",
    payoutBatchId: `po_e2erange_out_${Date.now()}`,
    createdAt: outOfRangeDate,
  });

  await loginAsUser(page, controller);

  const today = toDateOnly(new Date());
  const tenDaysAgo = toDateOnly(new Date(Date.now() - 10 * 24 * 60 * 60 * 1000));

  const csvInRange = await page.request.get(
    `/ops/financials/transactions/csv?start=${tenDaysAgo}&end=${today}`,
  );
  const inRangeBody = await csvInRange.text();
  expect(inRangeBody).toContain(inRangeRef);
  expect(inRangeBody).not.toContain(outOfRangeRef);

  await page.goto(`/ops/financials?start=${tenDaysAgo}&end=${today}`);
  await expect(page.getByRole("cell", { name: "SinglePass" })).toBeVisible();
});

test("a non-Controller hitting the payout drill-down page is bounced to the dashboard", async ({
  page,
}) => {
  const host = await createTestUser({ username: `e2ereconhost${Date.now()}` });
  await pool.query(`INSERT INTO volunteer_roles (user_id, role) VALUES ($1, 'SessionManager')`, [
    host.id,
  ]);

  await loginAsUser(page, host);
  await page.goto("/ops/financials/payouts/po_nonexistent");
  await expect(page).toHaveURL(/\/dashboard$/);
});
