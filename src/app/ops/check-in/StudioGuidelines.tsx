/** Static, session-independent — rendered once per page (not once per SessionRosterCard, which would duplicate it under every session on the overview page). */
export function StudioGuidelines() {
  return (
    <>
      <h2>Studio guidelines</h2>
      <p>
        Emergency contact: studio phone line, posted at the front desk. In a medical emergency, call 911 first.
        Models get first choice of pose; keep walkways clear for late arrivals.
      </p>
    </>
  );
}
