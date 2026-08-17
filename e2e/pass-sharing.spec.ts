import { expect, test } from "@playwright/test";
import { createTestUser, loginAsUser, pool } from "./helpers";

async function createTransferablePass(ownerId: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO passes (owner_id, status, is_transferable, effective_price) VALUES ($1, 'Available', true, 5.00) RETURNING id`,
    [ownerId],
  );
  return result.rows[0].id;
}

/**
 * Every share/accept/decline/cancel action redirects back to /app/wallet —
 * the exact page the actor was already on. page.waitForURL resolves
 * immediately in that case (URL already matches) without waiting for the
 * mutation to actually commit server-side, so a test that switches users or
 * navigates away right after the click can race the write. Poll the DB
 * directly instead, same fix this codebase already applies elsewhere for a
 * redirect-to-the-same-URL (see CLAUDE.md's CMS implementation notes).
 */
async function expectPassRow(
  passId: string,
  expected: Partial<{
    owner_id: string;
    pending_recipient_id: string | null;
    sender_user_id: string | null;
    status: string;
  }>,
) {
  await expect(async () => {
    const row = await pool.query<{
      owner_id: string;
      pending_recipient_id: string | null;
      sender_user_id: string | null;
      status: string;
    }>(`SELECT owner_id, pending_recipient_id, sender_user_id, status FROM passes WHERE id = $1`, [passId]);
    expect(row.rows[0]).toMatchObject(expected);
  }).toPass({ timeout: 5000 });
}

test("a member shares a pass with a named recipient, who accepts it and becomes the owner", async ({
  page,
}) => {
  const sender = await createTestUser({ username: `e2esharesender${Date.now()}` });
  const recipient = await createTestUser({ username: `e2esharerecipient${Date.now()}` });
  const passId = await createTransferablePass(sender.id);

  await loginAsUser(page, sender);
  await page.goto("/app/wallet");
  await page.getByPlaceholder("Recipient username").fill(recipient.username);
  await page.getByPlaceholder("Note (optional)").fill("Happy drawing!");
  await page.getByRole("button", { name: "Share" }).click();
  await page.waitForURL("**/app/wallet");

  // Pending — stays with the sender, locked from being spent, not spendable
  // or shareable again until resolved. Gates before switching users, since
  // the click's redirect target is the same URL it started on (see the
  // expectPassRow doc comment above).
  await expectPassRow(passId, { owner_id: sender.id, pending_recipient_id: recipient.id, status: "Assigned" });

  await loginAsUser(page, recipient);
  await page.goto("/app/wallet");
  await expect(page.getByText("Shared with you")).toBeVisible();
  await expect(page.getByText(sender.username)).toBeVisible();
  await expect(page.getByText("Happy drawing!")).toBeVisible();
  await page.getByRole("button", { name: "Accept" }).click();
  await page.waitForURL("**/app/wallet");

  await expectPassRow(passId, { owner_id: recipient.id, pending_recipient_id: null, status: "Available" });
});

test("a recipient can decline a pending transfer, returning the pass to the sender", async ({ page }) => {
  const sender = await createTestUser({ username: `e2esharedecline${Date.now()}` });
  const recipient = await createTestUser({ username: `e2esharedeclinerecip${Date.now()}` });
  const passId = await createTransferablePass(sender.id);

  await loginAsUser(page, sender);
  await page.goto("/app/wallet");
  await page.getByPlaceholder("Recipient username").fill(recipient.username);
  await page.getByRole("button", { name: "Share" }).click();
  await page.waitForURL("**/app/wallet");
  await expectPassRow(passId, { pending_recipient_id: recipient.id, status: "Assigned" });

  await loginAsUser(page, recipient);
  await page.goto("/app/wallet");
  await page.getByRole("button", { name: "Decline" }).click();
  await page.waitForURL("**/app/wallet");

  await expectPassRow(passId, {
    owner_id: sender.id,
    pending_recipient_id: null,
    sender_user_id: null,
    status: "Available",
  });

  // Spendable again — visible back in the sender's own transferable list.
  await loginAsUser(page, sender);
  await page.goto("/app/wallet");
  await expect(page.getByText("Transferable passes")).toBeVisible();
  await expect(page.getByPlaceholder("Recipient username")).toBeVisible();
});

test("a sender can cancel a pending share before the recipient responds", async ({ page }) => {
  const sender = await createTestUser({ username: `e2esharecancel${Date.now()}` });
  const recipient = await createTestUser({ username: `e2esharecancelrecip${Date.now()}` });
  const passId = await createTransferablePass(sender.id);

  await loginAsUser(page, sender);
  await page.goto("/app/wallet");
  await page.getByPlaceholder("Recipient username").fill(recipient.username);
  await page.getByRole("button", { name: "Share" }).click();
  await page.waitForURL("**/app/wallet");
  await expectPassRow(passId, { pending_recipient_id: recipient.id, status: "Assigned" });

  await page.goto("/app/wallet");
  await expect(page.getByText("Pending — you're sharing")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.waitForURL("**/app/wallet");

  await expectPassRow(passId, {
    owner_id: sender.id,
    pending_recipient_id: null,
    sender_user_id: null,
    status: "Available",
  });
});

test("sharing a pass with a nonexistent username is rejected with a clear error", async ({ page }) => {
  const sender = await createTestUser({ username: `e2eshareinvalid${Date.now()}` });
  await createTransferablePass(sender.id);

  await loginAsUser(page, sender);
  await page.goto("/app/wallet");
  await page.getByPlaceholder("Recipient username").fill("no-such-member-anywhere");
  await page.getByRole("button", { name: "Share" }).click();

  await expect(page.getByText("No member found with that username.")).toBeVisible();
});

test("the recipient sees the notification banner on an unrelated page before visiting the wallet, and it clears after responding", async ({
  page,
}) => {
  const sender = await createTestUser({ username: `e2esharebanner${Date.now()}` });
  const recipient = await createTestUser({ username: `e2esharebannerrecip${Date.now()}` });
  const passId = await createTransferablePass(sender.id);

  await loginAsUser(page, sender);
  await page.goto("/app/wallet");
  await page.getByPlaceholder("Recipient username").fill(recipient.username);
  await page.getByRole("button", { name: "Share" }).click();
  await page.waitForURL("**/app/wallet");
  await expectPassRow(passId, { pending_recipient_id: recipient.id, status: "Assigned" });

  await loginAsUser(page, recipient);
  await page.goto("/dashboard");
  await expect(page.getByText("You have a pass waiting for you to accept.")).toBeVisible();
  await page.getByRole("link", { name: "Review in your wallet" }).click();
  await page.waitForURL("**/app/wallet");
  await page.getByRole("button", { name: "Accept" }).click();
  await page.waitForURL("**/app/wallet");
  await expectPassRow(passId, { owner_id: recipient.id, pending_recipient_id: null, status: "Available" });

  await page.goto("/dashboard");
  await expect(page.getByText("You have a pass waiting for you to accept.")).not.toBeVisible();
});
