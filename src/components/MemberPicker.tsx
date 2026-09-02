"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { searchMembers, type MemberSearchResult } from "@/lib/users/memberSearch";
import { isValidEmail } from "@/lib/validation/email";

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;

export interface InviteResult {
  success?: boolean;
  error?: string;
}

interface MemberPickerProps {
  /** Name of the hidden form field carrying the selected member's id — nothing is submittable until a real selection exists. */
  name: string;
  /** "existing": must resolve to a real member (e.g. batch owner). "existing-or-invite": offers an email-invite fallback when nothing matches (ticket sharing). */
  mode: "existing" | "existing-or-invite";
  placeholder?: string;
  /** Excludes this user id from results — e.g. a sender shouldn't see themselves. */
  excludeUserId?: string;
  /** Lets the parent form gate its own submit button on a real selection. */
  onSelectionChange?: (memberId: string | null) => void;
  /** Required for mode="existing-or-invite" to actually show the invite affordance. */
  onInvite?: (email: string) => Promise<InviteResult>;
}

/**
 * Search-as-you-type member picker, replacing raw "type their exact
 * username" entry — introduced because migrated members' usernames are
 * auto-derived from email and unrecognizable to anyone (see the plan doc
 * for full context). Uses useId() for internal element ids because this
 * exact component renders multiple times on one page (one ShareForm per
 * transferable pass) — this codebase has a documented prior bug from
 * reusing an id across duplicate forms on one page.
 */
export function MemberPicker({
  name,
  mode,
  placeholder = "Search by name or username",
  excludeUserId,
  onSelectionChange,
  onInvite,
}: MemberPickerProps) {
  const listboxId = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MemberSearchResult[] | null>(null);
  const [selected, setSelected] = useState<MemberSearchResult | null>(null);
  const [open, setOpen] = useState(false);
  const [inviting, startInvite] = useTransition();
  const [inviteResult, setInviteResult] = useState<InviteResult | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (selected) return; // don't re-search once a pick has been made
    clearTimeout(debounceRef.current);

    const trimmed = query.trim();
    // Below MIN_QUERY_LENGTH: nothing to fetch, and rendering is already
    // gated on this same length check below, so `results` is simply never
    // read while short — no state to reset here.
    if (trimmed.length < MIN_QUERY_LENGTH) return;

    debounceRef.current = setTimeout(() => {
      let cancelled = false;
      searchMembers(trimmed).then((found) => {
        if (cancelled) return;
        setResults(excludeUserId ? found.filter((m) => m.id !== excludeUserId) : found);
      });
      return () => {
        cancelled = true;
      };
    }, DEBOUNCE_MS);

    return () => clearTimeout(debounceRef.current);
  }, [query, selected, excludeUserId]);

  function pick(member: MemberSearchResult) {
    setSelected(member);
    setOpen(false);
    setResults(null);
    onSelectionChange?.(member.id);
  }

  function clearSelection() {
    setSelected(null);
    setQuery("");
    setResults(null);
    onSelectionChange?.(null);
  }

  function invite() {
    if (!onInvite) return;
    const email = query.trim();
    startInvite(async () => {
      const result = await onInvite(email);
      setInviteResult(result);
    });
  }

  if (selected) {
    const label = selected.displayName ? `${selected.displayName} (@${selected.username})` : `@${selected.username}`;
    return (
      <div className="member-picker">
        <input type="hidden" name={name} value={selected.id} />
        <span className="member-picker-chip">
          {label}
          <button type="button" onClick={clearSelection} aria-label="Change selection">
            Change
          </button>
        </span>
      </div>
    );
  }

  const trimmedQuery = query.trim();
  const showEmptyState = results !== null && results.length === 0;
  const showInvite =
    mode === "existing-or-invite" && onInvite && showEmptyState && isValidEmail(trimmedQuery);

  return (
    <div className="member-picker">
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-label={placeholder}
        placeholder={placeholder}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setInviteResult(null);
        }}
        onFocus={() => setOpen(true)}
      />

      {open && trimmedQuery.length >= MIN_QUERY_LENGTH && (
        <ul id={listboxId} role="listbox" className="member-picker-results">
          {results === null && <li className="member-picker-status">Searching…</li>}

          {results !== null &&
            results.map((member) => (
              <li key={member.id}>
                <button type="button" role="option" aria-selected={false} onClick={() => pick(member)}>
                  {member.displayName ? `${member.displayName} (@${member.username})` : `@${member.username}`}
                </button>
              </li>
            ))}

          {showEmptyState && !showInvite && <li className="member-picker-status">No members found.</li>}

          {showInvite && (
            <li className="member-picker-status">
              {inviteResult?.success ? (
                <span role="status">Invited {trimmedQuery} — share again once they&rsquo;ve signed up.</span>
              ) : (
                <>
                  <p>No member found. Invite {trimmedQuery} to join?</p>
                  {inviteResult?.error && <p role="alert">{inviteResult.error}</p>}
                  <button type="button" onClick={invite} disabled={inviting}>
                    {inviting ? "Sending…" : `Invite ${trimmedQuery}`}
                  </button>
                </>
              )}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
