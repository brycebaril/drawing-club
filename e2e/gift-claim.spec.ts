import { expect, test } from "@playwright/test";
import { createTestUser, loginAsUser, pool } from "./helpers";
import { isClaimRateLimited, recordClaimAttempt } from "@/lib/auth/rateLimit";

test("a member gifts a transferable pass to another member by username, who claims it", async ({ page }) => {
  const sender = await createTestUser({ username: `e2egiftsender${Date.now()}` });
  const recipient = await createTestUser({ username: `e2egiftrecipient${Date.now()}` });

  const passResult = await pool.query<{ id: string }>(
    `INSERT INTO passes (owner_id, status, is_transferable, effective_price) VALUES ($1, 'Available', true, 5.00) RETURNING id`,
    [sender.id],
  );
  const passId = passResult.rows[0].id;

  await loginAsUser(page, sender);
  await page.goto("/app/wallet");
  await page.getByPlaceholder("Recipient username (optional)").fill(recipient.username);
  await page.getByPlaceholder("Note (optional)").fill("Happy drawing!");
  await page.getByRole("button", { name: "Send gift" }).click();
  await page.waitForURL(/giftLink=/);

  const linkText = await page.locator("code").textContent();
  expect(linkText).toContain("/app/wallet/claim?code=");
  const code = new URL(linkText!).searchParams.get("code");
  expect(code).toBeTruthy();

  // The pass is no longer available/transferable in the sender's own list —
  // it's in flight, owner_id NULL until claimed.
  await expect(async () => {
    const row = await pool.query<{ owner_id: string | null; status: string }>(
      `SELECT owner_id, status FROM passes WHERE id = $1`,
      [passId],
    );
    expect(row.rows[0]).toEqual({ owner_id: null, status: "Assigned" });
  }).toPass({ timeout: 5000 });

  await loginAsUser(page, recipient);
  await page.goto(`/app/wallet/claim?code=${code}`);
  await expect(page.getByText(new RegExp(sender.username))).toBeVisible();
  await expect(page.getByText("Happy drawing!")).toBeVisible();
  await page.getByRole("button", { name: "Claim & Add Pass to My Account" }).click();
  await page.waitForURL("**/app/wallet?claimed=1");
  await expect(page.getByText("Pass claimed and added to your wallet.")).toBeVisible();

  const claimed = await pool.query<{ owner_id: string; status: string; claimed_at: Date | null }>(
    `SELECT owner_id, status, claimed_at FROM passes WHERE id = $1`,
    [passId],
  );
  expect(claimed.rows[0].owner_id).toBe(recipient.id);
  expect(claimed.rows[0].status).toBe("Available");
  expect(claimed.rows[0].claimed_at).not.toBeNull();

  // Reusing the same (now-claimed) code must fail.
  await page.goto(`/app/wallet/claim?code=${code}`);
  await expect(page.getByText(/invalid or has already been used/)).toBeVisible();
});

test("a sender can revoke an unclaimed gift, returning the pass to their own wallet", async ({ page }) => {
  const sender = await createTestUser({ username: `e2egiftrevoke${Date.now()}` });

  const passResult = await pool.query<{ id: string }>(
    `INSERT INTO passes (owner_id, status, is_transferable, effective_price) VALUES ($1, 'Available', true, 5.00) RETURNING id`,
    [sender.id],
  );
  const passId = passResult.rows[0].id;

  await loginAsUser(page, sender);
  await page.goto("/app/wallet");
  // Blank recipient — shareable-link mode, still the same underlying mechanism.
  await page.getByRole("button", { name: "Send gift" }).click();
  await page.waitForURL(/giftLink=/);

  await page.goto("/app/wallet");
  await expect(page.getByRole("button", { name: "Revoke" })).toBeVisible();
  await page.getByRole("button", { name: "Revoke" }).click();
  await page.waitForURL("**/app/wallet");

  await expect(async () => {
    const row = await pool.query<{
      owner_id: string;
      sender_user_id: string | null;
      claim_code: string | null;
      status: string;
    }>(`SELECT owner_id, sender_user_id, claim_code, status FROM passes WHERE id = $1`, [passId]);
    expect(row.rows[0]).toEqual({
      owner_id: sender.id,
      sender_user_id: null,
      claim_code: null,
      status: "Available",
    });
  }).toPass({ timeout: 5000 });
});

test("isClaimRateLimited trips after repeated failed attempts from the same IP", async () => {
  // Date.now()-derived, not random — must never collide with the "different
  // IP" address checked below, in the same run or a concurrent one.
  const suffix = Date.now() % 65536;
  const ip = `10.${Math.floor(suffix / 256)}.${suffix % 256}.1`;
  const otherIp = `10.${Math.floor(suffix / 256)}.${suffix % 256}.2`;

  expect(await isClaimRateLimited(ip)).toBe(false);

  for (let i = 0; i < 5; i++) {
    await recordClaimAttempt(ip, false);
  }

  expect(await isClaimRateLimited(ip)).toBe(true);
  expect(await isClaimRateLimited(otherIp)).toBe(false);
});
