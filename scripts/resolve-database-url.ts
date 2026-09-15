/**
 * Prints the real, resolved DATABASE_URL to stdout — nothing else, so a
 * shell can capture it directly (`$(...)`).
 *
 * Exists specifically for amplify.yml's preBuild migration step.
 * node-pg-migrate reads DATABASE_URL itself as a raw connection string; it
 * has no idea src/lib/db/resolveDatabaseUrl.ts's {username}/{password}
 * template scheme exists. Running the migration with the template
 * unresolved fails outright ("password authentication failed for user
 * \"{username}\"") — found for real, the first time DATABASE_URL was
 * switched to template form on staging without this script existing yet.
 *
 * Deliberately a separate one-shot call, not reusing src/lib/db/pool.ts's
 * cached resolution — this process runs once and exits; there's nothing
 * to cache across.
 */
import { resolveDatabaseUrl } from "../src/lib/db/resolveDatabaseUrl";

resolveDatabaseUrl()
  .then((url) => {
    process.stdout.write(url);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
