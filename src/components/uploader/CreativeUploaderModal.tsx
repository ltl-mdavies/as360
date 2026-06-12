// src/components/uploader/CreativeUploaderModal.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import Portal from "../common/Portal";
import { formatMediaDimensions } from "../../logic/mockAssignment";
import { prepareUploadFilesWithPreview, type PreparedUploadFile } from "./uploadFiles";

import "./uploader.css";

export type VariantOption = {
  key: string;          // mediaVariantKey
  mediaName: string;
  w: number;
  h: number;
  color?: string;
  shortLabel?: string;
};

export default function CreativeUploaderModal({
  isOpen,
  onClose,
  variants,
  onAddToProject,
}: {
  isOpen: boolean;
  onClose: () => void;
  variants: VariantOption[];
  onAddToProject: (args: {
    variantKey: string;
    files: Array<{ file: File; filename: string; isPdf: boolean; objectUrl?: string | null }>;
  }) => void;
}) {
  const [selectedVariantKey, setSelectedVariantKey] = useState<string | null>(null);
  const [pending, setPending] = useState<PreparedUploadFile[]>([]);
  const dropRef = useRef<HTMLDivElement | null>(null);

  const selectedVariant = useMemo(
    () => variants.find((v) => v.key === selectedVariantKey) || null,
    [variants, selectedVariantKey]
  );

  // Reset when opening
  useEffect(() => {
    if (!isOpen) return;
    setSelectedVariantKey(null);
    setPending([]);
  }, [isOpen]);

  // Revoke object URLs on unmount/close
  useEffect(() => {
    return () => {
      pending.forEach((p) => {
        if (p.objectUrl) URL.revokeObjectURL(p.objectUrl);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function addFiles(list: FileList | File[]) {
    const arr = Array.from(list || []);
    if (arr.length === 0) return;
    void (async () => {
      const next = await prepareUploadFilesWithPreview(arr);
      setPending((prev) => [...prev, ...next]);
    })();
  }

  function removePending(id: string) {
    setPending((prev) => {
      const hit = prev.find((p) => p.id === id);
      if (hit?.objectUrl) URL.revokeObjectURL(hit.objectUrl);
      return prev.filter((p) => p.id !== id);
    });
  }

  const canSubmit = !!selectedVariantKey && pending.length > 0;
  const pendingCountLabel = `${pending.length} file${pending.length === 1 ? "" : "s"} ready`;

  function submit() {
    if (!canSubmit || !selectedVariantKey) return;

    onAddToProject({
      variantKey: selectedVariantKey,
      files: pending.map((p) => ({
        file: p.file,
        filename: p.file.name,
        isPdf: p.isPdf,
        objectUrl: p.objectUrl,
      })),
    });

    // Close immediately; parent will update list + toast
    onClose();
  }

  if (!isOpen) return null;

  return (
    <Portal>
      <div className="upl-backdrop" onMouseDown={onClose}>
        <div className="upl-modal" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
          <div className="upl-head">
            <div className="upl-headMain">
              <div className="upl-title">Upload Artwork</div>
              <div className="upl-sub">
                Choose a media + dimensions variant, then drop files. All uploaded files in this session will be tagged with that variant.
              </div>
              <div className="upl-headMeta">
                <span className="upl-metaPill">
                  {selectedVariant ? `${selectedVariant.mediaName} · ${formatMediaDimensions(selectedVariant.w, selectedVariant.h)}` : "Select a variant to begin"}
                </span>
                <span className={`upl-metaPill ${pending.length > 0 ? "is-ready" : ""}`}>
                  {pendingCountLabel}
                </span>
              </div>
            </div>
            <button className="btn btn-ghost btn-soft upl-close" type="button" onClick={onClose} aria-label="Close uploader">
              ✕
            </button>
          </div>

          <div className="upl-body">
            {/* Step 1: Variant selection */}
            <div className="upl-step">
              <div className="upl-stepHead">
                <div className="upl-stepTitle">1) Select media + dimensions</div>
                <div className="upl-stepNote">Choose the final production size before uploading files.</div>
              </div>

              <div className="upl-variants">
                {variants.map((v) => {
                  const isOn = v.key === selectedVariantKey;
                  return (
                    <button
                      key={v.key}
                      type="button"
                      className={`upl-variant ${isOn ? "is-on" : ""}`}
                      onClick={() => setSelectedVariantKey(v.key)}
                    >
                      <span className="upl-dot" style={{ background: v.color || "rgba(148,163,184,.9)" }} />
                      <span className="upl-variantText">
                        <span className="upl-variantName">{v.mediaName}</span>
                        <span className="upl-variantSize">{formatMediaDimensions(v.w, v.h)}</span>
                      </span>
                      {isOn ? <span className="upl-variantState">Selected</span> : null}
                    </button>
                  );
                })}
              </div>

              {!selectedVariant && (
                <div className="upl-hint">
                  Select a variant to enable uploads.
                </div>
              )}
            </div>

            {/* Step 2: Drop zone */}
            <div className={`upl-step ${!selectedVariant ? "is-disabled" : ""}`}>
              <div className="upl-stepHead">
                <div className="upl-stepTitle">2) Drag & drop files</div>
                <div className="upl-stepNote">Add approved artwork files for the selected media size.</div>
              </div>

              <div
                ref={dropRef}
                className="upl-drop"
                onDragOver={(e) => {
                  if (!selectedVariant) return;
                  e.preventDefault();
                  e.stopPropagation();
                  dropRef.current?.classList.add("is-dragover");
                }}
                onDragLeave={() => dropRef.current?.classList.remove("is-dragover")}
                onDrop={(e) => {
                  dropRef.current?.classList.remove("is-dragover");
                  if (!selectedVariant) return;
                  e.preventDefault();
                  e.stopPropagation();
                  if (e.dataTransfer?.files) addFiles(e.dataTransfer.files);
                }}
              >
                <div className="upl-dropEyebrow">Upload surface</div>
                <div className="upl-dropIcon">⬆</div>
                <div className="upl-dropTitle">Drop files here</div>
                <div className="upl-dropSub">PDFs are most common. Images are supported for demo previews.</div>

                <label className="btn btn-ghost btn-soft upl-browse">
                  Browse files
                  <input
                    type="file"
                    multiple
                    accept="application/pdf,image/*"
                    onChange={(e) => {
                      if (!selectedVariant) return;
                      if (e.target.files) addFiles(e.target.files);
                      e.currentTarget.value = "";
                    }}
                    style={{ display: "none" }}
                  />
                </label>
              </div>
            </div>

            {/* Files list */}
            <div className="upl-step">
              <div className="upl-stepHead">
                <div className="upl-stepTitle">3) Review</div>
                <div className="upl-stepNote">Confirm filenames and file types before adding them to the project.</div>
              </div>

              {pending.length === 0 ? (
                <div className="upl-empty">
                  <div className="upl-emptyTitle">No files added yet</div>
                  <div className="upl-emptyText">Once files are dropped here, we’ll show a clean review list before they are added to the project.</div>
                </div>
              ) : (
                <div className="upl-files">
                  {pending.map((p) => (
                    <div key={p.id} className="upl-fileRow">
                      <div className="upl-thumb">
                        {p.objectUrl ? (
                          <img src={p.objectUrl} alt="" />
                        ) : (
                          <div className="upl-pdfBadge">{p.isPdf ? "PDF" : "FILE"}</div>
                        )}
                      </div>

                      <div className="upl-fileMain">
                        <div className="upl-fileName" title={p.file.name}>{p.file.name}</div>
                        <div className="upl-fileMeta">
                          {(p.isPdf ? "PDF" : (p.file.type || "File"))} · {p.sizeLabel}
                          {selectedVariant ? (
                            <> · {selectedVariant.mediaName} {formatMediaDimensions(selectedVariant.w, selectedVariant.h)}</>
                          ) : null}
                        </div>
                      </div>

                      <button className="btn btn-ghost btn-soft upl-remove" type="button" onClick={() => removePending(p.id)} title="Remove">
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="upl-foot">
            <button className="btn btn-ghost btn-soft" type="button" onClick={onClose}>
              Cancel
            </button>

            <button className="btn btn-primary btn-wide" type="button" disabled={!canSubmit} onClick={submit}>
              Add to Project
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
