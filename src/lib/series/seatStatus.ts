export interface SeriesSessionInput {
  sessionId: string;
  startTime: Date;
  status: string;
}

export interface SeatReservationInput {
  sessionId: string;
  seatNumber: number;
  userId: string;
}

export interface SeatGridCell {
  sessionId: string;
  startTime: Date;
  state: "Open" | "Yours" | "TakenByOther";
}

/** Design Doc §6.5's four documented seat states. */
export type SeatRowStatus =
  | "FullSeriesAvailable"
  | "PartialSeriesAvailable"
  | "FullyReserved"
  | "UserReserved";

export interface SeatGridRow {
  seatNumber: number;
  status: SeatRowStatus;
  cells: SeatGridCell[];
}

/**
 * Pure seat×date grid for a series: for each seat 1..seatCount, the state of
 * every still-Scheduled session's date, plus the overall per-seat status
 * (Design Doc §6.5). "UserReserved" takes priority over the other three
 * whenever the viewer holds any reservation on that seat, regardless of
 * whether its other dates are open or taken by someone else.
 */
export function computeSeatGrid(input: {
  sessions: SeriesSessionInput[];
  reservations: SeatReservationInput[];
  seatCount: number;
  viewerId: string | null;
}): SeatGridRow[] {
  const scheduledSessions = input.sessions
    .filter((s) => s.status === "Scheduled")
    .slice()
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

  const rows: SeatGridRow[] = [];
  for (let seatNumber = 1; seatNumber <= input.seatCount; seatNumber++) {
    const reservationBySessionId = new Map(
      input.reservations.filter((r) => r.seatNumber === seatNumber).map((r) => [r.sessionId, r]),
    );

    const cells: SeatGridCell[] = scheduledSessions.map((session) => {
      const reservation = reservationBySessionId.get(session.sessionId);
      const state: SeatGridCell["state"] = !reservation
        ? "Open"
        : reservation.userId === input.viewerId
          ? "Yours"
          : "TakenByOther";
      return { sessionId: session.sessionId, startTime: session.startTime, state };
    });

    const viewerHoldsSeat = cells.some((c) => c.state === "Yours");
    const anyReserved = cells.some((c) => c.state !== "Open");
    const allReserved = cells.length > 0 && cells.every((c) => c.state !== "Open");

    const status: SeatRowStatus = viewerHoldsSeat
      ? "UserReserved"
      : !anyReserved
        ? "FullSeriesAvailable"
        : allReserved
          ? "FullyReserved"
          : "PartialSeriesAvailable";

    rows.push({ seatNumber, status, cells });
  }

  return rows;
}
