import { getSettingNumber } from "@/lib/settings";
import { SessionForm } from "./SessionForm";

export default async function NewSessionPage() {
  const defaultCapacity = await getSettingNumber("SESSION_DEFAULT_CAPACITY");

  return (
    <main>
      <h1>Create a one-off session</h1>
      <SessionForm defaultCapacity={defaultCapacity} />
    </main>
  );
}
