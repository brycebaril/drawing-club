"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getSessionDetail, type SessionDetailData } from "./[id]/actions";
import { SessionDetailBody } from "./[id]/SessionDetailBody";
import type { HostCandidate } from "@/lib/sessions/host";

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; detail: SessionDetailData };

/**
 * The edit counterpart to AddSessionModal — clicking a filled grid cell
 * opens this instead of navigating to /admin/sessions/[id] directly, per
 * explicit user request to reproduce that page's full content (roster,
 * edit form, three-way cancel) in the modal rather than a trimmed-down
 * quick-edit. Fetches on open via getSessionDetail (a Server Function, RPC-
 * called directly — see its own comment) rather than the grid pre-loading
 * every cell's full detail up front, which would mean an attendee/seat-
 * roster query per session in the whole visible window whether or not an
 * admin ever opens one.
 */
export function EditSessionModal({
  sessionId,
  hostCandidates,
  onClose,
}: {
  sessionId: string;
  hostCandidates: HostCandidate[];
  onClose: () => void;
}) {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    getSessionDetail(sessionId).then((detail) => {
      if (cancelled) return;
      setState(detail ? { status: "ready", detail } : { status: "error" });
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" role="dialog" aria-modal="true" aria-label="Session details" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>
          ×
        </button>

        {state.status === "loading" && <p>Loading…</p>}

        {state.status === "error" && <p role="alert">Couldn&apos;t load this session — it may have been removed.</p>}

        {state.status === "ready" && (
          <>
            <SessionDetailBody
              session={state.detail.session}
              attendees={state.detail.attendees}
              seats={state.detail.seats}
              hostCandidates={hostCandidates}
            />
            <p className="section-note">
              <Link href={`/admin/sessions/${sessionId}`} target="_blank" rel="noreferrer">
                Open in a new tab ↗
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
