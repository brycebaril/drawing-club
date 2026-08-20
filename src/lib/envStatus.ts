export type AppEnv = "development" | "staging" | "production";

export interface EnvStatus {
  appEnv: AppEnv;
  gitSha: string;
  stripeMode: "Live" | "Test";
  sesMode: "Live" | "Console fallback";
  dbTarget: "Local" | "Remote";
  /** Production but Stripe/SES/DB isn't actually pointed at a live target — the only case the banner shows up in production. */
  isAnomalous: boolean;
}

function resolveAppEnv(): AppEnv {
  const raw = process.env.APP_ENV;
  if (raw === "development" || raw === "staging" || raw === "production") return raw;
  // Unset/unrecognized APP_ENV falls back to NODE_ENV, but never silently
  // assumes "development" while actually running a production build — that
  // would suppress the exact misconfiguration alert this exists to surface.
  return process.env.NODE_ENV === "production" ? "production" : "development";
}

function resolveStripeMode(): "Live" | "Test" {
  return process.env.STRIPE_SECRET_KEY?.startsWith("sk_live_") ? "Live" : "Test";
}

function resolveSesMode(): "Live" | "Console fallback" {
  // Same condition src/lib/email/sender.ts already uses to decide whether to
  // actually call SES or fall back to a console-logged dev email.
  return process.env.AWS_REGION && process.env.SES_FROM_EMAIL ? "Live" : "Console fallback";
}

function resolveDbTarget(): "Local" | "Remote" {
  const url = process.env.DATABASE_URL;
  if (!url) return "Remote"; // src/lib/db/pool.ts already throws before this could matter in practice
  try {
    const hostname = new URL(url).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1" ? "Local" : "Remote";
  } catch {
    return "Remote";
  }
}

/**
 * Deployment-identity facts (env label, build SHA, live-vs-test API/DB
 * targets), not system_settings — same reasoning as src/lib/org.ts: these
 * are set once per instance, not runtime-editable business config. Pure and
 * DB-free so it's directly unit-testable against process.env, matching this
 * codebase's pure-function-tested-separately convention.
 */
export function getEnvStatus(): EnvStatus {
  const appEnv = resolveAppEnv();
  const stripeMode = resolveStripeMode();
  const sesMode = resolveSesMode();
  const dbTarget = resolveDbTarget();

  return {
    appEnv,
    gitSha: process.env.GIT_SHA ?? "unknown",
    stripeMode,
    sesMode,
    dbTarget,
    isAnomalous: appEnv === "production" && (stripeMode === "Test" || sesMode === "Console fallback" || dbTarget === "Local"),
  };
}
