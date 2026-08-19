"use server";

import { requestPasswordReset } from "@/lib/auth/passwordReset";

export interface ForgotPasswordState {
  submitted?: boolean;
  error?: string;
}

export async function requestPasswordResetAction(
  _prevState: ForgotPasswordState,
  formData: FormData,
): Promise<ForgotPasswordState> {
  const identifier = String(formData.get("identifier") ?? "").trim();
  if (!identifier) {
    return { error: "Enter your username or email." };
  }

  await requestPasswordReset(identifier);

  // Always the same response regardless of whether a matching account
  // exists — requestPasswordReset deliberately doesn't report that back,
  // so this can't be used to enumerate registered usernames/emails.
  return { submitted: true };
}
