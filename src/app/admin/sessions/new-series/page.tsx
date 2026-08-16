import { pool } from "@/lib/db/pool";
import { AdminNav } from "@/components/AdminNav";
import { getSettingNumber } from "@/lib/settings";
import { slotFor, startOfDay, dayIndex, toDateOnly, parseDateOnly } from "@/lib/sessions/shared";
import { SeriesSlotPickerForm } from "./SeriesSlotPickerForm";

const WINDOW_DAYS = 56;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

interface OccupiedRow {
  start_time: Date;
  session_type: string;
}

export default async function NewSeriesPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string }>;
}) {
  const { start } = await searchParams;
  const parsedStart = start ? parseDateOnly(start) : new Date();
  const gridStart = startOfDay(Number.isNaN(parsedStart.getTime()) ? new Date() : parsedStart);
  const gridEnd = new Date(gridStart.getTime() + WINDOW_DAYS * ONE_DAY_MS);

  const result = await pool.query<OccupiedRow>(
    `SELECT start_time, session_type FROM sessions
     WHERE status = 'Scheduled' AND start_time >= $1 AND start_time < $2`,
    [gridStart, gridEnd],
  );

  const occupied: Record<string, string> = {};
  for (const row of result.rows) {
    const date = new Date(row.start_time);
    occupied[`${dayIndex(gridStart, date)}:${slotFor(date)}`] = row.session_type;
  }

  const days = Array.from({ length: WINDOW_DAYS }, (_, i) => new Date(gridStart.getTime() + i * ONE_DAY_MS));

  const defaultSeatCount = await getSettingNumber("SESSION_DEFAULT_CAPACITY");

  const prevStart = toDateOnly(new Date(gridStart.getTime() - WINDOW_DAYS * ONE_DAY_MS));
  const nextStart = toDateOnly(new Date(gridStart.getTime() + WINDOW_DAYS * ONE_DAY_MS));

  return (
    <main>
      <AdminNav />
      <h1>Create a multi-week series</h1>
      <p>
        Pick any open slots below — consecutive or not, any week — then group them into a series.
        Each checked slot becomes one session, sharing the numbered seat map you set below.
        Already-booked slots are shown but can&apos;t be picked.
      </p>
      <p>
        <a href={`?start=${prevStart}`}>&larr; Previous {WINDOW_DAYS / 7} weeks</a>
        {" · "}
        <a href={`?start=${nextStart}`}>Next {WINDOW_DAYS / 7} weeks &rarr;</a>
      </p>
      <SeriesSlotPickerForm days={days} occupied={occupied} defaultSeatCount={defaultSeatCount} />
    </main>
  );
}
