"use client";

import { useActionState } from "react";
import { updateSettingAction, type UpdateSettingState } from "./actions";
import type { SettingDataType } from "@/lib/settingsValidation";

export function SettingForm({
  settingKey,
  dataType,
  value,
  description,
}: {
  settingKey: string;
  dataType: SettingDataType;
  value: string;
  description: string | null;
}) {
  const [state, formAction, pending] = useActionState<UpdateSettingState, FormData>(updateSettingAction, {});
  // Prefixed per-row so 15+ rows on one page never collide (this app hit
  // and documented the exact bug from reusing an id across two forms once —
  // see CLAUDE.md's Phase 4 notes).
  const fieldId = `value-${settingKey}`;

  return (
    <form action={formAction}>
      <input type="hidden" name="key" value={settingKey} />
      {/* No hidden dataType field — the server re-derives it from the DB row itself, never trusts the client for it. */}
      <label htmlFor={fieldId}>{settingKey}</label>
      {dataType === "Boolean" ? (
        <input id={fieldId} name="value" type="checkbox" defaultChecked={value === "true"} />
      ) : (
        // Plain text, not type="number" — a number input's native value
        // sanitization silently empties an invalid string before it ever
        // reaches the server, which would make server-side validation
        // untestable (and unreachable for real invalid input at all).
        // Server-side validateSettingValue is the actual enforced boundary.
        <input id={fieldId} name="value" type="text" defaultValue={value} />
      )}
      <button type="submit" disabled={pending}>
        Save
      </button>
      {state.error && <span role="alert">{state.error}</span>}
      {description && <p>{description}</p>}
    </form>
  );
}
