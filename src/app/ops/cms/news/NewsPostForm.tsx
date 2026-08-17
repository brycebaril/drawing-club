"use client";

import { useActionState, useState } from "react";
import { createNewsPostAction, updateNewsPostAction, type NewsPostFormState } from "./actions";
import { Markdown } from "@/components/Markdown";
import { slugify } from "@/lib/cms/slugify";

interface NewsPostFormProps {
  mode: "create" | "edit";
  postId?: string;
  initial?: {
    title: string;
    slug: string;
    excerpt: string;
    content: string;
    imageUrl: string;
    status: "Draft" | "Published";
    publishDate: string;
  };
}

const EMPTY = {
  title: "",
  slug: "",
  excerpt: "",
  content: "",
  imageUrl: "",
  status: "Draft" as const,
  publishDate: "",
};

export function NewsPostForm({ mode, postId, initial = EMPTY }: NewsPostFormProps) {
  const action = mode === "create" ? createNewsPostAction : updateNewsPostAction;
  const [state, formAction, pending] = useActionState<NewsPostFormState, FormData>(action, {});
  const [title, setTitle] = useState(initial.title);
  const [slug, setSlug] = useState(initial.slug);
  const [slugTouched, setSlugTouched] = useState(mode === "edit");
  const [content, setContent] = useState(initial.content);

  return (
    <form action={formAction}>
      {mode === "edit" && <input type="hidden" name="postId" value={postId} />}
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

      <label htmlFor="slug">Slug</label>
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

      <label htmlFor="excerpt">Excerpt (optional)</label>
      <input id="excerpt" name="excerpt" defaultValue={initial.excerpt} />

      <label htmlFor="imageUrl">Image URL (optional)</label>
      <input id="imageUrl" name="imageUrl" type="url" defaultValue={initial.imageUrl} />

      <label htmlFor="publishDate">Publish date</label>
      <input id="publishDate" name="publishDate" type="date" defaultValue={initial.publishDate} required />

      <fieldset>
        <legend>Status</legend>
        <label>
          <input type="radio" name="status" value="Draft" defaultChecked={initial.status === "Draft"} />
          Draft
        </label>
        <label>
          <input type="radio" name="status" value="Published" defaultChecked={initial.status === "Published"} />
          Published
        </label>
      </fieldset>

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
        {mode === "create" ? "Create post" : "Save"}
      </button>

      <h3>Preview</h3>
      <Markdown content={content} />
    </form>
  );
}
