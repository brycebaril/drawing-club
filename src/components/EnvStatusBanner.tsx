import { auth } from "@/auth";
import { getUserAuthContext } from "@/lib/auth/roles";
import { getEnvStatus } from "@/lib/envStatus";
import { getLaunchMode } from "@/lib/launchMode";

const ENV_LABELS: Record<string, string> = {
  development: "Development",
  staging: "Staging",
  production: "Production",
};

/**
 * Self-contained like NotificationBanner (its own auth() call, no props) —
 * admin-only. Always shown in dev/staging (informational, a plain non-red
 * banner). In production it renders nothing in the normal, correctly
 * configured case; it only appears there as a red alert if Stripe/SES/the
 * DB aren't actually live targets — a decision confirmed with the user
 * rather than a permanent admin-only status readout.
 */
export async function EnvStatusBanner() {
  const session = await auth();
  if (!session?.user?.id) return null;
  const ctx = await getUserAuthContext(session.user.id);
  if (!ctx?.roles.includes("ADMIN")) return null;

  const status = getEnvStatus();
  const launchMode = getLaunchMode();
  if (status.appEnv === "production" && !status.isAnomalous && launchMode === "full") return null;

  return (
    <div className={status.isAnomalous ? "notification-banner notification-banner--urgent" : "notification-banner"}>
      <p>
        {ctx.username} · {ENV_LABELS[status.appEnv]} · build {status.gitSha} · Stripe: {status.stripeMode} · SES:{" "}
        {status.sesMode} · DB: {status.dbTarget}
        {status.isAnomalous && " — misconfigured for production!"}
        {launchMode === "static_only" && " · LAUNCH MODE: static-only (booking/registration disabled)"}
      </p>
    </div>
  );
}
