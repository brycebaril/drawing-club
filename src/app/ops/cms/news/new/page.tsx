import { notFound } from "next/navigation";
import { requireOpsRole } from "@/lib/auth/requireOpsRole";
import { OpsNav } from "@/components/OpsNav";
import { NewsPostForm } from "../NewsPostForm";
import { toDateOnly } from "@/lib/sessions/shared";

export default async function NewNewsPostPage() {
  const ctx = await requireOpsRole(["VOL_MKT"]);
  if (!ctx) notFound();

  return (
    <main>
      <OpsNav roles={ctx.roles} />
      <h1>New post</h1>
      <NewsPostForm
        mode="create"
        initial={{
          title: "",
          slug: "",
          excerpt: "",
          content: "",
          imageUrl: "",
          status: "Draft",
          publishDate: toDateOnly(new Date()),
        }}
      />
    </main>
  );
}
