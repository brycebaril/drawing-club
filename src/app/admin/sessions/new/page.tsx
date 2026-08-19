import { getSettingNumber } from "@/lib/settings";
import { getSessionManagerCandidates } from "@/lib/sessions/host";
import { SessionForm } from "./SessionForm";

export default async function NewSessionPage() {
  const [defaultCapacity, hostCandidates] = await Promise.all([
    getSettingNumber("SESSION_DEFAULT_CAPACITY"),
    getSessionManagerCandidates(),
  ]);

  return (
    <main>
      <h1>Create a one-off session</h1>
      <SessionForm defaultCapacity={defaultCapacity} hostCandidates={hostCandidates} />
    </main>
  );
}
