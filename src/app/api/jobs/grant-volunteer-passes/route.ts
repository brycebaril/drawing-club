import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { grantWeeklyVolunteerPasses } from "@/lib/ops/volunteerPasses";
import { currentWeekStart, toDateOnly } from "@/lib/sessions/shared";
import { writeAuditLog } from "@/lib/audit/log";

/**
 * The scheduled trigger for the weekly volunteer free-pass grant
 * (docs/ArchitectureDocument.md §8) — replaces the old admin "Grant this
 * week's volunteer tickets" button on /admin/passes, which made a real,
 * recurring weekly grant depend on a person remembering to click it. Not
 * session/role-authenticated (there's no human actor) — a shared secret in
 * the Authorization header, same "protected internal API route" shape §8
 * already specifies for the rollforward/payout-report jobs, just fronted by
 * a GitHub Actions scheduled workflow (.github/workflows/
 * grant-volunteer-passes.yml) instead of EventBridge Scheduler, since
 * EventBridge isn't provisioned for this app yet (docs/StagingEnvironment.md)
 * — swapping the caller later doesn't require any change here.
 *
 * `scripts/grant-volunteer-passes.ts` still exists and calls the exact same
 * grantWeeklyVolunteerPasses function — kept as a manual/local-dev escape
 * hatch, not a second production trigger path.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const expectedSecret = process.env.JOB_TRIGGER_SECRET;
  if (!expectedSecret) {
    return NextResponse.json({ error: "Job trigger not configured" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const match = /^Bearer (.+)$/.exec(authHeader);
  const providedSecret = match?.[1] ?? "";
  // Constant-time comparison — a plain === would leak how many leading
  // characters matched via response-time differences. Buffers must be equal
  // length for timingSafeEqual, so a length mismatch is checked (and
  // rejected) separately first, before ever calling it.
  const providedBuf = Buffer.from(providedSecret);
  const expectedBuf = Buffer.from(expectedSecret);
  const isValid =
    providedBuf.length === expectedBuf.length && timingSafeEqual(providedBuf, expectedBuf);
  if (!isValid) {
    return NextResponse.json({ error: "Invalid or missing job trigger secret" }, { status: 401 });
  }

  const weekStart = currentWeekStart(new Date());
  const result = await grantWeeklyVolunteerPasses(weekStart);

  // No actorId — this run has no human actor, and system_audit_logs.actor_id
  // is nullable specifically so a scheduled-job mutation can be recorded
  // honestly as "nobody," not attributed to a fake account.
  await writeAuditLog({
    actionType: "VOLUNTEER_PASSES_GRANTED",
    metadata: {
      trigger: "scheduled-job",
      weekStart: toDateOnly(weekStart),
      granted: result.granted.length,
      skippedAtCap: result.skippedAtCap.length,
      alreadyGranted: result.alreadyGranted.length,
    },
  });

  return NextResponse.json({
    weekStart: toDateOnly(weekStart),
    granted: result.granted.length,
    skippedAtCap: result.skippedAtCap.length,
    alreadyGranted: result.alreadyGranted.length,
  });
}
