"use client";

import { useActionState, useState } from "react";
import { deleteUploadedFileAction, type DeleteUploadedFileState } from "./actions";

export function DeleteFileButton({ fileId }: { fileId: string }) {
  const [state, formAction, pending] = useActionState<DeleteUploadedFileState, FormData>(
    deleteUploadedFileAction,
    {},
  );
  const [confirming, setConfirming] = useState(false);

  return (
    <div>
      {confirming ? (
        <form action={formAction}>
          <input type="hidden" name="fileId" value={fileId} />
          <button type="submit" disabled={pending}>
            Confirm delete
          </button>
        </form>
      ) : (
        <button type="button" onClick={() => setConfirming(true)}>
          Delete
        </button>
      )}
      {state.error && <p role="alert">{state.error}</p>}
    </div>
  );
}
