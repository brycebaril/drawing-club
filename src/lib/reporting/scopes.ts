/** Shared scope taxonomy — one per dashboard section and one per /api/stats/* route. */
export const REPORT_SCOPES = ["users", "attendance", "revenue", "audit_logs", "flags", "passes", "members"] as const;

/** Every /api/stats/* route's requireApiKeyScope call is typed against this, not a plain string. */
export type ReportScope = (typeof REPORT_SCOPES)[number];
