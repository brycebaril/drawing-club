import type { ReactNode } from "react";

export type BadgeTone = "admin" | "volunteer" | "member" | "neutral" | "active" | "suspended" | "banned";

export function Badge({ tone, children }: { tone: BadgeTone; children: ReactNode }) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

/** users.status -> badge tone. */
export function statusTone(status: string): BadgeTone {
  if (status === "Suspended") return "suspended";
  if (status === "Banned") return "banned";
  return "active";
}

/** Derived MBR/ACCT tier (never a stored flag — see CLAUDE.md) -> badge tone. */
export function tierTone(isMember: boolean): BadgeTone {
  return isMember ? "member" : "neutral";
}

/** A mapped role string (e.g. "ADMIN", "VOL_HOST") -> badge tone. Every volunteer sub-role shares one tone, distinguished by label text only. */
export function roleTone(role: string): BadgeTone {
  return role === "ADMIN" ? "admin" : "volunteer";
}
