import { SESSION_TYPE_INFO } from "./scheduleTypes";

function Swatch({ className }: { className: string }) {
  return <div className={`h-4 w-4 shrink-0 rounded ${className}`} />;
}

export function Legend() {
  return (
    <div className="mt-6 rounded-lg border border-line bg-panel p-5 text-center shadow-sm">
      <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-ink">How to read the schedule</h2>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div>
          <h3 className="mb-2 text-[11px] font-semibold uppercase text-ink-soft">Session types</h3>
          <div className="grid grid-cols-2 justify-center gap-x-4 gap-y-1.5 text-sm text-ink">
            {Object.entries(SESSION_TYPE_INFO).map(([code, info]) => (
              <div key={code}>
                <span className={`inline-block w-6 font-bold ${info.textClass}`}>{info.display}</span> {info.label}
              </div>
            ))}
          </div>
        </div>
        <div>
          <h3 className="mb-2 text-[11px] font-semibold uppercase text-ink-soft">Status</h3>
          {/*
            Design Philosophy.dc.html §03: colour is never the only signal —
            every swatch below differs in fill, border weight and border
            style, matching SessionCell.tsx's own four variants exactly, not
            just a color key.
          */}
          <div className="mx-auto flex w-fit flex-col items-start gap-1.5 text-left text-sm text-ink">
            <div className="flex items-center gap-2.5">
              <Swatch className="border border-line bg-panel" />
              <span>Open</span>
            </div>
            <div className="flex items-center gap-2.5">
              <Swatch className="border-2 border-good-line bg-good-bg" />
              <span>Booked by you</span>
            </div>
            <div className="flex items-center gap-2.5">
              <Swatch className="border border-line bg-ink-soft/10" />
              <span>Full — waitlist</span>
            </div>
            <div className="flex items-center gap-2.5">
              <Swatch className="border border-dashed border-line/60 bg-canvas opacity-60" />
              <span>Opens later — outside your booking window</span>
            </div>
            <div className="flex items-center gap-2.5">
              <Swatch className="border-2 border-dashed border-warn-line bg-warn-bg" />
              <span>Model unconfirmed</span>
            </div>
            <div className="flex items-center gap-2.5">
              <Swatch className="border border-dashed border-line/60 bg-canvas" />
              <span>Nothing scheduled</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
