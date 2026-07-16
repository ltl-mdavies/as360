// src/pages/ProofApproval/ProofApprovalPage.tsx

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useNavigate, useParams, useSearchParams, useLocation } from "react-router-dom";
import { ChevronDown, Info, Search, SlidersHorizontal, X } from "lucide-react";
import { demoStore, useDemoStore } from "../../domain/store/demoStore";
import { useDemoProjectContext } from "../../domain/selectors/useDemoProjectContext";
import { useApiClient } from "../../api/useApiClient";
import {
  fetchProjectProofs,
  fetchProjectWorkspace,
  invalidateProjectProofsCache,
  invalidateProjectWorkspaceCache,
  logProjectErrorEvent,
  peekProjectProofsCache,
  peekProjectWorkspaceCache,
  requestArtworkUploadUrl,
  updateProjectCreativeAsset,
  updateProjectProofLine,
  type ApiProjectProofsResponse,
} from "../../api/projects";

import AppShell from "../../app/AppShell";
import Panel from "../../components/common/Panel";
import PageHeader from "../../components/common/PageHeader";
import Lightbox from "../../components/common/Lightbox";
import PullToRefresh from "../../components/common/PullToRefresh";
import { WorkspacePresenceCluster } from "../../components/realtime/WorkspacePresenceCluster";
import { ShareAccessDenied, useShareAccess } from "../../components/share/ShareAccess";
import { getRollupById } from "../../logic/mockRollups";
import { isDemoProjectRoute } from "../../logic/projectMode";
import type { ProofLineMock } from "../../logic/mockProofLines";
import { formatMediaDimensions } from "../../logic/mockAssignment";
import { buildDocumentThumbUrl } from "../../logic/imageUrls";
import { generatePdfThumbnail, sanitizeFilename } from "../../components/uploader/uploadFiles";
import { useCollaborationToastQueue } from "../../realtime/useCollaborationToastQueue";
import { useWorkspacePresence, type WorkspaceChangeEvent } from "../../realtime/useWorkspacePresence";

type FilterKey = "all" | "pending" | "approved" | "revised";
type BackgroundJobStatus = "processing" | "success" | "error";
type FeedbackSortOrder = "newest" | "oldest";
type ProofActionKind = "approve" | "undo";
type StagedRevisionFile = {
  file: File;
  filename: string;
  sizeBytes: number;
  previewKind: "image" | "pdf" | "file";
  previewUrl?: string | null;
  previewReady?: boolean;
};
const LIFT_PROOF_REVIEW_STEP = 7.02;
const LIFT_COMPLETED_STEP = 18;

type RevisionBackgroundJob = {
  id: string;
  lineItemId: string;
  lineNumber: number;
  filename: string;
  status: BackgroundJobStatus;
  title: string;
  detail: string;
  note: string;
};

function formatSize(w: number, h: number) {
  return formatMediaDimensions(w, h);
}

function mediaKey(line: ProofLineMock) {
  return `${line.mediaName}||${line.w}||${line.h}`;
}

function mediaLabelFromKey(key: string) {
  const [name, w, h] = key.split("||");
  return `${name} · ${formatSize(Number(w), Number(h))}`;
}

function formatRemoteProofSummary(event: WorkspaceChangeEvent) {
  const actor = event.actorName || "Another user";
  const detail = event.detail || {};
  const lineNumber = typeof detail.lineNumber === "number" || typeof detail.lineNumber === "string" ? detail.lineNumber : "";
  const lineLabel = lineNumber ? `line ${lineNumber}` : "a proof line";
  if (event.eventType === "proof.approved") return `${actor} approved ${lineLabel}.`;
  if (event.eventType === "proof.revised") return `${actor} uploaded a revision for ${lineLabel}.`;
  return event.summary || "Proof queue updated by another user.";
}

function statusLabel(line: ProofLineMock) {
  const hasProof = !!line.proofFullUrl;
  if (!hasProof) return { label: "Waiting", tone: "neutral" as const };
  if (line.status === "approved") return { label: "Approved", tone: "success" as const };
  return { label: "Pending", tone: "warning" as const };
}

function isPostProofReferenceLine(line?: ProofLineMock | null) {
  return typeof line?.lineStepNumber === "number" && line.lineStepNumber > LIFT_PROOF_REVIEW_STEP;
}

function isLiftCompletedLine(line?: ProofLineMock | null) {
  return typeof line?.lineStepNumber === "number" && line.lineStepNumber >= LIFT_COMPLETED_STEP;
}

function isLiftApprovedLine(line?: ProofLineMock | null) {
  return String(line?.liftProofStatus || "").toUpperCase() === "APPROVED";
}

function isLiftControlledApprovedLine(line?: ProofLineMock | null) {
  return !!line && line.status === "approved" && (isPostProofReferenceLine(line) || isLiftApprovedLine(line));
}

function proofQuantity(line: ProofLineMock) {
  const quantity = Number(line.quantity);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : null;
}

function hasProofQuantityMismatch(line: ProofLineMock) {
  const quantity = proofQuantity(line);
  return quantity != null && quantity !== line.locations.length;
}

function proofQuantityLabel(line: ProofLineMock) {
  const quantity = proofQuantity(line);
  return quantity == null ? "Qty —" : `Qty ${quantity}`;
}

function formatProofSyncTime(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function proofSyncStatusText(sync?: ApiProjectProofsResponse["sync"] | null) {
  if (!sync) return null;
  if (sync.attempted && !sync.ok) {
    return sync.message || "Lift proof sync could not refresh yet.";
  }
  const syncTime = formatProofSyncTime(sync.syncedAt || sync.lastLiftProofSyncAt);
  if (sync.attempted && sync.ok) {
    return syncTime ? `Lift proof sync refreshed ${syncTime}.` : "Lift proof sync refreshed.";
  }
  if (syncTime) {
    return `Lift proof sync last checked ${syncTime}.`;
  }
  if (sync.autoRefreshPausedReason) {
    return `Lift proof sync paused: ${sync.autoRefreshPausedReason}.`;
  }
  if (sync.autoRefreshRecommended) {
    return "Lift proof sync is queued for a background check.";
  }
  return "Lift proof sync has not run yet.";
}

function isStaleProofLineError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /proof line changed since you loaded/i.test(message);
}

function truncateMiddle(s: string, max = 34) {
  if (!s) return "";
  if (s.length <= max) return s;
  const keep = Math.max(8, Math.floor((max - 3) / 2));
  return `${s.slice(0, keep)}…${s.slice(-keep)}`;
}

function getProofFileName(line: ProofLineMock) {
  const url = line.proofFullUrl || line.proofThumbUrl || "";
  try {
    const clean = url.split("?")[0];
    const last = clean.split("/").pop() || "";
    if (!last) return "—";
    if (/^\d+$/.test(last)) return "—";
    return last;
  } catch {
    return "—";
  }
}

function cleanDisplayFilename(value?: string | null) {
  const filename = (value || "").split("?")[0].split("/").pop() || "";
  return filename.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i, "");
}

function getProofDisplayFilename(line: ProofLineMock) {
  const filename = cleanDisplayFilename(line.vendorProofFilename || getProofFileName(line));
  return filename || "—";
}

function hasClientUploadAsset(line: ProofLineMock | undefined | null) {
  return !!(line?.clientThumbUrl || line?.clientFullUrl);
}

function getQueueThumbUrl(line: ProofLineMock) {
  return (
    line.clientThumbUrl ||
    line.clientFullUrl ||
    line.proofThumbUrl ||
    line.proofFullUrl ||
    buildDocumentThumbUrl({ label: "FILE", accent: "#94a3b8" })
  );
}

function formatHistoryDate(value?: string | null) {
  if (!value) return "Timestamp pending";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function proofReceivedLabel(line: ProofLineMock) {
  return `Proof file received ${formatHistoryDate(line.vendorProofSubmittedAt || line.updatedAt)}`;
}

function ProofReceivedMeta({ line }: { line: ProofLineMock }) {
  const proofName = getProofDisplayFilename(line);
  return (
    <div className="proof-receivedMeta">
      <strong>{proofReceivedLabel(line)}</strong>
      <span title={proofName}>{proofName}</span>
    </div>
  );
}

function ClientUploadMeta({ line }: { line: ProofLineMock }) {
  return (
    <div className="proof-receivedMeta proof-clientUploadMeta">
      <strong>Client uploaded file</strong>
      <span title={line.clientFileName}>{line.clientFileName}</span>
    </div>
  );
}

function formatFileSize(bytes?: number | null) {
  if (!bytes) return "";
  const mb = bytes / 1024 / 1024;
  return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
}

function getStagedRevisionPreviewKind(file: File, filename: string): StagedRevisionFile["previewKind"] {
  if (file.type.startsWith("image/")) return "image";
  if (/\.pdf$/i.test(filename) || file.type === "application/pdf") return "pdf";
  return "file";
}

function StagedRevisionSummary({ staged }: { staged: StagedRevisionFile }) {
  const fallbackLabel = staged.previewKind === "pdf" ? "PDF" : "FILE";
  return (
    <div className="proof-stagedRevisionSummary">
      <div className={`proof-stagedRevisionThumb ${staged.previewUrl ? "has-preview" : ""}`}>
        {staged.previewUrl ? (
          <img src={staged.previewUrl} alt="" />
        ) : (
          <span>{staged.previewReady ? fallbackLabel : "..."}</span>
        )}
      </div>
      <div className="proof-stagedRevisionMeta">
        <strong>{staged.filename}</strong>
        <span>{formatFileSize(staged.sizeBytes) || "Ready to submit"}</span>
      </div>
    </div>
  );
}

function getProofFeedback(line: ProofLineMock | undefined) {
  const comments = line?.proofComments || [];
  const fallback = line?.printTeamFeedback?.trim();
  if (comments.length || !fallback) return comments;
  return [
    {
      id: "legacy-feedback",
      body: fallback,
      createdAt: line?.latestProofCommentAt || line?.updatedAt || null,
      attachments: [],
    },
  ];
}

function getFeedbackSummary(line: ProofLineMock | undefined) {
  const comments = getProofFeedback(line);
  const latest = comments[comments.length - 1] || null;
  const commentCount = Math.max(line?.proofCommentCount ?? 0, comments.length);
  const attachmentCount =
    Math.max(line?.proofCommentAttachmentCount ?? 0, comments.reduce((sum, comment) => sum + (comment.attachments?.length || 0), 0));
  return {
    comments,
    latest,
    commentCount,
    attachmentCount,
    latestAt: line?.latestProofCommentAt || latest?.createdAt || null,
    hasFeedback: commentCount > 0 || attachmentCount > 0,
  };
}

function feedbackAckKey(line: ProofLineMock) {
  const summary = getFeedbackSummary(line);
  return `${line.lineItemId}:${line.liftProofingId || "proof"}:${summary.latestAt || "no-ts"}:${summary.commentCount}:${summary.attachmentCount}`;
}

function formatFeedbackMeta(line: ProofLineMock | undefined) {
  const summary = getFeedbackSummary(line);
  const pieces = [];
  if (summary.commentCount) pieces.push(`${summary.commentCount} comment${summary.commentCount === 1 ? "" : "s"}`);
  if (summary.attachmentCount) pieces.push(`${summary.attachmentCount} attachment${summary.attachmentCount === 1 ? "" : "s"}`);
  if (summary.latestAt) pieces.push(`Latest ${formatHistoryDate(summary.latestAt)}`);
  return pieces.join(" · ");
}

function FeedbackGate({
  line,
  acknowledged,
  hasViewedFeedback,
  disabled,
  mobile = false,
  onOpen,
  onAcknowledge,
}: {
  line: ProofLineMock;
  acknowledged: boolean;
  hasViewedFeedback: boolean;
  disabled?: boolean;
  mobile?: boolean;
  onOpen: () => void;
  onAcknowledge: (checked: boolean) => void;
}) {
  const feedbackMeta = formatFeedbackMeta(line);
  const shouldShowAcknowledgement = hasViewedFeedback || acknowledged;

  return (
    <div className={`proof-dockFeedback ${mobile ? "proof-mobileFeedback" : ""} ${acknowledged ? "is-reviewed" : ""}`}>
      <div className="proof-dockFeedbackTop">
        <span className="proof-dockFeedbackIcon" aria-hidden="true">{acknowledged ? "✓" : "!"}</span>
        <div className="proof-dockFeedbackCopy">
          <div className="proof-dockFeedbackTitle">
            {acknowledged ? "Feedback reviewed" : "Print feedback requires review"}
          </div>
          {feedbackMeta ? <div className="proof-feedbackMetaLine">{feedbackMeta}</div> : null}
        </div>
      </div>
      <button className="proof-feedbackLink" type="button" onClick={onOpen}>
        {hasViewedFeedback ? "View Feedback Again" : "View Feedback"}
      </button>
      {shouldShowAcknowledgement ? (
        <label className={`proof-dockAck ${mobile ? "proof-mobileAck" : ""}`}>
          <input
            type="checkbox"
            checked={acknowledged}
            disabled={disabled}
            onChange={(event) => onAcknowledge(event.currentTarget.checked)}
          />
          <span>I reviewed the feedback and attachments.</span>
        </label>
      ) : null}
    </div>
  );
}

function buildProofHistory(line: ProofLineMock | undefined) {
  if (!line) return [];
  const proofName = getProofFileName(line);
  const items = [];
  if (line.proofFullUrl || line.proofThumbUrl) {
    items.push({
      key: "current-proof",
      label: line.vendorProofFilename || (proofName === "—" ? `Proof line ${line.lineNumber}` : proofName),
      badge: "Current proof",
      body: line.vendorProofNote ? `Proof note: ${line.vendorProofNote}` : "Current proof attached to this line.",
      date: formatHistoryDate(line.vendorProofSubmittedAt || line.updatedAt),
      tone: "current",
    });
  }
  if (line.revised) {
    items.push({
      key: "revision",
      label: line.clientFileName,
      badge: "Revised upload",
      body: "Latest revised artwork connected to this proof line.",
      date: formatHistoryDate(line.updatedAt),
      tone: "revision",
    });
  }
  if (hasClientUploadAsset(line)) {
    items.push({
      key: "client-upload",
      label: line.clientFileName,
      badge: "Client upload",
      body: "Original or currently linked client artwork for this Adspace proof line.",
      date: formatHistoryDate(line.updatedAt),
      tone: "upload",
    });
  }
  return items;
}

function getCurrentProofVersion(line: ProofLineMock | undefined) {
  if (!line) return null;
  const current = (line.proofVersions || []).find((version) => version.current && version.attachmentId === line.liftProofingId);
  if (current) return current;
  return {
    attachmentId: line.liftProofingId ?? null,
    orderLineId: line.liftOrderLineId ?? null,
    proofFilename: getProofFileName(line),
    proofThumbUrl: line.proofThumbUrl || null,
    proofFullUrl: line.proofFullUrl || null,
    status: line.status,
    proofApprovedBy: line.proofApprovedBy || null,
    proofApprovedDate: line.proofApprovedDate || null,
    technicalReports: line.technicalReports || [],
    createdAt: null,
    replacedAt: null,
    current: true,
    comments: getProofFeedback(line),
  };
}

function getHistoricalProofVersions(line: ProofLineMock | undefined) {
  if (!line) return [];
  return (line.proofVersions || []).filter((version) => {
    const isHistorical = !version.current || version.attachmentId !== line.liftProofingId;
    return isHistorical && (version.comments || []).length > 0;
  });
}

async function withRetry<T>(task: () => Promise<T>, attempts = 2, delayMs = 250): Promise<T> {
  let lastError: unknown;
  for (let index = 0; index < attempts; index += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (index < attempts - 1) {
        await new Promise((resolve) => window.setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError;
}

function toLiveProofLine(line: any): ProofLineMock {
  const vendorProofNote = line.vendorProofNote || null;
  const proofComments = Array.isArray(line.proofComments) ? line.proofComments : [];
  const synthesizedVendorComment =
    vendorProofNote && proofComments.length === 0
      ? [
          {
            id: `vendor-proof-note:${line.lineItemId || line.id || "line"}`,
            body: vendorProofNote,
            createdAt: line.vendorProofSubmittedAt || line.updatedAt || null,
            attachments: [],
          },
        ]
      : proofComments;
  const proofCommentAttachmentCount =
    line.proofCommentAttachmentCount ||
    synthesizedVendorComment.reduce((sum: number, comment: any) => sum + (comment.attachments?.length || 0), 0);

  return {
    lineItemId: line.lineItemId,
    lineNumber: line.lineNumber,
    lineStepNumber: line.lineStepNumber ?? null,
    liftOrderLineId: line.liftOrderLineId ?? null,
    liftProofingId: line.liftProofingId ?? null,
    liftProofStatus: line.liftProofStatus ?? null,
    clientCreativeId: line.clientCreativeId,
    productionRoute: line.productionRoute,
    vendorAccountId: line.vendorAccountId ?? null,
    vendorName: line.vendorName ?? null,
    routeLabel: line.routeLabel ?? null,
    integrationMode: line.integrationMode,
    mediaVariantLabel: line.mediaVariantLabel,
    liftProductName: line.liftProductName ?? null,
    mediaName: line.mediaName,
    w: line.w,
    h: line.h,
    unitNumber: line.unitNumber ?? null,
    quantity: line.quantity ?? null,
    locations: line.assignedLocations || line.locations || [],
    revised: !!line.revised,
    status: line.status,
    clientFileName: line.clientFileName,
    clientThumbUrl: line.clientThumbUrl || line.clientFullUrl || null,
    clientFullUrl: line.clientFullUrl || line.clientThumbUrl || null,
    proofThumbUrl: line.proofThumbUrl || line.proofFullUrl || null,
    proofFullUrl: line.proofFullUrl || line.proofThumbUrl || null,
    proofApprovedBy: line.proofApprovedBy ?? null,
    proofApprovedDate: line.proofApprovedDate ?? null,
    technicalReports: line.technicalReports || [],
    printTeamFeedback: line.printTeamFeedback || vendorProofNote || null,
    proofComments: synthesizedVendorComment,
    proofCommentCount: Math.max(line.proofCommentCount || 0, synthesizedVendorComment.length),
    proofCommentAttachmentCount,
    latestProofCommentAt: line.latestProofCommentAt || synthesizedVendorComment[synthesizedVendorComment.length - 1]?.createdAt || null,
    proofVersions: line.proofVersions || [],
    vendorProofSubmittedAt: line.vendorProofSubmittedAt || null,
    vendorProofSubmittedByName: line.vendorProofSubmittedByName || null,
    vendorProofSubmittedByVendorAccountId: line.vendorProofSubmittedByVendorAccountId || null,
    vendorProofFilename: line.vendorProofFilename || null,
    vendorProofContentType: line.vendorProofContentType || null,
    vendorProofSizeBytes: line.vendorProofSizeBytes ?? null,
    vendorProofNote,
    updatedAt: line.updatedAt || null,
  };
}

export default function ProofApprovalPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const api = useApiClient();

  const location = useLocation();
  const isDemo = isDemoProjectRoute(projectId, (location.state as any)?.demo === true);

  useEffect(() => {
    if (isDemo) demoStore.actions.hydrateDemo();
  }, [isDemo]);

  // Preserve customer context in back link
  const [searchParams] = useSearchParams();
  const modeSuffix = searchParams.get("mode") === "customer" ? "?mode=customer" : "";
  const useClassicProofHeader = ["1", "true", "yes"].includes((searchParams.get("classicProofHeader") || "").toLowerCase());
  const useProofCommandHeader = !useClassicProofHeader;
  const shareAccess = useShareAccess(projectId);
  const canEditProofs = shareAccess.canEdit("proofs");
  const showInternalRouteMeta = canEditProofs && searchParams.get("mode") !== "customer";

  // Non-demo rollup (unchanged)
  const rollup = isDemo || projectId !== "proj_001" ? null : getRollupById(projectId || "");

  // ------------------------------------------------------------
  // Demo context + Demo Store → ProofLineMock adapter (A1 hardened)
  // ------------------------------------------------------------
  const demoActiveProjectId = useDemoStore((s) => s.activeProjectId);
  const ctx = useDemoProjectContext(demoActiveProjectId);

  const demoProofsByProject = useDemoStore((s) => s.proofs);
  const demoCreativesAll = useDemoStore((s) => s.creatives);
  const [liveProject, setLiveProject] = useState<{
    title: string;
    venueName: string;
    extId?: string | null;
    liftOrderId?: string | null;
    production?: { policy: "direct" | "hold_for_release" };
    productionReleasedAt?: string | null;
  } | null>(null);
  const [liveLines, setLiveLines] = useState<ProofLineMock[]>([]);
  const [liveLoading, setLiveLoading] = useState(!isDemo);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [syncWarning, setSyncWarning] = useState<string | null>(null);
  const [backgroundSyncMessage, setBackgroundSyncMessage] = useState<string | null>(null);
  const [proofSyncInfo, setProofSyncInfo] = useState<ApiProjectProofsResponse["sync"] | null>(null);
  const backgroundLiftSyncKeyRef = useRef<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  // Project header fields (demo uses ctx)
  const projectTitle = isDemo
    ? ctx.title
    : (liveProject?.title || (projectId === "proj_001" ? "White Claw @ Penn Station 12.25.2025" : `Project ${projectId}`));

  const orderNumber = isDemo ? (ctx.liftOrderNumber || null) : (liveProject?.liftOrderId || liveProject?.extId || null);

  const applyProofResponse = useCallback((response: ApiProjectProofsResponse) => {
    setLiveLines(
      response.proofs
        .slice()
        .sort((a, b) => a.lineNumber - b.lineNumber)
        .map((line) => toLiveProofLine(line))
    );
    setProofSyncInfo(response.sync ?? null);
    if (response.sync?.attempted && !response.sync.ok) {
      setSyncWarning(response.sync.message || "Lift proof sync could not refresh yet.");
    }
  }, []);

  // Derive demo proof lines + creatives safely
  const demoProofLinesDomain = useMemo(() => {
    return demoProofsByProject[demoActiveProjectId] || [];
  }, [demoProofsByProject, demoActiveProjectId]);

  const demoCreativesDomain = useMemo(() => {
    return demoCreativesAll.filter((c) => c.projectId === demoActiveProjectId);
  }, [demoCreativesAll, demoActiveProjectId]);

  useEffect(() => {
    let cancelled = false;

    async function loadLiveProofs() {
      if (!projectId || isDemo || shareAccess.isResolving) return;
      setLiveLoading(true);
      setLoadError(null);
      setSyncWarning(null);
      try {
        const cachedWorkspace = peekProjectWorkspaceCache(projectId, shareAccess.isShareMode);
        if (cachedWorkspace) {
          setLiveProject({
            title: cachedWorkspace.project.title,
            venueName: cachedWorkspace.project.venueName,
            extId: cachedWorkspace.project.extId || null,
            liftOrderId: cachedWorkspace.project.liftOrderId || null,
            production: cachedWorkspace.project.production,
            productionReleasedAt: cachedWorkspace.project.productionReleasedAt || null,
          });
        }

        const cachedProofs = peekProjectProofsCache(projectId, shareAccess.isShareMode);
        if (cachedProofs) {
          setLiveLines(
            cachedProofs.proofs
              .slice()
              .sort((a, b) => a.lineNumber - b.lineNumber)
              .map((line) => toLiveProofLine(line))
          );
          setProofSyncInfo(cachedProofs.sync ?? null);
        }

        const [workspaceResult, proofsResult] = await Promise.allSettled([
          withRetry(() => fetchProjectWorkspace(api, projectId, shareAccess.isShareMode)),
          withRetry(() => fetchProjectProofs(api, projectId, shareAccess.isShareMode, reloadToken > 0)),
        ]);
        if (cancelled) return;

        if (workspaceResult.status === "fulfilled") {
          setLiveProject({
            title: workspaceResult.value.project.title,
            venueName: workspaceResult.value.project.venueName,
            extId: workspaceResult.value.project.extId || null,
            liftOrderId: workspaceResult.value.project.liftOrderId || null,
            production: workspaceResult.value.project.production,
            productionReleasedAt: workspaceResult.value.project.productionReleasedAt || null,
          });
        } else if (!cachedWorkspace) {
          console.error("Failed to load proof approval workspace metadata", workspaceResult.reason);
        }

        if (proofsResult.status === "fulfilled") {
          applyProofResponse(proofsResult.value);
          const sync = proofsResult.value.sync;
          const shouldRunBackgroundSync = reloadToken === 0 && sync?.autoRefreshRecommended === true;
          if (shouldRunBackgroundSync) {
            const syncKey = `${projectId}:${sync.lastLiftProofSyncAt || "never"}:${sync.lastLiftProofChangeAt || "none"}`;
            if (backgroundLiftSyncKeyRef.current !== syncKey) {
              backgroundLiftSyncKeyRef.current = syncKey;
              setBackgroundSyncMessage("Checking Lift for proof updates...");
              void fetchProjectProofs(api, projectId, shareAccess.isShareMode, true)
                .then((backgroundResponse) => {
                  if (cancelled) return;
                  applyProofResponse(backgroundResponse);
                  setBackgroundSyncMessage("Lift proof check complete.");
                  window.setTimeout(() => setBackgroundSyncMessage(null), 5000);
                })
                .catch((error) => {
                  if (cancelled) return;
                  console.warn("Background Lift proof sync failed", error);
                  setBackgroundSyncMessage(null);
                  setSyncWarning("Lift proof sync could not refresh in the background. Use Refresh Proof Status to try again.");
                });
            }
          }
        } else {
          console.error("Failed to load proof approval proofs", proofsResult.reason);
          if (!cachedProofs) {
            setLoadError("We couldn’t load the proof queue yet. Please try again.");
          }
        }
      } catch (error) {
        if (cancelled) return;
        console.error("Failed to load proof approval workspace", error);
        setLoadError("We couldn’t load the proof queue yet. Please try again.");
      } finally {
        if (!cancelled) setLiveLoading(false);
      }
    }

    void loadLiveProofs();
    return () => {
      cancelled = true;
    };
  }, [api, applyProofResponse, isDemo, projectId, reloadToken, shareAccess.isResolving, shareAccess.isShareMode]);

  const syncProofsSilently = useCallback(async () => {
    if (!projectId || isDemo) return null;
    invalidateProjectProofsCache(projectId, shareAccess.isShareMode);
    invalidateProjectWorkspaceCache(projectId, shareAccess.isShareMode);
    try {
      let refreshedLines: ProofLineMock[] | null = null;
      const [workspaceResult, proofsResult] = await Promise.allSettled([
        fetchProjectWorkspace(api, projectId, shareAccess.isShareMode),
        fetchProjectProofs(api, projectId, shareAccess.isShareMode, true),
      ]);
      if (workspaceResult.status === "fulfilled") {
        setLiveProject({
          title: workspaceResult.value.project.title,
          venueName: workspaceResult.value.project.venueName,
          extId: workspaceResult.value.project.extId || null,
          liftOrderId: workspaceResult.value.project.liftOrderId || null,
          production: workspaceResult.value.project.production,
          productionReleasedAt: workspaceResult.value.project.productionReleasedAt || null,
        });
      }
      if (proofsResult.status === "fulfilled") {
        refreshedLines = proofsResult.value.proofs
          .slice()
          .sort((a, b) => a.lineNumber - b.lineNumber)
          .map((line) => toLiveProofLine(line));
        setLiveLines(refreshedLines);
        setProofSyncInfo(proofsResult.value.sync ?? null);
        if (proofsResult.value.sync?.attempted && !proofsResult.value.sync.ok) {
          setSyncWarning(proofsResult.value.sync.message || "Lift proof sync could not refresh yet.");
        }
      }
      return refreshedLines;
    } catch (error) {
      console.warn("Silent proof sync failed", error);
      return null;
    }
  }, [api, isDemo, projectId, shareAccess.isShareMode]);

  const enqueueCollaborationToast = useCollaborationToastQueue("Proof queue updated by another user.");

  const requestRemoteProofSync = useCallback(() => {
    if (!projectId || isDemo) return;
    void syncProofsSilently();
  }, [isDemo, projectId, syncProofsSilently]);

  const handleRemoteProofChange = useCallback((event: WorkspaceChangeEvent) => {
    requestRemoteProofSync();
    enqueueCollaborationToast(event, formatRemoteProofSummary(event));
  }, [enqueueCollaborationToast, requestRemoteProofSync]);

  const presence = useWorkspacePresence({
    api,
    projectId,
    workspace: "proofs",
    enabled: !isDemo && Boolean(projectId) && !shareAccess.isResolving,
    shareMode: shareAccess.isShareMode,
    onRemoteChange: handleRemoteProofChange,
    onSyncRequested: requestRemoteProofSync,
  });

  function refreshProofStatus() {
    if (!projectId) return;
    invalidateProjectProofsCache(projectId, shareAccess.isShareMode);
    invalidateProjectWorkspaceCache(projectId, shareAccess.isShareMode);
    setSyncWarning(null);
    setBackgroundSyncMessage(null);
    setLoadError(null);
    setReloadToken((value) => value + 1);
  }

  const demoLines: ProofLineMock[] = useMemo(() => {
    if (!isDemo) return [];

    // Helper: parse "Name||W||H" mediaVariantKey
    function parseVariantKey(k: string) {
      const [name, w, h] = String(k || "").split("||");
      return {
        mediaName: name || "Media",
        w: Number(w) || 0,
        h: Number(h) || 0,
      };
    }

    const creativeById = new Map<string, any>();
    demoCreativesDomain.forEach((c) => creativeById.set(c.id, c));

    return demoProofLinesDomain
      .slice()
      .sort((a, b) => (a.lineNumber ?? 0) - (b.lineNumber ?? 0))
      .map((p, idx) => {
        const v = parseVariantKey((p as any).mediaVariantKey);
        const client = creativeById.get((p as any).clientCreativeId);

        const clientThumbUrl = client?.thumbUrl || `https://picsum.photos/seed/demo_client_${idx}/640/420`;
        const clientFullUrl = client?.fullUrl || `https://picsum.photos/seed/demo_client_full_${idx}/1600/1000`;

        return {
          lineItemId: (p as any).lineItemId,
          lineNumber: (p as any).lineNumber ?? (idx + 1),
          liftOrderLineId: (p as any).liftOrderLineId ?? null,
          clientCreativeId: (p as any).clientCreativeId,

          mediaVariantLabel: (p as any).mediaVariantLabel || `${v.mediaName} · ${formatSize(v.w, v.h)}`,
          mediaName: v.mediaName,
          w: v.w,
          h: v.h,
          unitNumber: (p as any).unitNumber ?? null,
          quantity: (p as any).quantity ?? null,
          locations: (p as any).locations || [],

          clientFileName: client?.filename || "Client_File.pdf",
          clientThumbUrl,
          clientFullUrl,

          proofThumbUrl: (p as any).proofThumbUrl || null,
          proofFullUrl: (p as any).proofFullUrl || null,

          status: (((p as any).status === "approved" || (p as any).status === "waiting")
            ? (p as any).status
            : "pending") as any,
          revised: !!(p as any).revised,

          printTeamFeedback: (p as any).printTeamFeedback || "",
        } as ProofLineMock;
      });
  }, [isDemo, demoProofLinesDomain, demoCreativesDomain]);

  // ----------------------------
  // Local UI state
  // ----------------------------
  const [filter, setFilter] = useState<FilterKey>("all");
  const [lines, setLines] = useState<ProofLineMock[]>(isDemo ? demoLines : []);

  const [selectedId, setSelectedId] = useState<string>((isDemo ? demoLines[0]?.lineItemId : "") || "");

  useEffect(() => {
    const nextLines = isDemo ? demoLines : liveLines;
    setLines(nextLines);
  }, [isDemo, demoLines, liveLines]);

  useEffect(() => {
    if (!lines.some((l) => l.lineItemId === selectedId)) {
      setSelectedId(lines[0]?.lineItemId || "");
    }
  }, [lines, selectedId]);

  const [q, setQ] = useState("");
  const [mediaVariant, setMediaVariant] = useState("all");
  const [routeFilter, setRouteFilter] = useState<"all" | "lift" | "adspace">("all");
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [showRevisionUploader, setShowRevisionUploader] = useState(false);
  const [isRevisionDragActive, setIsRevisionDragActive] = useState(false);
  const [feedbackAcknowledgedByLine, setFeedbackAcknowledgedByLine] = useState<Record<string, boolean>>({});
  const [feedbackViewedByLine, setFeedbackViewedByLine] = useState<Record<string, boolean>>({});
  const [historyOpen, setHistoryOpen] = useState(false);
  const [feedbackDrawerOpen, setFeedbackDrawerOpen] = useState(false);
  const [feedbackSortOrder, setFeedbackSortOrder] = useState<FeedbackSortOrder>("newest");
  const [feedbackLightbox, setFeedbackLightbox] = useState<{
    src: string;
    fallbackSrc?: string;
    openUrl?: string;
    title: string;
    subtitle?: string;
  } | null>(null);
  const [mobileToolsExpanded, setMobileToolsExpanded] = useState(false);
  const [technicalInfoOpen, setTechnicalInfoOpen] = useState(false);
  const [lineNotes, setLineNotes] = useState<Record<string, string>>({});
  const [revisionJobs, setRevisionJobs] = useState<RevisionBackgroundJob[]>([]);
  const [stagedRevisionByLine, setStagedRevisionByLine] = useState<Record<string, StagedRevisionFile>>({});
  const [pendingProofAction, setPendingProofAction] = useState<string | null>(null);
  const lineNotesRef = useRef<Record<string, string>>({});
  const stagedRevisionRef = useRef<Record<string, StagedRevisionFile>>({});
  const mobileRevisionInputRef = useRef<HTMLInputElement | null>(null);
  const mobileSearchInputRef = useRef<HTMLInputElement | null>(null);
  const mobileToolsRef = useRef<HTMLDivElement | null>(null);
  const mobileCardsTopRef = useRef<HTMLDivElement | null>(null);
  const mobileCardRefs = useRef<Record<string, HTMLElement | null>>({});
  const previousMobileScrollYRef = useRef(0);
  const shouldFocusMobileSearchRef = useRef(false);
  const tabletRevisionInputRef = useRef<HTMLInputElement | null>(null);
  const revisionInputRef = useRef<HTMLInputElement | null>(null);

  const selected = useMemo(
    () => lines.find((l) => l.lineItemId === selectedId) || lines[0],
    [lines, selectedId]
  );
  const selectedFeedbackSummary = useMemo(() => getFeedbackSummary(selected), [selected]);
  const selectedLineNote = selected ? lineNotes[selected.lineItemId] || "" : "";
  const selectedStagedRevision = selected ? stagedRevisionByLine[selected.lineItemId] || null : null;
  const hasPrintFeedback = selectedFeedbackSummary.hasFeedback;
  const feedbackAcknowledged = selected ? feedbackAcknowledgedByLine[feedbackAckKey(selected)] === true : false;
  const feedbackViewed = selected ? feedbackViewedByLine[feedbackAckKey(selected)] === true : false;
  const proofHistory = useMemo(() => buildProofHistory(selected), [selected]);
  const proofPullRefreshDisabled =
    historyOpen ||
    feedbackDrawerOpen ||
    Boolean(feedbackLightbox) ||
    isRevisionDragActive ||
    showRevisionUploader ||
    Boolean(pendingProofAction) ||
    Object.keys(stagedRevisionByLine).length > 0 ||
    revisionJobs.some((job) => job.status === "processing");
  const refreshProofApproval = useCallback(async () => {
    setSyncWarning(null);
    setBackgroundSyncMessage(null);
    setLoadError(null);
    await syncProofsSilently();
  }, [syncProofsSilently]);

  useEffect(() => {
    stagedRevisionRef.current = stagedRevisionByLine;
  }, [stagedRevisionByLine]);

  useEffect(() => {
    return () => {
      Object.values(stagedRevisionRef.current).forEach((staged) => {
        if (staged.previewUrl) URL.revokeObjectURL(staged.previewUrl);
      });
    };
  }, []);
  
  // Approval behavior flags (demo-safe defaults)
  const isApproved = selected?.status === "approved";
  const productionApprovalMode: "immediate" | "project_release" =
    isDemo
      ? ctx.productionApprovalMode
      : liveProject?.production?.policy === "direct"
        ? "immediate"
        : "project_release";
  const productionReleased = isDemo ? ctx.productionReleased : !!liveProject?.productionReleasedAt;
  const liftLinesBeyondProofReview =
    !isDemo && lines.length > 0 && lines.every((line) => isPostProofReferenceLine(line));
  const liftLinesComplete =
    !isDemo && lines.length > 0 && lines.every((line) => isLiftCompletedLine(line));
  const selectedLiftControlledApproved =
    !isDemo && isLiftControlledApprovedLine(selected);
  const canUndoSelectedApproval =
    !!selected &&
    isApproved &&
    canEditProofs &&
    productionApprovalMode === "project_release" &&
    !productionReleased &&
    !selectedLiftControlledApproved;

  const venueName = isDemo ? (ctx.venueName || "Penn Station") : (liveProject?.venueName || "Penn Station");

  // Counts (demo uses ctx, non-demo uses local lines)
  const counts = useMemo(() => {
    if (isDemo) {
      return {
        total: ctx.proofs.total,
        approved: ctx.proofs.approved,
        pending: ctx.proofs.pending,
        waiting: ctx.proofs.waiting,
        revised: ctx.proofs.revised,
      };
    }

    const total = lines.length;
    const approved = lines.filter((l) => l.status === "approved").length;
    const pending = lines.filter((l) => l.status === "pending").length;
    const waiting = lines.filter((l) => l.status === "waiting").length;
    const revised = lines.filter((l) => !!l.revised).length;

    return { total, approved, pending, waiting, revised };
  }, [
    isDemo,
    ctx.proofs.total,
    ctx.proofs.approved,
    ctx.proofs.pending,
    ctx.proofs.waiting,
    ctx.proofs.revised,
    lines,
  ]);

  const mediaOptions = useMemo(() => {
    const set = new Set<string>();
    for (const l of lines) set.add(mediaKey(l));

    const sorted = Array.from(set).sort((a, b) => {
      const [an, aw, ah] = a.split("||");
      const [bn, bw, bh] = b.split("||");
      if (an !== bn) return an.localeCompare(bn);
      const awNum = Number(aw);
      const bwNum = Number(bw);
      if (awNum !== bwNum) return awNum - bwNum;
      return Number(ah) - Number(bh);
    });

    return ["all", ...sorted];
  }, [lines]);

  const proofSiblingMeta = useMemo(() => {
    const groups = new Map<string, ProofLineMock[]>();
    for (const line of lines) {
      const key = line.liftOrderLineId ? `lift:${line.liftOrderLineId}` : `line:${line.lineNumber}`;
      const group = groups.get(key) || [];
      group.push(line);
      groups.set(key, group);
    }

    const meta = new Map<string, { index: number; total: number }>();
    for (const group of groups.values()) {
      const ordered = group
        .slice()
        .sort(
          (a, b) =>
            a.lineNumber - b.lineNumber ||
            (a.liftProofingId ?? Number.MAX_SAFE_INTEGER) - (b.liftProofingId ?? Number.MAX_SAFE_INTEGER) ||
            a.lineItemId.localeCompare(b.lineItemId)
        );
      ordered.forEach((line, index) => {
        meta.set(line.lineItemId, { index: index + 1, total: ordered.length });
      });
    }
    return meta;
  }, [lines]);

  function getProofLineLabel(line: ProofLineMock) {
    const sibling = proofSiblingMeta.get(line.lineItemId);
    const suffix = sibling && sibling.total > 1 ? ` - ${sibling.index} of ${sibling.total}` : "";
    return `Line ${line.lineNumber}${suffix}`;
  }

  function getProofReferencePills(line: ProofLineMock) {
    const isAdspaceManaged = line.integrationMode === "adspace" || line.productionRoute === "external_vendor";
    return [
      `Proof line ${line.lineNumber}`,
      line.liftProofingId && !isAdspaceManaged ? `Proof ID ${line.liftProofingId}` : "",
      line.liftOrderLineId && !isAdspaceManaged ? `Lift line ${line.liftOrderLineId}` : "",
    ].filter(Boolean);
  }

  function getProofReferenceSubtitle(line: ProofLineMock) {
    const isAdspaceManaged = line.integrationMode === "adspace" || line.productionRoute === "external_vendor";
    return line.liftProofingId && !isAdspaceManaged ? `Proof ID ${line.liftProofingId}` : `Proof line ${line.lineNumber}`;
  }

  function proofRouteKey(line: ProofLineMock) {
    return line.integrationMode === "adspace" || line.productionRoute === "external_vendor" ? "adspace" : "lift";
  }

  function proofRouteLabel(line: ProofLineMock) {
    return proofRouteKey(line) === "adspace" ? "External" : "Lift Sync";
  }

  function getLocationPreview(line: ProofLineMock, limit = 2) {
    const visible = line.locations.slice(0, limit);
    const remaining = Math.max(0, line.locations.length - visible.length);
    return { visible, remaining };
  }

  function getTechnicalInfoRows(line: ProofLineMock) {
    const quantity = proofQuantity(line);
    const assignedLocations = line.locations.length
      ? `${line.locations.length} assigned (${line.locations.join(", ")})`
      : "No assigned locations";

    return [
      { label: "Adspace Proof Line", value: getProofLineLabel(line) },
      ...(showInternalRouteMeta ? [{ label: "Production Route", value: proofRouteLabel(line) }] : []),
      ...(proofRouteKey(line) === "lift" && line.liftOrderLineId ? [{ label: "Lift Line ID", value: line.liftOrderLineId }] : []),
      ...(proofRouteKey(line) === "lift" && line.liftProofingId ? [{ label: "Proof ID", value: line.liftProofingId }] : []),
      ...(proofRouteKey(line) === "lift" && line.liftProductName ? [{ label: "Lift Product", value: line.liftProductName }] : []),
      { label: "Client Upload Filename", value: line.clientFileName || "Unavailable" },
      { label: "Proof Filename", value: getProofFileName(line) },
      ...(line.proofApprovedBy ? [{ label: "Approved By", value: line.proofApprovedBy }] : []),
      ...(line.proofApprovedDate ? [{ label: "Approved Date", value: formatHistoryDate(line.proofApprovedDate) }] : []),
      ...((line.technicalReports || []).map((report, index) => ({
        label: report.definitionLabel || `Technical Report ${index + 1}`,
        value: report.reportUrl || (report.reportId != null ? `Report ${report.reportId}` : "Available"),
      }))),
      {
        label: "Qty",
        value: quantity == null ? "—" : `${quantity}${hasProofQuantityMismatch(line) ? ` · ${line.locations.length} assigned` : ""}`,
      },
      { label: "Assigned Locations", value: assignedLocations },
      { label: "Media/Product", value: line.mediaName || line.mediaVariantLabel || "—" },
      { label: "Dimensions", value: formatSize(line.w, line.h) },
      { label: "Unit", value: line.unitNumber || "—" },
      { label: "Proof Status", value: statusLabel(line).label },
    ];
  }

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();

    return lines
      .slice()
      .sort((a, b) => a.lineNumber - b.lineNumber)
      .filter((l) => {
        if (filter === "all") return true;
        if (filter === "revised") return l.revised;
        if (filter === "approved") return l.status === "approved";
        if (filter === "pending") return l.status !== "approved";
        return true;
      })
      .filter((l) => (mediaVariant === "all" ? true : mediaKey(l) === mediaVariant))
      .filter((l) => (showInternalRouteMeta && routeFilter !== "all" ? proofRouteKey(l) === routeFilter : true))
      .filter((l) => {
        if (!query) return true;
        const proofName = getProofFileName(l);
        const hay = [
          l.clientFileName,
          proofName,
          l.mediaName,
          l.mediaVariantLabel || "",
          l.unitNumber || "",
          showInternalRouteMeta ? proofRouteLabel(l) : "",
          String(l.lineNumber),
          l.liftProofingId ? String(l.liftProofingId) : "",
          proofSiblingMeta.get(l.lineItemId)?.total ? getProofLineLabel(l) : "",
          l.locations.join(","),
        ]
          .join(" ")
          .toLowerCase();

        return hay.includes(query);
      });
  }, [lines, filter, q, mediaVariant, showInternalRouteMeta, routeFilter, proofSiblingMeta]);

  const selectedHasProof = !!(selected?.proofThumbUrl || selected?.proofFullUrl);
  const selectedHasClientAsset = hasClientUploadAsset(selected);
  const selectedIsWaiting = selected?.status === "waiting" || !selectedHasProof;
  const selectedUsesSimpleDecisionDock = !!selected && !hasPrintFeedback && !isApproved && !selectedIsWaiting;
  const isSelectedRevisionProcessing =
    !!selected &&
    revisionJobs.some((job) => job.lineItemId === selected.lineItemId && job.status === "processing");
  const isSelectedApprovalProcessing = !!selected && isProofActionProcessing("approve", selected.lineItemId);
  const isSelectedUndoProcessing = !!selected && isProofActionProcessing("undo", selected.lineItemId);

  function proofActionId(kind: ProofActionKind, lineItemId: string) {
    return `${kind}:${lineItemId}`;
  }

  function isProofActionProcessing(kind: ProofActionKind, lineItemId: string) {
    return pendingProofAction === proofActionId(kind, lineItemId);
  }

  function isLineWaiting(line: ProofLineMock) {
    return line.status === "waiting" || !(line.proofThumbUrl || line.proofFullUrl);
  }

  function isLineRevisionProcessing(line: ProofLineMock) {
    return revisionJobs.some((job) => job.lineItemId === line.lineItemId && job.status === "processing");
  }

  function isLineFeedbackAcknowledged(line: ProofLineMock) {
    return feedbackAcknowledgedByLine[feedbackAckKey(line)] === true;
  }

  function hasLineFeedbackBeenViewed(line: ProofLineMock) {
    return feedbackViewedByLine[feedbackAckKey(line)] === true;
  }

  function lineRequiresFeedbackAcknowledgement(line: ProofLineMock) {
    return (
      getFeedbackSummary(line).hasFeedback &&
      line.status !== "approved" &&
      !isLineWaiting(line) &&
      !isLineFeedbackAcknowledged(line)
    );
  }

  function canApproveLine(line: ProofLineMock) {
    return (
      !!line.proofFullUrl &&
      !isLineWaiting(line) &&
      line.status !== "approved" &&
      canEditProofs &&
      !isLineRevisionProcessing(line) &&
      !isProofActionProcessing("approve", line.lineItemId) &&
      (!getFeedbackSummary(line).hasFeedback || isLineFeedbackAcknowledged(line))
    );
  }

  function canUploadRevisionForLine(line: ProofLineMock) {
    return (
      !isLineWaiting(line) &&
      line.status !== "approved" &&
      canEditProofs &&
      !isLineRevisionProcessing(line) &&
      (!getFeedbackSummary(line).hasFeedback || isLineFeedbackAcknowledged(line))
    );
  }

  const mobileActionableCount = useMemo(
    () => filtered.filter((line) => line.status !== "approved").length,
    [filtered]
  );
  const hasActiveMobileFilters = filter !== "all" || q.trim() !== "" || mediaVariant !== "all" || (showInternalRouteMeta && routeFilter !== "all");
  const mobileFilterSummary =
    filter === "pending"
      ? `${counts.pending} pending`
      : filter === "approved"
      ? `${counts.approved} approved`
      : filter === "revised"
      ? `${counts.revised} revised`
      : `${filtered.length} shown`;

  useEffect(() => {
    if (!mobileToolsExpanded || !shouldFocusMobileSearchRef.current) return;
    shouldFocusMobileSearchRef.current = false;
    window.requestAnimationFrame(() => mobileSearchInputRef.current?.focus());
  }, [mobileToolsExpanded]);

  const scrollMobileCardsStart = useCallback((behavior: ScrollBehavior = "smooth") => {
    const target = mobileCardsTopRef.current || mobileToolsRef.current;
    target?.scrollIntoView({ behavior, block: "start" });
  }, []);

  const expandMobileTools = useCallback((focusSearch = false) => {
    shouldFocusMobileSearchRef.current = focusSearch;
    setMobileToolsExpanded(true);
  }, []);

  const handleMobileFilterChange = useCallback((nextFilter: FilterKey) => {
    previousMobileScrollYRef.current = window.scrollY;
    setFilter(nextFilter);
    setMobileToolsExpanded(false);
    window.requestAnimationFrame(() => scrollMobileCardsStart());
  }, [scrollMobileCardsStart]);

  const handleMobileSearchChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    previousMobileScrollYRef.current = window.scrollY;
    setQ(event.currentTarget.value);
    window.requestAnimationFrame(() => scrollMobileCardsStart());
  }, [scrollMobileCardsStart]);

  const handleMobileMediaChange = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    previousMobileScrollYRef.current = window.scrollY;
    setMediaVariant(event.currentTarget.value);
    setMobileToolsExpanded(false);
    window.requestAnimationFrame(() => scrollMobileCardsStart());
  }, [scrollMobileCardsStart]);

  const handleMobileRouteChange = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    previousMobileScrollYRef.current = window.scrollY;
    setRouteFilter(event.currentTarget.value as "all" | "lift" | "adspace");
    setMobileToolsExpanded(false);
    window.requestAnimationFrame(() => scrollMobileCardsStart());
  }, [scrollMobileCardsStart]);

  const clearMobileFilters = useCallback(() => {
    const restoreY = previousMobileScrollYRef.current;
    setFilter("all");
    setQ("");
    setMediaVariant("all");
    setRouteFilter("all");
    setMobileToolsExpanded(false);
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: restoreY || 0, behavior: "smooth" });
    });
  }, []);

  const scrollMobileQueueTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const scrollToNextPendingMobile = useCallback(() => {
    const candidates = filtered.filter((line) => line.status !== "approved");
    if (!candidates.length) return;

    const viewportThreshold = 96;
    const nextLine =
      candidates.find((line) => {
        const node = mobileCardRefs.current[line.lineItemId];
        return !!node && node.getBoundingClientRect().top > viewportThreshold;
      }) || candidates[0];

    setSelectedId(nextLine.lineItemId);
    setMobileToolsExpanded(false);
    window.requestAnimationFrame(() => {
      mobileCardRefs.current[nextLine.lineItemId]?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [filtered]);

  const canApproveSelected =
    !!selected && canApproveLine(selected);
  const canUploadRevision =
    !!selected && canUploadRevisionForLine(selected);
  const requiresFeedbackAcknowledgement = !!selected && lineRequiresFeedbackAcknowledgement(selected);
  const showSelectedLineNote = !!selected && (!requiresFeedbackAcknowledgement || isApproved);
  const remainingProofActions = counts.pending + counts.waiting;
  const proofsComplete = counts.total > 0 && remainingProofActions === 0;
  const proofsCompleteInProduction = proofsComplete && (productionReleased || liftLinesBeyondProofReview);
  const proofSummaryTitle =
    counts.total === 0
      ? "No proofs available yet"
      : remainingProofActions === 0
      ? "All proofs approved"
      : `${remainingProofActions} proof task${remainingProofActions === 1 ? "" : "s"} remaining`;
  const proofSummaryBody =
    counts.total === 0
      ? "Proofs will appear here after the order has been submitted."
      : counts.pending > 0 && counts.waiting > 0
      ? `${counts.pending} proof${counts.pending === 1 ? "" : "s"} are ready for approval and ${counts.waiting} are still waiting on updated proof files.`
      : counts.pending > 0
      ? `${counts.pending} proof${counts.pending === 1 ? "" : "s"} are ready for review and approval.`
      : counts.waiting > 0
      ? `${counts.waiting} proof${counts.waiting === 1 ? "" : "s"} are still waiting for the current proof file and are not ready to approve yet.`
      : liftLinesComplete
      ? "All proofs are approved and the order is complete."
      : proofsCompleteInProduction
      ? "All proofs are approved and the order is now in production."
      : "All proof approvals are complete.";
  const selectedNextStep =
    !selected
      ? "Select a proof line to review its current status."
      : selectedIsWaiting
      ? "This line is still processing or waiting on a regenerated proof file before it can be approved."
      : isApproved
      ? "This proof is approved for print."
      : "Review the proof image, confirm any print feedback is resolved, then approve for print or upload a revision.";
  const selectedCompactNextStep =
    !selected
      ? "Select a proof line to review."
      : selectedIsWaiting
      ? "Waiting for the proof file."
      : isApproved
      ? "Approved."
      : "Review proof, resolve feedback if any, then approve or upload a revision.";

  useEffect(() => {
    setActionMessage(null);
    setShowRevisionUploader(false);
    setIsRevisionDragActive(false);
    setHistoryOpen(false);
    setTechnicalInfoOpen(false);
  }, [selectedId]);

  function applyProofPatch(
    lineId: string,
    next: {
      status: "waiting" | "pending" | "approved";
      revised: boolean;
      clientFileName?: string | null;
      clientThumbUrl?: string | null;
      clientFullUrl?: string | null;
      proofThumbUrl?: string | null;
      proofFullUrl?: string | null;
      proofApprovedBy?: string | null;
      proofApprovedDate?: string | null;
      technicalReports?: ProofLineMock["technicalReports"];
      printTeamFeedback?: string | null;
      proofComments?: ProofLineMock["proofComments"];
      proofCommentCount?: number;
      proofCommentAttachmentCount?: number;
      latestProofCommentAt?: string | null;
      proofVersions?: ProofLineMock["proofVersions"];
      updatedAt?: string | null;
    }
  ) {
    setLines((prev) =>
      prev.map((l) =>
        l.lineItemId === lineId
          ? {
              ...l,
              status: next.status,
              revised: next.revised,
              clientFileName: next.clientFileName ?? l.clientFileName,
              clientThumbUrl: next.clientThumbUrl ?? l.clientThumbUrl,
              clientFullUrl: next.clientFullUrl ?? l.clientFullUrl,
              proofThumbUrl:
                Object.prototype.hasOwnProperty.call(next, "proofThumbUrl")
                  ? next.proofThumbUrl ?? null
                  : l.proofThumbUrl ?? null,
              proofFullUrl:
                Object.prototype.hasOwnProperty.call(next, "proofFullUrl")
                  ? next.proofFullUrl ?? null
                  : l.proofFullUrl ?? null,
              proofApprovedBy:
                Object.prototype.hasOwnProperty.call(next, "proofApprovedBy")
                  ? next.proofApprovedBy ?? null
                  : l.proofApprovedBy ?? null,
              proofApprovedDate:
                Object.prototype.hasOwnProperty.call(next, "proofApprovedDate")
                  ? next.proofApprovedDate ?? null
                  : l.proofApprovedDate ?? null,
              technicalReports: next.technicalReports ?? l.technicalReports ?? [],
              printTeamFeedback: next.printTeamFeedback ?? l.printTeamFeedback ?? null,
            proofComments: next.proofComments ?? l.proofComments ?? [],
            proofCommentCount: next.proofCommentCount ?? l.proofCommentCount ?? 0,
            proofCommentAttachmentCount: next.proofCommentAttachmentCount ?? l.proofCommentAttachmentCount ?? 0,
            latestProofCommentAt: next.latestProofCommentAt ?? l.latestProofCommentAt ?? null,
            proofVersions: next.proofVersions ?? l.proofVersions ?? [],
              updatedAt: Object.prototype.hasOwnProperty.call(next, "updatedAt") ? next.updatedAt ?? null : l.updatedAt ?? null,
            }
          : l
      )
    );
  }

  function acknowledgeFeedbackForLine(line: ProofLineMock, acknowledged: boolean) {
    const key = feedbackAckKey(line);
    setFeedbackAcknowledgedByLine((prev) => ({
      ...prev,
      [key]: acknowledged,
    }));
    if (!acknowledged) {
      setFeedbackViewedByLine((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  }

  function clearFeedbackAcknowledgement(line: ProofLineMock | string) {
    setFeedbackAcknowledgedByLine((prev) => {
      const next = { ...prev };
      if (typeof line === "string") {
        Object.keys(next).forEach((key) => {
          if (key.startsWith(`${line}:`)) delete next[key];
        });
      } else {
        delete next[feedbackAckKey(line)];
      }
      return next;
    });
    setFeedbackViewedByLine((prev) => {
      const next = { ...prev };
      if (typeof line === "string") {
        Object.keys(next).forEach((key) => {
          if (key.startsWith(`${line}:`)) delete next[key];
        });
      } else {
        delete next[feedbackAckKey(line)];
      }
      return next;
    });
  }

  function getLineNoteValue(lineItemId: string) {
    return lineNotesRef.current[lineItemId] ?? lineNotes[lineItemId] ?? "";
  }

  function setLineNoteDraft(lineItemId: string, value: string, commit = false) {
    lineNotesRef.current[lineItemId] = value;
    if (commit) {
      setLineNotes((prev) => ({
        ...prev,
        [lineItemId]: value,
      }));
    }
  }

  function clearLineNote(lineItemId: string) {
    delete lineNotesRef.current[lineItemId];
    setLineNotes((prev) => {
      const next = { ...prev };
      delete next[lineItemId];
      return next;
    });
  }

  function stageRevisedFile(file: File, line: ProofLineMock) {
    if (!file || !line) return;
    const filename = sanitizeFilename(file.name);
    const previewKind = getStagedRevisionPreviewKind(file, filename);
    const initialPreviewUrl = previewKind === "image" ? URL.createObjectURL(file) : null;
    setSelectedId(line.lineItemId);
    setShowRevisionUploader(true);
    setIsRevisionDragActive(false);
    setActionMessage(null);
    setStagedRevisionByLine((prev) => {
      const previousPreviewUrl = prev[line.lineItemId]?.previewUrl;
      if (previousPreviewUrl) URL.revokeObjectURL(previousPreviewUrl);
      return {
        ...prev,
        [line.lineItemId]: {
          file,
          filename,
          sizeBytes: file.size,
          previewKind,
          previewUrl: initialPreviewUrl,
          previewReady: previewKind !== "pdf",
        },
      };
    });

    if (previewKind === "pdf") {
      void generatePdfThumbnail(file, filename)
        .then((thumbnailFile) => {
          const previewUrl = URL.createObjectURL(thumbnailFile);
          setStagedRevisionByLine((prev) => {
            const current = prev[line.lineItemId];
            if (!current || current.file !== file || current.filename !== filename) {
              URL.revokeObjectURL(previewUrl);
              return prev;
            }
            if (current.previewUrl) URL.revokeObjectURL(current.previewUrl);
            return {
              ...prev,
              [line.lineItemId]: {
                ...current,
                previewUrl,
                previewReady: true,
              },
            };
          });
        })
        .catch((error) => {
          console.warn("Failed to generate staged revised PDF thumbnail", error);
          setStagedRevisionByLine((prev) => {
            const current = prev[line.lineItemId];
            if (!current || current.file !== file || current.filename !== filename) return prev;
            return {
              ...prev,
              [line.lineItemId]: {
                ...current,
                previewReady: true,
              },
            };
          });
        });
    }
  }

  function clearStagedRevision(lineItemId: string) {
    setStagedRevisionByLine((prev) => {
      const next = { ...prev };
      if (next[lineItemId]?.previewUrl) URL.revokeObjectURL(next[lineItemId].previewUrl);
      delete next[lineItemId];
      return next;
    });
  }

  function cancelRevisionUpload(lineItemId?: string) {
    if (lineItemId) clearStagedRevision(lineItemId);
    setShowRevisionUploader(false);
    setIsRevisionDragActive(false);
  }

  function submitStagedRevision(line: ProofLineMock) {
    const staged = stagedRevisionByLine[line.lineItemId];
    if (!staged || isLineRevisionProcessing(line)) return;
    void processRevisedFile(staged.file, line);
  }

  function openFeedbackDrawer(line: ProofLineMock) {
    setSelectedId(line.lineItemId);
    setFeedbackViewedByLine((prev) => ({
      ...prev,
      [feedbackAckKey(line)]: true,
    }));
    setFeedbackDrawerOpen(true);
  }

  function approveProofLine(line: ProofLineMock) {
    if (!line.proofFullUrl) return;
    if (isProofActionProcessing("approve", line.lineItemId)) return;
    const lineNote = getLineNoteValue(line.lineItemId).trim();

    shareAccess.requireEdit("proofs", "proof.approve", `approved proof line ${line.lineNumber}`, async () => {
      const actionId = proofActionId("approve", line.lineItemId);
      setPendingProofAction(actionId);
      setActionMessage(`Approving line ${line.lineNumber}...`);
      try {
        if (isDemo && projectId) {
          applyProofPatch(line.lineItemId, { status: "approved", revised: line.revised });
          demoStore.actions.approveProofLine(projectId, line.lineItemId, "Demo User");
        } else if (projectId) {
          const response = await updateProjectProofLine(api, projectId, line.lineItemId, {
            status: "approved",
            proofDecisionComment: lineNote || null,
            expectedUpdatedAt: line.updatedAt || null,
            clientSessionId: presence.sessionId,
          }, shareAccess.isShareMode);
          applyProofPatch(line.lineItemId, {
            status: response.proof.status,
            revised: response.proof.revised,
            proofThumbUrl: response.proof.proofThumbUrl || response.proof.proofFullUrl || null,
            proofFullUrl: response.proof.proofFullUrl || response.proof.proofThumbUrl || null,
            printTeamFeedback: response.proof.printTeamFeedback || null,
            proofComments: response.proof.proofComments || [],
            proofCommentCount: response.proof.proofCommentCount || 0,
            proofCommentAttachmentCount: response.proof.proofCommentAttachmentCount || 0,
            latestProofCommentAt: response.proof.latestProofCommentAt || null,
            proofVersions: response.proof.proofVersions || [],
            proofApprovedBy: response.proof.proofApprovedBy || null,
            proofApprovedDate: response.proof.proofApprovedDate || null,
            technicalReports: response.proof.technicalReports || [],
            updatedAt: response.proof.updatedAt || null,
          });
        }

        clearLineNote(line.lineItemId);
        clearFeedbackAcknowledgement(line.lineItemId);
        setActionMessage(null);
      } catch (error) {
        console.error("Failed to approve proof", error);
        const message = error instanceof Error ? error.message : "We couldn't approve this proof yet. Please try again.";
        setActionMessage(message);
      } finally {
        setPendingProofAction((current) => (current === actionId ? null : current));
      }
    });
  }

  function approveSelected() {
    if (!selected) return;
    approveProofLine(selected);
  }

  function uploadRevised(line = selected) {
    if (!line) return;
    if (line.lineItemId !== selected?.lineItemId) {
      setSelectedId(line.lineItemId);
      setShowRevisionUploader(true);
      return;
    }
    if (showRevisionUploader) {
      cancelRevisionUpload(line.lineItemId);
    } else {
      setShowRevisionUploader(true);
    }
  }

  function updateRevisionJob(jobId: string, patch: Partial<RevisionBackgroundJob>) {
    setRevisionJobs((prev) => prev.map((job) => (job.id === jobId ? { ...job, ...patch } : job)));
  }

  function dismissRevisionJob(jobId: string) {
    setRevisionJobs((prev) => prev.filter((job) => job.id !== jobId));
  }

  async function runRevisedFileJob(
    jobId: string,
    file: File,
    lineForJob: ProofLineMock,
    lineNote: string
  ) {
    try {
      const filename = sanitizeFilename(file.name);
      const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(filename);

      updateRevisionJob(jobId, {
        detail: "Uploading revised artwork to Adspace.",
      });

      if (isDemo && projectId) {
        const revisedThumbUrl = buildDocumentThumbUrl({
          label: isPdf ? "PDF" : "FILE",
          accent: "#3F6ED8",
        });
        setLines((prev) =>
          prev.map((l) =>
            l.lineItemId !== lineForJob.lineItemId
              ? l
              : {
                  ...l,
                  revised: true,
                  status: "pending",
                  clientFileName: filename,
                  clientThumbUrl: revisedThumbUrl,
                  clientFullUrl: revisedThumbUrl,
                  proofThumbUrl: revisedThumbUrl,
                  proofFullUrl: revisedThumbUrl,
                  printTeamFeedback: "",
                  proofComments: [],
                  proofCommentCount: 0,
                  proofCommentAttachmentCount: 0,
                  latestProofCommentAt: null,
                }
          )
        );
        demoStore.actions.reviseProofLine(projectId, lineForJob.lineItemId);
        updateRevisionJob(jobId, {
          status: "success",
          title: `Line ${lineForJob.lineNumber} revision queued`,
          detail: "Revised artwork is ready for review.",
        });
        window.setTimeout(() => dismissRevisionJob(jobId), 4500);
        return;
      }

      if (!projectId) return;
      if (!lineForJob.clientCreativeId) {
        throw new Error("This proof line is missing its linked creative record.");
      }

      let thumbnailFile: File | null = null;
      if (isPdf) {
        try {
          thumbnailFile = await generatePdfThumbnail(file, filename);
        } catch (error) {
          console.warn("Failed to generate revised PDF thumbnail", error);
        }
      }

      const signed = await requestArtworkUploadUrl(api, {
        projectId,
        filename,
        contentType: file.type || "application/octet-stream",
        assetKind: "artwork",
        shareMode: shareAccess.isShareMode,
      });

      let signedThumb:
        | {
            key: string;
            uploadUrl: string;
          }
        | null = null;

      if (thumbnailFile) {
        const thumbSigned = await requestArtworkUploadUrl(api, {
          projectId,
          filename: thumbnailFile.name,
          contentType: thumbnailFile.type || "image/jpeg",
          assetKind: "artwork",
          shareMode: shareAccess.isShareMode,
        });
        signedThumb = {
          key: thumbSigned.key,
          uploadUrl: thumbSigned.uploadUrl,
        };
      }

      const fileResponse = await fetch(signed.uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": file.type || "application/octet-stream",
        },
        body: file,
      });
      if (!fileResponse.ok) {
        throw new Error(`Upload failed for ${filename}`);
      }

      if (signedThumb && thumbnailFile) {
        const thumbResponse = await fetch(signedThumb.uploadUrl, {
          method: "PUT",
          headers: {
            "Content-Type": thumbnailFile.type || "image/jpeg",
          },
          body: thumbnailFile,
        });
        if (!thumbResponse.ok) {
          throw new Error(`Thumbnail upload failed for ${filename}`);
        }
      }

      updateRevisionJob(jobId, {
        detail: "Submitting revised artwork.",
      });

      const fileMeta = `${isPdf ? "PDF" : "FILE"} · ${(file.size / 1024 / 1024).toFixed(1)} MB · ${
        lineForJob.mediaName
      } ${formatSize(lineForJob.w, lineForJob.h)}`;

      const updatedCreative = await updateProjectCreativeAsset(api, projectId, lineForJob.clientCreativeId, {
        bucketName: signed.bucket,
        objectKey: signed.key,
        thumbObjectKey: signedThumb?.key,
        filename,
        fileMeta,
        contentType: file.type || "application/octet-stream",
        thumbContentType: thumbnailFile?.type || undefined,
        sizeBytes: file.size,
      }, shareAccess.isShareMode);

      const buildRevisionPayload = (expectedUpdatedAt: string | null) => ({
        status: "pending" as const,
        revised: true,
        clientFileName: filename,
        useClientCreativeAsProof: true,
        proofDecisionComment: lineNote || null,
        expectedUpdatedAt,
        clientSessionId: presence.sessionId,
      });

      let response: Awaited<ReturnType<typeof updateProjectProofLine>>;
      try {
        response = await updateProjectProofLine(
          api,
          projectId,
          lineForJob.lineItemId,
          buildRevisionPayload(lineForJob.updatedAt || null),
          shareAccess.isShareMode
        );
      } catch (error) {
        if (!isStaleProofLineError(error)) throw error;
        updateRevisionJob(jobId, {
          detail: "Proof data changed during upload. Refreshing and finishing submission.",
        });
        const refreshedLines = await syncProofsSilently();
        const refreshedLine = refreshedLines?.find((line) => line.lineItemId === lineForJob.lineItemId);
        response = await updateProjectProofLine(
          api,
          projectId,
          lineForJob.lineItemId,
          buildRevisionPayload(refreshedLine?.updatedAt || null),
          shareAccess.isShareMode
        );
      }

      applyProofPatch(lineForJob.lineItemId, {
        status: response.proof.status,
        revised: response.proof.revised,
        clientFileName: filename,
        clientThumbUrl:
          updatedCreative.thumbUrl ||
          updatedCreative.fullUrl ||
          buildDocumentThumbUrl({
            label: isPdf ? "PDF" : "FILE",
            accent: updatedCreative.color || "#3F6ED8",
          }),
        clientFullUrl: updatedCreative.fullUrl || updatedCreative.thumbUrl || null,
        proofThumbUrl: response.proof.proofThumbUrl || response.proof.proofFullUrl || null,
        proofFullUrl: response.proof.proofFullUrl || response.proof.proofThumbUrl || null,
        printTeamFeedback: response.proof.printTeamFeedback || null,
        proofComments: response.proof.proofComments || [],
        proofCommentCount: response.proof.proofCommentCount || 0,
        proofCommentAttachmentCount: response.proof.proofCommentAttachmentCount || 0,
        latestProofCommentAt: response.proof.latestProofCommentAt || null,
        proofVersions: response.proof.proofVersions || [],
        proofApprovedBy: response.proof.proofApprovedBy || null,
        proofApprovedDate: response.proof.proofApprovedDate || null,
        technicalReports: response.proof.technicalReports || [],
        updatedAt: response.proof.updatedAt || null,
      });

      updateRevisionJob(jobId, {
        status: "success",
        title: `Line ${lineForJob.lineNumber} revision submitted`,
        detail: "Revised artwork accepted. A regenerated proof will appear after sync.",
      });
      window.setTimeout(() => dismissRevisionJob(jobId), 5000);
    } catch (error) {
      console.error("Failed to upload revised artwork", error);
      const staleLine = isStaleProofLineError(error);
      const message = staleLine
        ? "Proof data refreshed. Submit the revised artwork again."
        : error instanceof Error ? error.message : "We couldn't upload the revised artwork yet. Please try again.";
      if (staleLine) {
        const refreshedLines = await syncProofsSilently();
        const refreshedLine = refreshedLines?.find((line) => line.lineItemId === lineForJob.lineItemId) || lineForJob;
        setSelectedId(lineForJob.lineItemId);
        setShowRevisionUploader(true);
        stageRevisedFile(file, refreshedLine);
      }
      if (!isDemo && projectId) {
        void logProjectErrorEvent(api, projectId, {
          actionType: "proof.revise",
          errorCode: "proof_revision_upload_failed",
          message,
          severity: "error",
          surface: "proof_approval.revision_upload",
          workspace: "proofs",
          metadata: {
            lineItemId: lineForJob.lineItemId,
            lineNumber: lineForJob.lineNumber,
          },
        }, shareAccess.isShareMode).catch(() => undefined);
      }
      if (lineNote) {
        setLineNoteDraft(lineForJob.lineItemId, lineNote, true);
      }
      updateRevisionJob(jobId, {
        status: "error",
        title: `Line ${lineForJob.lineNumber} revision failed`,
        detail: message,
      });
    }
  }

  async function processRevisedFile(file: File, lineOverride?: ProofLineMock) {
    const lineForJob = lineOverride || selected;
    if (!file || !lineForJob || !projectId) return;
    const filename = sanitizeFilename(file.name);
    const lineNote = getLineNoteValue(lineForJob.lineItemId).trim();
    const jobId = `${lineForJob.lineItemId}-${Date.now()}`;

    await shareAccess.requireEdit(
      "proofs",
      "proof.revise",
      `uploaded revised file for proof line ${lineForJob.lineNumber}`,
      async () => {
        setRevisionJobs((prev) => [
          {
            id: jobId,
            lineItemId: lineForJob.lineItemId,
            lineNumber: lineForJob.lineNumber,
            filename,
            status: "processing",
            title: `Line ${lineForJob.lineNumber} revision processing`,
            detail: "Preparing revised artwork upload.",
            note: lineNote,
          },
          ...prev.filter((job) => job.id !== jobId),
        ]);
        clearLineNote(lineForJob.lineItemId);
        clearStagedRevision(lineForJob.lineItemId);
        setShowRevisionUploader(false);
        setIsRevisionDragActive(false);
        clearFeedbackAcknowledgement(lineForJob.lineItemId);
        setActionMessage(null);
        void runRevisedFileJob(jobId, file, lineForJob, lineNote);
      }
    );
  }

  function undoApproval() {
    if (!selected) return;
    shareAccess.requireEdit("proofs", "proof.undo_approval", `removed approval for proof line ${selected.lineNumber}`, async () => {
      const lineForUndo = selected;
      const actionId = proofActionId("undo", lineForUndo.lineItemId);
      setPendingProofAction(actionId);
      setActionMessage(`Updating line ${lineForUndo.lineNumber}...`);
      try {
        if (isDemo && projectId) {
          applyProofPatch(lineForUndo.lineItemId, { status: "pending", revised: lineForUndo.revised });
          demoStore.actions.updateProofLine(projectId, lineForUndo.lineItemId, {
            status: "pending",
          } as any);
        } else if (projectId) {
          const response = await updateProjectProofLine(api, projectId, lineForUndo.lineItemId, {
            status: "pending",
            expectedUpdatedAt: lineForUndo.updatedAt || null,
            clientSessionId: presence.sessionId,
          }, shareAccess.isShareMode);
          applyProofPatch(lineForUndo.lineItemId, {
            status: response.proof.status,
            revised: response.proof.revised,
            proofThumbUrl: response.proof.proofThumbUrl || response.proof.proofFullUrl || null,
            proofFullUrl: response.proof.proofFullUrl || response.proof.proofThumbUrl || null,
            printTeamFeedback: response.proof.printTeamFeedback || null,
            proofComments: response.proof.proofComments || [],
            proofCommentCount: response.proof.proofCommentCount || 0,
            proofCommentAttachmentCount: response.proof.proofCommentAttachmentCount || 0,
            latestProofCommentAt: response.proof.latestProofCommentAt || null,
            proofVersions: response.proof.proofVersions || [],
            proofApprovedBy: response.proof.proofApprovedBy || null,
            proofApprovedDate: response.proof.proofApprovedDate || null,
            technicalReports: response.proof.technicalReports || [],
            updatedAt: response.proof.updatedAt || null,
          });
        }

        setActionMessage("Approval removed. This proof now needs review again.");
      } catch (error) {
        console.error("Failed to undo proof approval", error);
        const message = error instanceof Error ? error.message : "We couldn't update this proof yet. Please try again.";
        setActionMessage(message);
      } finally {
        setPendingProofAction((current) => (current === actionId ? null : current));
      }
    });
  }

  if (shareAccess.isShareMode && shareAccess.isResolving) {
    return (
      <AppShell pageClassName="wide" projectTitle={projectTitle}>
        <div className="app-loadingWrap app-loadingWrap-page">
          <div className="app-loadingCard app-loadingCard-wide" role="status" aria-live="polite">
            <div className="app-loadingOrb" aria-hidden="true">
              <span className="app-loadingOrbRing" />
              <span className="app-loadingOrbDot" />
            </div>
            <div className="app-loadingTitle">Loading Proof Approval</div>
            <div className="app-loadingBody">Checking your shared access and pulling the live proof queue.</div>
            <div className="app-loadingRail" aria-hidden="true">
              <span className="app-loadingRailBar app-loadingRailBar-wide" />
              <span className="app-loadingRailBar" />
              <span className="app-loadingRailBar app-loadingRailBar-short" />
            </div>
          </div>
        </div>
      </AppShell>
    );
  }

  if (shareAccess.isShareMode && (!shareAccess.shareLink || shareAccess.isRevoked || !shareAccess.canView("proofs"))) {
    return (
      <AppShell pageClassName="wide" projectTitle={projectTitle}>
        <ShareAccessDenied
          title={shareAccess.isRevoked ? "This shared link has been revoked" : "This shared link cannot open Proof Approval"}
          body="Ask the project owner for an End Client Collaboration or View Only link if you need proof access."
        />
      </AppShell>
    );
  }

  if (!isDemo && liveLoading && lines.length === 0) {
    return (
      <AppShell pageClassName="wide" projectTitle={projectTitle}>
        <div className="app-loadingWrap app-loadingWrap-page">
          <div className="app-loadingCard app-loadingCard-wide" role="status" aria-live="polite">
            <div className="app-loadingOrb" aria-hidden="true">
              <span className="app-loadingOrbRing" />
              <span className="app-loadingOrbDot" />
            </div>
            <div className="app-loadingTitle">Loading Proof Approval</div>
            <div className="app-loadingBody">Pulling the latest proof queue and line details.</div>
            <div className="app-loadingRail" aria-hidden="true">
              <span className="app-loadingRailBar app-loadingRailBar-wide" />
              <span className="app-loadingRailBar" />
              <span className="app-loadingRailBar app-loadingRailBar-short" />
            </div>
          </div>
        </div>
      </AppShell>
    );
  }

  if (!isDemo && loadError && lines.length === 0) {
    return (
      <AppShell pageClassName="wide" projectTitle={projectTitle}>
        <div className="app-loadingWrap app-loadingWrap-page">
          <div className="app-loadingCard app-loadingCard-wide" role="alert" aria-live="polite">
            <div className="app-loadingOrb" aria-hidden="true">
              <span className="app-loadingOrbRing" />
              <span className="app-loadingOrbDot" />
            </div>
            <div className="app-loadingTitle">Proof Queue Unavailable</div>
            <div className="app-loadingBody">{loadError}</div>
            <div className="settings-actions">
              <button className="btn btn-primary" type="button" onClick={refreshProofStatus}>
                Retry Proof Queue
              </button>
              <button className="btn btn-ghost btn-soft" type="button" onClick={() => navigate(shareAccess.buildProjectUrl(`/p/${projectId}${modeSuffix}`))}>
                Back to Hub
              </button>
            </div>
          </div>
        </div>
      </AppShell>
    );
  }

  // Everything above is now hardened/organized.
  // Next line in your file should be:  return (
  const proofSyncMessage = syncWarning || backgroundSyncMessage || proofSyncStatusText(proofSyncInfo);

  return (
    <AppShell pageClassName="wide" projectTitle={projectTitle}>
      <PullToRefresh onRefresh={refreshProofApproval} disabled={proofPullRefreshDisabled}>
      <div className={`proof-workspace ${useProofCommandHeader ? "is-command-header" : "is-classic-header"}`}>
        {useProofCommandHeader ? (
          <section className="proof-commandHeader" aria-label="Proof approval workspace header">
            <div className="proof-commandIdentity">
              <button
                className="btn btn-ghost btn-soft proof-commandBack"
                type="button"
                onClick={() => navigate(shareAccess.buildProjectUrl(`/p/${projectId}${modeSuffix}`))}
              >
                ← Back
              </button>

              <div className="proof-commandTitleBlock">
                <div className="proof-commandEyebrow">Proof Approval</div>
                <div className="proof-commandTitle" title={rollup?.title || projectTitle}>
                  {rollup?.title || projectTitle}
                </div>
              </div>
            </div>

            <div className="proof-commandMeta" aria-label="Proof approval status">
              <span className="proof-commandChip">{rollup ? rollup.venueName : venueName}</span>
              <span className="proof-commandChip">Order {rollup?.liftOrderId || rollup?.extId || orderNumber || "Not set"}</span>

              <span className="proof-commandStat proof-commandStatPending">
                <span className="proof-commandStatLabel">Pending</span>
                <span className="proof-commandStatValue">{counts.pending}</span>
              </span>

              {counts.revised > 0 ? (
                <span className="proof-commandStat proof-commandStatRevised">
                  <span className="proof-commandStatLabel">Revised</span>
                  <span className="proof-commandStatValue">{counts.revised}</span>
                </span>
              ) : null}

              {counts.waiting > 0 ? (
                <span className="proof-commandStat proof-commandStatWaiting">
                  <span className="proof-commandStatLabel">Waiting</span>
                  <span className="proof-commandStatValue">{counts.waiting}</span>
                </span>
              ) : null}

              <span className="proof-commandStat proof-commandStatApproved">
                <span className="proof-commandStatLabel">Approved</span>
                <span className="proof-commandStatValue">{counts.approved}/{counts.total}</span>
              </span>
            </div>

            <div className="proof-commandActions">
              <WorkspacePresenceCluster
                participants={presence.participants}
                currentSessionId={presence.sessionId}
                status={presence.status}
              />
              {proofSyncMessage ? (
                <span
                  className={`proof-commandSyncStatus ${syncWarning ? "is-warning" : "is-neutral"}`}
                  role="status"
                  title={proofSyncMessage}
                >
                  {proofSyncMessage}
                </span>
              ) : null}
              {!isDemo && !shareAccess.isShareMode ? (
                <button
                  className="btn btn-ghost btn-soft"
                  type="button"
                  disabled={liveLoading}
                  onClick={refreshProofStatus}
                >
                  {liveLoading ? "Refreshing…" : "Refresh Proof Status"}
                </button>
              ) : (
                <span className="proof-commandQueueStatus">
                  {remainingProofActions === 0 && counts.total > 0 ? "Review Complete" : "Review Queue"}
                </span>
              )}
            </div>
          </section>
        ) : (
          <PageHeader
            variant="workspace"
            className="page-header-compactProject"
            backLabel="← Back to Hub"
            onBack={() => navigate(shareAccess.buildProjectUrl(`/p/${projectId}${modeSuffix}`))}
            eyebrow="Proof Approval"
            title={rollup?.title || projectTitle}
            actions={
              !isDemo ? (
                <button
                  className="btn btn-ghost btn-soft"
                  type="button"
                  disabled={liveLoading}
                  onClick={refreshProofStatus}
                >
                  {liveLoading ? "Refreshing…" : "Refresh Proof Status"}
                </button>
              ) : null
            }
            meta={
              <>
                <span>{rollup ? `${rollup.venueName}` : `${venueName}`}</span>
                <span className="page-header-dot">•</span>
                <span>Order #: {rollup?.liftOrderId || rollup?.extId || orderNumber || "—"}</span>
                <span className="page-header-dot">•</span>
                <span>{counts.pending} pending</span>
                <span className="page-header-dot">•</span>
                <span>{counts.approved} approved</span>
              </>
            }
          />
        )}

      {!useProofCommandHeader && proofSyncMessage && (
        <div className={`proof-syncWarning ${syncWarning ? "" : "is-neutral"}`} role="status">
          {proofSyncMessage}
        </div>
      )}

      {proofsComplete && (
        <div className="proof-completeBanner">
          <div className="proof-completeBannerMain">
            <div className="proof-completeKicker">Proof Approval Complete</div>
            <div className="proof-completeTitle">All proofs have been approved.</div>
            <div className="proof-completeBody">
              {proofsCompleteInProduction
                ? liftLinesComplete
                  ? "The order is complete."
                  : "The order is now in production."
                : "The proof packet remains available for reference."}
            </div>
          </div>
        </div>
      )}

      <div className="proof-mobileFeed" aria-label="Proof approval feed">
        {!proofsComplete && (
          <div className="proof-mobileControls">
            <div className="proof-summary proof-mobileSummary">
              <div className="proof-summary-title">{proofSummaryTitle}</div>
              <div className="proof-summary-body">{proofSummaryBody}</div>
            </div>
          </div>
        )}

        <div
          className={`proof-mobileStickyTools ${mobileToolsExpanded ? "is-expanded" : "is-collapsed"} ${hasActiveMobileFilters ? "has-active-filters" : ""}`}
          ref={mobileToolsRef}
        >
          <div className="proof-mobileDock" aria-label="Proof queue controls">
            <button
              className="proof-mobileDockSummary"
              type="button"
              aria-expanded={mobileToolsExpanded}
              onClick={() => setMobileToolsExpanded((prev) => !prev)}
            >
              <span className="proof-mobileDockCount">{mobileFilterSummary}</span>
              <span className="proof-mobileDockSub">{mobileActionableCount} pending</span>
              <ChevronDown aria-hidden="true" size={14} />
            </button>

            <button
              className="proof-mobileDockIcon"
              type="button"
              aria-label="Search proof files"
              onClick={() => expandMobileTools(true)}
            >
              <Search aria-hidden="true" size={17} />
            </button>

            <button
              className={`proof-mobileDockIcon ${hasActiveMobileFilters ? "is-active" : ""}`}
              type="button"
              aria-label="Filter proof queue"
              onClick={() => expandMobileTools(false)}
            >
              <SlidersHorizontal aria-hidden="true" size={17} />
            </button>

            <button
              className="proof-mobileDockNext"
              type="button"
              onClick={scrollToNextPendingMobile}
              disabled={mobileActionableCount === 0}
            >
              Next
            </button>
          </div>

          {mobileToolsExpanded ? (
            <div className="proof-mobileExpandedTools">
              <div className="proof-tabs proof-mobileTabs">
                <button className={`tab ${filter === "all" ? "tab-active" : ""}`} onClick={() => handleMobileFilterChange("all")} type="button">
                  All ({counts.total})
                </button>
                <button className={`tab ${filter === "pending" ? "tab-active" : ""}`} onClick={() => handleMobileFilterChange("pending")} type="button">
                  Pending ({counts.pending})
                </button>
                <button className={`tab ${filter === "approved" ? "tab-active" : ""}`} onClick={() => handleMobileFilterChange("approved")} type="button">
                  Approved ({counts.approved})
                </button>
                <button className={`tab ${filter === "revised" ? "tab-active" : ""}`} onClick={() => handleMobileFilterChange("revised")} type="button">
                  Revised ({counts.revised})
                </button>
              </div>

              <div className="proof-filters proof-mobileFilters">
                <div className="proof-search">
                  <span className="field-icon">⌕</span>
                  <input
                    ref={mobileSearchInputRef}
                    className="field-input"
                    placeholder="Search files…"
                    value={q}
                    onChange={handleMobileSearchChange}
                  />
                </div>

                <select className="select proof-media" value={mediaVariant} onChange={handleMobileMediaChange}>
                  {mediaOptions.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt === "all" ? "All Media" : mediaLabelFromKey(opt)}
                    </option>
                  ))}
                </select>
                {showInternalRouteMeta ? (
                  <select className="select proof-media" value={routeFilter} onChange={handleMobileRouteChange}>
                    <option value="all">All Routes</option>
                    <option value="lift">Lift Sync</option>
                    <option value="adspace">External</option>
                  </select>
                ) : null}
              </div>

              <div className="proof-mobileQueueBar" aria-label="Proof queue shortcuts">
                <div className="proof-mobileQueueCount">
                  <strong>{filtered.length}</strong>
                  <span>of {counts.total} shown</span>
                </div>
                <button
                  className="proof-mobileQueueButton"
                  type="button"
                  onClick={clearMobileFilters}
                  disabled={!hasActiveMobileFilters}
                >
                  Clear
                </button>
                <button className="proof-mobileQueueButton" type="button" onClick={scrollMobileQueueTop}>
                  Top
                </button>
                <button
                  className="proof-mobileQueueButton is-primary"
                  type="button"
                  onClick={scrollToNextPendingMobile}
                  disabled={mobileActionableCount === 0}
                >
                  Next Pending
                </button>
                <button
                  className="proof-mobileQueueButton proof-mobileQueueClose"
                  type="button"
                  onClick={() => setMobileToolsExpanded(false)}
                  aria-label="Collapse proof queue controls"
                >
                  <X aria-hidden="true" size={15} />
                  <span>Collapse</span>
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="proof-mobileCardsAnchor" ref={mobileCardsTopRef} />
        <div className="proof-mobileCards">
          {filtered.length === 0 ? (
            <div className="proof-empty">
              No proof lines match the current filters.
            </div>
          ) : filtered.map((l) => {
            const s = statusLabel(l);
            const proofName = getProofFileName(l);
            const lineFeedbackSummary = getFeedbackSummary(l);
            const lineHasClientAsset = hasClientUploadAsset(l);
            const lineIsApproved = l.status === "approved";
            const lineIsWaiting = isLineWaiting(l);
            const lineIsProcessing = isLineRevisionProcessing(l);
            const lineIsApproving = isProofActionProcessing("approve", l.lineItemId);
            const lineCanApprove = canApproveLine(l);
            const lineCanUploadRevision = canUploadRevisionForLine(l);
            const lineNeedsFeedbackAck = lineRequiresFeedbackAcknowledgement(l);
            const isUploaderOpenForLine = showRevisionUploader && selected?.lineItemId === l.lineItemId && !lineIsApproved;
            const lineStagedRevision = stagedRevisionByLine[l.lineItemId] || null;
            const lineUsesSimpleDecisionDock = !lineFeedbackSummary.hasFeedback && !lineIsApproved && !lineIsWaiting;
            return (
              <article
                className={`proof-mobileCard ${lineIsApproved ? "is-complete" : "is-actionable"}`}
                key={l.lineItemId}
                ref={(node) => {
                  mobileCardRefs.current[l.lineItemId] = node;
                }}
              >
                <div className="proof-mobileCardHead">
                  <div className="proof-lineIdentity">
                    <span className="proof-lineBadge">{getProofLineLabel(l)}</span>
                    {lineFeedbackSummary.hasFeedback ? (
                      <button className="proof-commentBadge proof-commentBadgeButton" type="button" onClick={() => openFeedbackDrawer(l)}>
                        {lineFeedbackSummary.commentCount || lineFeedbackSummary.attachmentCount} feedback
                      </button>
                    ) : null}
                  </div>
                  <span className={`chip tone-${s.tone}`}>{s.label}</span>
                </div>

                <div className="proof-mobileTitle">
                  {l.mediaVariantLabel || `${l.mediaName} · ${formatSize(l.w, l.h)}`}
                </div>
                {l.locations.length ? (
                  <div className="proof-mobileMeta">
                    <span>{l.locations.length} location{l.locations.length === 1 ? "" : "s"}</span>
                    <span>{l.locations.join(", ")}</span>
                  </div>
                ) : null}

                {lineHasClientAsset ? (
                  <>
                    <div className="proof-mobileUpload">
                      <button
                        className="proof-mobileUploadThumb"
                        type="button"
                        disabled={!l.clientFullUrl}
                        aria-label={`View client upload ${l.clientFileName}`}
                        onClick={() => l.clientFullUrl && window.open(l.clientFullUrl, "_blank")}
                      >
                        <img src={l.clientThumbUrl || l.clientFullUrl || getQueueThumbUrl(l)} alt="" />
                      </button>
                      <div className="proof-mobileFileBlock">
                        <div className="proof-mobileFileLabel">Client upload</div>
                        <div className="proof-mobileFileName" title={l.clientFileName}>{l.clientFileName}</div>
                      </div>
                    </div>
                    <ClientUploadMeta line={l} />
                  </>
                ) : (
                  <div className="proof-uploadUnavailable">
                    Original client upload unavailable for this proof line.
                  </div>
                )}

                <button
                  className="proof-mobileProof proof-mobileProofButton"
                  type="button"
                  disabled={!l.proofFullUrl}
                  aria-label={`View proof file ${proofName}`}
                  onClick={() => l.proofFullUrl && window.open(l.proofFullUrl, "_blank")}
                >
                  {l.proofThumbUrl ? (
                    <img src={l.proofThumbUrl} alt="" />
                  ) : (
                    <div className="proof-waiting">The current proof file has not been published yet...</div>
                  )}
                </button>
                {l.proofFullUrl || l.proofThumbUrl ? <ProofReceivedMeta line={l} /> : null}

                {isUploaderOpenForLine ? (
                  <div
                    className={`proof-revisionDrop proof-mobileRevisionDrop ${isRevisionDragActive ? "is-dragover" : ""}`}
                    onDragOver={(event) => {
                      if (!canEditProofs) return;
                      event.preventDefault();
                      setIsRevisionDragActive(true);
                    }}
                    onDragLeave={() => setIsRevisionDragActive(false)}
	                    onDrop={(event) => {
	                      event.preventDefault();
	                      setIsRevisionDragActive(false);
	                      const file = event.dataTransfer.files?.[0];
	                      if (file) stageRevisedFile(file, l);
	                    }}
	                  >
	                    <div className="proof-revisionDropTitle">Upload revised artwork</div>
	                    {lineStagedRevision ? (
	                      <div className="proof-stagedRevision">
	                        <StagedRevisionSummary staged={lineStagedRevision} />
	                        <button
	                          className="btn btn-ghost btn-soft"
	                          type="button"
	                          disabled={lineIsProcessing}
	                          onClick={() => clearStagedRevision(l.lineItemId)}
	                        >
	                          Clear
	                        </button>
	                      </div>
	                    ) : (
	                      <div className="proof-revisionDropBody">
	                        Drop or browse for the revised file. Nothing is sent until you submit.
	                      </div>
	                    )}
	                    <div className="proof-revisionDropActions">
	                      <button
	                        className="btn btn-ghost btn-soft"
	                        type="button"
	                        disabled={!canEditProofs || lineIsProcessing}
                        onClick={() => mobileRevisionInputRef.current?.click()}
                      >
                        Browse Files
                      </button>
	                      <button
	                        className="btn btn-ghost btn-soft"
	                        type="button"
	                        disabled={lineIsProcessing}
	                        onClick={() => cancelRevisionUpload(l.lineItemId)}
	                      >
	                        Cancel
	                      </button>
	                      <button
	                        className="btn btn-primary"
	                        type="button"
	                        disabled={!canEditProofs || lineIsProcessing || !lineStagedRevision}
	                        onClick={() => submitStagedRevision(l)}
	                      >
	                        Submit Revised Art
	                      </button>
	                    </div>
	                    <input
	                      ref={mobileRevisionInputRef}
	                      hidden
                      type="file"
	                      accept=".pdf,image/*"
	                      onChange={(event) => {
	                        const file = event.currentTarget.files?.[0];
	                        if (file) stageRevisedFile(file, l);
	                        event.currentTarget.value = "";
	                      }}
	                    />
                  </div>
                ) : null}

                <footer className={`proof-mobileAction ${lineFeedbackSummary.hasFeedback && !lineIsApproved && !lineIsWaiting ? "has-feedback" : ""} ${lineNeedsFeedbackAck ? "is-locked" : ""} ${lineUsesSimpleDecisionDock ? "is-simple" : ""}`}>
                  {lineFeedbackSummary.hasFeedback && !lineIsApproved && !lineIsWaiting ? (
                    <FeedbackGate
                      line={l}
                      acknowledged={isLineFeedbackAcknowledged(l)}
                      hasViewedFeedback={hasLineFeedbackBeenViewed(l)}
                      disabled={!canEditProofs}
                      mobile
                      onOpen={() => openFeedbackDrawer(l)}
                      onAcknowledge={(checked) => acknowledgeFeedbackForLine(l, checked)}
                    />
                  ) : lineIsWaiting ? (
                    <div className="proof-dockHint">
                      Approval unlocks after the proof file is published.
                    </div>
                  ) : null}

                  {!lineNeedsFeedbackAck || lineIsApproved ? (
                    <label className="proof-dockNoteWrap proof-mobileNoteWrap">
                      <span>Line note</span>
	                      <textarea
	                        className="proof-dockNote"
	                        placeholder="Optional note sent with this decision"
	                        key={`line-note-${l.lineItemId}-${lineNotes[l.lineItemId] || ""}`}
	                        defaultValue={lineNotes[l.lineItemId] || ""}
	                        disabled={!canEditProofs || lineIsApproved || lineIsProcessing}
	                        onFocus={() => setSelectedId(l.lineItemId)}
	                        onChange={(event) => setLineNoteDraft(l.lineItemId, event.currentTarget.value)}
	                        onBlur={(event) => setLineNoteDraft(l.lineItemId, event.currentTarget.value, true)}
	                      />
                    </label>
                  ) : null}

                  {!lineNeedsFeedbackAck || lineIsApproved ? (
                    <div className="proof-actions proof-mobileActions">
                    {!lineIsApproved ? (
                      <>
                          <button
                            className={lineCanApprove || lineIsApproving ? "btn btn-primary btn-lg" : "btn btn-ghost btn-soft btn-lg"}
                            disabled={!lineCanApprove || lineIsApproving}
                            onClick={() => {
                              setSelectedId(l.lineItemId);
                              approveProofLine(l);
                            }}
                            type="button"
                          >
                            {lineIsApproving ? (
                              <>
                                <span className="proof-buttonSpinner" aria-hidden="true" />
                                Approving...
                              </>
                            ) : lineIsWaiting ? "Waiting for Proof" : "Approve for Print"}
                          </button>

                          <button
                            className="btn btn-ghost btn-soft btn-lg"
                            disabled={!lineCanUploadRevision}
                            onClick={() => uploadRevised(l)}
                            type="button"
                          >
                            {lineIsProcessing ? "Revision Processing…" : isUploaderOpenForLine ? "Close Revised Upload" : "Upload Revised File"}
                          </button>
                        </>
                    ) : (
                        <div className="proof-approvedNote tone-success">
                          This proof is approved for print.
                        </div>
                      )}
                    </div>
                  ) : null}
                </footer>
              </article>
            );
          })}
        </div>
      </div>

      <div className="proof-layout">
        <Panel className="proof-left panel-tight">
          {!proofsComplete && (
            <div className="proof-summary">
              <div className="proof-summary-title">{proofSummaryTitle}</div>
              <div className="proof-summary-body">{proofSummaryBody}</div>
            </div>
          )}

          <div className="proof-tabs">
            <button className={`tab ${filter === "all" ? "tab-active" : ""}`} onClick={() => setFilter("all")}>
              All ({counts.total})
            </button>
            <button className={`tab ${filter === "pending" ? "tab-active" : ""}`} onClick={() => setFilter("pending")}>
              Pending ({counts.pending})
            </button>
            <button className={`tab ${filter === "approved" ? "tab-active" : ""}`} onClick={() => setFilter("approved")}>
              Approved ({counts.approved})
            </button>
            <button className={`tab ${filter === "revised" ? "tab-active" : ""}`} onClick={() => setFilter("revised")}>
              Revised ({counts.revised})
            </button>
          </div>

          <div className="proof-filters">
            <div className="proof-search">
              <span className="field-icon">⌕</span>
              <input
                className="field-input"
                placeholder="Search files…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>

            <select className="select proof-media" value={mediaVariant} onChange={(e) => setMediaVariant(e.target.value)}>
              {mediaOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt === "all" ? "All Media" : mediaLabelFromKey(opt)}
                </option>
              ))}
            </select>
            {showInternalRouteMeta ? (
              <select className="select proof-media" value={routeFilter} onChange={(e) => setRouteFilter(e.target.value as "all" | "lift" | "adspace")}>
                <option value="all">All Routes</option>
                <option value="lift">Lift Sync</option>
                <option value="adspace">External</option>
              </select>
            ) : null}
          </div>

          <div className="proof-list">
            {filtered.length === 0 ? (
              <div className="proof-empty">
                No proof lines match the current filters.
              </div>
            ) : filtered.map((l) => {
              const s = statusLabel(l);
              const proofName = getProofFileName(l);
              const locationPreview = getLocationPreview(l);
              const feedbackSummary = getFeedbackSummary(l);
              const queueThumbUrl = getQueueThumbUrl(l);
              const productLabel = l.mediaName || l.mediaVariantLabel || "Proof item";
              const dimensionsLabel = formatSize(l.w, l.h);
              return (
                <button
                  key={l.lineItemId}
                  className={`proof-row ${l.lineItemId === selected?.lineItemId ? "is-active" : ""}`}
                  onClick={() => setSelectedId(l.lineItemId)}
                  type="button"
                >
                  <div className="proof-thumb">
                    <img src={queueThumbUrl} alt="" />
                  </div>

                  <div className="proof-row-main">
                    <div className="proof-row-top">
                      <span className="proof-lineIdentity">
                        <span className="proof-lineBadge">{getProofLineLabel(l)}</span>
                        {feedbackSummary.hasFeedback ? (
                          <span className="proof-commentBadge" title={formatFeedbackMeta(l)}>
                            {feedbackSummary.commentCount || feedbackSummary.attachmentCount} feedback
                          </span>
                        ) : null}
                      </span>
                      <span className={`chip tone-${s.tone}`}>{s.label}</span>
                    </div>

                    <div className="proof-row-specs" title={`${productLabel} · ${dimensionsLabel}`}>
                      <div className="proof-row-spec">
                        <span>Product</span>
                        <strong>{productLabel}</strong>
                      </div>
                      <div className="proof-row-spec">
                        <span>Dimensions</span>
                        <strong>{dimensionsLabel}</strong>
                      </div>
                      <div className={`proof-row-spec ${hasProofQuantityMismatch(l) ? "is-warning" : ""}`}>
                        <span>Qty</span>
                        <strong>
                          {proofQuantity(l) ?? "—"}
                          {hasProofQuantityMismatch(l) ? ` · ${l.locations.length} assigned` : ""}
                        </strong>
                      </div>
                    </div>

                    <div className="proof-row-file" title={proofName !== "—" ? proofName : l.clientFileName}>
                      {truncateMiddle(proofName !== "—" ? proofName : l.clientFileName, 48)}
                    </div>

                    {locationPreview.visible.length || l.revised ? (
                    <div className="proof-row-locations" title={l.locations.join(", ") || "Line status"}>
                      {locationPreview.visible.length ? locationPreview.visible.map((locationId) => (
                        <span className="proof-locationPill" key={locationId}>{locationId}</span>
                      )) : null}
                      {locationPreview.remaining > 0 ? (
                        <span className="proof-locationPill is-more">+{locationPreview.remaining}</span>
                      ) : null}
                      {l.revised && <span className="proof-revised">Revised</span>}
                    </div>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
        </Panel>

        <Panel className="proof-right">
          {selected ? (
            <>
              <article className="proof-tabletCanvas" aria-label="Selected proof review card">
                <div className="proof-mobileCard proof-tabletCard">
                  <div className="proof-mobileCardHead proof-tabletCardHead">
                    <div className="proof-lineIdentity">
                      <span className="proof-lineBadge">{getProofLineLabel(selected)}</span>
                    </div>
                    <div className="proof-tabletTools">
                      <button
                        className="btn btn-ghost btn-soft proof-headerAction"
                        onClick={() => setHistoryOpen(true)}
                        type="button"
                      >
                        File history
                      </button>
                      <span className={`chip tone-${statusLabel(selected).tone}`}>{statusLabel(selected).label}</span>
                    </div>
                  </div>

                  <div className="proof-mobileTitle proof-tabletTitle">
                    {selected.mediaVariantLabel || `${selected.mediaName} · ${formatSize(selected.w, selected.h)}`}
                  </div>
                  <div className="proof-mobileMeta proof-tabletMeta">
                    {selected.locations.length ? (
                      <>
                        <span>{selected.locations.length} location{selected.locations.length === 1 ? "" : "s"}</span>
                        <span>{selected.locations.join(", ")}</span>
                      </>
                    ) : null}
                    <span className={hasProofQuantityMismatch(selected) ? "is-warning" : ""}>
                      {proofQuantityLabel(selected)}
                      {hasProofQuantityMismatch(selected) ? ` · ${selected.locations.length} assigned` : ""}
                    </span>
                  </div>
                  <div className={`proof-nextStep proof-tabletNextStep ${selectedIsWaiting ? "is-neutral" : isApproved ? "is-success" : "is-warning"}`}>
                    {selectedCompactNextStep}
                  </div>

                  {selectedHasClientAsset ? (
                    <>
                      <div className="proof-mobileUpload proof-tabletUpload">
                        <button
                          className="proof-mobileUploadThumb"
                          type="button"
                          disabled={!selected.clientFullUrl}
                          aria-label={`View client upload ${selected.clientFileName}`}
                          onClick={() => selected.clientFullUrl && window.open(selected.clientFullUrl, "_blank")}
                        >
                          <img src={selected.clientThumbUrl || selected.clientFullUrl || getQueueThumbUrl(selected)} alt="" />
                        </button>
                        <div className="proof-mobileFileBlock">
                          <div className="proof-mobileFileLabel">Client upload</div>
                          <div className="proof-mobileFileName" title={selected.clientFileName}>{selected.clientFileName}</div>
                        </div>
                      </div>
                      <ClientUploadMeta line={selected} />
                    </>
                ) : (
                  <div className="proof-uploadUnavailable proof-tabletUploadNote">
                    Original client upload unavailable for this proof line.
                  </div>
                )}

                  <button
                    className="proof-mobileProof proof-mobileProofButton proof-tabletProof"
                    type="button"
                    disabled={!selected.proofFullUrl}
                    aria-label={`View proof file ${getProofFileName(selected)}`}
                    onClick={() => selected.proofFullUrl && window.open(selected.proofFullUrl, "_blank")}
                  >
                    {selected.proofThumbUrl ? (
                      <img src={selected.proofThumbUrl} alt="" />
                    ) : (
                      <div className="proof-waiting">The current proof file has not been published yet...</div>
                    )}
                  </button>
                  {selected.proofFullUrl || selected.proofThumbUrl ? <ProofReceivedMeta line={selected} /> : null}

                  {showRevisionUploader && !isApproved ? (
                    <div
                      className={`proof-revisionDrop proof-mobileRevisionDrop proof-tabletRevisionDrop ${isRevisionDragActive ? "is-dragover" : ""}`}
                      onDragOver={(event) => {
                        if (!canEditProofs) return;
                        event.preventDefault();
                        setIsRevisionDragActive(true);
                      }}
                      onDragLeave={() => setIsRevisionDragActive(false)}
	                      onDrop={(event) => {
	                        event.preventDefault();
	                        setIsRevisionDragActive(false);
	                        const file = event.dataTransfer.files?.[0];
	                        if (file) stageRevisedFile(file, selected);
	                      }}
	                    >
	                      <div className="proof-revisionDropTitle">Upload revised artwork</div>
	                      {selectedStagedRevision ? (
	                        <div className="proof-stagedRevision">
	                          <StagedRevisionSummary staged={selectedStagedRevision} />
	                          <button
	                            className="btn btn-ghost btn-soft"
	                            type="button"
	                            disabled={isSelectedRevisionProcessing}
	                            onClick={() => selected && clearStagedRevision(selected.lineItemId)}
	                          >
	                            Clear
	                          </button>
	                        </div>
	                      ) : (
	                        <div className="proof-revisionDropBody">
	                          Drop or browse for the revised file. Nothing is sent until you submit.
	                        </div>
	                      )}
	                      <div className="proof-revisionDropActions">
	                        <button
	                          className="btn btn-ghost btn-soft"
	                          type="button"
                          disabled={!canEditProofs || isSelectedRevisionProcessing}
                          onClick={() => tabletRevisionInputRef.current?.click()}
                        >
                          Browse Files
                        </button>
	                        <button
	                          className="btn btn-ghost btn-soft"
	                          type="button"
	                          disabled={isSelectedRevisionProcessing}
	                          onClick={() => selected && cancelRevisionUpload(selected.lineItemId)}
	                        >
	                          Cancel
	                        </button>
	                        <button
	                          className="btn btn-primary"
	                          type="button"
	                          disabled={!canEditProofs || isSelectedRevisionProcessing || !selectedStagedRevision}
	                          onClick={() => selected && submitStagedRevision(selected)}
	                        >
	                          Submit Revised Art
	                        </button>
	                      </div>
	                      <input
	                        ref={tabletRevisionInputRef}
                        hidden
                        type="file"
	                        accept=".pdf,image/*"
	                        onChange={(event) => {
	                          const file = event.currentTarget.files?.[0];
	                          if (file) stageRevisedFile(file, selected);
	                          event.currentTarget.value = "";
	                        }}
	                      />
                    </div>
                  ) : null}

                  <footer className={`proof-mobileAction proof-tabletAction ${hasPrintFeedback && !isApproved && !selectedIsWaiting ? "has-feedback" : ""} ${requiresFeedbackAcknowledgement ? "is-locked" : ""} ${selectedUsesSimpleDecisionDock ? "is-simple" : ""}`}>
                    {hasPrintFeedback && !isApproved && !selectedIsWaiting ? (
                      <FeedbackGate
                        line={selected}
                        acknowledged={feedbackAcknowledged}
                        hasViewedFeedback={feedbackViewed}
                        disabled={!canEditProofs}
                        mobile
                        onOpen={() => openFeedbackDrawer(selected)}
                        onAcknowledge={(checked) => acknowledgeFeedbackForLine(selected, checked)}
                      />
                    ) : selectedIsWaiting ? (
                      <div className="proof-dockHint">
                        Approval unlocks after the proof file is published.
                      </div>
                    ) : null}

                    {showSelectedLineNote ? (
                      <label className="proof-dockNoteWrap proof-mobileNoteWrap">
                        <span>Line note</span>
	                        <textarea
	                          className="proof-dockNote"
	                          placeholder="Optional note sent with this decision"
	                          key={`tablet-line-note-${selected.lineItemId}-${selectedLineNote}`}
	                          defaultValue={selectedLineNote}
	                          disabled={!canEditProofs || isApproved || isSelectedRevisionProcessing}
	                          onChange={(event) => setLineNoteDraft(selected.lineItemId, event.currentTarget.value)}
	                          onBlur={(event) => setLineNoteDraft(selected.lineItemId, event.currentTarget.value, true)}
	                        />
                      </label>
                    ) : null}

                    {!requiresFeedbackAcknowledgement || isApproved ? (
                      <div className="proof-actions proof-mobileActions">
                      {!isApproved ? (
                        <>
                            <button
                              className={canApproveSelected || isSelectedApprovalProcessing ? "btn btn-primary btn-lg" : "btn btn-ghost btn-soft btn-lg"}
                              disabled={!canApproveSelected || isSelectedApprovalProcessing}
                              onClick={approveSelected}
                              type="button"
                            >
                              {isSelectedApprovalProcessing ? (
                                <>
                                  <span className="proof-buttonSpinner" aria-hidden="true" />
                                  Approving...
                                </>
                              ) : selectedIsWaiting ? "Waiting for Proof" : "Approve for Print"}
                            </button>

                            <button
                              className="btn btn-ghost btn-soft btn-lg"
                              disabled={!canUploadRevision}
                              onClick={() => uploadRevised()}
                              type="button"
                            >
                              {isSelectedRevisionProcessing ? "Revision Processing…" : showRevisionUploader ? "Close Revised Upload" : "Upload Revised File"}
                            </button>
                          </>
                      ) : (
                          <div className="proof-approvedNote tone-success">
                            This proof is approved for print.
                          </div>
                        )}
                      </div>
                    ) : null}
                  </footer>
                </div>
              </article>

              <div className="proof-rightScroll">
				<div className="proof-ins-head">
				  {(() => {
					const s = statusLabel(selected); // { label, tone }
					return (
					  <>
						<div className="proof-ins-topRow">
						  <div className="proof-ins-titleWrap">
							<div className="proof-ins-lineKicker">
                  {getProofLineLabel(selected)}
                  {showInternalRouteMeta ? (
                    <span className={`proof-routeBadge proof-route-${proofRouteKey(selected)}`}>{proofRouteLabel(selected)}</span>
                  ) : null}
                </div>
							<div className="proof-ins-title">
							  {selected.mediaVariantLabel || `${selected.mediaName} · ${formatSize(selected.w, selected.h)}`}
							</div>
						  </div>
				
						  <div className="proof-ins-tools">
							<button
							  className="btn btn-ghost btn-soft proof-headerAction"
							  onClick={() => setHistoryOpen(true)}
							  type="button"
							>
							  File history
							</button>
							<span className={`chip tone-${s.tone} proof-ins-statusChip`}>
							  {s.label}
							</span>
                <button
                  className={`proof-infoButton ${technicalInfoOpen ? "is-active" : ""}`}
                  type="button"
                  aria-label="Show proof technical details"
                  aria-expanded={technicalInfoOpen}
                  onClick={() => setTechnicalInfoOpen((prev) => !prev)}
                >
                  <Info aria-hidden="true" size={15} />
                </button>
                {technicalInfoOpen ? (
                  <div className="proof-techPopover" role="dialog" aria-label="Proof technical details">
                    <div className="proof-techPopoverHead">
                      <div>
                        <div className="proof-techEyebrow">Technical Info</div>
                        <div className="proof-techTitle">{getProofLineLabel(selected)}</div>
                      </div>
                      <button
                        className="proof-techClose"
                        type="button"
                        aria-label="Close technical details"
                        onClick={() => setTechnicalInfoOpen(false)}
                      >
                        <X aria-hidden="true" size={14} />
                      </button>
                    </div>
                    <dl className="proof-techList">
                      {getTechnicalInfoRows(selected).map((row) => (
                        <div className="proof-techRow" key={row.label}>
                          <dt>{row.label}</dt>
                          <dd title={String(row.value)}>{row.value}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ) : null}
						  </div>
						</div>
				
						{selected.locations.length ? (
						<div className="proof-ins-primaryMeta">
              {(() => {
                const locationPreview = getLocationPreview(selected, 3);
                return (
                  <>
                    <span>{selected.locations.length} location{selected.locations.length === 1 ? "" : "s"}</span>
                    <span className="proof-ins-locationPills" title={selected.locations.join(", ")}>
                      {locationPreview.visible.map((locationId) => (
                        <span className="proof-locationPill" key={locationId}>{locationId}</span>
                      ))}
                      {locationPreview.remaining > 0 ? <span className="proof-locationPill is-more">+{locationPreview.remaining}</span> : null}
                    </span>
                  </>
                );
              })()}
						</div>
            ) : null}

                <div className="proof-ins-systemRow" aria-label="Proof line details">
                  <div className="proof-ins-systemMeta">
                    <span className={hasProofQuantityMismatch(selected) ? "is-warning" : ""}>
                      <b>Qty</b>{proofQuantity(selected) ?? "—"}
                      {hasProofQuantityMismatch(selected) ? ` · ${selected.locations.length} assigned` : ""}
                    </span>
                  </div>
                </div>
				
						{selected.revised && (
						  <div className="proof-revised-pill">Revised from previous version</div>
						)}

            <div className={`proof-nextStep ${selectedIsWaiting ? "is-neutral" : isApproved ? "is-success" : "is-warning"}`}>
              {selectedNextStep}
            </div>

            {actionMessage && (
              <div className="proof-actionMessage">
                {actionMessage}
              </div>
            )}
					  </>
					);
				  })()}
				</div>

              <div className={`proof-viewers ${selectedHasClientAsset ? "" : "is-proof-only"}`}>
                {selectedHasClientAsset ? (
                  <div className="proof-view">
                    <div className="proof-viewHeader">
                      <div className="proof-view-label">Client Upload</div>
                    </div>
                    <button
                      className="proof-image proof-imageButton"
                      type="button"
                      disabled={!selected.clientFullUrl}
                      aria-label={`View client upload ${selected.clientFileName}`}
                      onClick={() => selected.clientFullUrl && window.open(selected.clientFullUrl, "_blank")}
                    >
                      <img src={selected.clientThumbUrl || selected.clientFullUrl || getQueueThumbUrl(selected)} alt="" />
                    </button>
                    <ClientUploadMeta line={selected} />
                  </div>
                ) : null}

                  <div className="proof-view">
                    <div className="proof-viewHeader">
                      <div className="proof-view-label">Proof for Review</div>
                      {!selectedHasClientAsset ? (
                        <div className="proof-viewNote">Original client upload unavailable for this proof line.</div>
                      ) : null}
                    </div>
                  <button
                    className="proof-image proof-imageButton"
                    type="button"
                    disabled={!selected.proofFullUrl}
                    aria-label={`View proof file ${getProofFileName(selected)}`}
                    onClick={() => selected.proofFullUrl && window.open(selected.proofFullUrl, "_blank")}
                  >
                      {selected.proofThumbUrl ? <img src={selected.proofThumbUrl} alt="" /> : <div className="proof-waiting">The current proof file has not been published yet...</div>}
                  </button>
                        {selected.proofFullUrl || selected.proofThumbUrl ? <ProofReceivedMeta line={selected} /> : null}
                      </div>
              </div>

              {showRevisionUploader && !isApproved && (
                <div
                  className={`proof-revisionDrop ${isRevisionDragActive ? "is-dragover" : ""}`}
                  onDragOver={(event) => {
                    if (!canEditProofs) return;
                    event.preventDefault();
                    setIsRevisionDragActive(true);
                  }}
                  onDragLeave={() => setIsRevisionDragActive(false)}
	                  onDrop={(event) => {
	                    event.preventDefault();
	                    setIsRevisionDragActive(false);
	                    const file = event.dataTransfer.files?.[0];
	                    if (file && selected) stageRevisedFile(file, selected);
	                  }}
	                >
	                  <div className="proof-revisionDropTitle">Upload revised artwork for this proof line</div>
	                  {selectedStagedRevision ? (
	                    <div className="proof-stagedRevision">
	                      <StagedRevisionSummary staged={selectedStagedRevision} />
	                      <button
	                        className="btn btn-ghost btn-soft"
	                        type="button"
	                        disabled={isSelectedRevisionProcessing}
	                        onClick={() => selected && clearStagedRevision(selected.lineItemId)}
	                      >
	                        Clear
	                      </button>
	                    </div>
	                  ) : (
	                    <div className="proof-revisionDropBody">
	                      Replace the current creative with a new file. Assigned locations, media variant, and proof history stay tied to this same line. Nothing is sent until you submit.
	                    </div>
	                  )}
	                  <div className="proof-revisionDropActions">
	                    <button
	                      className="btn btn-ghost btn-soft"
                      type="button"
                      disabled={!canEditProofs || isSelectedRevisionProcessing}
                      onClick={() => revisionInputRef.current?.click()}
                    >
                      Browse Files
                    </button>
	                    <button
	                      className="btn btn-ghost btn-soft"
	                      type="button"
	                      disabled={isSelectedRevisionProcessing}
	                      onClick={() => selected && cancelRevisionUpload(selected.lineItemId)}
	                    >
	                      Cancel
	                    </button>
	                    <button
	                      className="btn btn-primary"
	                      type="button"
	                      disabled={!canEditProofs || isSelectedRevisionProcessing || !selectedStagedRevision}
	                      onClick={() => selected && submitStagedRevision(selected)}
	                    >
	                      Submit Revised Art
	                    </button>
	                  </div>
	                  <input
	                    ref={revisionInputRef}
                    hidden
                    type="file"
	                    accept=".pdf,image/*"
	                    onChange={(event) => {
	                      const file = event.currentTarget.files?.[0];
	                      if (file && selected) stageRevisedFile(file, selected);
	                      event.currentTarget.value = "";
	                    }}
	                  />
                </div>
              )}
              </div>

              <div className={`proof-actionDock ${hasPrintFeedback && !isApproved && !selectedIsWaiting ? "has-feedback" : ""} ${requiresFeedbackAcknowledgement ? "is-locked" : ""} ${selectedUsesSimpleDecisionDock ? "is-simple" : ""} ${isApproved ? "is-approved" : ""}`}>
                {!selectedUsesSimpleDecisionDock && !isApproved ? (
                <div className="proof-dockDecision">
                  {hasPrintFeedback && !isApproved && !selectedIsWaiting ? (
                    <FeedbackGate
                      line={selected}
                      acknowledged={feedbackAcknowledged}
                      hasViewedFeedback={feedbackViewed}
                      disabled={!canEditProofs}
                      onOpen={() => openFeedbackDrawer(selected)}
                      onAcknowledge={(checked) => selected && acknowledgeFeedbackForLine(selected, checked)}
                    />
                  ) : selectedIsWaiting ? (
                    <div className="proof-dockHint">
                      Approval unlocks after the proof file is published.
                    </div>
                  ) : null}
                </div>
                ) : null}

                {showSelectedLineNote ? (
                  <label className="proof-dockNoteWrap">
                    <span>Line note</span>
	                    <textarea
	                      className="proof-dockNote"
	                      placeholder="Optional note sent with this decision"
	                      key={`desktop-line-note-${selected.lineItemId}-${selectedLineNote}`}
	                      defaultValue={selectedLineNote}
	                      disabled={!canEditProofs || isApproved || isSelectedRevisionProcessing}
	                      onChange={(event) => setLineNoteDraft(selected.lineItemId, event.currentTarget.value)}
	                      onBlur={(event) => setLineNoteDraft(selected.lineItemId, event.currentTarget.value, true)}
	                    />
                  </label>
                ) : null}

                {!requiresFeedbackAcknowledgement || isApproved ? (
                  <div className="proof-actions">
                    {!isApproved ? (
                      <>
                        <button
                          className={canApproveSelected || isSelectedApprovalProcessing ? "btn btn-primary btn-lg" : "btn btn-ghost btn-soft btn-lg"}
                          disabled={!canApproveSelected || isSelectedApprovalProcessing}
                          onClick={approveSelected}
                          type="button"
                        >
                          {isSelectedApprovalProcessing ? (
                            <>
                              <span className="proof-buttonSpinner" aria-hidden="true" />
                              Approving...
                            </>
                          ) : selectedIsWaiting ? "Waiting for Proof" : "Approve for Print"}
                        </button>

                        <button
                          className="btn btn-ghost btn-soft btn-lg"
                          disabled={!canUploadRevision}
                          onClick={() => uploadRevised()}
                          type="button"
                        >
                          {isSelectedRevisionProcessing ? "Revision Processing…" : showRevisionUploader ? "Close Revised Upload" : "Upload Revised File"}
                        </button>
                      </>
                    ) : (
                      <>
                        {canUndoSelectedApproval ? (
                          <>
                            <button
                              className="btn btn-ghost btn-soft btn-lg"
                              type="button"
                              disabled={!canEditProofs || isSelectedUndoProcessing}
                              onClick={undoApproval}
                            >
                              {isSelectedUndoProcessing ? (
                                <>
                                  <span className="proof-buttonSpinner" aria-hidden="true" />
                                  Updating...
                                </>
                              ) : "Undo Approval"}
                            </button>

                            <div className="proof-approvedNote tone-success">
                              This proof is approved for print.
                            </div>
                          </>
                        ) : (
                          <div className="proof-approvedNote tone-success">
                            This proof is approved for print.
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ) : null}
              </div>
            </>
          ) : (
            <div className="proof-emptyCanvas" role="status">
              <div className="proof-emptyCanvasMark" aria-hidden="true" />
              <div className="proof-emptyCanvasKicker">Proof Review</div>
              <div className="proof-emptyCanvasTitle">No proof line selected.</div>
              <div className="proof-emptyCanvasBody">
                Proof artwork, file history, feedback, and approval actions will appear here once a proof line is available.
              </div>
            </div>
          )}
        </Panel>
      </div>
      </div>
      {feedbackDrawerOpen && selected ? (() => {
        const currentVersion = getCurrentProofVersion(selected);
        const historicalVersions = getHistoricalProofVersions(selected);
        const siblingCount = lines.filter(
          (line) =>
            line.lineItemId !== selected.lineItemId &&
            line.liftOrderLineId != null &&
            line.liftOrderLineId === selected.liftOrderLineId
        ).length;
        const currentComments = currentVersion?.comments || [];
        const currentCommentsForDisplay =
          feedbackSortOrder === "newest" ? currentComments.slice().reverse() : currentComments;
        const currentAttachmentCount = currentComments.reduce((sum, comment) => sum + (comment.attachments?.length || 0), 0);
        const latestCurrentComment = currentComments[currentComments.length - 1] || null;
        return (
          <div className="proof-feedbackScrim" role="presentation" onMouseDown={() => setFeedbackDrawerOpen(false)}>
            <aside
              className="proof-feedbackDrawer"
              role="dialog"
              aria-modal="true"
              aria-label="Proof feedback"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="proof-feedbackDrawerHead">
                <div>
                  <div className="proof-feedbackEyebrow">Proof Feedback</div>
                  <div className="proof-feedbackTitle">{getProofLineLabel(selected)}</div>
                  <div className="proof-feedbackMeta">
                    {getProofReferencePills(selected).map((pill) => (
                      <span key={pill}>{pill}</span>
                    ))}
                    {siblingCount > 0 ? <span>{siblingCount} sibling proof{siblingCount === 1 ? "" : "s"} on this line</span> : null}
                  </div>
                </div>
                <button className="btn btn-ghost btn-soft" type="button" onClick={() => setFeedbackDrawerOpen(false)}>
                  Close
                </button>
              </div>

              <div className="proof-feedbackCurrent">
                <div className="proof-feedbackSectionTop">
                  <div className="proof-feedbackProofIntro">
                    <button
                      className="proof-feedbackProofThumb"
                      type="button"
                      disabled={!currentVersion?.proofFullUrl && !currentVersion?.proofThumbUrl}
                      aria-label={`Preview current proof ${currentVersion?.proofFilename || getProofFileName(selected)}`}
                      title="Preview current proof"
                      onClick={() => {
                        const proofUrl = currentVersion?.proofFullUrl || currentVersion?.proofThumbUrl;
                        if (!proofUrl) return;
                        setFeedbackLightbox({
                          src: proofUrl,
                          fallbackSrc: currentVersion?.proofThumbUrl || undefined,
                          openUrl: proofUrl,
                          title: currentVersion?.proofFilename || getProofFileName(selected),
                          subtitle: getProofReferenceSubtitle(selected),
                        });
                      }}
                    >
                      <span className="proof-feedbackProofThumbLabel">Current proof</span>
                      {currentVersion?.proofThumbUrl ? (
                        <img src={currentVersion.proofThumbUrl} alt="" />
                      ) : (
                        <span>Proof</span>
                      )}
                    </button>
                    <div className="proof-feedbackProofCopy">
                      <div className="proof-feedbackSectionLabel">Current proof thread</div>
                      <div className="proof-feedbackFilename" title={currentVersion?.proofFilename || getProofFileName(selected)}>
                        {currentVersion?.proofFilename || getProofFileName(selected)}
                      </div>
                    </div>
                  </div>
                  <span className={`chip tone-${statusLabel(selected).tone}`}>{statusLabel(selected).label}</span>
                </div>

                <div className="proof-feedbackSummaryRow">
                  <div className="proof-feedbackSummaryPills">
                    <span>{currentComments.length} comment{currentComments.length === 1 ? "" : "s"}</span>
                    <span>{currentAttachmentCount} attachment{currentAttachmentCount === 1 ? "" : "s"}</span>
                    {latestCurrentComment?.createdAt ? <span>Latest {formatHistoryDate(latestCurrentComment.createdAt)}</span> : null}
                  </div>
                  {currentComments.length > 1 ? (
                    <div className="proof-feedbackSort" aria-label="Feedback order">
                      <button
                        type="button"
                        className={feedbackSortOrder === "newest" ? "is-active" : ""}
                        onClick={() => setFeedbackSortOrder("newest")}
                      >
                        Newest
                      </button>
                      <button
                        type="button"
                        className={feedbackSortOrder === "oldest" ? "is-active" : ""}
                        onClick={() => setFeedbackSortOrder("oldest")}
                      >
                        Oldest
                      </button>
                    </div>
                  ) : null}
                </div>

                {currentComments.length ? (
                  <div className="proof-feedbackThread">
                    {currentCommentsForDisplay.map((comment) => (
                      <div className="proof-feedbackComment" key={comment.id}>
                        <div className="proof-feedbackCommentTime">{formatHistoryDate(comment.createdAt)}</div>
                        {comment.body ? <div className="proof-feedbackCommentBody">{comment.body}</div> : null}
                        {comment.attachments?.length ? (
                          <div className="proof-feedbackAttachments">
                            {comment.attachments.map((attachment, index) => (
                              <button
                                className="proof-feedbackAttachment"
                                type="button"
                                onClick={() =>
                                  setFeedbackLightbox({
                                    src: attachment.url,
                                    title: attachment.filename || "Comment attachment",
                                    subtitle: formatHistoryDate(attachment.createdAt),
                                  })
                                }
                                key={`${attachment.url}-${index}`}
                              >
                                <span className="proof-feedbackAttachmentThumb">
                                  <img src={attachment.url} alt="" />
                                </span>
                                <span className="proof-feedbackAttachmentText">
                                  <strong>{truncateMiddle(attachment.filename || "Comment attachment", 30)}</strong>
                                  <span>{formatHistoryDate(attachment.createdAt)}</span>
                                </span>
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="proof-feedbackEmpty">No current proof feedback has been recorded.</div>
                )}
              </div>

              {historicalVersions.length ? (
                <div className="proof-feedbackHistorical">
                  <div className="proof-feedbackSectionLabel">Previous proof feedback</div>
                  {historicalVersions.map((version, index) => (
                    <details className="proof-feedbackHistoryGroup" key={`${version.attachmentId || "version"}-${index}`}>
                      <summary>
                        <span>Replaced proof {version.attachmentId ? `ID ${version.attachmentId}` : ""}</span>
                        <b>{version.comments?.length || 0} comment{(version.comments?.length || 0) === 1 ? "" : "s"}</b>
                      </summary>
                      <div className="proof-feedbackHistoryMeta">
                        <span>{version.proofFilename || "Previous proof file"}</span>
                        {version.replacedAt ? <span>Replaced {formatHistoryDate(version.replacedAt)}</span> : null}
                      </div>
                      {(version.comments || []).length ? (
                        <div className="proof-feedbackThread is-history">
                          {(version.comments || []).map((comment) => (
                            <div className="proof-feedbackComment" key={comment.id}>
                              <div className="proof-feedbackCommentTime">{formatHistoryDate(comment.createdAt)}</div>
                              {comment.body ? <div className="proof-feedbackCommentBody">{comment.body}</div> : null}
                              {comment.attachments?.length ? (
                                <div className="proof-feedbackAttachments">
                                  {comment.attachments.map((attachment, attachmentIndex) => (
                                    <button
                                      className="proof-feedbackAttachment"
                                      type="button"
                                      onClick={() =>
                                        setFeedbackLightbox({
                                          src: attachment.url,
                                          title: attachment.filename || "Comment attachment",
                                          subtitle: formatHistoryDate(attachment.createdAt),
                                        })
                                      }
                                      key={`${attachment.url}-${attachmentIndex}`}
                                    >
                                      <span className="proof-feedbackAttachmentThumb">
                                        <img src={attachment.url} alt="" />
                                      </span>
                                      <span className="proof-feedbackAttachmentText">
                                        <strong>{truncateMiddle(attachment.filename || "Comment attachment", 30)}</strong>
                                        <span>{formatHistoryDate(attachment.createdAt)}</span>
                                      </span>
                                    </button>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="proof-feedbackEmpty">No saved comments for this replaced proof.</div>
                      )}
                    </details>
                  ))}
                </div>
              ) : null}
            </aside>
          </div>
        );
      })() : null}
      {historyOpen && selected ? (
        <div className="proof-historyScrim" role="presentation" onMouseDown={() => setHistoryOpen(false)}>
          <div className="proof-historyModal" role="dialog" aria-modal="true" aria-label="Proof file history" onMouseDown={(event) => event.stopPropagation()}>
            <div className="proof-historyHead">
              <div>
                <div className="proof-historyEyebrow">File History</div>
                <div className="proof-historyTitle">Line {selected.lineNumber}</div>
                <div className="proof-historyMeta">{selected.mediaVariantLabel || `${selected.mediaName} · ${formatSize(selected.w, selected.h)}`}</div>
              </div>
              <button className="btn btn-ghost btn-soft" type="button" onClick={() => setHistoryOpen(false)}>
                Close
              </button>
            </div>

            <div className="proof-historyHero">
              <img
                src={
                  selected.proofThumbUrl ||
                  selected.clientThumbUrl ||
                  selected.clientFullUrl ||
                  buildDocumentThumbUrl({ label: "FILE", accent: "#94a3b8" })
                }
                alt=""
              />
              <div className="proof-historyHeroMeta">
                <span className={`chip tone-${statusLabel(selected).tone}`}>{statusLabel(selected).label}</span>
                {getProofReferencePills(selected).map((pill) => (
                  <span key={pill}>{pill}</span>
                ))}
              </div>
            </div>

            <div className="proof-historyList">
              {proofHistory.map((item) => (
                <div className={`proof-historyItem tone-${item.tone}`} key={item.key}>
                  <div className="proof-historyMark" aria-hidden="true">{item.badge.slice(0, 1)}</div>
                  <div className="proof-historyContent">
                    <div className="proof-historyItemTop">
                      <div className="proof-historyItemTitle" title={item.label}>{truncateMiddle(item.label, 58)}</div>
                      <span className="proof-historyBadge">{item.badge}</span>
                    </div>
                    <div className="proof-historyBody">{item.body}</div>
                    <div className="proof-historyDate">{item.date}</div>
                  </div>
                </div>
              ))}
            </div>
            {selected.technicalReports?.length ? (
              <div className="proof-historyReports">
                <div className="proof-historyReportsTitle">Technical reports</div>
                {selected.technicalReports.map((report, index) => (
                  <a
                    className="proof-historyReportLink"
                    href={report.reportUrl || undefined}
                    key={`${report.reportId || report.definitionId || index}`}
                    target="_blank"
                    rel="noreferrer"
                    aria-disabled={!report.reportUrl}
                  >
                    <span>{report.definitionLabel || `Report ${index + 1}`}</span>
                    <small>{report.reportId != null ? `Report ID ${report.reportId}` : "Lift report"}</small>
                  </a>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      <Lightbox
        isOpen={Boolean(feedbackLightbox)}
        src={feedbackLightbox?.src || ""}
        fallbackSrc={feedbackLightbox?.fallbackSrc}
        title={feedbackLightbox?.title}
        subtitle={feedbackLightbox?.subtitle}
        openInNewTabUrl={feedbackLightbox?.openUrl || feedbackLightbox?.src}
        onClose={() => setFeedbackLightbox(null)}
      />
      {revisionJobs.length > 0 ? (
        <div className="proof-jobStack" aria-live="polite">
          {revisionJobs.map((job) => (
            <div className={`proof-jobToast status-${job.status}`} key={job.id}>
              <div className="proof-jobToastIcon" aria-hidden="true" />
              <div className="proof-jobToastMain">
                <div className="proof-jobToastTitle">{job.title}</div>
                <div className="proof-jobToastDetail">{job.detail}</div>
                <div className="proof-jobToastMeta">{truncateMiddle(job.filename, 42)}</div>
              </div>
              <div className="proof-jobToastActions">
                <button
                  className="btn btn-ghost btn-soft"
                  type="button"
                  onClick={() => setSelectedId(job.lineItemId)}
                >
                  {job.status === "error" ? "Return to line" : "View line"}
                </button>
                {job.status !== "processing" ? (
                  <button
                    className="proof-jobToastClose"
                    type="button"
                    aria-label="Dismiss revision status"
                    onClick={() => dismissRevisionJob(job.id)}
                  >
                    ×
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {shareAccess.identityModal()}
      </PullToRefresh>
    </AppShell>
  );
}
