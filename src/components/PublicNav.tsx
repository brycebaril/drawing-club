import Link from "next/link";

/** For the public-facing pages the CMS phase built (/, /about, /news, /contact) — none had a persistent nav before this. */
export function PublicNav() {
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
