"use client";

import { useActionState } from "react";
import { updateSeriesMetadataAction, type UpdateSeriesMetadataState } from "./actions";

const initialState: UpdateSeriesMetadataState = {};

export function SeriesMetadataEditForm({
  seriesId,
  name,
  seatCount,
}: {
  seriesId: string;
  name: string;
  seatCount: number;
}) {
  const [state, formAction, pending] = useActionState(updateSeriesMetadataAction, initialState);

  return (
    <form action={formAction}>
      <input type="hidden" name="seriesId" value={seriesId} />
      <div>
        <label htmlFor="sme-name">Series name</label>
        <input id="sme-name" name="name" defaultValue={name} required />
      </div>
      <div>
        <label htmlFor="sme-seatCount">Seat count</label>
        <input id="sme-seatCount" name="seatCount" type="number" min={1} defaultValue={seatCount} required />
      </div>
      {state.error && <p role="alert">{state.error}</p>}
      <button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}
