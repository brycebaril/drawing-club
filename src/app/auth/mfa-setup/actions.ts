"use server";

import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { confirmMfaEnrollment } from "@/lib/auth/mfaEnrollment";

export interface MfaSetupState {
  error?: string;
}

export async function confirmMfaAction(
  _prevState: MfaSetupState,
  formData: FormData,
): Promise<MfaSetupState> {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/auth/login?redirect=/auth/mfa-setup");
  }

  const code = String(formData.get("code") ?? "").trim();
  const ok = await confirmMfaEnrollment(session.user.id, code);
  if (!ok) {
    return { error: "Invalid code. Try again." };
  }

  redirect("/dashboard");
}
