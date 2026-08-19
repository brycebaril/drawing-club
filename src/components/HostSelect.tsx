import type { HostCandidate } from "@/lib/sessions/host";

/**
 * Host-selection dropdown, filtered to users tagged SessionManager and
 * showing their display_name. If the current value (editing an existing
 * session/rule) isn't one of those candidates — e.g. a migrated session's
 * historical host, or someone who's since lost the role — it's still
 * included as its own option so saving unrelated changes doesn't silently
 * clear a real assignment.
 */
export function HostSelect({
  id,
  candidates,
  defaultValue,
}: {
  id: string;
  candidates: HostCandidate[];
  defaultValue?: string;
}) {
  const currentNotListed = defaultValue && !candidates.some((c) => c.username === defaultValue);

  return (
    <select id={id} name="hostUsername" defaultValue={defaultValue ?? ""}>
      <option value="">Open host slot</option>
      {currentNotListed && (
        <option value={defaultValue}>{defaultValue} (current — not tagged Session Manager)</option>
      )}
      {candidates.map((c) => (
        <option key={c.username} value={c.username}>
          {c.displayName}
        </option>
      ))}
    </select>
  );
}
