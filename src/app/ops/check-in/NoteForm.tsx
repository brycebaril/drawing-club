"use client";

import { useActionState, useEffect, useRef } from "react";
import { postSessionNoteAction, type PostNoteState } from "@/lib/checkin/actions";

const initialState: PostNoteState = {};

export function NoteForm({ sessionId, onPosted }: { sessionId: string; onPosted: () => void }) {
  const [state, formAction, pending] = useActionState(postSessionNoteAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const wasPending = useRef(false);

  // Success is "was pending, now isn't, and there's no error" — there's no
  // separate success flag on PostNoteState, so a state transition is the
  // only signal. Clears the textarea and asks the parent card to refetch
  // immediately (see SessionRosterCard) instead of waiting up to a full
  // poll interval to see a note you just posted yourself.
  useEffect(() => {
    if (wasPending.current && !pending && !state.error) {
      formRef.current?.reset();
      onPosted();
    }
    wasPending.current = pending;
  }, [pending, state.error, onPosted]);

  // Prefixed per session, matching this codebase's established fix for the
  // exact same bug on /admin/users/[id] — the overview page renders one
  // NoteForm per upcoming session, and a duplicate id across forms silently
  // breaks both label association and getByLabel targeting.
  const contentId = `note-content-${sessionId}`;

  return (
    <form ref={formRef} action={formAction}>
      <input type="hidden" name="sessionId" value={sessionId} />
      {state.error && <p role="alert">{state.error}</p>}
      <label htmlFor={contentId}>Add a note</label>
      <textarea id={contentId} name="content" rows={3} />
      <button type="submit" disabled={pending}>
        {pending ? "Posting…" : "Post note"}
      </button>
    </form>
  );
}
