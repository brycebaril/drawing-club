import Link from "next/link";
import { X } from "lucide-react";

/**
 * No client JS: "closing" is just a Link back to the bare /app/schedule
 * route (matching SiteOutline's existing ?session_id= deep-linking
 * convention). The backdrop Link and the panel are siblings, not nested —
 * the panel's own z-index/stacking means clicks inside it hit the panel's
 * real buttons/forms, and clicks outside it fall through to the backdrop
 * Link, all via normal DOM hit-testing rather than onClick/stopPropagation.
 */
export function Modal({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <Link href="/app/schedule" aria-label="Close" className="absolute inset-0 bg-ink/60 backdrop-blur-sm" />
      <div className="relative z-10 max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg bg-panel shadow-2xl">
        <Link
          href="/app/schedule"
          aria-label="Close"
          className="absolute right-4 top-4 z-20 rounded-full p-2 text-ink-soft transition-colors hover:bg-canvas hover:text-ink"
        >
          <X className="h-5 w-5" />
        </Link>
        {children}
      </div>
    </div>
  );
}
