/**
 * A PDF (or any non-image upload) can't be shown inline, so it gets a plain
 * link rather than an image tag — otherwise every renderer here (this app's
 * own preview included) would just show a broken image icon.
 */
export function markdownSnippetForUpload(file: { name: string; type: string }, url: string): string {
  return file.type.startsWith("image/") ? `![${file.name}](${url})` : `[${file.name}](${url})`;
}
