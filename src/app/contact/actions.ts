"use server";

import { getSettingString } from "@/lib/settings";
import { sendEmail } from "@/lib/email/sender";

export interface ContactFormState {
  error?: string;
  success?: boolean;
}

/**
 * Public, unauthenticated form — no rate-limit table or CAPTCHA this phase
 * (kept out of scope deliberately, see CLAUDE.md's CMS notes). The
 * "company" field is a honeypot: hidden from real visitors via CSS, so a
 * filled-in value means a bot filled every field. We report success without
 * actually sending, so the bot doesn't learn the trap didn't work.
 */
export async function sendContactMessageAction(
  _prevState: ContactFormState,
  formData: FormData,
): Promise<ContactFormState> {
  const honeypot = String(formData.get("company") ?? "");
  if (honeypot) {
    return { success: true };
  }

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const message = String(formData.get("message") ?? "").trim();
  if (!name || !email || !message) {
    return { error: "Name, email, and message are all required." };
  }

  const recipient = await getSettingString("CONTACT_FORM_RECIPIENT_EMAIL");
  if (!recipient) {
    return { error: "Unable to send your message right now. Please try again later." };
  }

  await sendEmail({
    to: recipient,
    subject: `Contact form message from ${name}`,
    body: `From: ${name} <${email}>\n\n${message}`,
  });

  return { success: true };
}
