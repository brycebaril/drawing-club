"use client";

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "schedule-next-session-hint-dismissed";
const CHANGE_EVENT = "schedule-next-session-hint-change";

function isDismissed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function subscribe(onStoreChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onStoreChange);
  return () => window.removeEventListener(CHANGE_EVENT, onStoreChange);
}

function dismissHint() {
  try {
    localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // Storage inaccessible — worst case the hint just reappears next visit.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/**
 * A first-time-guidance nudge, not a permanent fixture — points at the
 * single earliest bookable session on the default (week 0) view and
 * disappears for good once dismissed, tracked in localStorage (per-browser,
 * matching this app's existing "lightweight per-viewer convenience" use of
 * browser storage — nothing server-side needs to know a visitor saw a hint).
 *
 * useSyncExternalStore, not useState+useEffect: whether the hint was
 * already dismissed can only be known client-side (SSR has no
 * localStorage), so it genuinely can't be computed during render the way
 * ordinary derived state can — this is exactly the "syncing with an
 * external system, safely across server/client" case the hook exists for.
 * getServerSnapshot returns true (hidden) so the server-rendered HTML and
 * the first client render always agree — no hydration mismatch — and the
 * real answer swaps in right after. dismissHint() dispatches a same-tab
 * custom event (the native `storage` event only fires in *other* tabs)
 * so clicking dismiss re-renders immediately instead of only on next visit.
 */
export function NextSessionCallout({
  href,
  label,
  whenText,
}: {
  href: string;
  label: string;
  whenText: string;
}) {
  const dismissed = useSyncExternalStore(subscribe, isDismissed, () => true);

  if (dismissed) return null;

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border-2 border-brand bg-brand/10 px-4 py-3 text-sm text-ink">
      <span>
        👉 New here? Your next open session is <strong>{label}</strong> on {whenText}.{" "}
        <a href={href} onClick={dismissHint} className="font-bold text-linktext underline hover:text-linktext-hover">
          Book it here
        </a>
      </span>
      <button
        type="button"
        onClick={dismissHint}
        aria-label="Dismiss this hint"
        className="shrink-0 rounded px-2 py-1 text-ink-soft hover:text-ink"
      >
        ✕
      </button>
    </div>
  );
}
