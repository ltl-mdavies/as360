import { useMemo, useRef, useState } from "react";
import Panel from "../../components/common/Panel";
import Portal from "../../components/common/Portal";
import PageHeader from "../../components/common/PageHeader";
import Lightbox from "../../components/common/Lightbox";
import CreativeUploaderModal from "../../components/uploader/CreativeUploaderModal";
import { prepareUploadFiles, type ProjectUploadFile } from "../../components/uploader/uploadFiles";
import {
  formatMediaDimensions,
  mediaLabelFromKey,
  mockMediaVariants,
  type MediaVariant,
  type CreativeAsset,
  type InventoryItem,
} from "../../logic/mockAssignment";

import "../../styles/artworkFolder.css";

type ArtworkFolderWorkspaceProps = {
  projectId?: string;
  projectTitle: string;
  venueName: string;
  marketName: string;
  artworkDue?: string | null;
  postDate?: string | null;
  creatives: CreativeAsset[];
  inventory: InventoryItem[];
  variantCatalog?: MediaVariant[];
  backLabel?: string;
  onBack?: () => void;
  onClose?: () => void;
  chrome?: "page" | "modal";
  canUpload?: boolean;
  isLoading?: boolean;
  onUploadFiles: (args: { variantKey: string; files: ProjectUploadFile[] }) => void;
  onDeleteCreative?: (creative: CreativeAsset) => void;
  onReplaceCreative?: (creative: CreativeAsset) => void;
};

function variantForKey(key: string) {
  const known = mockMediaVariants.find((v) => v.key === key);
  if (known) return known;

  const [mediaName, w, h] = key.split("||");
  return {
    key,
    mediaName: mediaName || mediaLabelFromKey(key),
    w: Number(w || 0),
    h: Number(h || 0),
    shortLabel: (mediaName || "M").slice(0, 2).toUpperCase(),
    color: "rgba(148,163,184,.9)",
  };
}

function toProjectUploadFiles(files: ReturnType<typeof prepareUploadFiles>): ProjectUploadFile[] {
  return files.map((p) => ({
    file: p.file,
    filename: p.filename,
    isPdf: p.isPdf,
    objectUrl: p.objectUrl,
  }));
}

export default function ArtworkFolderWorkspace({
  projectTitle,
  venueName,
  marketName,
  artworkDue,
  postDate,
  creatives,
  inventory,
  variantCatalog,
  backLabel = "← Back to Hub",
  onBack,
  onClose,
  chrome = "page",
  canUpload = true,
  isLoading = false,
  onUploadFiles,
  onDeleteCreative,
  onReplaceCreative,
}: ArtworkFolderWorkspaceProps) {
  const [isUploaderOpen, setUploaderOpen] = useState(false);
  const [dragVariantKey, setDragVariantKey] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{
    src: string;
    fallbackSrc?: string;
    title?: string;
    subtitle?: string;
    openUrl?: string;
    assetType?: "image" | "document";
  } | null>(null);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  const variantLookup = useMemo(() => {
    const source = variantCatalog?.length ? variantCatalog : mockMediaVariants;
    return new Map(source.map((variant) => [variant.key, variant]));
  }, [variantCatalog]);

  const sections = useMemo(() => {
    const requiredByVariant = new Map<string, number>();
    inventory.forEach((item: any) => {
      if (!item.mediaVariantKey) return;
      requiredByVariant.set(item.mediaVariantKey, (requiredByVariant.get(item.mediaVariantKey) || 0) + 1);
    });

    const creativesByVariant = new Map<string, CreativeAsset[]>();
    creatives.forEach((creative) => {
      const arr = creativesByVariant.get(creative.mediaVariantKey) || [];
      arr.push(creative);
      creativesByVariant.set(creative.mediaVariantKey, arr);
    });

    const keys = new Set<string>([...Array.from(requiredByVariant.keys()), ...Array.from(creativesByVariant.keys())]);

    return Array.from(keys)
      .map((key) => {
        const variant = variantLookup.get(key) || variantForKey(key);
        const files = (creativesByVariant.get(key) || []).slice().sort((a, b) => a.filename.localeCompare(b.filename));
        const requiredCount = requiredByVariant.get(key) || 0;
        const assignedCount = files.reduce((sum, c) => sum + (c.assignedInventoryIds?.length || 0), 0);
        const uploadedCount = files.length;
        const guideTone =
          requiredCount === 0
            ? "neutral"
            : assignedCount >= requiredCount && requiredCount > 0
            ? "success"
            : uploadedCount > 0
            ? "progress"
            : "warning";
        const guideLabel =
          requiredCount === 0
            ? "No scoped locations"
            : assignedCount >= requiredCount && requiredCount > 0
            ? "Fully assigned"
            : uploadedCount > 0
            ? "Artwork uploaded"
            : "Needs artwork";
        const guideBody =
          requiredCount === 0
            ? "This variant is not currently scoped into the project."
            : uploadedCount === 0
            ? "needs_uploaded_artwork"
            : assignedCount >= requiredCount
            ? "fully_assigned"
            : assignedCount > 0
            ? "partially_assigned"
            : "uploaded_not_assigned";
        return {
          key,
          variant,
          label: `${variant.mediaName} · ${formatMediaDimensions(variant.w, variant.h)}`,
          variantDisplay: `${variant.mediaName} • ${formatMediaDimensions(variant.w, variant.h)}`,
          requiredCount,
          uploadedCount,
          assignedCount,
          guideTone,
          guideLabel,
          guideBody,
          files,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [creatives, inventory, variantLookup]);

  const kpis = useMemo(() => {
    const covered = sections.filter((section) => section.uploadedCount > 0).length;
    return {
      files: creatives.length,
      variants: sections.length,
      covered,
      needsArtwork: Math.max(0, sections.length - covered),
    };
  }, [creatives.length, sections]);

  const uploaderVariants = sections.map((section) => section.variant);

  function uploadPreparedFiles(variantKey: string, list: FileList | File[]) {
    if (!canUpload) return;
    const prepared = prepareUploadFiles(list);
    if (prepared.length === 0) return;
    onUploadFiles({ variantKey, files: toProjectUploadFiles(prepared) });
  }

  const content = (
    <div className={`artwork-folder ${chrome === "modal" ? "artwork-folder-modalBody" : ""}`}>
      <PageHeader
        variant={chrome === "modal" ? "workspace" : "standard"}
        className={chrome === "modal" ? "page-header-compactProject artwork-folder-modalHeader" : "page-header-compactProject"}
        eyebrow="Artwork Folder"
        title={projectTitle}
        backLabel={chrome === "page" && onBack ? backLabel : undefined}
        onBack={chrome === "page" ? onBack : undefined}
        meta={
          <div className="artwork-folder-projectMeta">
            <span className="artwork-folder-chip">{marketName}</span>
            <span className="artwork-folder-chip">{venueName}</span>
            <span className="artwork-folder-detail">
              <span>Artwork Due</span>
              <strong>{artworkDue || "—"}</strong>
            </span>
            <span className="artwork-folder-detail">
              <span>Post Date</span>
              <strong>{postDate || "—"}</strong>
            </span>
          </div>
        }
        actions={
          <>
            <button className="btn btn-primary btn-lg" type="button" disabled={!canUpload} onClick={() => setUploaderOpen(true)}>
              Upload Artwork
            </button>
            {chrome === "modal" && onClose ? (
              <button className="btn btn-ghost btn-soft btn-lg" type="button" onClick={onClose}>
                Close
              </button>
            ) : null}
          </>
        }
      />

      <div className="artwork-folder-kpis">
        <div className="artwork-folder-kpi artwork-folder-kpi-blue">
          <span>Artwork Files</span>
          <strong>{kpis.files}</strong>
        </div>
        <div className="artwork-folder-kpi artwork-folder-kpi-slate">
          <span>Variant Buckets</span>
          <strong>{kpis.variants}</strong>
        </div>
        <div className="artwork-folder-kpi artwork-folder-kpi-green">
          <span>Covered Variants</span>
          <strong>{kpis.covered}</strong>
        </div>
        <div className="artwork-folder-kpi artwork-folder-kpi-amber">
          <span>Needs Artwork</span>
          <strong>{kpis.needsArtwork}</strong>
        </div>
      </div>

      <Panel className="artwork-folder-panel">
        <div className="artwork-folder-panelHead">
          <div>
            <div className="artwork-folder-panelTitle">Artwork by Media Variant</div>
            <div className="artwork-folder-panelSub">
              Upload-only workspace for collecting production artwork before placement and approval.
            </div>
          </div>
          <button className="btn btn-ghost btn-soft" type="button" disabled={!canUpload} onClick={() => setUploaderOpen(true)}>
            Use Guided Uploader
          </button>
        </div>

        <div className="artwork-folder-sections">
          {!isLoading && sections.map((section) => (
            <div key={section.key} className="artwork-folder-variant">
              <div className="artwork-folder-variantHead">
                  <div className="artwork-folder-variantTitleGroup">
                    <span className="artwork-folder-dot" style={{ background: section.variant.color }} />
                    <div>
                      <div className="artwork-folder-variantTitle">{section.variant.mediaName}</div>
                      <div className="artwork-folder-variantSub">{formatMediaDimensions(section.variant.w, section.variant.h)}</div>
                  </div>
                </div>
                <div className="artwork-folder-variantStats">
                  <span>{section.requiredCount} in venue</span>
                  <span>{section.uploadedCount} file{section.uploadedCount === 1 ? "" : "s"} uploaded</span>
                </div>
                </div>

                <div className={`artwork-folder-variantGuide artwork-folder-variantGuide-${section.guideTone}`}>
                  <div className="artwork-folder-variantGuideLabel">{section.guideLabel}</div>
                  <div className="artwork-folder-variantGuideBody">
                    {section.guideBody === "needs_uploaded_artwork" && (
                      <>
                        Design team brief: this project includes {section.requiredCount}{" "}
                        <span className="artwork-folder-variantGuideEmphasis">{section.variantDisplay}</span>{" "}
                        placement{section.requiredCount === 1 ? "" : "s"} in the venue, and no files have been uploaded yet.
                      </>
                    )}
                    {section.guideBody === "fully_assigned" && (
                      <>
                        <span className="artwork-folder-variantGuideEmphasis">{section.variantDisplay}</span> is fully covered.
                        {" "}{Math.min(section.assignedCount, section.requiredCount)} of {section.requiredCount} placements are assigned, with {section.uploadedCount} file{section.uploadedCount === 1 ? "" : "s"} uploaded.
                      </>
                    )}
                    {section.guideBody === "partially_assigned" && (
                      <>
                        <span className="artwork-folder-variantGuideEmphasis">{section.variantDisplay}</span> is underway.
                        {" "}{Math.min(section.assignedCount, section.requiredCount)} of {section.requiredCount} locations are already assigned, and {section.uploadedCount} file{section.uploadedCount === 1 ? "" : "s"} are available for this variant.
                      </>
                    )}
                    {section.guideBody === "uploaded_not_assigned" && (
                      <>
                        <span className="artwork-folder-variantGuideEmphasis">{section.variantDisplay}</span> artwork is uploaded and ready.
                        {" "}0 of {section.requiredCount} placements are assigned yet, so the placement team can start using the available file{section.uploadedCount === 1 ? "" : "s"}.
                      </>
                    )}
                    {section.guideBody === "This variant is not currently scoped into the project." && section.guideBody}
                  </div>
                </div>

              <div className="artwork-folder-variantBody">
                <div
                  className={`artwork-folder-drop ${dragVariantKey === section.key ? "is-dragover" : ""}`}
                  onDragOver={(e) => {
                    if (!canUpload) return;
                    e.preventDefault();
                    e.stopPropagation();
                    setDragVariantKey(section.key);
                  }}
                  onDragLeave={() => setDragVariantKey(null)}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDragVariantKey(null);
                    if (!canUpload) return;
                    if (e.dataTransfer.files) uploadPreparedFiles(section.key, e.dataTransfer.files);
                  }}
                >
                  <div className="artwork-folder-dropTitle">
                    {canUpload ? `Drop files for ${section.variant.mediaName}` : "Upload access is disabled"}
                  </div>
                  <div className="artwork-folder-dropSub">
                    {canUpload
                      ? `Files dropped here are automatically tagged as this media variant and can be used across ${section.requiredCount} project location${section.requiredCount === 1 ? "" : "s"}.`
                      : "This shared link can view artwork but cannot upload new files."}
                  </div>
                  <button
                    className="btn btn-ghost btn-soft"
                    type="button"
                    disabled={!canUpload}
                    onClick={() => fileInputs.current[section.key]?.click()}
                  >
                    Browse Files
                  </button>
                  <input
                    ref={(node) => {
                      fileInputs.current[section.key] = node;
                    }}
                    type="file"
                    multiple
                    accept="application/pdf,image/*"
                    onChange={(e) => {
                      if (e.currentTarget.files) uploadPreparedFiles(section.key, e.currentTarget.files);
                      e.currentTarget.value = "";
                    }}
                    hidden
                  />
                </div>

                <div className="artwork-folder-fileList">
                  {section.files.length === 0 ? (
                    <div className="artwork-folder-empty">
                      <div>No artwork uploaded for this variant yet.</div>
                      <span>Drag files into the upload target or use the guided uploader.</span>
                    </div>
                  ) : (
                    section.files.map((creative) => (
                      <div key={creative.id} className="artwork-folder-fileRow">
                        <button
                          className="artwork-folder-thumbBtn"
                          type="button"
                          onClick={() =>
                            setLightbox({
                              src: (creative as any).fullUrl || (creative as any).thumbUrl,
                              fallbackSrc: (creative as any).thumbUrl,
                              title: creative.filename,
                              subtitle: creative.fileMeta,
                              openUrl: (creative as any).fullUrl || (creative as any).thumbUrl,
                              assetType: creative.fileMeta?.toUpperCase().includes("PDF") ? "document" : "image",
                            })
                          }
                          title="Preview artwork"
                        >
                          {(creative as any).thumbUrl ? (
                            <img src={(creative as any).thumbUrl} alt="" loading="lazy" />
                          ) : (
                            <span>PDF</span>
                          )}
                          <i style={{ background: section.variant.color }} />
                        </button>
                        <div className="artwork-folder-fileMain">
                          <div className="artwork-folder-fileName" title={creative.filename}>
                            {creative.filename}
                          </div>
                          <div className="artwork-folder-fileMeta">{creative.fileMeta}</div>
                        </div>
                        <div className="artwork-folder-fileStatus">
                          {creative.uploadState === "uploading"
                            ? "Uploading…"
                            : creative.uploadState === "processing"
                            ? "Processing preview…"
                            : (creative.assignedInventoryIds?.length || 0) > 0
                            ? `${creative.assignedInventoryIds.length} placement${creative.assignedInventoryIds.length === 1 ? "" : "s"}`
                            : "Available for assignment"}
                        </div>
                        <div className="artwork-folder-fileActions">
                          {onReplaceCreative ? (
                            <button
                              className="btn btn-ghost btn-soft artwork-folder-replace"
                              type="button"
                              disabled={creative.uploadState === "uploading" || creative.uploadState === "processing"}
                              onClick={() => onReplaceCreative(creative)}
                            >
                              Replace File
                            </button>
                          ) : null}
                          {onDeleteCreative ? (
                            <button
                              className="btn btn-ghost btn-soft artwork-folder-delete"
                              type="button"
                              disabled={creative.uploadState === "uploading" || creative.uploadState === "processing"}
                              onClick={() => onDeleteCreative(creative)}
                            >
                              Delete
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          ))}
          {isLoading ? (
            <div className="artwork-folder-empty">
              Loading artwork buckets
              <span>Pulling project inventory and uploaded files from the backend.</span>
            </div>
          ) : null}
        </div>
      </Panel>

      <CreativeUploaderModal
        isOpen={isUploaderOpen && canUpload}
        onClose={() => setUploaderOpen(false)}
        variants={uploaderVariants}
        onAddToProject={onUploadFiles}
      />

      <Lightbox
        isOpen={!!lightbox}
        src={lightbox?.src || ""}
        fallbackSrc={lightbox?.fallbackSrc}
        title={lightbox?.title}
        subtitle={lightbox?.subtitle}
        openInNewTabUrl={lightbox?.openUrl}
        assetType={lightbox?.assetType}
        onClose={() => setLightbox(null)}
      />
    </div>
  );

  if (chrome !== "modal") return content;

  return (
    <Portal>
      <div className="artwork-folder-scrim" onMouseDown={onClose}>
        <div className="artwork-folder-modal" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
          {content}
        </div>
      </div>
    </Portal>
  );
}
