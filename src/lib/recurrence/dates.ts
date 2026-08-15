/**
 * Every date matching `dayOfWeek` (0=Sunday..6=Saturday, matching JS
 * Date.getDay()) within [rangeStart, rangeEnd] inclusive. Pure — no DB,
 * no "now" — so callers control exactly what range gets generated.
 */
export function computeOccurrenceDates(
  dayOfWeek: number,
  rangeStart: Date,
  rangeEnd: Date,
): Date[] {
  const dates: Date[] = [];

  const cursor = new Date(rangeStart);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date(rangeEnd);
  end.setHours(0, 0, 0, 0);

  // Advance to the first matching day of week, then step by exactly a week.
  const daysUntilFirstMatch = (dayOfWeek - cursor.getDay() + 7) % 7;
  cursor.setDate(cursor.getDate() + daysUntilFirstMatch);

  while (cursor <= end) {
    dates.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 7);
  }

  return dates;
}

/** Combines a calendar date with a "HH:MM:SS" time-of-day into one Date. */
export function combineDateAndTime(date: Date, timeOfDay: string): Date {
  const [hours, minutes, seconds] = timeOfDay.split(":").map(Number);
  const combined = new Date(date);
  combined.setHours(hours, minutes, seconds ?? 0, 0);
  return combined;
}
