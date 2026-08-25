import { SiteNav } from "@/components/SiteNav";
import { BatchForm } from "./BatchForm";

export default function NewBatchPage() {
  return (
    <>
      <SiteNav />
      <main className="main--wide">
      <h1>New ticket batch</h1>
      <p>Creates a block of transferable tickets for a corporate/institutional client.</p>
      <BatchForm />
    </main>
    </>
  );
}
