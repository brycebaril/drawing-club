import type { PoolClient } from "pg";
import { combineDateAndTime } from "@/lib/recurrence/dates";
import { SLOTS, SLOT_TIMES, slotFor, parseDateOnly, type Slot } from "./shared";
import { ORG_TIMEZONE } from "@/lib/org";

export interface ParsedSlot {
  date: Date;
  slot: Slot;
  startTime: Date;
  endTime: Date;
}

export type ParseSlotsResult = { ok: true; slots: ParsedSlot[] } | { ok: false; error: string };

/** Parses and validates raw `"YYYY-MM-DD|SlotName"` checkbox values from the slot-picker form, sorted by start time. */
export function parseSlotValues(slotValues: string[]): ParseSlotsResult {
  if (slotValues.length === 0) {
    return { ok: false, error: "Pick at least one date/slot." };
  }

  const parsedSlots: ParsedSlot[] = [];
  for (const value of slotValues) {
    const [dateStr, slotName] = value.split("|");
    if (!(SLOTS as readonly string[]).includes(slotName)) {
      return { ok: false, error: `Invalid slot "${slotName}".` };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return { ok: false, error: `Invalid date "${dateStr}".` };
    }
    const date = parseDateOnly(dateStr);
    if (Number.isNaN(date.getTime())) {
      return { ok: false, error: `Invalid date "${dateStr}".` };
    }
    const times = SLOT_TIMES[slotName as Slot];
    parsedSlots.push({
      date,
      slot: slotName as Slot,
      startTime: combineDateAndTime(date, times.start),
      endTime: combineDateAndTime(date, times.end),
    });
  }
  parsedSlots.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

  return { ok: true, slots: parsedSlots };
}

/**
 * Re-validates each slot against concurrent bookings within an open
 * transaction (the picker's occupied-slot display could be stale by the
 * time a submission lands) — returns an error message on the first
 * conflict found, or null if every slot is still open.
 */
export async function checkSlotConflicts(client: PoolClient, slots: ParsedSlot[]): Promise<string | null> {
  for (const slot of slots) {
    const dayStart = new Date(slot.date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const existing = await client.query<{ start_time: Date; session_type: string }>(
      `SELECT start_time, session_type FROM sessions
       WHERE status = 'Scheduled' AND start_time >= $1 AND start_time < $2
       FOR UPDATE`,
      [dayStart, dayEnd],
    );
    const conflict = existing.rows.find((row) => slotFor(new Date(row.start_time)) === slot.slot);
    if (conflict) {
      return `${slot.date.toLocaleDateString("en-US", { timeZone: ORG_TIMEZONE })} (${slot.slot}) was just booked by something else (${conflict.session_type}) — reload and try again.`;
    }
  }
  return null;
}
