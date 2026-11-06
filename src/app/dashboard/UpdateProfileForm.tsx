"use client";

import { useActionState } from "react";
import { updateProfileAction, updateEmailAction, type ActionState } from "./actions";

const initialState: ActionState = {};

export function UpdateProfileForm({ displayName, username }: { displayName: string; username: string }) {
  const [state, formAction, pending] = useActionState(updateProfileAction, initialState);

  return (
    <form action={formAction}>
      <div>
        <label htmlFor="profile-display-name">Display name</label>
        <input id="profile-display-name" name="displayName" type="text" required defaultValue={displayName} />
      </div>
      <div>
        <label htmlFor="profile-username">Username</label>
        <input
          id="profile-username"
          name="username"
          type="text"
          required
          minLength={3}
          maxLength={32}
          defaultValue={username}
        />
      </div>
      {state.error && <p role="alert">{state.error}</p>}
      <button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save profile"}
      </button>
    </form>
  );
}

export function UpdateEmailForm({ email, emailVerified }: { email: string; emailVerified: boolean }) {
  const [state, formAction, pending] = useActionState(updateEmailAction, initialState);

  return (
    <form action={formAction}>
      <div>
        <label htmlFor="profile-email">Email</label>
        <input id="profile-email" name="email" type="email" required defaultValue={email} />
      </div>
      <p>{emailVerified ? "Verified." : "Not yet verified."}</p>
      <p>Changing your email will require re-verifying it before you can book or buy tickets.</p>
      {state.error && <p role="alert">{state.error}</p>}
      <button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Change email"}
      </button>
    </form>
  );
}
