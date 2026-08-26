"use client";

import { useActionState, useState, useTransition } from "react";
import { createNewsPostAction, updateNewsPostAction, type NewsPostFormState } from "./actions";
import { uploadFileAction, type UploadFileState } from "../uploads/actions";
import { Markdown } from "@/components/Markdown";
import { MarkdownHelpModal } from "@/components/cms/MarkdownHelpModal";
import { MediaPickerModal } from "@/components/cms/MediaPickerModal";
import { useMarkdownFileUpload } from "@/components/cms/useMarkdownFileUpload";
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
  const [imageUrl, setImageUrl] = useState(initial.imageUrl);
  const [uploadState, setUploadState] = useState<UploadFileState>({});
  const [uploading, startUpload] = useTransition();
  const {
    textareaRef: contentTextareaRef,
    uploadState: contentUploadState,
    uploading: contentUploading,
    handleFileChange: handleContentFileChange,
    insertSnippet,
  } = useMarkdownFileUpload(content, setContent);

  function handleImageFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const uploadFormData = new FormData();
    uploadFormData.set("file", file);
    startUpload(async () => {
      const result = await uploadFileAction({}, uploadFormData);
      setUploadState(result);
      if (result.url) setImageUrl(result.url);
    });
  }

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
      <input
        id="imageUrl"
        name="imageUrl"
        type="url"
        value={imageUrl}
        onChange={(e) => setImageUrl(e.target.value)}
      />
      <label htmlFor="imageFile">Or upload an image</label>
      <input
        id="imageFile"
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        onChange={handleImageFileChange}
        disabled={uploading}
      />
      <MediaPickerModal onSelect={(file) => setImageUrl(file.url)} />
      {uploading && <p role="status">Uploading…</p>}
      {uploadState.error && <p role="alert">{uploadState.error}</p>}

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

      <div>
        <MarkdownHelpModal />
      </div>

      <label htmlFor="content">Content (Markdown)</label>
      <label htmlFor="contentFile">Upload an image or document to insert it here</label>
      <input
        id="contentFile"
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
        onChange={handleContentFileChange}
        disabled={contentUploading}
      />
      <MediaPickerModal
        onSelect={(file) =>
          insertSnippet({ name: file.originalFilename ?? file.key, type: file.contentType }, file.url)
        }
      />
      {contentUploading && <p role="status">Uploading…</p>}
      {contentUploadState.error && <p role="alert">{contentUploadState.error}</p>}
      <textarea
        id="content"
        name="content"
        ref={contentTextareaRef}
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
