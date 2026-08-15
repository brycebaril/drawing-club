/**
 * Manual stand-in for the scheduled job ArchitectureDocument.md §8 specs
 * (daily, via EventBridge Scheduler once AWS infra is provisioned). Until
 * then, this is what keeps recurring sessions' rolling booking window
 * populated — run it periodically, or trigger it from
 * /admin/sessions/recurring.
 */
import { pool } from "../src/lib/db/pool";
import { rollforwardAllRules } from "../src/lib/recurrence/generate";

async function main() {
  const results = await rollforwardAllRules();
  const totalCreated = results.reduce((sum, r) => sum + r.created, 0);
  console.log(`Rolled forward ${results.length} rule(s), created ${totalCreated} session(s):`);
  for (const r of results) {
    if (r.created > 0) console.log(` - ${r.ruleId}: ${r.created} created`);
  }
}

main()
  .catch((error) => {
    console.error("Rollforward failed:", error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
