import Link from "next/link";
import { getSettingNumber } from "@/lib/settings";
import { AdminNav } from "@/components/AdminNav";
import { RecurrenceRuleForm } from "./RecurrenceRuleForm";

export default async function NewRecurringSessionPage() {
  const defaultCapacity = await getSettingNumber("SESSION_DEFAULT_CAPACITY");

  return (
    <main>
      <AdminNav />
      <h1>Create a recurring session</h1>
      <p>
        Generates occurrences up to 90 days out immediately; run <code>pnpm rollforward</code> (or use
        the &quot;Generate more sessions&quot; button on the{" "}
        <Link href="/admin/sessions/recurring">recurring rules page</Link>) to extend a perpetual
        series further as time passes.
      </p>
      <RecurrenceRuleForm defaultCapacity={defaultCapacity} />
    </main>
  );
}
