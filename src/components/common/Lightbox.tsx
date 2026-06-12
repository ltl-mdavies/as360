// src/components/common/Lightbox.tsx
import { useEffect, useState } from "react";
import Portal from "./Portal";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type LightboxProps = {
  isOpen: boolean;
  src: string;
  title?: string;
  subtitle?: string;
  onClose: () => void;
  openInNewTabUrl?: string;
  assetType?: "image" | "document";
};

export default function Lightbox({
  isOpen,
  src,
  title,
  subtitle,
  onClose,
  openInNewTabUrl,
  assetType = "image",
}: LightboxProps) {
  const [documentPreviewSrc, setDocumentPreviewSrc] = useState(src);
  const [documentPreviewLoading, setDocumentPreviewLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);

    // Prevent body scroll while open
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    let cancelled = false;
    let objectUrlToRevoke: string | null = null;

    async function renderPdfPreview() {
      if (!isOpen || assetType !== "document") {
        setDocumentPreviewSrc(src);
        setDocumentPreviewLoading(false);
        return;
      }

      setDocumentPreviewSrc(src);

      if (!openInNewTabUrl || !/\.pdf($|[?#])/i.test(openInNewTabUrl)) {
        setDocumentPreviewLoading(false);
        return;
      }

      try {
        setDocumentPreviewLoading(true);
        const pdf = await getDocument(openInNewTabUrl).promise;
        const page = await pdf.getPage(1);
        const baseViewport = page.getViewport({ scale: 1 });
        const targetWidth = 1200;
        const scale = targetWidth / Math.max(baseViewport.width, 1);
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");

        if (!context) throw new Error("Canvas rendering is unavailable");

        canvas.width = Math.max(1, Math.round(viewport.width));
        canvas.height = Math.max(1, Math.round(viewport.height));

        await page.render({ canvas, canvasContext: context, viewport }).promise;
        await pdf.destroy();

        const blob = await new Promise<Blob | null>((resolve) => {
          canvas.toBlob((next) => resolve(next), "image/jpeg", 0.9);
        });

        if (!blob || cancelled) return;
        objectUrlToRevoke = URL.createObjectURL(blob);
        setDocumentPreviewSrc(objectUrlToRevoke);
      } catch (error) {
        if (!cancelled) {
          console.warn("Failed to render document preview in lightbox", error);
          setDocumentPreviewSrc(src);
        }
      } finally {
        if (!cancelled) setDocumentPreviewLoading(false);
      }
    }

    void renderPdfPreview();

    return () => {
      cancelled = true;
      if (objectUrlToRevoke) URL.revokeObjectURL(objectUrlToRevoke);
    };
  }, [assetType, isOpen, openInNewTabUrl, src]);

  if (!isOpen) return null;

  return (
    <Portal>
      <div className="lb-backdrop" onMouseDown={onClose}>
        <div
          className="lb-modal"
          onMouseDown={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
        >
          <div className="lb-head">
            <div className="lb-head-left">
              {title && <div className="lb-title" title={title}>{title}</div>}
              {subtitle && <div className="lb-sub" title={subtitle}>{subtitle}</div>}
            </div>

            <div className="lb-head-right">
              {openInNewTabUrl && (
                <button
                  className="btn btn-ghost btn-soft"
                  type="button"
                  onClick={() => window.open(openInNewTabUrl, "_blank")}
                >
                  Open
                </button>
              )}
              <button className="btn btn-ghost btn-soft lb-close" type="button" onClick={onClose}>
                ✕
              </button>
            </div>
          </div>

          <div className="lb-body">
            {assetType === "document" ? (
              <div className="lb-docWrap">
                <img className="lb-img lb-img-doc" src={documentPreviewSrc} alt="" />
                <div className="lb-docNote">{documentPreviewLoading ? "Rendering document preview..." : "Document preview"}</div>
              </div>
            ) : (
              <img className="lb-img" src={src} alt="" />
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
}
