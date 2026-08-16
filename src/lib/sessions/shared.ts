// Design Doc §3.2.
export const SESSION_TYPES = ["L", "R", "G", "P", "S", "X", "Gallery", "Party"] as const;

// Matches JS Date.getDay() (0=Sunday..6=Saturday).
export const DAYS_OF_WEEK = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
] as const;

export const SLOTS = ["Morning", "Afternoon", "Evening"] as const;
export type Slot = (typeof SLOTS)[number];

/**
 * Canonical start/end time-of-day for each slot — matches slotFor's hour
 * boundaries (14, 18) below. Used wherever a new session needs a concrete
 * time derived from just a slot choice (the multi-week series slot picker).
 */
export const SLOT_TIMES: Record<Slot, { start: string; end: string }> = {
  Morning: { start: "10:00", end: "13:00" },
  Afternoon: { start: "14:00", end: "17:00" },
  Evening: { start: "18:00", end: "21:00" },
};

export function slotFor(date: Date): Slot {
  const hour = date.getHours();
  if (hour < 14) return "Morning";
  if (hour < 18) return "Afternoon";
  return "Evening";
}

export function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function dayIndex(gridStart: Date, date: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((startOfDay(date).getTime() - gridStart.getTime()) / msPerDay);
}

/**
 * Formats a Date as its LOCAL "YYYY-MM-DD" calendar day — deliberately not
 * `toISOString().slice(0, 10)`, which reads the UTC calendar day and would
 * silently shift by one for any server running in a positive UTC-offset
 * timezone (e.g. local midnight in UTC+10 is still the previous day in UTC).
 */
export function toDateOnly(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Parses a "YYYY-MM-DD" string as LOCAL midnight — the inverse of toDateOnly, avoiding the UTC-parsing behavior of `new Date("YYYY-MM-DD")`. */
export function parseDateOnly(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}
