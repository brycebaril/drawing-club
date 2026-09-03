"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";

export interface StaffLink {
  href: string;
  label: string;
}

/**
 * The one bit of client-side nav interactivity in this app (see SiteNav's
 * own doc comment on why everything else there is a plain Server
 * Component) — a native <details>/<summary> disclosure has no way to
 * detect a click/tap outside itself without JS, and "close the same way
 * you opened it" was a real, reported usability gap. Kept to the smallest
 * possible client boundary: only this menu is a client component, not the
 * whole nav.
 */
export function StaffMenu({
  isAdmin,
  adminLinks,
  opsLinks,
}: {
  isAdmin: boolean;
  adminLinks: StaffLink[];
  opsLinks: StaffLink[];
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    // pointerdown (not click) so a touch tap outside the menu closes it too,
    // not just a mouse click — a single listener covers mouse, touch, and pen.
    function handlePointerDown(event: PointerEvent) {
      const details = detailsRef.current;
      if (!details || !details.open) return;
      if (event.target instanceof Node && !details.contains(event.target)) {
        details.open = false;
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  return (
    <li className="staff-menu">
      <details ref={detailsRef}>
        <summary role="button">☰ Staff</summary>
        <div className="staff-menu-panel">
          {isAdmin && (
            <>
              <p className="nav-group-label">Admin</p>
              <ul>
                {adminLinks.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href}>{link.label}</Link>
                  </li>
                ))}
              </ul>
            </>
          )}
          {opsLinks.length > 0 && (
            <>
              <p className="nav-group-label">Ops</p>
              <ul>
                {opsLinks.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href}>{link.label}</Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </details>
    </li>
  );
}
