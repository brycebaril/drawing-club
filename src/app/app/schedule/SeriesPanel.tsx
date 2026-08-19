import { pool } from "@/lib/db/pool";
import { getSettingNumber } from "@/lib/settings";
import { isCancellable } from "@/lib/cancellation";
import { computeSeatGrid } from "@/lib/series/seatStatus";
import { bookSeriesSeatAction, cancelSeriesSeatDateAction } from "./actions";

interface SeriesInfo {
  id: string;
  name: string;
  seat_count: number;
}

interface SeriesSessionRow {
  id: string;
  start_time: Date;
  status: string;
}

interface ReservationRow {
  session_id: string;
  seat_number: number;
  user_id: string;
}

/**
 * Design Doc §6.5's numbered-seat booking flow: a member picks one open seat
 * for the series, then checks off which of that seat's still-open dates to
 * reserve. One seat per member per series (bookSeriesSeat enforces this
 * server-side too) — once a member holds a seat, this panel skips straight
 * to it rather than offering the seat list again.
 */
export async function SeriesPanel({
  seriesId,
  clickedSessionId,
  viewerId,
  selectedSeat,
  bookingError,
}: {
  seriesId: string;
  clickedSessionId: string;
  viewerId: string;
  selectedSeat: number | null;
  bookingError?: string;
}) {
  const seriesResult = await pool.query<SeriesInfo>(`SELECT id, name, seat_count FROM series WHERE id = $1`, [
    seriesId,
  ]);
  if (seriesResult.rowCount === 0) return null;
  const series = seriesResult.rows[0];

  const sessionsResult = await pool.query<SeriesSessionRow>(
    `SELECT id, start_time, status FROM sessions WHERE series_id = $1 AND status = 'Scheduled' ORDER BY start_time`,
    [seriesId],
  );
  const sessionIds = sessionsResult.rows.map((r) => r.id);

  const reservationsResult = sessionIds.length
    ? await pool.query<ReservationRow>(
        `SELECT session_id, seat_number, user_id FROM seat_reservations WHERE session_id = ANY($1::uuid[])`,
        [sessionIds],
      )
    : { rows: [] as ReservationRow[] };

  const grid = computeSeatGrid({
    sessions: sessionsResult.rows.map((r) => ({
      sessionId: r.id,
      startTime: new Date(r.start_time),
      status: r.status,
    })),
    reservations: reservationsResult.rows.map((r) => ({
      sessionId: r.session_id,
      seatNumber: r.seat_number,
      userId: r.user_id,
    })),
    seatCount: series.seat_count,
    viewerId,
  });

  const viewerRow = grid.find((row) => row.status === "UserReserved");
  const chosenRow = viewerRow ?? (selectedSeat ? grid.find((row) => row.seatNumber === selectedSeat) : undefined);

  const cutoffHours = await getSettingNumber("CANCELLATION_CUTOFF_HOURS");

  return (
    <div className="p-6">
      <h2 className="text-xl font-bold text-ink">{series.name} — numbered seats</h2>
      {bookingError && (
        <p role="alert" className="mt-4 rounded-lg border border-warn-line bg-warn-bg p-3 text-sm font-medium text-warn">
          Couldn&apos;t complete that: {bookingError}
        </p>
      )}

      {!chosenRow ? (
        <>
          <p className="mt-4 text-sm text-ink-soft">Pick a seat to see which dates are open:</p>
          <ul className="mt-3 space-y-1.5">
            {grid.map((row) => (
              <li key={row.seatNumber} className="text-sm">
                {row.status === "FullyReserved" ? (
                  <span className="text-ink-soft">Seat {row.seatNumber}: fully reserved</span>
                ) : (
                  <a
                    href={`?session_id=${clickedSessionId}&seat=${row.seatNumber}`}
                    className="font-medium text-brand hover:text-brand-strong hover:underline"
                  >
                    Seat {row.seatNumber} (
                    {row.status === "FullSeriesAvailable" ? "all dates open" : "some dates open"})
                  </a>
                )}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <p className="mt-4 text-sm font-semibold text-ink">Seat {chosenRow.seatNumber}</p>
          <form action={bookSeriesSeatAction} className="mt-2">
            <input type="hidden" name="seriesId" value={series.id} />
            <input type="hidden" name="clickedSessionId" value={clickedSessionId} />
            <input type="hidden" name="seatNumber" value={chosenRow.seatNumber} />
            <div className="table-scroll">
              <table>
              <tbody>
                {chosenRow.cells.map((cell) => (
                  <tr key={cell.sessionId}>
                    <td>{new Date(cell.startTime).toLocaleString()}</td>
                    <td>
                      {cell.state === "Open" && (
                        <label>
                          <input type="checkbox" name="sessionIds" value={cell.sessionId} /> Reserve
                        </label>
                      )}
                      {cell.state === "Yours" && "Booked (yours)"}
                      {cell.state === "TakenByOther" && "Taken"}
                    </td>
                  </tr>
                ))}
              </tbody>
              </table>
            </div>
            <button
              type="submit"
              className="mt-3 w-full rounded-lg bg-brand py-3.5 font-bold text-white shadow-sm transition-all hover:bg-brand-strong hover:shadow-md"
            >
              Reserve checked dates (1 pass each)
            </button>
          </form>

          {chosenRow.cells.some((cell) => cell.state === "Yours") && (
            <>
              <h3 className="mt-6 text-sm font-bold text-ink">Cancel a booked date</h3>
              <div className="mt-2 space-y-3">
                {chosenRow.cells
                  .filter((cell) => cell.state === "Yours")
                  .map((cell) => {
                    const refundable = isCancellable(new Date(cell.startTime), cutoffHours);
                    return (
                      <form action={cancelSeriesSeatDateAction} key={cell.sessionId} className="space-y-2">
                        <input type="hidden" name="sessionId" value={cell.sessionId} />
                        <input type="hidden" name="clickedSessionId" value={clickedSessionId} />
                        {!refundable && (
                          <label className="flex items-start gap-2 text-sm text-ink-soft">
                            <input type="checkbox" required className="mt-1" />
                            <span>
                              I understand I won&rsquo;t get my pass back for{" "}
                              {new Date(cell.startTime).toLocaleDateString()} if I cancel now.
                            </span>
                          </label>
                        )}
                        <button
                          type="submit"
                          className="w-full rounded-lg bg-brand py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-strong"
                        >
                          {refundable
                            ? `Cancel ${new Date(cell.startTime).toLocaleDateString()}`
                            : `Cancel ${new Date(cell.startTime).toLocaleDateString()} without refund`}
                        </button>
                      </form>
                    );
                  })}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
