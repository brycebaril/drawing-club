// Extracted from registerAction, which used to keep its own private copy —
// now also needed by MemberPicker's client-side "does this look like an
// email" check and inviteMemberByEmailAction's server-side validation.
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value);
}
