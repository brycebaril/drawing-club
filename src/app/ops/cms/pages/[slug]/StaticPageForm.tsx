"use client";

import { useActionState, useState } from "react";
import { updateStaticPageAction, type UpdateStaticPageState } from "../actions";
import { Markdown } from "@/components/Markdown";
import { MarkdownHelpModal } from "@/components/cms/MarkdownHelpModal";
import { useMarkdownFileUpload } from "@/components/cms/useMarkdownFileUpload";

export function StaticPageForm({
  slug,
  initialTitle,
  initialContent,
}: {
  slug: string;
  initialTitle: string;
  initialContent: string;
}) {
  const [state, formAction, pending] = useActionState<UpdateStaticPageState, FormData>(
    updateStaticPageAction,
    {},
  );
  const [content, setContent] = useState(initialContent);
  const { textareaRef, uploadState, uploading, handleFileChange } = useMarkdownFileUpload(content, setContent);

  return (
    <form action={formAction}>
      <input type="hidden" name="slug" value={slug} />
      {state.error && <p role="alert">{state.error}</p>}

      <label htmlFor="title">Title</label>
      <input id="title" name="title" defaultValue={initialTitle} required />

      <p>
        <MarkdownHelpModal />
      </p>

      <label htmlFor="content">Content (Markdown)</label>
      <label htmlFor="contentFile">Upload an image or document to insert it here</label>
      <input
        id="contentFile"
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
        onChange={handleFileChange}
        disabled={uploading}
      />
      {uploading && <p role="status">Uploading…</p>}
      {uploadState.error && <p role="alert">{uploadState.error}</p>}
      <textarea
        id="content"
        name="content"
        ref={textareaRef}
        rows={16}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        required
      />

      <button type="submit" disabled={pending}>
        Save
      </button>

      <h3>Preview</h3>
      <Markdown content={content} />
    </form>
  );
}
