"use client";

import { useActionState } from "react";
import { postSessionNoteAction, type PostNoteState } from "./actions";

const initialState: PostNoteState = {};

export function NoteForm({ sessionId }: { sessionId: string }) {
  const [state, formAction, pending] = useActionState(postSessionNoteAction, initialState);

  return (
    <form action={formAction}>
      <input type="hidden" name="sessionId" value={sessionId} />
      {state.error && <p role="alert">{state.error}</p>}
      <label htmlFor="note-content">Add a note</label>
      <textarea id="note-content" name="content" rows={3} />
      <button type="submit" disabled={pending}>
        {pending ? "Posting…" : "Post note"}
      </button>
    </form>
  );
}
