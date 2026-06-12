// src/pages/ProofApproval/ProofApprovalPage.tsx

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams, useLocation } from "react-router-dom";
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
import { ShareAccessDenied, useShareAccess } from "../../components/share/ShareAccess";
import { getRollupById } from "../../logic/mockRollups";
import { isDemoProjectRoute } from "../../logic/projectMode";
import type { ProofLineMock } from "../../logic/mockProofLines";
import { formatMediaDimensions } from "../../logic/mockAssignment";
import { buildDocumentThumbUrl } from "../../logic/imageUrls";
import { generatePdfThumbnail, sanitizeFilename } from "../../components/uploader/uploadFiles";

type FilterKey = "all" | "pending" | "approved" | "revised";
type BackgroundJobStatus = "processing" | "success" | "error";
type FeedbackSortOrder = "newest" | "oldest";

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

function statusLabel(line: ProofLineMock) {
  const hasProof = !!line.proofFullUrl;
  if (!hasProof) return { label: "Waiting", tone: "neutral" as const };
  if (line.status === "approved") return { label: "Approved", tone: "success" as const };
  return { label: "Pending", tone: "warning" as const };
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
  if (summary.latestAt) pieces.push(formatHistoryDate(summary.latestAt));
  return pieces.join(" · ");
}

function FeedbackGate({
  line,
  acknowledged,
  disabled,
  mobile = false,
  onOpen,
  onAcknowledge,
}: {
  line: ProofLineMock;
  acknowledged: boolean;
  disabled?: boolean;
  mobile?: boolean;
  onOpen: () => void;
  onAcknowledge: (checked: boolean) => void;
}) {
  const summary = getFeedbackSummary(line);
  const latestLabel = summary.latestAt ? formatHistoryDate(summary.latestAt) : null;

  return (
    <div className={`proof-dockFeedback ${mobile ? "proof-mobileFeedback" : ""} ${acknowledged ? "is-reviewed" : ""}`}>
      <div className="proof-dockFeedbackTop">
        <span className="proof-dockFeedbackIcon" aria-hidden="true">{acknowledged ? "✓" : "!"}</span>
        <div className="proof-dockFeedbackCopy">
          <div className="proof-dockFeedbackTitle">
            {acknowledged ? "Feedback reviewed" : "Print feedback requires review"}
          </div>
          <div className="proof-feedbackMeta" aria-label={formatFeedbackMeta(line)}>
            {summary.commentCount ? (
              <span className="proof-feedbackMetaChip">
                {summary.commentCount} comment{summary.commentCount === 1 ? "" : "s"}
              </span>
            ) : null}
            {summary.attachmentCount ? (
              <span className="proof-feedbackMetaChip">
                {summary.attachmentCount} attachment{summary.attachmentCount === 1 ? "" : "s"}
              </span>
            ) : null}
            {latestLabel ? (
              <span className="proof-feedbackMetaChip">
                Latest {latestLabel}
              </span>
            ) : null}
          </div>
        </div>
        <button className="proof-feedbackLink" type="button" onClick={onOpen}>
          Review feedback
        </button>
      </div>
      {!acknowledged ? (
        <label className={`proof-dockAck ${mobile ? "proof-mobileAck" : ""}`}>
          <input
            type="checkbox"
            checked={acknowledged}
            disabled={disabled}
            onChange={(event) => onAcknowledge(event.currentTarget.checked)}
          />
          <span>I reviewed all print feedback and attachments.</span>
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
      label: proofName === "—" ? `Proof line ${line.lineNumber}` : proofName,
      badge: "Current proof",
      body: "Current Lift proof attached to this line.",
      date: formatHistoryDate(line.updatedAt),
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
    createdAt: null,
    replacedAt: null,
    current: true,
    comments: getProofFeedback(line),
  };
}

function getHistoricalProofVersions(line: ProofLineMock | undefined) {
  if (!line) return [];
  return (line.proofVersions || []).filter((version) => !version.current || version.attachmentId !== line.liftProofingId);
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
  return {
    lineItemId: line.lineItemId,
    lineNumber: line.lineNumber,
    liftOrderLineId: line.liftOrderLineId ?? null,
    liftProofingId: line.liftProofingId ?? null,
    clientCreativeId: line.clientCreativeId,
    mediaVariantLabel: line.mediaVariantLabel,
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
    printTeamFeedback: line.printTeamFeedback || null,
    proofComments: line.proofComments || [],
    proofCommentCount: line.proofCommentCount || 0,
    proofCommentAttachmentCount: line.proofCommentAttachmentCount || 0,
    latestProofCommentAt: line.latestProofCommentAt || null,
    proofVersions: line.proofVersions || [],
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
  const shareAccess = useShareAccess(projectId);
  const canEditProofs = shareAccess.canEdit("proofs");

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
        const applyProofResponse = (response: ApiProjectProofsResponse) => {
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
        };
        const cachedWorkspace = peekProjectWorkspaceCache(projectId, shareAccess.isShareMode);
        if (cachedWorkspace) {
          setLiveProject({
            title: cachedWorkspace.project.title,
            venueName: cachedWorkspace.project.venueName,
            extId: cachedWorkspace.project.extId || null,
            liftOrderId: cachedWorkspace.project.liftOrderId || null,
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
  }, [api, isDemo, projectId, reloadToken, shareAccess.isResolving, shareAccess.isShareMode]);

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
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [showRevisionUploader, setShowRevisionUploader] = useState(false);
  const [isRevisionDragActive, setIsRevisionDragActive] = useState(false);
  const [feedbackAcknowledgedByLine, setFeedbackAcknowledgedByLine] = useState<Record<string, boolean>>({});
  const [historyOpen, setHistoryOpen] = useState(false);
  const [feedbackDrawerOpen, setFeedbackDrawerOpen] = useState(false);
  const [feedbackSortOrder, setFeedbackSortOrder] = useState<FeedbackSortOrder>("newest");
  const [feedbackLightbox, setFeedbackLightbox] = useState<{
    src: string;
    title: string;
    subtitle?: string;
  } | null>(null);
  const [lineNotes, setLineNotes] = useState<Record<string, string>>({});
  const [revisionJobs, setRevisionJobs] = useState<RevisionBackgroundJob[]>([]);
  const mobileRevisionInputRef = useRef<HTMLInputElement | null>(null);
  const tabletRevisionInputRef = useRef<HTMLInputElement | null>(null);
  const revisionInputRef = useRef<HTMLInputElement | null>(null);

  const selected = useMemo(
    () => lines.find((l) => l.lineItemId === selectedId) || lines[0],
    [lines, selectedId]
  );
  const selectedFeedbackSummary = useMemo(() => getFeedbackSummary(selected), [selected]);
  const selectedLineNote = selected ? lineNotes[selected.lineItemId] || "" : "";
  const hasPrintFeedback = selectedFeedbackSummary.hasFeedback;
  const feedbackAcknowledged = selected ? feedbackAcknowledgedByLine[feedbackAckKey(selected)] === true : false;
  const proofHistory = useMemo(() => buildProofHistory(selected), [selected]);
  
  // Approval behavior flags (demo-safe defaults)
  const isApproved = selected?.status === "approved";
  const productionApprovalMode: "immediate" | "project_release" =
    isDemo ? ctx.productionApprovalMode : "project_release";
  const productionReleased = isDemo ? ctx.productionReleased : !!liveProject?.productionReleasedAt;
  const canUndoApproval =
    productionApprovalMode === "project_release" && !productionReleased;

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

  function getProofIdLabel(line: ProofLineMock) {
    return line.liftProofingId ? `ID ${line.liftProofingId}` : null;
  }

  function getLocationPreview(line: ProofLineMock, limit = 2) {
    const visible = line.locations.slice(0, limit);
    const remaining = Math.max(0, line.locations.length - visible.length);
    return { visible, remaining };
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
      .filter((l) => {
        if (!query) return true;
        const proofName = getProofFileName(l);
        const hay = [
          l.clientFileName,
          proofName,
          l.mediaName,
          l.mediaVariantLabel || "",
          l.unitNumber || "",
          String(l.lineNumber),
          l.liftProofingId ? String(l.liftProofingId) : "",
          proofSiblingMeta.get(l.lineItemId)?.total ? getProofLineLabel(l) : "",
          l.locations.join(","),
        ]
          .join(" ")
          .toLowerCase();

        return hay.includes(query);
      });
  }, [lines, filter, q, mediaVariant, proofSiblingMeta]);

  const selectedHasProof = !!(selected?.proofThumbUrl || selected?.proofFullUrl);
  const selectedHasClientAsset = hasClientUploadAsset(selected);
  const selectedIsWaiting = selected?.status === "waiting" || !selectedHasProof;
  const selectedUsesSimpleDecisionDock = !!selected && !hasPrintFeedback && !isApproved && !selectedIsWaiting;
  const isSelectedRevisionProcessing =
    !!selected &&
    revisionJobs.some((job) => job.lineItemId === selected.lineItemId && job.status === "processing");
  function isLineWaiting(line: ProofLineMock) {
    return line.status === "waiting" || !(line.proofThumbUrl || line.proofFullUrl);
  }

  function isLineRevisionProcessing(line: ProofLineMock) {
    return revisionJobs.some((job) => job.lineItemId === line.lineItemId && job.status === "processing");
  }

  function isLineFeedbackAcknowledged(line: ProofLineMock) {
    return feedbackAcknowledgedByLine[feedbackAckKey(line)] === true;
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

  const canApproveSelected =
    !!selected && canApproveLine(selected);
  const canUploadRevision =
    !!selected && canUploadRevisionForLine(selected);
  const requiresFeedbackAcknowledgement = !!selected && lineRequiresFeedbackAcknowledgement(selected);
  const showSelectedLineNote = !!selected && (!requiresFeedbackAcknowledgement || isApproved);
  const remainingProofActions = counts.pending + counts.waiting;
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
      ? `${counts.waiting} proof${counts.waiting === 1 ? "" : "s"} are still waiting for Lift to publish the current proof file and are not ready to approve yet.`
      : productionApprovalMode === "project_release" && !productionReleased
      ? "All proofs are approved. The project can now move to transit approval or production release."
      : "All proof approvals are complete.";
  const selectedNextStep =
    !selected
      ? "Select a proof line to review its current status."
      : selectedIsWaiting
      ? "This line is still processing in Lift or waiting on a regenerated proof file before it can be approved."
      : isApproved
      ? canUndoApproval
        ? "This proof is approved and currently held until final production release."
        : "This proof is already approved."
      : "Review the proof image, confirm any print feedback is resolved, then approve for print or upload a revision.";
  const selectedCompactNextStep =
    !selected
      ? "Select a proof line to review."
      : selectedIsWaiting
      ? "Waiting for Lift to publish the proof file."
      : isApproved
      ? "Proof decision recorded."
      : "Review proof, resolve feedback if any, then approve or upload a revision.";

  useEffect(() => {
    setActionMessage(null);
    setShowRevisionUploader(false);
    setIsRevisionDragActive(false);
    setHistoryOpen(false);
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
    setFeedbackAcknowledgedByLine((prev) => ({
      ...prev,
      [feedbackAckKey(line)]: acknowledged,
    }));
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
  }

  function openFeedbackDrawer(line: ProofLineMock) {
    setSelectedId(line.lineItemId);
    setFeedbackDrawerOpen(true);
  }

  function approveProofLine(line: ProofLineMock) {
    if (!line.proofFullUrl) return;
    const lineNote = (lineNotes[line.lineItemId] || "").trim();

    shareAccess.requireEdit("proofs", "proof.approve", `approved proof line ${line.lineNumber}`, async () => {
      if (isDemo && projectId) {
        applyProofPatch(line.lineItemId, { status: "approved", revised: line.revised });
        demoStore.actions.approveProofLine(projectId, line.lineItemId, "Demo User");
      } else if (projectId) {
        const response = await updateProjectProofLine(api, projectId, line.lineItemId, {
          status: "approved",
          proofDecisionComment: lineNote || null,
          expectedUpdatedAt: line.updatedAt || null,
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
        });
      }

      setLineNotes((prev) => {
        const next = { ...prev };
        delete next[line.lineItemId];
        return next;
      });
      clearFeedbackAcknowledgement(line.lineItemId);
      setActionMessage("Proof approved. You can continue reviewing the remaining lines.");
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
    setShowRevisionUploader((prev) => !prev);
  }

  function updateRevisionJob(jobId: string, patch: Partial<RevisionBackgroundJob>) {
    setRevisionJobs((prev) => prev.map((job) => (job.id === jobId ? { ...job, ...patch } : job)));
  }

  function dismissRevisionJob(jobId: string) {
    setRevisionJobs((prev) => prev.filter((job) => job.id !== jobId));
  }

  function selectNextProofLine(currentLineId: string) {
    const currentIndex = filtered.findIndex((line) => line.lineItemId === currentLineId);
    const nextLine =
      filtered.slice(currentIndex + 1).find((line) => line.status !== "approved") ||
      filtered.find((line) => line.lineItemId !== currentLineId && line.status !== "approved") ||
      filtered.find((line) => line.lineItemId !== currentLineId);

    if (nextLine) setSelectedId(nextLine.lineItemId);
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
          accent: "#2563eb",
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
        detail: "Submitting revised artwork to Lift.",
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

      const response = await updateProjectProofLine(api, projectId, lineForJob.lineItemId, {
        status: "pending",
        revised: true,
        clientFileName: filename,
        useClientCreativeAsProof: true,
        proofDecisionComment: lineNote || null,
        expectedUpdatedAt: lineForJob.updatedAt || null,
      }, shareAccess.isShareMode);

      applyProofPatch(lineForJob.lineItemId, {
        status: response.proof.status,
        revised: response.proof.revised,
        clientFileName: filename,
        clientThumbUrl:
          updatedCreative.thumbUrl ||
          updatedCreative.fullUrl ||
          buildDocumentThumbUrl({
            label: isPdf ? "PDF" : "FILE",
            accent: updatedCreative.color || "#2563eb",
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
        updatedAt: response.proof.updatedAt || null,
      });

      updateRevisionJob(jobId, {
        status: "success",
        title: `Line ${lineForJob.lineNumber} revision submitted`,
        detail: "Lift accepted the revised artwork. A regenerated proof will appear after sync.",
      });
      window.setTimeout(() => dismissRevisionJob(jobId), 5000);
    } catch (error) {
      console.error("Failed to upload revised artwork", error);
      const message = error instanceof Error ? error.message : "We couldn't upload the revised artwork yet. Please try again.";
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
        setLineNotes((prev) => ({ ...prev, [lineForJob.lineItemId]: lineNote }));
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
    const lineNote = (lineNotes[lineForJob.lineItemId] || "").trim();
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
        setLineNotes((prev) => {
          const next = { ...prev };
          delete next[lineForJob.lineItemId];
          return next;
        });
        setShowRevisionUploader(false);
        setIsRevisionDragActive(false);
        clearFeedbackAcknowledgement(lineForJob.lineItemId);
        setActionMessage(null);
        selectNextProofLine(lineForJob.lineItemId);
        void runRevisedFileJob(jobId, file, lineForJob, lineNote);
      }
    );
  }

  function undoApproval() {
    if (!selected) return;
    shareAccess.requireEdit("proofs", "proof.undo_approval", `removed approval for proof line ${selected.lineNumber}`, async () => {
      if (isDemo && projectId) {
        applyProofPatch(selected.lineItemId, { status: "pending", revised: selected.revised });
        demoStore.actions.updateProofLine(projectId, selected.lineItemId, {
          status: "pending",
        } as any);
      } else if (projectId) {
        const response = await updateProjectProofLine(api, projectId, selected.lineItemId, { status: "pending", expectedUpdatedAt: selected.updatedAt || null }, shareAccess.isShareMode);
        applyProofPatch(selected.lineItemId, {
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
          updatedAt: response.proof.updatedAt || null,
        });
      }

      setActionMessage("Approval removed. This proof now needs review again.");
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

  return (
    <AppShell pageClassName="wide" projectTitle={projectTitle}>
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

      {(syncWarning || backgroundSyncMessage || proofSyncStatusText(proofSyncInfo)) && (
        <div className={`proof-syncWarning ${syncWarning ? "" : "is-neutral"}`} role="status">
          {syncWarning || backgroundSyncMessage || proofSyncStatusText(proofSyncInfo)}
        </div>
      )}

      {counts.total > 0 && remainingProofActions === 0 && (
        <div className="proof-completeBanner">
          <div className="proof-completeBannerMain">
            <div className="proof-completeKicker">Proof Approval Complete</div>
            <div className="proof-completeTitle">All proofs have been approved.</div>
            <div className="proof-completeBody">
              Proof approval is complete. Transit approval may already be in progress, and once both are complete the campaign can be released to production.
            </div>
          </div>
        </div>
      )}

      <div className="proof-mobileFeed" aria-label="Proof approval feed">
        <div className="proof-mobileControls">
          <div className="proof-summary proof-mobileSummary">
            <div className="proof-summary-title">{proofSummaryTitle}</div>
            <div className="proof-summary-body">{proofSummaryBody}</div>
          </div>

          <div className="proof-tabs proof-mobileTabs">
            <button className={`tab ${filter === "all" ? "tab-active" : ""}`} onClick={() => setFilter("all")} type="button">
              All ({counts.total})
            </button>
            <button className={`tab ${filter === "pending" ? "tab-active" : ""}`} onClick={() => setFilter("pending")} type="button">
              Pending ({counts.pending})
            </button>
            <button className={`tab ${filter === "approved" ? "tab-active" : ""}`} onClick={() => setFilter("approved")} type="button">
              Approved ({counts.approved})
            </button>
            <button className={`tab ${filter === "revised" ? "tab-active" : ""}`} onClick={() => setFilter("revised")} type="button">
              Revised ({counts.revised})
            </button>
          </div>

          <div className="proof-filters proof-mobileFilters">
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
          </div>
        </div>

        <div className="proof-mobileCards">
          {filtered.length === 0 ? (
            <div className="proof-empty">
              No proof lines match the current filters.
            </div>
          ) : filtered.map((l) => {
            const s = statusLabel(l);
            const proofName = getProofFileName(l);
            const proofIdLabel = getProofIdLabel(l);
            const lineFeedbackSummary = getFeedbackSummary(l);
            const lineHasClientAsset = hasClientUploadAsset(l);
            const lineIsApproved = l.status === "approved";
            const lineIsWaiting = isLineWaiting(l);
            const lineIsProcessing = isLineRevisionProcessing(l);
            const lineCanApprove = canApproveLine(l);
            const lineCanUploadRevision = canUploadRevisionForLine(l);
            const lineNeedsFeedbackAck = lineRequiresFeedbackAcknowledgement(l);
            const isUploaderOpenForLine = showRevisionUploader && selected?.lineItemId === l.lineItemId && !lineIsApproved;
            const lineUsesSimpleDecisionDock = !lineFeedbackSummary.hasFeedback && !lineIsApproved && !lineIsWaiting;
            return (
              <article className="proof-mobileCard" key={l.lineItemId}>
                <div className="proof-mobileCardHead">
                  <div className="proof-lineIdentity">
                    <span className="proof-lineBadge">{getProofLineLabel(l)}</span>
                    {proofIdLabel ? <span className="proof-attachmentBadge">{proofIdLabel}</span> : null}
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
                ) : (
                  <div className="proof-uploadUnavailable">
                    Original client upload unavailable for this linked Lift order.
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
                    <div className="proof-waiting">Lift has not published the current proof file yet…</div>
                  )}
                </button>
                <div className="proof-mobileProofFooter">
                  <div className="proof-mobileFileBlock">
                    <div className="proof-mobileFileLabel">Proof file</div>
                    <div className="proof-mobileFileName" title={proofName}>{proofName}</div>
                  </div>
                </div>

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
                      if (file) void processRevisedFile(file, l);
                    }}
                  >
                    <div className="proof-revisionDropTitle">Upload revised artwork</div>
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
                        onClick={() => setShowRevisionUploader(false)}
                      >
                        Cancel
                      </button>
                    </div>
                    <input
                      ref={mobileRevisionInputRef}
                      hidden
                      type="file"
                      accept=".pdf,image/*"
                      onChange={(event) => {
                        const file = event.currentTarget.files?.[0];
                        if (file) void processRevisedFile(file, l);
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
                      disabled={!canEditProofs}
                      mobile
                      onOpen={() => openFeedbackDrawer(l)}
                      onAcknowledge={(checked) => acknowledgeFeedbackForLine(l, checked)}
                    />
                  ) : lineIsWaiting || lineIsApproved ? (
                    <div className="proof-dockHint">
                      {lineIsWaiting ? "Approval unlocks after Lift publishes the proof file." : "Proof decision recorded."}
                    </div>
                  ) : null}

                  {!lineNeedsFeedbackAck || lineIsApproved ? (
                    <label className="proof-dockNoteWrap proof-mobileNoteWrap">
                      <span>Line note</span>
                      <textarea
                        className="proof-dockNote"
                        placeholder="Optional note sent with this decision"
                        value={lineNotes[l.lineItemId] || ""}
                        disabled={!canEditProofs || lineIsApproved || lineIsProcessing}
                        onFocus={() => setSelectedId(l.lineItemId)}
                        onChange={(event) => {
                          setSelectedId(l.lineItemId);
                          setLineNotes((prev) => ({
                            ...prev,
                            [l.lineItemId]: event.currentTarget.value,
                          }));
                        }}
                      />
                    </label>
                  ) : null}

                  {!lineNeedsFeedbackAck || lineIsApproved ? (
                    <div className="proof-actions proof-mobileActions">
                    {!lineIsApproved ? (
                      <>
                          <button
                            className={lineCanApprove ? "btn btn-primary btn-lg" : "btn btn-ghost btn-soft btn-lg"}
                            disabled={!lineCanApprove}
                            onClick={() => {
                              setSelectedId(l.lineItemId);
                              approveProofLine(l);
                            }}
                            type="button"
                          >
                            {lineIsWaiting ? "Waiting for Lift Proof" : "Approve for Print"}
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
                        Approved for print.
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
          <div className="proof-summary">
            <div className="proof-summary-title">{proofSummaryTitle}</div>
            <div className="proof-summary-body">{proofSummaryBody}</div>
          </div>

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
          {selected && (
            <>
              <article className="proof-tabletCanvas" aria-label="Selected proof review card">
                <div className="proof-mobileCard proof-tabletCard">
                  <div className="proof-mobileCardHead proof-tabletCardHead">
                    <div className="proof-lineIdentity">
                      <span className="proof-lineBadge">{getProofLineLabel(selected)}</span>
                      {getProofIdLabel(selected) ? <span className="proof-attachmentBadge">{getProofIdLabel(selected)}</span> : null}
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
                    <span>Lift line {selected.liftOrderLineId || "—"}</span>
                    <span>Proof ID {selected.liftProofingId || "—"}</span>
                    <span className={hasProofQuantityMismatch(selected) ? "is-warning" : ""}>
                      {proofQuantityLabel(selected)}
                      {hasProofQuantityMismatch(selected) ? ` · ${selected.locations.length} assigned` : ""}
                    </span>
                  </div>
                  <div className={`proof-nextStep proof-tabletNextStep ${selectedIsWaiting ? "is-neutral" : isApproved ? "is-success" : "is-warning"}`}>
                    {selectedCompactNextStep}
                  </div>

                  {selectedHasClientAsset ? (
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
                  ) : (
                    <div className="proof-uploadUnavailable proof-tabletUploadNote">
                      Original client upload unavailable for this linked Lift order.
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
                      <div className="proof-waiting">Lift has not published the current proof file yet…</div>
                    )}
                  </button>
                  <div className="proof-mobileProofFooter proof-tabletProofFooter">
                    <div className="proof-mobileFileBlock">
                      <div className="proof-mobileFileLabel">Proof file</div>
                      <div className="proof-mobileFileName" title={getProofFileName(selected)}>{getProofFileName(selected)}</div>
                    </div>
                  </div>

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
                        if (file) void processRevisedFile(file, selected);
                      }}
                    >
                      <div className="proof-revisionDropTitle">Upload revised artwork</div>
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
                          onClick={() => setShowRevisionUploader(false)}
                        >
                          Cancel
                        </button>
                      </div>
                      <input
                        ref={tabletRevisionInputRef}
                        hidden
                        type="file"
                        accept=".pdf,image/*"
                        onChange={(event) => {
                          const file = event.currentTarget.files?.[0];
                          if (file) void processRevisedFile(file, selected);
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
                        disabled={!canEditProofs}
                        mobile
                        onOpen={() => setFeedbackDrawerOpen(true)}
                        onAcknowledge={(checked) => acknowledgeFeedbackForLine(selected, checked)}
                      />
                    ) : selectedIsWaiting || isApproved ? (
                      <div className="proof-dockHint">
                        {selectedIsWaiting ? "Approval unlocks after Lift publishes the proof file." : "Proof decision recorded."}
                      </div>
                    ) : null}

                    {showSelectedLineNote ? (
                      <label className="proof-dockNoteWrap proof-mobileNoteWrap">
                        <span>Line note</span>
                        <textarea
                          className="proof-dockNote"
                          placeholder="Optional note sent with this decision"
                          value={selectedLineNote}
                          disabled={!canEditProofs || isApproved || isSelectedRevisionProcessing}
                          onChange={(event) => {
                            setLineNotes((prev) => ({
                              ...prev,
                              [selected.lineItemId]: event.currentTarget.value,
                            }));
                          }}
                        />
                      </label>
                    ) : null}

                    {!requiresFeedbackAcknowledgement || isApproved ? (
                      <div className="proof-actions proof-mobileActions">
                      {!isApproved ? (
                        <>
                            <button
                              className={canApproveSelected ? "btn btn-primary btn-lg" : "btn btn-ghost btn-soft btn-lg"}
                              disabled={!canApproveSelected}
                              onClick={approveSelected}
                              type="button"
                            >
                              {selectedIsWaiting ? "Waiting for Lift Proof" : "Approve for Print"}
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
                          Approved for print.
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
                  {getProofIdLabel(selected) ? <span>{getProofIdLabel(selected)}</span> : null}
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

                <div className="proof-ins-systemRow" aria-label="Lift line details">
                  <div className="proof-ins-systemMeta">
                    <span><b>Lift line</b>{selected.liftOrderLineId || "—"}</span>
                    <span><b>Proof ID</b>{selected.liftProofingId || "—"}</span>
                    <span className={hasProofQuantityMismatch(selected) ? "is-warning" : ""}>
                      <b>Qty</b>{proofQuantity(selected) ?? "—"}
                      {hasProofQuantityMismatch(selected) ? ` · ${selected.locations.length} assigned` : ""}
                    </span>
                    <span><b>Unit</b>{selected.unitNumber || "—"}</span>
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
                    <div className="proof-fileFooter">
                      <div className="proof-filemeta" title={selected.clientFileName}>
                        <span>File</span>
                        <strong>{selected.clientFileName}</strong>
                      </div>
                    </div>
                  </div>
                ) : null}

                  <div className="proof-view">
                    <div className="proof-viewHeader">
                      <div className="proof-view-label">Proof for Review</div>
                      {!selectedHasClientAsset ? (
                        <div className="proof-viewNote">Original client upload unavailable for this linked Lift order.</div>
                      ) : null}
                    </div>
                  <button
                    className="proof-image proof-imageButton"
                    type="button"
                    disabled={!selected.proofFullUrl}
                    aria-label={`View proof file ${getProofFileName(selected)}`}
                    onClick={() => selected.proofFullUrl && window.open(selected.proofFullUrl, "_blank")}
                  >
                      {selected.proofThumbUrl ? <img src={selected.proofThumbUrl} alt="" /> : <div className="proof-waiting">Lift has not published the current proof file yet…</div>}
                  </button>
                        <div className="proof-fileFooter">
                          <div className="proof-filemeta" title={getProofFileName(selected)}>
                            <span>Proof file</span>
                            <strong>{getProofFileName(selected)}</strong>
                          </div>
                        </div>
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
                    if (file) void processRevisedFile(file);
                  }}
                >
                  <div className="proof-revisionDropTitle">Upload revised artwork for this proof line</div>
                  <div className="proof-revisionDropBody">
                    Replace the current creative with a new file. Assigned locations, media variant, and proof history stay tied to this same line.
                  </div>
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
                      onClick={() => setShowRevisionUploader(false)}
                    >
                      Cancel
                    </button>
                  </div>
                  <input
                    ref={revisionInputRef}
                    hidden
                    type="file"
                    accept=".pdf,image/*"
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      if (file) void processRevisedFile(file);
                      event.currentTarget.value = "";
                    }}
                  />
                </div>
              )}
              </div>

              <div className={`proof-actionDock ${hasPrintFeedback && !isApproved && !selectedIsWaiting ? "has-feedback" : ""} ${requiresFeedbackAcknowledgement ? "is-locked" : ""} ${selectedUsesSimpleDecisionDock ? "is-simple" : ""}`}>
                {!selectedUsesSimpleDecisionDock ? (
                <div className="proof-dockDecision">
                  {hasPrintFeedback && !isApproved && !selectedIsWaiting ? (
                    <FeedbackGate
                      line={selected}
                      acknowledged={feedbackAcknowledged}
                      disabled={!canEditProofs}
                      onOpen={() => setFeedbackDrawerOpen(true)}
                      onAcknowledge={(checked) => selected && acknowledgeFeedbackForLine(selected, checked)}
                    />
                  ) : selectedIsWaiting || isApproved ? (
                    <div className="proof-dockHint">
                      {selectedIsWaiting ? "Approval unlocks after Lift publishes the proof file." : "Proof decision recorded."}
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
                      value={selectedLineNote}
                      disabled={!canEditProofs || isApproved || isSelectedRevisionProcessing}
                      onChange={(event) => {
                        if (!selected) return;
                        setLineNotes((prev) => ({
                          ...prev,
                          [selected.lineItemId]: event.currentTarget.value,
                        }));
                      }}
                    />
                  </label>
                ) : null}

                {!requiresFeedbackAcknowledgement || isApproved ? (
                  <div className="proof-actions">
                    {!isApproved ? (
                      <>
                        <button
                          className={canApproveSelected ? "btn btn-primary btn-lg" : "btn btn-ghost btn-soft btn-lg"}
                          disabled={!canApproveSelected}
                          onClick={approveSelected}
                          type="button"
                        >
                          {selectedIsWaiting ? "Waiting for Lift Proof" : "Approve for Print"}
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
                        {canUndoApproval ? (
                          <>
                            <button
                              className="btn btn-ghost btn-soft btn-lg"
                              type="button"
                              disabled={!canEditProofs}
                              onClick={undoApproval}
                            >
                              Undo Approval
                            </button>

                            <div className="proof-approvedNote tone-success">
                              Approved (held until production release)
                            </div>
                          </>
                        ) : (
                          <div className="proof-approvedNote tone-success">
                            Approved for print. Contact the project manager for changes.
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ) : null}
              </div>
            </>
          )}
        </Panel>
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
                    <span>Proof ID {selected.liftProofingId || "—"}</span>
                    <span>Lift line {selected.liftOrderLineId || "—"}</span>
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
                          src: currentVersion?.proofThumbUrl || proofUrl,
                          title: currentVersion?.proofFilename || getProofFileName(selected),
                          subtitle: `Proof ID ${selected.liftProofingId || "—"}`,
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
                    <div>
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
                  <div className="proof-feedbackEmpty">No current proof feedback has been sent from Lift.</div>
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
                <span>Proof ID {selected.liftProofingId || "—"}</span>
                <span>Lift line {selected.liftOrderLineId || "—"}</span>
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
          </div>
        </div>
      ) : null}
      <Lightbox
        isOpen={Boolean(feedbackLightbox)}
        src={feedbackLightbox?.src || ""}
        title={feedbackLightbox?.title}
        subtitle={feedbackLightbox?.subtitle}
        openInNewTabUrl={feedbackLightbox?.src}
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
    </AppShell>
  );
}
