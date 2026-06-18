// src/components/common/Lightbox.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import Portal from "./Portal";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

function isCoarsePointerDevice() {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(pointer: coarse)").matches ?? false;
}

function isIOSLikeDevice() {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function shouldRenderClientPdfPreview() {
  if (typeof window === "undefined") return false;
  const narrowViewport = window.matchMedia?.("(max-width: 820px)").matches ?? false;
  const lowMemory =
    "deviceMemory" in navigator &&
    Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory) <= 4;

  return !narrowViewport && !isCoarsePointerDevice() && !isIOSLikeDevice() && !lowMemory;
}

type LightboxProps = {
  isOpen: boolean;
  src: string;
  fallbackSrc?: string;
  title?: string;
  subtitle?: string;
  onClose: () => void;
  openInNewTabUrl?: string;
  assetType?: "image" | "document";
};

export default function Lightbox({
  isOpen,
  src,
  fallbackSrc,
  title,
  subtitle,
  onClose,
  openInNewTabUrl,
  assetType = "image",
}: LightboxProps) {
  const previewStageRef = useRef<HTMLDivElement | null>(null);
  const [documentPreviewSrc, setDocumentPreviewSrc] = useState(fallbackSrc || src);
  const [documentPreviewLoading, setDocumentPreviewLoading] = useState(false);
  const [previewBox, setPreviewBox] = useState({ width: 0, height: 0 });
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const zoomLabel = `${Math.round(zoom * 100)}%`;
  const fitScale = useMemo(() => {
    if (!previewBox.width || !previewBox.height || !imageSize.width || !imageSize.height) return 1;
    return Math.min(previewBox.width / imageSize.width, previewBox.height / imageSize.height, 1);
  }, [imageSize.height, imageSize.width, previewBox.height, previewBox.width]);
  const fittedImageStyle =
    imageSize.width && imageSize.height
      ? {
          width: `${Math.max(1, Math.floor(imageSize.width * fitScale * zoom))}px`,
          height: `${Math.max(1, Math.floor(imageSize.height * fitScale * zoom))}px`,
        }
      : undefined;

  function zoomIn() {
    setZoom((current) => Math.min(3, Math.round((current + 0.25) * 100) / 100));
  }

  function zoomOut() {
    setZoom((current) => Math.max(1, Math.round((current - 0.25) * 100) / 100));
  }

  function resetZoom() {
    setZoom(1);
  }

  const displayedSrc = assetType === "document" ? documentPreviewSrc || fallbackSrc || src : src;

  useEffect(() => {
    if (!isOpen) return;

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if ((e.key === "+" || e.key === "=") && !e.metaKey && !e.ctrlKey) zoomIn();
      if (e.key === "-" && !e.metaKey && !e.ctrlKey) zoomOut();
      if (e.key === "0" && !e.metaKey && !e.ctrlKey) resetZoom();
    }
    document.addEventListener("keydown", onKey);

    const scrollY = window.scrollY;
    const lockBodyPosition = isCoarsePointerDevice() || isIOSLikeDevice();
    const prevOverflow = document.body.style.overflow;
    const prevPosition = document.body.style.position;
    const prevTop = document.body.style.top;
    const prevWidth = document.body.style.width;

    document.body.style.overflow = "hidden";
    if (lockBodyPosition) {
      document.body.style.position = "fixed";
      document.body.style.top = `-${scrollY}px`;
      document.body.style.width = "100%";
    }

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      document.body.style.position = prevPosition;
      document.body.style.top = prevTop;
      document.body.style.width = prevWidth;
      if (lockBodyPosition) window.scrollTo(0, scrollY);
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen) resetZoom();
  }, [isOpen, src]);

  useEffect(() => {
    setImageSize({ width: 0, height: 0 });
  }, [displayedSrc]);

  useEffect(() => {
    if (!isOpen || !previewStageRef.current) return;

    const stage = previewStageRef.current;
    const updatePreviewBox = () => {
      setPreviewBox({
        width: Math.max(0, stage.clientWidth),
        height: Math.max(0, stage.clientHeight),
      });
    };

    updatePreviewBox();
    const resizeObserver = new ResizeObserver(updatePreviewBox);
    resizeObserver.observe(stage);
    window.addEventListener("resize", updatePreviewBox);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updatePreviewBox);
    };
  }, [isOpen]);

  useEffect(() => {
    let cancelled = false;
    let objectUrlToRevoke: string | null = null;

    async function renderPdfPreview() {
      if (!isOpen || assetType !== "document") {
        setDocumentPreviewSrc(src);
        setDocumentPreviewLoading(false);
        return;
      }

      setDocumentPreviewSrc(fallbackSrc || src);

      if (!openInNewTabUrl || !/\.pdf($|[?#])/i.test(openInNewTabUrl)) {
        setDocumentPreviewSrc(fallbackSrc || src);
        setDocumentPreviewLoading(false);
        return;
      }

      if (!shouldRenderClientPdfPreview()) {
        setDocumentPreviewLoading(false);
        return;
      }

      let pdf: Awaited<ReturnType<typeof getDocument>["promise"]> | null = null;
      try {
        setDocumentPreviewLoading(true);
        pdf = await getDocument(openInNewTabUrl).promise;
        const page = await pdf.getPage(1);
        const baseViewport = page.getViewport({ scale: 1 });
        const targetWidth = 900;
        const scale = targetWidth / Math.max(baseViewport.width, 1);
        let viewport = page.getViewport({ scale });
        const maxCanvasPixels = 1_600_000;
        const projectedPixels = viewport.width * viewport.height;
        if (projectedPixels > maxCanvasPixels) {
          const pixelScale = Math.sqrt(maxCanvasPixels / projectedPixels);
          viewport = page.getViewport({ scale: scale * pixelScale });
        }
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");

        if (!context) throw new Error("Canvas rendering is unavailable");

        canvas.width = Math.max(1, Math.round(viewport.width));
        canvas.height = Math.max(1, Math.round(viewport.height));

        await page.render({ canvas, canvasContext: context, viewport }).promise;

        const blob = await new Promise<Blob | null>((resolve) => {
          canvas.toBlob((next) => resolve(next), "image/jpeg", 0.9);
        });

        if (!blob || cancelled) return;
        objectUrlToRevoke = URL.createObjectURL(blob);
        setDocumentPreviewSrc(objectUrlToRevoke);
      } catch (error) {
        if (!cancelled) {
          console.debug("Using fallback document preview in lightbox", error);
          setDocumentPreviewSrc(fallbackSrc || src);
        }
      } finally {
        if (pdf) void pdf.destroy();
        if (!cancelled) setDocumentPreviewLoading(false);
      }
    }

    void renderPdfPreview();

    return () => {
      cancelled = true;
      if (objectUrlToRevoke) URL.revokeObjectURL(objectUrlToRevoke);
    };
  }, [assetType, fallbackSrc, isOpen, openInNewTabUrl, src]);

  if (!isOpen) return null;

  return (
    <Portal>
      <div className="lb-backdrop" onClick={onClose}>
        <div
          className="lb-modal"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
        >
          <div className="lb-head">
            <div className="lb-head-left">
              {title && <div className="lb-title" title={title}>{title}</div>}
              {subtitle && <div className="lb-sub" title={subtitle}>{subtitle}</div>}
            </div>

            <div className="lb-head-right">
              <div className="lb-zoomControls" role="group" aria-label="Preview zoom controls">
                <button className="btn btn-ghost btn-soft" type="button" onClick={zoomOut} disabled={zoom <= 1} aria-label="Zoom out">
                  −
                </button>
                <button className="btn btn-ghost btn-soft lb-zoomFit" type="button" onClick={resetZoom} disabled={zoom === 1}>
                  {zoom === 1 ? "Fit" : zoomLabel}
                </button>
                <button className="btn btn-ghost btn-soft" type="button" onClick={zoomIn} disabled={zoom >= 3} aria-label="Zoom in">
                  +
                </button>
              </div>
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

          <div className={`lb-body ${zoom > 1 ? "is-zoomed" : ""} ${assetType === "document" ? "has-doc" : ""}`}>
            <div className="lb-zoomStage" ref={previewStageRef}>
              <img
                className={`lb-img ${assetType === "document" ? "lb-img-doc" : ""}`}
                src={displayedSrc}
                style={fittedImageStyle}
                onLoad={(event) => {
                  setImageSize({
                    width: event.currentTarget.naturalWidth,
                    height: event.currentTarget.naturalHeight,
                  });
                }}
                alt=""
              />
            </div>
            {assetType === "document" ? (
              <div className="lb-docNote">{documentPreviewLoading ? "Rendering document preview..." : "Document preview"}</div>
            ) : null}
          </div>
        </div>
      </div>
    </Portal>
  );
}
