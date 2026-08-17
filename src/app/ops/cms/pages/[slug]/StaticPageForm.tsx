"use client";

import { useActionState, useState } from "react";
import { updateStaticPageAction, type UpdateStaticPageState } from "../actions";
import { Markdown } from "@/components/Markdown";

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

  return (
    <form action={formAction}>
      <input type="hidden" name="slug" value={slug} />
      {state.error && <p role="alert">{state.error}</p>}

      <label htmlFor="title">Title</label>
      <input id="title" name="title" defaultValue={initialTitle} required />

      <label htmlFor="content">Content (Markdown)</label>
      <textarea
        id="content"
        name="content"
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
