import { expect, test } from "@playwright/test";
import { createTestUser, loginAsUser, pool } from "./helpers";

test("a member creates a support ticket, a support agent sees and replies to it, and the member sees the urgent banner and reply", async ({
  page,
}) => {
  const member = await createTestUser({ username: `e2esupportmember${Date.now()}` });
  const agent = await createTestUser({ username: `e2esupportagent${Date.now()}` });
  await pool.query(`INSERT INTO volunteer_roles (user_id, role) VALUES ($1, 'SupportAgent')`, [agent.id]);

  const subject = `e2e-ticket-${Date.now()}`;

  await loginAsUser(page, member);
  await page.goto("/app/support");
  await page.getByLabel("Subject").fill(subject);
  await page.getByLabel("Message").fill("My ticket balance looks wrong.");
  await page.getByRole("button", { name: "Submit ticket" }).click();
  await page.waitForURL(/\/app\/support\/[0-9a-f-]+$/);
  const ticketId = page.url().split("/").pop()!;

  const ticketRow = await pool.query<{ status: string; requester_user_id: string }>(
    `SELECT status, requester_user_id FROM support_tickets WHERE id = $1`,
    [ticketId],
  );
  expect(ticketRow.rowCount).toBe(1);
  expect(ticketRow.rows[0].status).toBe("Open");
  expect(ticketRow.rows[0].requester_user_id).toBe(member.id);

  await loginAsUser(page, agent);
  await page.goto("/ops/support");
  // The badge link lives inside the closed <details> disclosure — open it
  // first. The count itself is a global "needs staff reply across every
  // ticket" number (a deliberately shared, unassigned inbox), so other
  // parallel e2e workers' tickets can add to it — assert it's non-zero
  // rather than exactly 1.
  await page.getByRole("button", { name: "☰ Staff" }).click();
  await expect(page.getByRole("link", { name: /^Support \(\d+\)$/ })).toBeVisible();
  // Scoped to this ticket's own row — other parallel e2e workers may also
  // have an open "Needs reply" ticket in this shared inbox at the same time,
  // so a bare getByRole("link", { name: "Needs reply" }) could match more
  // than one row.
  const inboxRow = page.getByRole("row", { name: subject });
  await expect(inboxRow).toBeVisible();
  await expect(inboxRow.getByRole("link", { name: "Needs reply" })).toBeVisible();

  await page.goto(`/ops/support/${ticketId}`);
  await expect(page.getByText("My ticket balance looks wrong.")).toBeVisible();

  await page.getByLabel("Reply").fill("Looking into it now.");
  await page.getByRole("button", { name: "Send reply" }).click();
  await expect(page.getByText("Looking into it now.")).toBeVisible();

  await expect(async () => {
    const reply = await pool.query<{ last_message_by_user_id: string }>(
      `SELECT last_message_by_user_id FROM support_tickets WHERE id = $1`,
      [ticketId],
    );
    expect(reply.rows[0].last_message_by_user_id).toBe(agent.id);
  }).toPass({ timeout: 5000 });

  await loginAsUser(page, member);
  // The urgent banner is a standing, every-page prompt, not something only
  // visible on the ticket page itself — same reasoning e2e/pass-sharing.spec.ts
  // uses for its own pending-transfer banner check.
  await page.goto("/dashboard");
  await expect(page.getByText("You have a support ticket reply waiting for you.")).toBeVisible();

  await page.goto(`/app/support/${ticketId}`);
  await expect(page.getByText("Looking into it now.")).toBeVisible();
  await page.getByLabel("Reply").fill("Thanks, that fixed it.");
  await page.getByRole("button", { name: "Send reply" }).click();
  await expect(page.getByText("Thanks, that fixed it.")).toBeVisible();
});

test("resolving a ticket and a member's reply auto-reopens it", async ({ page }) => {
  const member = await createTestUser({ username: `e2esupportreopen${Date.now()}` });
  const agent = await createTestUser({ username: `e2esupportreopenagent${Date.now()}` });
  await pool.query(`INSERT INTO volunteer_roles (user_id, role) VALUES ($1, 'SupportAgent')`, [agent.id]);

  const ticketResult = await pool.query<{ id: string }>(
    `INSERT INTO support_tickets (requester_user_id, subject, last_message_by_user_id)
     VALUES ($1, $2, $1) RETURNING id`,
    [member.id, `e2e-reopen-ticket-${Date.now()}`],
  );
  const ticketId = ticketResult.rows[0].id;
  await pool.query(
    `INSERT INTO support_ticket_messages (ticket_id, author_user_id, content) VALUES ($1, $2, $3)`,
    [ticketId, member.id, "Original question."],
  );

  await loginAsUser(page, agent);
  await page.goto(`/ops/support/${ticketId}`);
  await page.getByRole("button", { name: "Mark resolved" }).click();
  await expect(async () => {
    const row = await pool.query<{ status: string }>(`SELECT status FROM support_tickets WHERE id = $1`, [
      ticketId,
    ]);
    expect(row.rows[0].status).toBe("Resolved");
  }).toPass({ timeout: 5000 });

  await loginAsUser(page, member);
  await page.goto(`/app/support/${ticketId}`);
  await page.getByLabel("Reply").fill("Actually it's still broken.");
  await page.getByRole("button", { name: "Send reply" }).click();

  await expect(async () => {
    const row = await pool.query<{ status: string }>(`SELECT status FROM support_tickets WHERE id = $1`, [
      ticketId,
    ]);
    expect(row.rows[0].status).toBe("Open");
  }).toPass({ timeout: 5000 });
});

test("a non-VOL_SUPPORT/non-admin hitting /ops/support is bounced to the dashboard", async ({ page }) => {
  const member = await createTestUser({ username: `e2esupportnoauth${Date.now()}` });
  await loginAsUser(page, member);

  await page.goto("/ops/support");
  await page.waitForURL("**/dashboard");
});

test("a member hitting another member's support ticket gets a 404", async ({ page }) => {
  const owner = await createTestUser({ username: `e2esupportowner${Date.now()}` });
  const other = await createTestUser({ username: `e2esupportother${Date.now()}` });

  const ticketResult = await pool.query<{ id: string }>(
    `INSERT INTO support_tickets (requester_user_id, subject, last_message_by_user_id)
     VALUES ($1, $2, $1) RETURNING id`,
    [owner.id, `e2e-scoped-ticket-${Date.now()}`],
  );
  const ticketId = ticketResult.rows[0].id;

  await loginAsUser(page, other);
  const response = await page.goto(`/app/support/${ticketId}`);
  expect(response?.status()).toBe(404);
});
