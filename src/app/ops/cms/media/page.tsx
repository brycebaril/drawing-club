import { notFound } from "next/navigation";
import { requireOpsRole } from "@/lib/auth/requireOpsRole";
import { SiteNav } from "@/components/SiteNav";
import { UploadForm } from "../uploads/UploadForm";
import { listUploadedFiles } from "./actions";
import { DeleteFileButton } from "./DeleteFileButton";
import { formatFileSize } from "@/lib/uploads/format";
import { ORG_TIMEZONE } from "@/lib/org";

export default async function CmsMediaLibraryPage() {
  const ctx = await requireOpsRole(["VOL_MKT"]);
  if (!ctx) notFound();

  const files = await listUploadedFiles();

  return (
    <>
      <SiteNav />
      <main className="main--wide">
        <h1>Media library</h1>
        <p>
          Upload a new file here, or reuse any of these from the &quot;Browse existing&quot; button on a content
          editor.
        </p>
        <UploadForm />

        <h2>Uploaded files</h2>
        {files.length === 0 ? (
          <p>No files uploaded yet.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th>Filename</th>
                  <th>Type</th>
                  <th>Size</th>
                  <th>Dimensions</th>
                  <th>Uploaded by</th>
                  <th>Uploaded</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {files.map((file) => (
                  <tr key={file.id}>
                    <td>
                      {file.contentType.startsWith("image/") ? (
                        // eslint-disable-next-line @next/next/no-img-element -- see CMS implementation notes: an arbitrary/editor-controlled URL can't use next/image without per-domain remotePatterns.
                        <img src={file.url} alt="" width={60} height={60} style={{ objectFit: "cover" }} />
                      ) : (
                        "📄"
                      )}
                    </td>
                    <td>{file.originalFilename ?? file.key}</td>
                    <td>{file.contentType}</td>
                    <td>{formatFileSize(file.sizeBytes)}</td>
                    <td>{file.width && file.height ? `${file.width}×${file.height}` : "—"}</td>
                    <td>{file.uploadedByUsername}</td>
                    <td>{new Date(file.createdAt).toLocaleString("en-US", { timeZone: ORG_TIMEZONE })}</td>
                    <td>
                      <DeleteFileButton fileId={file.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  );
}
