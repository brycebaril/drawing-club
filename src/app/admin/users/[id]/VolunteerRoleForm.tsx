"use client";

import { useActionState } from "react";
import { assignVolunteerRoleAction, type ActionState } from "./actions";

const initialState: ActionState = {};

export function VolunteerRoleForm({
  userId,
  availableRoles,
  labels,
}: {
  userId: string;
  availableRoles: string[];
  labels: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState(assignVolunteerRoleAction, initialState);

  return (
    <form action={formAction}>
      <input type="hidden" name="userId" value={userId} />
      <label htmlFor="role">Assign a role</label>
      <select id="role" name="role" defaultValue={availableRoles[0]}>
        {availableRoles.map((role) => (
          <option key={role} value={role}>
            {labels[role] ?? role}
          </option>
        ))}
      </select>
      {state.error && <p role="alert">{state.error}</p>}
      <button type="submit" disabled={pending}>
        {pending ? "Assigning…" : "Assign role"}
      </button>
    </form>
  );
}
