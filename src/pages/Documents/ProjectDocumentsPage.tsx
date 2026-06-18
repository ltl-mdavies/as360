import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import AppShell from "../../app/AppShell";
import PageHeader from "../../components/common/PageHeader";
import Panel from "../../components/common/Panel";
import Lightbox from "../../components/common/Lightbox";
import { useApiClient } from "../../api/useApiClient";
import {
  createProjectDocument,
  fetchProjectDocuments,
  fetchProjectWorkspace,
  generateProjectCreativePackage,
  logProjectErrorEvent,
  requestArtworkUploadUrl,
  type ApiProjectDocument,
} from "../../api/projects";
import { buildDocumentThumbUrl } from "../../logic/imageUrls";
import { triggerBrowserDownload } from "../../logic/downloads";
import { generatePdfThumbnail, prepareUploadFilesWithPreview } from "../../components/uploader/uploadFiles";
import "../../styles/documents.css";

type PendingDocument = {
  id: string;
  file: File;
  filename: string;
  isPdf: boolean;
  objectUrl: string | null;
  sizeLabel: string;
};

type DocumentSourceMode = "adspace" | "external" | "hybrid";

const categoryLabels: Record<ApiProjectDocument["category"], string> = {
  project_document: "Project Document",
  lift_payload: "Lift Payload",
  allocation_report: "Allocation Report",
  order_package: "Order Package",
  reconciliation: "Reconciliation",
};

function describeGeneratedRecord(document: ApiProjectDocument) {
  if (document.category === "order_package") {
    return {
      label: "Artwork Package",
      detail: "Client artwork ZIP with creative allocation manifest",
      tone: "tone-info",
    };
  }

  if (document.category !== "lift_payload") {
    return {
      label: categoryLabels[document.category],
      detail: document.contentType || "Generated record",
      tone: "tone-success",
    };
  }

  if (document.filename.startsWith("lift-preview-")) {
    return {
      label: "Preview Snapshot",
      detail: "Dry-run Lift payload captured before submission",
      tone: "tone-info",
    };
  }

  if (document.filename.includes("-request.")) {
    return {
      label: "Submitted Request",
      detail: "Lift request payload stored after submission",
      tone: "tone-success",
    };
  }

  if (document.filename.includes("-response.")) {
    return {
      label: "Lift Response",
      detail: "Lift response snapshot stored after submission",
      tone: "tone-success",
    };
  }

  return {
    label: categoryLabels[document.category],
    detail: document.contentType || "Generated record",
    tone: "tone-success",
  };
}

function formatBytes(bytes?: number | null) {
  if (!bytes) return "";
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
}

function formatTimestamp(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function isImageDocument(document: ApiProjectDocument) {
  return Boolean(document.contentType?.startsWith("image/"));
}

function externalRepoLabel(url: string) {
  const normalized = url.toLowerCase();
  if (normalized.includes("drive.google.com")) return "Google Drive Folder";
  if (normalized.includes("sharepoint.com") || normalized.includes("onedrive")) return "Shared Document Folder";
  return "External Document Repository";
}

export default function ProjectDocumentsPage() {
  const api = useApiClient();
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId || "";
  const shareMode = useMemo(() => new URLSearchParams(location.search).has("share"), [location.search]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projectMeta, setProjectMeta] = useState<{
    title: string;
    venueName: string;
    marketName: string;
    artworkDueDate?: string;
    postDate?: string;
    documentSourceMode?: DocumentSourceMode;
    documentLibraryUrl?: string;
  } | null>(null);
  const [documents, setDocuments] = useState<ApiProjectDocument[]>([]);
  const [pending, setPending] = useState<PendingDocument[]>([]);
  const [lightboxDoc, setLightboxDoc] = useState<ApiProjectDocument | null>(null);
  const [packageGenerating, setPackageGenerating] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!projectId) return;
      setLoading(true);
      setError(null);
      try {
        const [workspaceResult, documentsResult] = await Promise.allSettled([
          fetchProjectWorkspace(api, projectId, shareMode),
          fetchProjectDocuments(api, projectId, shareMode),
        ]);
        if (cancelled) return;

        if (workspaceResult.status === "fulfilled") {
          setProjectMeta({
            title: workspaceResult.value.project.title,
            venueName: workspaceResult.value.project.venueName,
            marketName: workspaceResult.value.project.marketName,
            artworkDueDate: workspaceResult.value.project.artworkDueDate,
            postDate: workspaceResult.value.project.postDate,
            documentSourceMode: workspaceResult.value.project.documentSourceMode,
            documentLibraryUrl: workspaceResult.value.project.documentLibraryUrl,
          });
        } else {
          console.warn("Failed to load project document workspace metadata", workspaceResult.reason);
        }

        if (documentsResult.status === "fulfilled") {
          setDocuments(documentsResult.value.documents || []);
        } else {
          console.error("Failed to load project documents", documentsResult.reason);
          setError("We couldn’t load the document repository for this project.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [api, projectId, shareMode]);

  const uploadedDocuments = useMemo(
    () => documents.filter((document) => document.source === "uploaded"),
    [documents]
  );
  const generatedDocuments = useMemo(
    () => documents.filter((document) => document.source === "generated"),
    [documents]
  );

  async function generateCreativePackage() {
    if (!projectId || shareMode) return;
    setPackageGenerating(true);
    setError(null);
    try {
      const response = await generateProjectCreativePackage(api, projectId);
      setDocuments((current) => [response.document, ...current.filter((document) => document.id !== response.document.id)]);
      if (response.document.fullUrl) {
        triggerBrowserDownload(response.document.fullUrl, response.document.filename);
      }
    } catch (packageError) {
      console.error("Failed to generate creative allocation package", packageError);
      setError("We couldn’t generate the artwork package yet.");
      await logProjectErrorEvent(api, projectId, {
        surface: "project_documents",
        severity: "warning",
        errorCode: "CREATIVE_PACKAGE_FAILED",
        message: "Artwork package generation failed.",
        metadata: {
          message: packageError instanceof Error ? packageError.message : String(packageError),
        },
      });
    } finally {
      setPackageGenerating(false);
    }
  }

  async function handleFilesSelected(fileList: FileList | null) {
    if (!fileList?.length) return;
    const prepared = await prepareUploadFilesWithPreview(fileList);
    setPending((current) => [
      ...prepared.map((file) => ({
        id: file.id,
        file: file.file,
        filename: file.filename,
        isPdf: file.isPdf,
        objectUrl: file.objectUrl,
        sizeLabel: file.sizeLabel,
      })),
      ...current,
    ]);
  }

  function removePending(id: string) {
    setPending((current) => {
      const next = current.filter((item) => item.id !== id);
      const removed = current.find((item) => item.id === id);
      if (removed?.objectUrl) URL.revokeObjectURL(removed.objectUrl);
      return next;
    });
  }

  async function uploadPendingDocuments() {
    if (!projectId || !pending.length || shareMode) return;
    setSaving(true);
    setError(null);
    try {
      const created: ApiProjectDocument[] = [];

      for (const item of pending) {
        const signed = await requestArtworkUploadUrl(api, {
          projectId,
          filename: item.filename,
          contentType: item.file.type || "application/octet-stream",
          assetKind: "projectDocument",
        });

        const uploadResponse = await fetch(signed.uploadUrl, {
          method: "PUT",
          headers: {
            "Content-Type": item.file.type || "application/octet-stream",
          },
          body: item.file,
        });

        if (!uploadResponse.ok) {
          throw new Error(`Upload failed for ${item.filename}`);
        }

        let thumbnailFile: File | null = null;
        let thumbSigned:
          | {
              key: string;
            }
          | null = null;

        if (item.isPdf) {
          try {
            thumbnailFile = await generatePdfThumbnail(item.file, item.filename);
            const signedThumb = await requestArtworkUploadUrl(api, {
              projectId,
              filename: thumbnailFile.name,
              contentType: thumbnailFile.type || "image/jpeg",
              assetKind: "projectDocument",
            });
            const thumbUploadResponse = await fetch(signedThumb.uploadUrl, {
              method: "PUT",
              headers: {
                "Content-Type": thumbnailFile.type || "image/jpeg",
              },
              body: thumbnailFile,
            });
            if (thumbUploadResponse.ok) {
              thumbSigned = { key: signedThumb.key };
            }
          } catch (thumbError) {
            console.warn("Failed to upload document thumbnail", thumbError);
          }
        }

        const response = await createProjectDocument(api, projectId, {
          bucketName: signed.bucket,
          objectKey: signed.key,
          thumbObjectKey: thumbSigned?.key,
          filename: item.filename,
          contentType: item.file.type || "application/octet-stream",
          thumbContentType: thumbnailFile?.type || undefined,
          sizeBytes: item.file.size,
        });
        created.push(response.document);
      }

      setDocuments((current) => [...created, ...current]);
      pending.forEach((item) => {
        if (item.objectUrl) URL.revokeObjectURL(item.objectUrl);
      });
      setPending([]);
    } catch (uploadError) {
      console.error("Failed to upload project documents", uploadError);
      setError("We couldn’t finish uploading those documents.");
      void logProjectErrorEvent(api, projectId, {
        actionType: "document_upload_failed",
        severity: "error",
        errorCode: "document_upload_failed",
        message: uploadError instanceof Error ? uploadError.message : "Project document upload failed",
        surface: "project_documents",
        workspace: "hub",
      });
    } finally {
      setSaving(false);
    }
  }

  const stats = useMemo(() => {
    const total = documents.length;
    const generated = generatedDocuments.length;
    const uploaded = uploadedDocuments.length;
    return { total, uploaded, generated };
  }, [documents.length, generatedDocuments.length, uploadedDocuments.length]);

  const documentSourceMode: DocumentSourceMode =
    projectMeta?.documentSourceMode || (projectMeta?.documentLibraryUrl ? "hybrid" : "adspace");
  const externalDocumentUrl = projectMeta?.documentLibraryUrl?.trim() || "";
  const usesExternalRepository = documentSourceMode === "external" || documentSourceMode === "hybrid";
  const allowAdspaceUploads = documentSourceMode !== "external";
  const externalLabel = externalDocumentUrl ? externalRepoLabel(externalDocumentUrl) : "External Document Repository";

  return (
    <AppShell pageClassName="wide">
      <PageHeader
        eyebrow="DOCUMENT REPOSITORY"
        backLabel="← Back to Hub"
        onBack={() => navigate(`/p/${projectId}${location.search}`)}
        title={projectMeta?.title || "Project Documents"}
        subtitle={
          documentSourceMode === "external"
            ? "Use the customer-approved external repository for reference docs while Adspace keeps generated records here."
            : documentSourceMode === "hybrid"
              ? "Use the venue’s external repository alongside Adspace uploads, generated records, and package artifacts."
              : "Keep project documents, generated order records, and future package artifacts in one dependable place."
        }
        meta={
          projectMeta ? (
            <div className="documents-meta">
              <span>{projectMeta.marketName}</span>
              <span className="page-header-dot">•</span>
              <span>{projectMeta.venueName}</span>
              {projectMeta.artworkDueDate ? (
                <>
                  <span className="page-header-dot">•</span>
                  <span>Artwork Due {projectMeta.artworkDueDate}</span>
                </>
              ) : null}
              {projectMeta.postDate ? (
                <>
                  <span className="page-header-dot">•</span>
                  <span>Post Date {projectMeta.postDate}</span>
                </>
              ) : null}
            </div>
          ) : undefined
        }
        actions={
          !shareMode ? (
            <div className="documents-headerActions">
              <button
                className="btn btn-ghost btn-soft"
                type="button"
                disabled={packageGenerating}
                onClick={() => void generateCreativePackage()}
              >
                {packageGenerating ? "Building Package…" : "Generate Artwork Package"}
              </button>
              {allowAdspaceUploads ? (
                <>
                  <button className="btn btn-ghost btn-soft" type="button" onClick={() => fileInputRef.current?.click()}>
                    Choose Files
                  </button>
                  <button className="btn btn-primary" type="button" disabled={!pending.length || saving} onClick={() => void uploadPendingDocuments()}>
                    {saving ? "Uploading…" : pending.length ? `Upload ${pending.length} File${pending.length === 1 ? "" : "s"}` : "Upload Files"}
                  </button>
                </>
              ) : null}
            </div>
          ) : null
        }
      />

      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          void handleFilesSelected(event.target.files);
          event.currentTarget.value = "";
        }}
      />

      <div className="documents-grid">
        {usesExternalRepository ? (
          <Panel className="documents-panel documents-panel-external">
            <div className="documents-externalCard">
              <div>
                <div className="documents-sectionEyebrow">External Repository</div>
                <div className="documents-externalTitle">{externalLabel}</div>
                <div className="documents-copy">
                  {externalDocumentUrl
                    ? "Customer reference files are managed in the approved external repository. Adspace-generated records remain available below."
                    : "This venue is configured to use an external repository, but no external document URL has been added yet."}
                </div>
              </div>
              {externalDocumentUrl ? (
                <a className="btn btn-primary documents-externalButton" href={externalDocumentUrl} target="_blank" rel="noreferrer">
                  Open {externalLabel}
                </a>
              ) : (
                <span className="chip tone-warning">URL needed</span>
              )}
            </div>
          </Panel>
        ) : null}

        <Panel className="documents-panel documents-panel-hero">
          <div className="documents-statGrid">
            <div className="documents-stat">
              <div className="documents-statValue">{stats.total}</div>
              <div className="documents-statLabel">Documents</div>
            </div>
            <div className="documents-stat">
              <div className="documents-statValue">{stats.uploaded}</div>
              <div className="documents-statLabel">Uploaded</div>
            </div>
            <div className="documents-stat">
              <div className="documents-statValue">{stats.generated}</div>
              <div className="documents-statLabel">Generated Records</div>
            </div>
          </div>

          {error ? <div className="documents-error">{error}</div> : null}

          {!shareMode && allowAdspaceUploads ? (
            <div className="documents-uploadStrip">
              <div>
                <div className="documents-sectionEyebrow">Add Documents</div>
                <div className="documents-copy">
                  Upload project-specific reference files here, or generate an artwork package containing client uploads and a creative allocation manifest.
                </div>
              </div>
              <div className="documents-headerActions">
                <button
                  className="btn btn-ghost btn-soft"
                  type="button"
                  disabled={packageGenerating}
                  onClick={() => void generateCreativePackage()}
                >
                  {packageGenerating ? "Building…" : "Artwork Package"}
                </button>
                <button className="btn btn-primary" type="button" onClick={() => fileInputRef.current?.click()}>
                  Add Documents
                </button>
              </div>
            </div>
          ) : null}

          {pending.length ? (
            <div className="documents-pending">
              {pending.map((item) => (
                <div key={item.id} className="documents-pendingRow">
                  <div className="documents-thumb">
                    {item.objectUrl ? <img src={item.objectUrl} alt="" /> : <img src={buildDocumentThumbUrl({ label: item.isPdf ? "PDF" : "FILE" })} alt="" />}
                  </div>
                  <div className="documents-pendingCopy">
                    <div className="documents-fileName">{item.filename}</div>
                    <div className="documents-fileMeta">{item.isPdf ? "PDF" : "FILE"} • {item.sizeLabel}</div>
                  </div>
                  <button className="btn btn-ghost btn-soft" type="button" onClick={() => removePending(item.id)}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </Panel>

        {allowAdspaceUploads ? (
          <Panel className="documents-panel" title="Project Documents" subtitle="Uploaded reference files and project attachments.">
            {loading ? (
              <div className="documents-empty">Loading project documents…</div>
            ) : uploadedDocuments.length ? (
              <div className="documents-list">
                {uploadedDocuments.map((document) => (
                  <button key={document.id} className="documents-row" type="button" onClick={() => setLightboxDoc(document)}>
                    <div className="documents-thumb">
                      <img
                        src={
                          document.thumbUrl ||
                          (isImageDocument(document)
                            ? document.fullUrl
                            : buildDocumentThumbUrl({ label: document.contentType === "application/pdf" ? "PDF" : "FILE" }))
                        }
                        alt=""
                      />
                    </div>
                    <div className="documents-rowCopy">
                      <div className="documents-rowHead">
                        <span className="documents-fileName">{document.filename}</span>
                        <span className="chip tone-info">{categoryLabels[document.category]}</span>
                      </div>
                      <div className="documents-fileMeta">
                        {formatBytes(document.sizeBytes)}{formatBytes(document.sizeBytes) ? " • " : ""}
                        {document.contentType || "Unknown type"} • Uploaded by {document.uploadedByName} • {formatTimestamp(document.createdAt)}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="documents-empty">No project documents have been added yet.</div>
            )}
          </Panel>
        ) : null}

        <Panel className={`documents-panel ${allowAdspaceUploads ? "" : "documents-panel-wide"}`} title="Generated Records" subtitle="System-created artifacts for audit, submission, and reconciliation.">
          {loading ? (
            <div className="documents-empty">Loading generated records…</div>
          ) : generatedDocuments.length ? (
            <div className="documents-list">
              {generatedDocuments.map((document) => (
                <button key={document.id} className="documents-row" type="button" onClick={() => setLightboxDoc(document)}>
                  <div className="documents-thumb">
                    <img
                      src={
                        document.thumbUrl ||
                        buildDocumentThumbUrl({
                          label: document.assetKind === "liftPayload" ? "JSON" : document.assetKind === "orderPackage" ? "ZIP" : "DOC",
                        })
                      }
                      alt=""
                    />
                  </div>
                  <div className="documents-rowCopy">
                    {(() => {
                      const descriptor = describeGeneratedRecord(document);
                      return (
                        <>
                    <div className="documents-rowHead">
                      <span className="documents-fileName">{document.filename}</span>
                      <span className={`chip ${descriptor.tone}`}>{descriptor.label}</span>
                    </div>
                    <div className="documents-fileMeta">
                      {descriptor.detail} • {document.source === "generated" ? "Generated" : "Uploaded"} • {formatTimestamp(document.createdAt)}
                    </div>
                        </>
                      );
                    })()}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="documents-empty">Generated records will appear here after dry-run payload previews, order submission, and later reconciliation steps.</div>
          )}
        </Panel>
      </div>

      <Lightbox
        isOpen={Boolean(lightboxDoc)}
        src={
          lightboxDoc?.fullUrl ||
          lightboxDoc?.thumbUrl ||
          (lightboxDoc ? buildDocumentThumbUrl({ label: lightboxDoc.contentType === "application/pdf" ? "PDF" : "FILE" }) : "")
        }
        fallbackSrc={
          lightboxDoc?.thumbUrl ||
          (lightboxDoc ? buildDocumentThumbUrl({ label: lightboxDoc.contentType === "application/pdf" ? "PDF" : "FILE" }) : "")
        }
        title={lightboxDoc?.filename}
        subtitle={lightboxDoc ? `${categoryLabels[lightboxDoc.category]} • ${lightboxDoc.contentType || "Document"}` : undefined}
        onClose={() => setLightboxDoc(null)}
        openInNewTabUrl={lightboxDoc?.fullUrl}
        assetType={lightboxDoc && !isImageDocument(lightboxDoc) ? "document" : "image"}
      />
    </AppShell>
  );
}
