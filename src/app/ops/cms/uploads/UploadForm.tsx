"use client";

import { useActionState } from "react";
import { uploadFileAction, type UploadFileState } from "./actions";

const initialState: UploadFileState = {};

export function UploadForm() {
  const [state, formAction, pending] = useActionState(uploadFileAction, initialState);

  return (
    <form action={formAction}>
      {state.error && <p role="alert">{state.error}</p>}
      {state.url && (
        <p role="status">
          Uploaded — <code>{state.url}</code>
        </p>
      )}

      <label htmlFor="file">File (JPEG, PNG, WebP, GIF, or PDF — up to 10 MB)</label>
      <input id="file" name="file" type="file" accept="image/jpeg,image/png,image/webp,image/gif,application/pdf" required />

      <button type="submit" disabled={pending}>
        {pending ? "Uploading…" : "Upload"}
      </button>
    </form>
  );
}
