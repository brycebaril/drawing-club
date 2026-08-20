import { notFound } from "next/navigation";
import { requireOpsRole } from "@/lib/auth/requireOpsRole";
import { SiteNav } from "@/components/SiteNav";
import { NewStaticPageForm } from "./NewStaticPageForm";

export default async function NewStaticPagePage() {
  const ctx = await requireOpsRole(["VOL_MKT"]);
  if (!ctx) notFound();

  return (
    <>
      <SiteNav />
      <main className="main--wide">
      <h1>New page</h1>
      <NewStaticPageForm />
    </main>
    </>
  );
}
