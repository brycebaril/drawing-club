import { expect, test } from "@playwright/test";
import { createTestUser, loginAsUser, pool } from "./helpers";

test("VOL_MKT edits a static page and the change renders on the public route", async ({ page }) => {
  const editor = await createTestUser({ username: `e2ecmseditor${Date.now()}` });
  await pool.query(`INSERT INTO volunteer_roles (user_id, role) VALUES ($1, 'ContentEditor')`, [
    editor.id,
  ]);

  const newBody = `Updated about copy ${Date.now()}`;

  await loginAsUser(page, editor);
  await page.goto("/ops/cms/pages/about");
  await page.getByLabel("Title").fill("About the Society");
  await page.getByLabel("Content (Markdown)").fill(newBody);
  await page.getByRole("button", { name: "Save" }).click();

  // updateStaticPageAction redirects back to the same URL it started from,
  // so waitForURL would resolve trivially without ever waiting for the save
  // to commit — poll the DB directly instead (established pattern for
  // browser-driven mutations, e.g. series.spec.ts).
  await expect(async () => {
    const row = await pool.query<{ content: string }>(
      `SELECT content FROM static_pages WHERE slug = 'about'`,
    );
    expect(row.rows[0].content).toBe(newBody);
  }).toPass({ timeout: 5000 });

  await page.goto("/about");
  await expect(page.getByRole("heading", { name: "About the Society" })).toBeVisible();
  await expect(page.getByText(newBody)).toBeVisible();
});

test("a Draft post is hidden from the public site until published", async ({ page }) => {
  const editor = await createTestUser({ username: `e2ecmsnews${Date.now()}` });
  await pool.query(`INSERT INTO volunteer_roles (user_id, role) VALUES ($1, 'ContentEditor')`, [
    editor.id,
  ]);

  const title = `Studio Update ${Date.now()}`;

  await loginAsUser(page, editor);
  await page.goto("/ops/cms/news/new");
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Content (Markdown)").fill("We have some **exciting** news.");
  await page.getByRole("button", { name: "Create post" }).click();
  await page.waitForURL(/\/ops\/cms\/news\/[0-9a-f-]+$/);
  const editUrl = page.url();
  const slugRow = await pool.query<{ slug: string }>(
    `SELECT slug FROM news_posts WHERE title = $1`,
    [title],
  );
  const slug = slugRow.rows[0].slug;

  await page.goto("/news");
  await expect(page.getByText(title)).toHaveCount(0);
  const draftResponse = await page.goto(`/news/${slug}`);
  expect(draftResponse?.status()).toBe(404);

  await page.goto(editUrl);
  await page.getByRole("radio", { name: "Published" }).check();
  await page.getByRole("button", { name: "Save" }).click();

  // Same already-on-target-URL trivial-resolve issue as the static-page
  // test above — poll the DB for the status flip instead of waitForURL.
  await expect(async () => {
    const row = await pool.query<{ status: string }>(
      `SELECT status FROM news_posts WHERE slug = $1`,
      [slug],
    );
    expect(row.rows[0].status).toBe("Published");
  }).toPass({ timeout: 5000 });

  await page.goto("/news");
  await expect(page.getByText(title)).toBeVisible();
  await page.goto(`/news/${slug}`);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
});

test("a non-VOL_MKT/non-ADMIN volunteer hitting /ops/cms is bounced to the dashboard", async ({
  page,
}) => {
  // Unlike /ops/check-in/*'s per-session scoping (which Proxy can't express
  // and so falls through to the page's own notFound()), /ops/cms's role
  // check is a plain route-level rule Proxy fully covers — src/proxy.ts
  // redirects an authenticated-but-not-permitted request to /dashboard
  // before the page component ever runs, so the page's own notFound() guard
  // is unreachable for this case.
  const host = await createTestUser({ username: `e2ecmsdenied${Date.now()}` });
  await pool.query(`INSERT INTO volunteer_roles (user_id, role) VALUES ($1, 'SessionManager')`, [
    host.id,
  ]);

  await loginAsUser(page, host);
  await page.goto("/ops/cms");
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("a public visitor submits the contact form and gets a confirmation", async ({ page }) => {
  await pool.query(
    `UPDATE system_settings SET value = 'studio@example.test' WHERE key = 'CONTACT_FORM_RECIPIENT_EMAIL'`,
  );

  await page.goto("/contact");
  await page.getByLabel("Name").fill("Jamie Visitor");
  await page.getByLabel("Email").fill("jamie@example.test");
  await page.getByLabel("Message").fill("What are your studio hours?");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText("Thanks — your message has been sent.")).toBeVisible();
});

test("a filled honeypot field silently succeeds without sending", async ({ page }) => {
  await page.goto("/contact");
  await page.getByLabel("Name").fill("Bot");
  await page.getByLabel("Email").fill("bot@example.test");
  await page.getByLabel("Message").fill("buy cheap watches");
  // Force-filled: the honeypot is intentionally off-screen for real visitors
  // (position: absolute; left: -9999px), which Playwright's normal
  // actionability check would refuse to scroll to. A real bot sets the DOM
  // value directly without caring about visibility, so `force` matches that.
  await page.locator("#company").fill("Acme Corp", { force: true });
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText("Thanks — your message has been sent.")).toBeVisible();
});
