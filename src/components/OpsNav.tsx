import Link from "next/link";
import type { Role } from "@/lib/auth/roles";
import { LogoutForm } from "./LogoutForm";

/**
 * Unlike AdminNav (unconditional — every /admin/* page already requires
 * ADMIN), /ops/* workspaces are gated per volunteer sub-role and those
 * aren't mutually exclusive, so this renders only the links the viewer's
 * roles actually grant. Check-in has no standalone link — it's only ever
 * reached from a specific session (/ops/check-in/[sessionId]), not browsed
 * to directly.
 */
export function OpsNav({ roles }: { roles: Role[] }) {
  const isAdmin = roles.includes("ADMIN");

  return (
    <nav>
      <ul>
        {(isAdmin || roles.includes("VOL_MBR")) && (
          <li>
            <Link href="/ops/model-booking">Model Booking</Link>
          </li>
        )}
        {(isAdmin || roles.includes("VOL_MKT")) && (
          <li>
            <Link href="/ops/cms">CMS</Link>
          </li>
        )}
        {(isAdmin || roles.includes("VOL_CTRL")) && (
          <li>
            <Link href="/ops/financials">Financials</Link>
          </li>
        )}
        <li>
          <Link href="/dashboard">Dashboard</Link>
        </li>
        <li>
          <Link href="/app/schedule">Schedule</Link>
        </li>
        <li>
          <Link href="/app/wallet">Wallet</Link>
        </li>
        <li>
          <LogoutForm />
        </li>
      </ul>
    </nav>
  );
}
