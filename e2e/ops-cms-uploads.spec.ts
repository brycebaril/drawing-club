import { expect, test } from "@playwright/test";
import { createTestUser, loginAsUser, pool } from "./helpers";

async function createContentEditor(usernamePrefix: string) {
  const editor = await createTestUser({ username: `${usernamePrefix}${Date.now()}` });
  await pool.query(`INSERT INTO volunteer_roles (user_id, role) VALUES ($1, 'ContentEditor')`, [editor.id]);
  return editor;
}

test("VOL_MKT uploads a file and gets back a URL that's actually served", async ({ page, request }) => {
  const editor = await createContentEditor("e2ecmsupload");
  await loginAsUser(page, editor);

  await page.goto("/ops/cms/uploads");
  await page
    .getByLabel("File (JPEG, PNG, WebP, GIF, or PDF — up to 10 MB)")
    .setInputFiles({ name: "test-image.png", mimeType: "image/png", buffer: Buffer.from([137, 80, 78, 71]) });
  await page.getByRole("button", { name: "Upload" }).click();

  await expect(page.getByRole("status")).toContainText("Uploaded —");
  const urlText = await page.locator('[role="status"] code').textContent();
  expect(urlText).toBeTruthy();

  // Local-disk fallback (no AWS vars in CI/local dev) serves it back at that
  // URL — checked with a request context that never logged in (unlike
  // page.request, this `request` fixture carries no session cookie), since
  // response.ok() alone doesn't prove much: a route this app's own RBAC
  // fails closed on 307s to /auth/login, which itself renders 200, so
  // response.ok() would stay true even while every guest got the login page
  // back instead of the image. Asserting the real content-type is what
  // actually distinguishes those two cases.
  const response = await request.get(urlText!.startsWith("http") ? urlText! : `http://localhost:3000${urlText}`);
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toBe("image/png");
});

test("an oversized file is rejected", async ({ page }) => {
  const editor = await createContentEditor("e2ecmsuploadbig");
  await loginAsUser(page, editor);

  await page.goto("/ops/cms/uploads");
  await page.getByLabel("File (JPEG, PNG, WebP, GIF, or PDF — up to 10 MB)").setInputFiles({
    name: "too-big.png",
    mimeType: "image/png",
    buffer: Buffer.alloc(11 * 1024 * 1024),
  });
  await page.getByRole("button", { name: "Upload" }).click();

  await expect(page.getByText("too large")).toBeVisible();
});

test("a disallowed file type is rejected", async ({ page }) => {
  const editor = await createContentEditor("e2ecmsuploadtype");
  await loginAsUser(page, editor);

  await page.goto("/ops/cms/uploads");
  await page.getByLabel("File (JPEG, PNG, WebP, GIF, or PDF — up to 10 MB)").setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("just some text"),
  });
  await page.getByRole("button", { name: "Upload" }).click();

  await expect(page.getByText("isn't allowed")).toBeVisible();
});

test("a non-VOL_MKT/non-admin hitting /ops/cms/uploads is bounced to the dashboard", async ({ page }) => {
  const member = await createTestUser({ username: `e2ecmsuploadnoauth${Date.now()}` });
  await loginAsUser(page, member);

  await page.goto("/ops/cms/uploads");
  await page.waitForURL("**/dashboard");
});
