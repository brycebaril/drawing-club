import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

/**
 * Pure substitution, split out so it's testable without mocking the AWS
 * SDK. Percent-encodes both values since a generated RDS password
 * routinely contains URI-special characters (confirmed against the real
 * secret during the incident this module fixes) that would otherwise
 * corrupt the connection string.
 */
export function substituteCredentials(template: string, username: string, password: string): string {
  return template.replace("{username}", encodeURIComponent(username)).replace("{password}", encodeURIComponent(password));
}

/**
 * One-shot resolve, no caching — "the real connection string, right now."
 *
 * When DATABASE_SECRET_ARN is unset (local dev, CI — every environment
 * except staging/production), DATABASE_URL is used exactly as it always
 * has been: a complete connection string, no AWS calls. This is the same
 * "no AWS config present -> plain fallback" shape src/lib/email/sender.ts
 * already established for SES, not a new pattern.
 *
 * When DATABASE_SECRET_ARN *is* set (see docs/StagingEnvironment.md —
 * RDS's managed master-password rotation was silently breaking every
 * deploy whenever it fired, since a static DATABASE_URL never tracked
 * it), DATABASE_URL is instead a *template* containing literal
 * "{username}"/"{password}" tokens, substituted here from the secret's
 * live values. The secret itself only ever contains {username, password}
 * — never host/port/dbname, confirmed directly against the real secret —
 * so those still come from the template.
 *
 * Two callers, deliberately kept separate rather than one importing the
 * other's caching: src/lib/db/pool.ts wraps this in its own 15-minute
 * cache plus rotation-aware pool-rebuild logic, for the long-lived app
 * process. scripts/resolve-database-url.ts calls this directly, once, for
 * amplify.yml's preBuild migration step — node-pg-migrate reads
 * DATABASE_URL itself as a raw connection string with no idea this
 * template/secret scheme exists, so it needs an already-resolved real
 * value, not the template (found for real: the migration step failed
 * with `password authentication failed for user "{username}"` the first
 * time DATABASE_URL was switched to the template form without this).
 */
export async function resolveDatabaseUrl(): Promise<string> {
  const secretArn = process.env.DATABASE_SECRET_ARN;
  if (!secretArn) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    return url;
  }

  const template = process.env.DATABASE_URL;
  if (!template) throw new Error("DATABASE_URL (template) is not set");

  const client = new SecretsManagerClient({});
  const result = await client.send(new GetSecretValueCommand({ SecretId: secretArn }));
  const secret = JSON.parse(result.SecretString ?? "{}") as { username: string; password: string };

  return substituteCredentials(template, secret.username, secret.password);
}
