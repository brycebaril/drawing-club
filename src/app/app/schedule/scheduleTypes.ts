import type { SessionStatus } from "@/lib/booking/sessionStatus";

export interface SessionTypeInfo {
  label: string;
  display: string;
  textClass: string;
}

// Each session_type gets a distinct hue from the schedule's own warm,
// muted category palette (tailwind.css's --color-type-* tokens) — analogous
// to the site's terracotta accent, not Tailwind's stock blue/purple/indigo.
export const SESSION_TYPE_INFO: Record<string, SessionTypeInfo> = {
  L: { label: "Long Pose", display: "L", textClass: "text-type-l" },
  R: { label: "Regular", display: "R", textClass: "text-type-r" },
  G: { label: "Gesture", display: "G", textClass: "text-type-g" },
  P: { label: "Portrait", display: "P", textClass: "text-type-p" },
  S: { label: "Special", display: "S", textClass: "text-type-s" },
  X: { label: "Extra Long Pose", display: "X", textClass: "text-type-x" },
  Gallery: { label: "Gallery Hours", display: "Ga", textClass: "text-type-gallery" },
  Party: { label: "Party", display: "Pa", textClass: "text-type-party" },
};

export function sessionTypeInfo(type: string): SessionTypeInfo {
  return SESSION_TYPE_INFO[type] ?? { label: type, display: type.slice(0, 2), textClass: "text-ink" };
}

export interface GridCellData {
  id: string;
  sessionType: string;
  status: SessionStatus;
  needsModel: boolean;
}

/** Whether the cell should render as a normal, clickable session (vs. dimmed/disabled). */
export function isCellInteractive(status: SessionStatus): boolean {
  return status !== "TooFarFuture";
}
