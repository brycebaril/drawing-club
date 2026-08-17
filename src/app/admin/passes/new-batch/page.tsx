import { AdminNav } from "@/components/AdminNav";
import { BatchForm } from "./BatchForm";

export default function NewBatchPage() {
  return (
    <main>
      <AdminNav />
      <h1>New pass batch</h1>
      <p>Creates a block of transferable passes for a corporate/institutional client.</p>
      <BatchForm />
    </main>
  );
}
