import Link from "next/link";
import { auth } from "@/auth";
import { getUserAuthContext } from "@/lib/auth/roles";
import { AppNav } from "./AppNav";

/**
 * For the public-facing pages the CMS phase built (/, /about, /news,
 * /contact). Must check auth itself — a logged-in visitor landing here
 * (e.g. via a bookmark or search result) previously always saw "Log in" /
 * "Sign up" regardless of session state, even though clicking through
 * worked fine (the session was real, the nav just never looked at it).
 * Delegates to AppNav for an authenticated visitor rather than duplicating
 * its link set.
 */
export async function PublicNav() {
  const session = await auth();
  const ctx = session?.user?.id ? await getUserAuthContext(session.user.id) : null;

  if (ctx) {
    return <AppNav roles={ctx.roles} />;
  }

  return (
    <nav>
      <ul>
        <li>
          <Link href="/">Home</Link>
        </li>
        <li>
          <Link href="/about">About</Link>
        </li>
        <li>
          <Link href="/news">News</Link>
        </li>
        <li>
          <Link href="/contact">Contact</Link>
        </li>
        <li>
          <Link href="/auth/login">Log in</Link>
        </li>
        <li>
          <Link href="/auth/register">Sign up</Link>
        </li>
      </ul>
    </nav>
  );
}
