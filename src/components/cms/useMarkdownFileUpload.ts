"use client";

import { type ChangeEvent, useRef, useState, useTransition } from "react";
import { uploadFileAction, type UploadFileState } from "@/app/ops/cms/uploads/actions";
import { markdownSnippetForUpload } from "@/lib/uploads/markdownSnippet";

/**
 * Shared by StaticPageForm and NewStaticPageForm — both are a single
 * Markdown textarea with no separate "image URL" field the way
 * NewsPostForm has, so an uploaded file has nowhere to land except inserted
 * directly into the content at the cursor. Reuses the same uploadFileAction
 * (S3-backed, local-disk fallback in dev/CI — src/lib/uploads/storage.ts)
 * NewsPostForm's inline uploader and the standalone /ops/cms/uploads page
 * already call.
 */
export function useMarkdownFileUpload(content: string, setContent: (value: string) => void) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [uploadState, setUploadState] = useState<UploadFileState>({});
  const [uploading, startUpload] = useTransition();

  /**
   * Inserts a Markdown snippet for an already-known file (fresh upload or a
   * reused pick from MediaPickerModal.tsx) at the textarea's cursor —
   * factored out so both paths share one cursor-insertion implementation.
   */
  function insertSnippet(file: { name: string; type: string }, url: string) {
    const snippet = markdownSnippetForUpload(file, url);
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? content.length;
    const end = textarea?.selectionEnd ?? content.length;
    const next = `${content.slice(0, start)}${snippet}${content.slice(end)}`;
    setContent(next);

    // Textarea value updates on the next render; wait a tick before
    // restoring focus/cursor, or setSelectionRange lands on stale text.
    requestAnimationFrame(() => {
      if (!textarea) return;
      textarea.focus();
      const cursor = start + snippet.length;
      textarea.setSelectionRange(cursor, cursor);
    });
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const formData = new FormData();
    formData.set("file", file);
    startUpload(async () => {
      const result = await uploadFileAction({}, formData);
      setUploadState(result);
      if (result.url) insertSnippet(file, result.url);
    });
  }

  return { textareaRef, uploadState, uploading, handleFileChange, insertSnippet };
}
