"use client";

import { useEffect, useState } from "react";
import { listUploadedFiles, type UploadedFileRow } from "@/app/ops/cms/media/actions";
import { formatFileSize } from "@/lib/uploads/format";

/**
 * Same modal shell/conventions as admin/sessions/EditSessionModal.tsx
 * (backdrop + centered panel, Escape-to-close, backdrop-click-to-close,
 * role="dialog"), fetching lazily on open rather than the parent form
 * preloading the whole library up front on every page view. `files` is
 * cleared (not just hidden) on close so reopening always re-fetches —
 * something else may have uploaded a file in the meantime.
 */
export function MediaPickerModal({ onSelect }: { onSelect: (file: UploadedFileRow) => void }) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<UploadedFileRow[] | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listUploadedFiles().then((result) => {
      if (!cancelled) setFiles(result);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  function close() {
    setOpen(false);
    setFiles(null);
  }

  function pick(file: UploadedFileRow) {
    onSelect(file);
    close();
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Browse existing
      </button>

      {open && (
        <div className="modal-backdrop" onClick={close}>
          <div
            className="modal-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Choose a previously uploaded file"
            onClick={(e) => e.stopPropagation()}
          >
            <button type="button" className="modal-close" aria-label="Close" onClick={close}>
              ×
            </button>
            <h3>Choose a file</h3>

            {files === null && <p>Loading…</p>}

            {files !== null && files.length === 0 && <p>No files uploaded yet.</p>}

            {files !== null && files.length > 0 && (
              <div className="media-picker-grid">
                {files.map((file) => (
                  <button
                    type="button"
                    key={file.id}
                    className="media-picker-item"
                    onClick={() => pick(file)}
                    title={file.originalFilename ?? file.key}
                  >
                    {file.contentType.startsWith("image/") ? (
                      // eslint-disable-next-line @next/next/no-img-element -- see CMS implementation notes: an arbitrary/editor-controlled URL can't use next/image without per-domain remotePatterns.
                      <img src={file.url} alt="" />
                    ) : (
                      <span aria-hidden="true">📄</span>
                    )}
                    <span className="media-picker-caption">
                      {file.originalFilename ?? file.key} · {formatFileSize(file.sizeBytes)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
