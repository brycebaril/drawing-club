"use client";

import { useActionState, useState } from "react";
import { createStaticPageAction, type CreateStaticPageState } from "../actions";
import { Markdown } from "@/components/Markdown";
import { slugify } from "@/lib/cms/slugify";

export function NewStaticPageForm() {
  const [state, formAction, pending] = useActionState<CreateStaticPageState, FormData>(
    createStaticPageAction,
    {},
  );
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [content, setContent] = useState("");

  return (
    <form action={formAction}>
      {state.error && <p role="alert">{state.error}</p>}

      <label htmlFor="title">Title</label>
      <input
        id="title"
        name="title"
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
          if (!slugTouched) setSlug(slugify(e.target.value));
        }}
        required
      />

      <label htmlFor="slug">Slug — will be reachable at /pages/{slug || "…"}</label>
      <input
        id="slug"
        name="slug"
        value={slug}
        onChange={(e) => {
          setSlugTouched(true);
          setSlug(e.target.value);
        }}
        required
      />

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
        Create page
      </button>

      <h3>Preview</h3>
      <Markdown content={content} />
    </form>
  );
}
