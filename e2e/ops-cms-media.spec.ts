import { expect, test } from "@playwright/test";
import { createTestUser, loginAsUser, pool } from "./helpers";

async function createContentEditor(usernamePrefix: string) {
  const editor = await createTestUser({ username: `${usernamePrefix}${Date.now()}` });
  await pool.query(`INSERT INTO volunteer_roles (user_id, role) VALUES ($1, 'ContentEditor')`, [editor.id]);
  return editor;
}

test("uploading records dimensions/size, the library lists it, the picker reuses it without a duplicate, and delete removes it", async ({
  page,
}) => {
  const editor = await createContentEditor("e2ecmsmedia");
  await loginAsUser(page, editor);

  // A real, valid 1x1 PNG — image-size needs real header bytes to parse.
  const pngBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const fileName = `e2e-media-${Date.now()}.png`;

  await page.goto("/ops/cms/media");
  await page
    .getByLabel("File (JPEG, PNG, WebP, GIF, or PDF — up to 10 MB)")
    .setInputFiles({ name: fileName, mimeType: "image/png", buffer: Buffer.from(pngBase64, "base64") });
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByRole("status")).toContainText("Uploaded —");

  const row = await pool.query<{ id: string; width: number; height: number; content_type: string }>(
    `SELECT id, width, height, content_type FROM uploaded_files WHERE original_filename = $1`,
    [fileName],
  );
  expect(row.rowCount).toBe(1);
  expect(row.rows[0].width).toBe(1);
  expect(row.rows[0].height).toBe(1);
  expect(row.rows[0].content_type).toBe("image/png");

  await page.goto("/ops/cms/media");
  await expect(page.getByRole("cell", { name: fileName })).toBeVisible();
  await expect(page.getByText("1×1")).toBeVisible();

  // Reuse it from a *different* editor's picker — new page, new session,
  // nothing carried over except the file now living in the library.
  await page.goto("/ops/cms/pages/new");
  await page.getByRole("button", { name: "Browse existing" }).click();
  await expect(page.getByRole("dialog", { name: "Choose a previously uploaded file" })).toBeVisible();
  await page.getByRole("button", { name: new RegExp(fileName) }).click();

  await expect(page.locator("#content")).toHaveValue(new RegExp(`!\\[${fileName}\\]\\(.*\\)`));

  const afterReuse = await pool.query(`SELECT count(*) FROM uploaded_files WHERE original_filename = $1`, [
    fileName,
  ]);
  expect(Number(afterReuse.rows[0].count)).toBe(1);

  // Delete it from the library.
  await page.goto("/ops/cms/media");
  const libraryRow = page.locator("tr", { hasText: fileName });
  await libraryRow.getByRole("button", { name: "Delete" }).click();
  await libraryRow.getByRole("button", { name: "Confirm delete" }).click();
  await expect(page.getByRole("cell", { name: fileName })).toHaveCount(0);

  const afterDelete = await pool.query(`SELECT count(*) FROM uploaded_files WHERE id = $1`, [row.rows[0].id]);
  expect(Number(afterDelete.rows[0].count)).toBe(0);
});

test("a non-VOL_MKT/non-admin hitting /ops/cms/media is bounced to the dashboard", async ({ page }) => {
  const member = await createTestUser({ username: `e2ecmsmedianoauth${Date.now()}` });
  await loginAsUser(page, member);

  await page.goto("/ops/cms/media");
  await page.waitForURL("**/dashboard");
});
