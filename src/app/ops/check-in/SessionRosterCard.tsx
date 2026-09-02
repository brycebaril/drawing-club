"use client";

import { useCallback, useEffect, useState } from "react";
import { getCheckInRoster, type CheckInRoster, type RosterRow } from "@/lib/checkin/roster";
import { setCheckedInAction } from "@/lib/checkin/actions";
import { NoteForm } from "./NoteForm";
import { ORG_TIMEZONE } from "@/lib/org";
import { memberLabel } from "@/lib/users/memberLabel";

const POLL_INTERVAL_MS = 10_000;

const ROLE_LABELS: Record<string, string> = {
  SessionManager: "Host",
  ContentEditor: "Content Editor",
  ModelBooker: "Model Booker",
  Controller: "Controller",
  // Was missing here too (same gap as admin/users/[id]'s and
  // filterUsers.ts's own separate copies of this map, fixed at the same
  // time as those) — a Board or Support volunteer's note author fell
  // through to the generic "Member" label until now.
  Board: "Board Member",
  SupportAgent: "Support Agent",
};

function describeAuthorRole(baseRole: string, volunteerRoles: string[]): string {
  if (baseRole === "Admin") return "Admin";
  const labels = volunteerRoles.map((role) => ROLE_LABELS[role] ?? role);
  return labels.length > 0 ? labels.join(", ") : "Member";
}

/**
 * The full per-session check-in unit — reused verbatim by both
 * /ops/check-in (one card per upcoming session) and /ops/check-in/[id]
 * (a single card), so the two entry points can't drift the way this
 * codebase has seen happen before (see SessionDetailBody's identical
 * reasoning in src/app/admin/sessions).
 *
 * Polls getCheckInRoster every ~10s (paused while the tab isn't visible) —
 * this app has no WebSocket/SSE/pub-sub infrastructure anywhere, so polling
 * a Server Function is the pragmatic "live (or polled)" choice, not a
 * fallback. Checkbox toggles apply optimistically via setCheckedInAction,
 * called directly (not through a <form>) so a tap never waits on a round
 * trip — same RPC-from-a-client-handler pattern EditSessionModal already
 * established.
 */
export function SessionRosterCard({
  initial,
  defaultOpen = true,
}: {
  initial: CheckInRoster;
  defaultOpen?: boolean;
}) {
  const [data, setData] = useState(initial);
  const sessionId = data.session.id;

  const refresh = useCallback(() => {
    getCheckInRoster(sessionId).then((fresh) => {
      if (fresh) setData(fresh);
    });
  }, [sessionId]);

  useEffect(() => {
    function pollIfVisible() {
      if (document.visibilityState === "visible") refresh();
    }
    const interval = setInterval(pollIfVisible, POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", pollIfVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", pollIfVisible);
    };
  }, [refresh]);

  async function handleToggle(row: RosterRow) {
    const nextChecked = !row.checkedIn;
    setData((prev) => ({
      ...prev,
      roster: prev.roster.map((r) => (r.id === row.id ? { ...r, checkedIn: nextChecked } : r)),
    }));
    const result = await setCheckedInAction(sessionId, row.rowType, row.id, nextChecked);
    if (!result.ok) {
      setData((prev) => ({
        ...prev,
        roster: prev.roster.map((r) => (r.id === row.id ? { ...r, checkedIn: row.checkedIn } : r)),
      }));
    }
  }

  const { session, modelName, roster, notes } = data;
  const attending = roster.filter((r) => r.checkedIn).length;
  const registered = roster.length;
  const unregistered = Math.max(0, session.maxCapacity - registered);
  const start = new Date(session.startTime);

  return (
    <details className="roster-card" open={defaultOpen}>
      <summary className="roster-card-summary">
        <span className="roster-card-title">
          {session.sessionType} — {start.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: ORG_TIMEZONE })}
          {", "}
          {start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: ORG_TIMEZONE })}
        </span>
        <span className="roster-card-meta">
          {attending}/{registered} checked in
        </span>
      </summary>

      <div className="roster-card-body">
        <p className="section-note">
          {start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: ORG_TIMEZONE })} –{" "}
          {new Date(session.endTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: ORG_TIMEZONE })} · Host:{" "}
          {session.hostUsername ? memberLabel(session.hostDisplayName, session.hostUsername) : "Open"}
          {modelName && <> · Model: {modelName}</>} · Status: {session.status}
        </p>
        {session.description && <p>{session.description}</p>}

        {roster.length === 0 ? (
          <p>Nobody booked yet.</p>
        ) : (
          <ol className="roster-list">
            {roster.map((row) => (
              <li key={row.id} className={row.checkedIn ? "roster-row roster-row--checked" : "roster-row"}>
                <label>
                  <input type="checkbox" checked={row.checkedIn} onChange={() => handleToggle(row)} />
                  <span className="roster-row-name">
                    {session.isSeries && <span className="roster-row-seat">Seat {row.seatNumber}</span>}
                    {memberLabel(row.displayName, row.username)}
                  </span>
                  {row.isMember && (
                    <span title="Member" aria-label="Member">
                      🎨
                    </span>
                  )}
                  {row.isFirstTimer && (
                    <span title="First-time attendee" aria-label="First-time attendee">
                      🐣
                    </span>
                  )}
                </label>
              </li>
            ))}
          </ol>
        )}
        <p className="section-note">
          {attending} attending + {unregistered} unregistered seats ({session.maxCapacity} max)
        </p>

        <h3>Session notes</h3>
        <p className="section-note">
          Visible to the Host, Model Booker, and Admins working this session — not to attendees.
        </p>
        <NoteForm sessionId={sessionId} onPosted={refresh} />
        {notes.length === 0 ? (
          <p>No notes yet.</p>
        ) : (
          <ul>
            {notes.map((note) => (
              <li key={note.id}>
                <strong>
                  {memberLabel(note.authorDisplayName, note.authorUsername)} ({describeAuthorRole(note.baseRole, note.volunteerRoles)})
                </strong>{" "}
                — {new Date(note.createdAt).toLocaleString("en-US", { timeZone: ORG_TIMEZONE })}
                <br />
                {note.content}
              </li>
            ))}
          </ul>
        )}

        <p>
          <a href={`/admin/sessions/${sessionId}`} target="_blank" rel="noreferrer">
            Manage full session ↗
          </a>
        </p>
      </div>
    </details>
  );
}
