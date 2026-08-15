/**
 * Design Doc §6.1 / §12.1: a booking is cancelable only strictly before
 * `cutoffHours` prior to the session's start time.
 */
export function isCancellable(
  sessionStartTime: Date,
  cutoffHours: number,
  now: Date = new Date(),
): boolean {
  const cutoff = new Date(sessionStartTime.getTime() - cutoffHours * 60 * 60 * 1000);
  return now < cutoff;
}
