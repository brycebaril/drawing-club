"use server";

import { consumeResetToken } from "@/lib/auth/passwordReset";

export interface ResetPasswordState {
  error?: string;
  success?: boolean;
}

export async function resetPasswordAction(
  _prevState: ResetPasswordState,
  formData: FormData,
): Promise<ResetPasswordState> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (!token) {
    return { error: "Missing reset token." };
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }
  if (password !== confirmPassword) {
    return { error: "Passwords don't match." };
  }

  const result = await consumeResetToken(token, password);
  switch (result) {
    case "reset":
      return { success: true };
    case "already-used":
      return { error: "This reset link has already been used." };
    case "expired":
      return { error: "This reset link has expired. Request a new one." };
    case "invalid":
      return { error: "This reset link is invalid." };
  }
}
