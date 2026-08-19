import { CheckCircle2, Clock, Info, Lock, UserX } from "lucide-react";
import { SESSION_TYPE_INFO } from "./scheduleTypes";

export function Legend() {
  return (
    <div className="mt-6 rounded-lg border border-line bg-panel p-5 shadow-sm">
      <h2 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-ink">
        <Info className="h-4 w-4" /> How to read the schedule
      </h2>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div>
          <h3 className="mb-2 text-[11px] font-semibold uppercase text-ink-soft">Session types</h3>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm text-ink">
            {Object.entries(SESSION_TYPE_INFO).map(([code, info]) => (
              <div key={code}>
                <span className={`inline-block w-6 font-bold ${info.textClass}`}>{info.display}</span> {info.label}
              </div>
            ))}
          </div>
        </div>
        <div>
          <h3 className="mb-2 text-[11px] font-semibold uppercase text-ink-soft">Status</h3>
          <div className="space-y-1.5 text-sm text-ink">
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="h-4 w-4 text-good" fill="currentColor" />
              <span>You&rsquo;re registered</span>
            </div>
            <div className="flex items-center gap-2.5">
              <Lock className="h-4 w-4 text-warn" strokeWidth={2.5} />
              <span>Registered, too close to start to cancel</span>
            </div>
            <div className="flex items-center gap-2.5">
              <Clock className="h-4 w-4 text-warn" strokeWidth={2.5} />
              <span>You&rsquo;re on the waitlist</span>
            </div>
            <div className="flex items-center gap-2.5">
              <UserX className="h-4 w-4 text-warn" strokeWidth={2.5} />
              <span>No model assigned yet</span>
            </div>
            <div className="flex items-center gap-2.5">
              <div className="h-4 w-4 rounded border border-line bg-canvas opacity-60" />
              <span>Nothing scheduled</span>
            </div>
            <div className="flex items-center gap-2.5">
              <div className="h-4 w-4 rounded border border-line bg-canvas opacity-50 grayscale" />
              <span>Not yet open for your booking window</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
