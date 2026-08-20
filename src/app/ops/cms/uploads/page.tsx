import { notFound } from "next/navigation";
import { requireOpsRole } from "@/lib/auth/requireOpsRole";
import { SiteNav } from "@/components/SiteNav";
import { UploadForm } from "./UploadForm";

export default async function CmsUploadsPage() {
  const ctx = await requireOpsRole(["VOL_MKT"]);
  if (!ctx) notFound();

  return (
    <>
      <SiteNav />
      <main className="main--wide">
      <h1>Upload a file</h1>
      <p>
        Upload an image or PDF to get a URL — paste it into a news post&apos;s image field, or into any
        page&apos;s Markdown content (e.g. <code>![alt text](url)</code> for an image, or{" "}
        <code>[Constitution](url)</code> for a document link).
      </p>
      <UploadForm />
    </main>
    </>
  );
}
