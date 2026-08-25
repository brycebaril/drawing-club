"use client";

import { useEffect, useState } from "react";
import { Markdown } from "@/components/Markdown";

const HELP_CONTENT = `
## Formatting

This editor renders [GitHub-flavored Markdown](https://github.github.com/gfm/) — the same renderer used on the
live page, so what you see in Preview is what visitors get.

| You type | You get |
| --- | --- |
| \`# Heading\`, \`## Subheading\` | Section headings |
| \`**bold**\`, \`*italic*\` | **bold**, *italic* |
| \`- item\` | Bullet list |
| \`1. item\` | Numbered list |
| \`[link text](https://example.com)\` | A link |
| \`![alt text](https://example.com/image.png)\` | An embedded image |
| \`\\| A \\| B \\|\` rows, header separated by \`\\| --- \\| --- \\|\` | A table |

## Adding an image or document

Use the **upload** control above the content box: pick a file (JPEG, PNG, WebP, GIF, or a PDF), and once it
finishes, an image link is inserted into the content for you (a PDF or other document gets inserted as a plain
link instead of an image, since it can't be shown inline).

You can also upload from [the standalone uploads page](/ops/cms/uploads) and paste the resulting URL in
yourself — useful if you want to reuse one file across several pages, or link to a document without embedding
it right where you uploaded it. Either way the file lands in the same place (S3 in a deployed environment, a
local folder in dev) — there's no difference between the two once it's uploaded.
`.trim();

export function MarkdownHelpModal() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <>
      <button type="button" className="link-button" onClick={() => setOpen(true)}>
        Formatting &amp; images help
      </button>

      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div
            className="modal-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Formatting and images help"
            onClick={(e) => e.stopPropagation()}
          >
            <button type="button" className="modal-close" aria-label="Close" onClick={() => setOpen(false)}>
              ×
            </button>
            <Markdown content={HELP_CONTENT} />
          </div>
        </div>
      )}
    </>
  );
}
