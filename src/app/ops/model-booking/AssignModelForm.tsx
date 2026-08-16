"use client";

import { useActionState } from "react";
import { assignModelAction, type AssignModelState } from "./actions";

const initialState: AssignModelState = {};

export function AssignModelForm({
  sessionId,
  models,
}: {
  sessionId: string;
  models: { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState(assignModelAction, initialState);

  return (
    <form action={formAction}>
      <input type="hidden" name="sessionId" value={sessionId} />
      {state.error && <p role="alert">{state.error}</p>}
      <select name="modelId" defaultValue="" required>
        <option value="" disabled>
          Choose a model
        </option>
        {models.map((model) => (
          <option key={model.id} value={model.id}>
            {model.name}
          </option>
        ))}
      </select>
      <input name="note" placeholder="Note for the host (optional)" />
      <button type="submit" disabled={pending}>
        {pending ? "Assigning…" : "Assign & notify host"}
      </button>
    </form>
  );
}
