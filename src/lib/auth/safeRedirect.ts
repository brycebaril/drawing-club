/** Only allow same-origin relative paths, to avoid an open-redirect via ?redirect=. */
export function safeRedirectTarget(target: string | null | undefined, fallback = "/dashboard"): string {
  if (!target) return fallback;
  if (!target.startsWith("/") || target.startsWith("//")) return fallback;
  return target;
}
