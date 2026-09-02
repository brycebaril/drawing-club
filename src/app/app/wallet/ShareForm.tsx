"use client";

import { useState, useActionState } from "react";
import { sharePassAction, inviteMemberByEmailAction, type SharePassState } from "./actions";
import { MemberPicker } from "@/components/MemberPicker";

const initialState: SharePassState = {};

export function ShareForm({
  passId,
  disabled,
  senderUserId,
}: {
  passId: string;
  disabled: boolean;
  senderUserId: string;
}) {
  const [state, formAction, pending] = useActionState(sharePassAction, initialState);
  const [recipientId, setRecipientId] = useState<string | null>(null);

  return (
    <form action={formAction}>
      <input type="hidden" name="passId" value={passId} />
      {state.error && <p role="alert">{state.error}</p>}
      <MemberPicker
        name="recipientUserId"
        mode="existing-or-invite"
        placeholder="Search by name or username"
        excludeUserId={senderUserId}
        onSelectionChange={setRecipientId}
        onInvite={(email) => {
          const formData = new FormData();
          formData.set("email", email);
          return inviteMemberByEmailAction({}, formData);
        }}
      />
      <input name="note" placeholder="Note (optional)" />
      <button type="submit" disabled={pending || disabled || !recipientId}>
        {pending ? "Sharing…" : "Share"}
      </button>
    </form>
  );
}
