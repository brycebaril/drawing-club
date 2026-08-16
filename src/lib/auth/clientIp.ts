/**
 * Best-effort client IP extraction; null locally where no proxy sets these.
 * Takes Headers rather than a full Request so it works from a Server Action
 * (via next/headers's headers()) as well as an API route/Auth.js's
 * authorize() (both already had a Headers-compatible `request.headers`).
 */
export function getClientIp(headers: Headers): string | null {
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  return headers.get("x-real-ip");
}
