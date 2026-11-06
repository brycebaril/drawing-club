import { signOut } from "@/auth";

/**
 * Previously inlined only on /dashboard — the only place in the app a user
 * could sign out. Shared here so SiteNav can offer it on every authenticated page.
 */
export function LogoutForm() {
  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/" });
      }}
    >
      <button type="submit" className="plain-button">
        Log out
      </button>
    </form>
  );
}
