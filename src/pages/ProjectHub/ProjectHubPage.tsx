// src/pages/ProjectHub/ProjectHubPage.tsx
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowUp, ChevronDown, ListChecks } from "lucide-react";
import AppShell from "../../app/AppShell";
import { useNavigate, useParams, useSearchParams, useLocation } from "react-router-dom";
import Panel from "../../components/common/Panel";
import PageHeader from "../../components/common/PageHeader";
import { ShareAccessDenied, ShareAccessModal, useShareAccess } from "../../components/share/ShareAccess";
import "../../styles/hub.css";

import { getRollupById } from "../../logic/mockRollups";
import type { ProjectRollup } from "../../logic/mockRollups";
import { isDemoProjectRoute } from "../../logic/projectMode";

import InventoryScopeModal from "../../components/projects/InventoryScopeModal";
import ReviewAllocationModal from "../../components/reviewAllocation/ReviewAllocationModal";
import EditProjectDetailsModal, { type ProjectDetailsDraft } from "../../components/projects/EditProjectDetailsModal";
import { useApiClient } from "../../api/useApiClient";
import {
  fetchProjectActivity,
  fetchProjectHubBootstrap,
  fetchProjectLiftOrderUrl,
  fetchProjectTransit,
  fetchProjectWorkspace,
  fetchVenueDetail,
  generateProjectCreativePackage,
  invalidateProjectWorkspaceCache,
  logProjectErrorEvent,
  peekProjectWorkspaceCache,
  normalizeCreativeAsset,
  normalizeWorkspaceInventory,
  normalizeWorkspaceMaps,
  normalizeWorkspaceVariants,
  releaseProjectProduction,
  type ApiProjectAuditEvent,
  type ApiVenueInventoryPreset,
  updateProjectTransit,
} from "../../api/projects";

import { demoStore, useDemoStore } from "../../domain/store/demoStore";
import { useDemoProjectContext } from "../../domain/selectors/useDemoProjectContext";
import { toLegacyInventory, toLegacyCreatives } from "../../domain/adapters/uiShapes";
import { triggerBrowserDownload } from "../../logic/downloads";

import {
  getEndClientPrimaryActionCard,
  getEndClientStepperModel,
  isProofApprovalEnabled,
  isLiftOrderCompleted,
  isLiftOrderLinkBlocked,
  isLiftProductionReference,
  getTransitBanner,
  type StepKey,
  type StepState,
  type StepperModel,
} from "../../logic/renderingRules";

import { mockCreatives, mockInventory, mockMaps, mockMediaVariants } from "../../logic/mockAssignment";

function formatDateLabel(d?: string | null) {
  return d || "—";
}

function isPlaceholderProjectTitle(title?: string | null, projectId?: string | null) {
  const normalized = String(title || "").trim();
  if (!normalized) return true;
  if (projectId && normalized.toLowerCase() === `project ${projectId}`.toLowerCase()) return true;
  if (projectId && normalized.toLowerCase() === `project${projectId}`.toLowerCase()) return true;
  return /^project[\s_-]?(proj[_-]?)?[a-z0-9]{4,}$/i.test(normalized);
}

function externalRepoLabel(url?: string | null) {
  const normalized = String(url || "").toLowerCase();
  if (normalized.includes("drive.google.com")) return "Google Drive";
  if (normalized.includes("sharepoint.com") || normalized.includes("onedrive")) return "Shared Docs";
  return "External Docs";
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
}

type HubStepperModel = StepperModel & { currentKey: StepKey };
type ActivityFilterKey = "all" | "workflow" | "approvals" | "uploads" | "collaboration" | "errors";
type ProjectScopeUpdateResponse = {
  project: any;
  scope: {
    includedIds: string[];
    sourceType?: "full_venue" | "venue_preset" | "manual";
    presetId?: string | null;
    presetName?: string | null;
    appliedAt?: string | null;
  };
};
const ACTIVITY_FEED_LIMIT = 10;

function getCurrentStepKey(model: StepperModel): StepKey {
  return model.steps.find((step) => step.state === "current")?.key || "production";
}

function Stepper({ model }: { model: StepperModel }) {
  const steps = model.steps.filter((s) => !s.hidden);
  const rendered: ReactNode[] = [];

  function renderStep(step: StepperModel["steps"][number], compact = false) {
    return (
      <div key={step.key} className={`hub-step2 ${step.state} ${compact ? "hub-step2-compact" : ""}`}>
        <div className="hub-step2-dot">
          {step.state === "complete" ? <span className="hub-step2-check">✓</span> : null}
          {step.state === "current" ? <span className="hub-step2-currentMark" /> : null}
        </div>
        <div className="hub-step2-label">{step.label}</div>
      </div>
    );
  }

  for (let idx = 0; idx < steps.length; idx += 1) {
    const step = steps[idx];
    const next = steps[idx + 1];

    if (step.key === "proofs" && next?.key === "transit") {
      const pairState =
        step.state === "complete" && next.state === "complete"
          ? "complete"
          : step.state === "current" || next.state === "current"
          ? "current"
          : "upcoming";

      rendered.push(
        <div key="proof-transit-pair" className={`hub-step2-pair ${pairState}`}>
          {renderStep(step, true)}
          <div className="hub-step2-pairJoin">+</div>
          {renderStep(next, true)}
        </div>
      );
      if (idx < steps.length - 2) rendered.push(<div key={`${step.key}-line`} className="hub-step2-line" />);
      idx += 1;
      continue;
    }

    rendered.push(renderStep(step));
    if (idx < steps.length - 1) rendered.push(<div key={`${step.key}-line`} className="hub-step2-line" />);
  }

  return (
    <div className="hub-stepper2">
      {rendered}
    </div>
  );
}

function buildDemoStepperModel(ctx: any): HubStepperModel {
  // Determine which step should be "current" in demo mode
  const isSubmitted = !!ctx?.isSubmitted;
  const proofsTotal = ctx?.proofs?.total ?? 0;
  const proofsApproved = ctx?.proofs?.approved ?? 0;
  const proofsPending = ctx?.proofs?.pending ?? 0;
  const proofsWaiting = ctx?.proofs?.waiting ?? 0;

  const transitStatus = ctx?.transit?.status ?? "not_started"; // not_started | approved | rejected
  const productionReleased = !!ctx?.productionReleased;
  const needsProofWork = proofsTotal > 0 && (proofsApproved < proofsTotal || proofsPending > 0 || proofsWaiting > 0);

  let currentKey: StepKey = "assignment";

  if (!isSubmitted) {
    currentKey = "assignment";
  } else if (needsProofWork) {
    currentKey = "proofs";
  } else if (transitStatus !== "approved") {
    currentKey = "transit";
  } else if (!productionReleased) {
    currentKey = "production";
  } else {
    currentKey = "complete";
  }

  const mk = (key: StepKey, label: string, complete: boolean): StepperModel["steps"][number] => ({
    key,
    label,
    state: (complete ? "complete" : key === currentKey ? "current" : "upcoming") as StepState,
    hidden: false,
  });

  // Submit Order step is considered complete once submitted
  return {
    currentKey,
    steps: [
      mk("assignment", "Creative Assignment", !!ctx?.allocation && ctx.allocation.assigned >= ctx.allocation.required),
      mk("submit", "Submit Order", isSubmitted),
      mk("proofs", "Proof Approval", proofsTotal > 0 && proofsApproved === proofsTotal),
      mk("transit", "Transit Approval", transitStatus === "approved"),
      mk("production", "Production", productionReleased),
      mk("complete", "Complete", false),
    ],
  };
}

type HubTone = "primary" | "warning" | "success" | "danger" | "neutral";
type HubPrimaryBannerTone = HubTone | "info";
type HubPrimaryBannerIconName = "upload" | "assign" | "submit" | "proof" | "transit" | "production" | "complete" | "next";

function toneToChipClass(tone: HubTone) {
  switch (tone) {
    case "primary":
      return "hub-chip tone-info";
    case "warning":
      return "hub-chip tone-warning";
    case "success":
      return "hub-chip tone-success";
    case "danger":
      return "hub-chip tone-danger";
    default:
      return "hub-chip tone-neutral";
  }
}

function primaryBannerToneClass(tone: HubPrimaryBannerTone) {
  return tone === "info" ? "primary" : tone;
}

function getPrimaryBannerIconName(banner: { tone: HubPrimaryBannerTone; title: string; ctaKind?: string }): HubPrimaryBannerIconName {
  switch (banner.ctaKind) {
    case "get_started":
      return "upload";
    case "continue_assignment":
      return banner.title.toLowerCase().includes("submit") || banner.title.toLowerCase().includes("ready")
        ? "submit"
        : "assign";
    case "open_proofs":
      return "proof";
    case "open_transit":
      return "transit";
    case "approve_production":
      return "production";
    default:
      return banner.tone === "success" ? "complete" : "next";
  }
}

function HubPrimaryBannerIcon({ icon }: { icon: HubPrimaryBannerIconName }) {
  if (icon === "upload") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M12 15V5" />
        <path d="m8 9 4-4 4 4" />
        <path d="M5 15v3.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V15" />
      </svg>
    );
  }

  if (icon === "proof") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M7 3.5h6l4 4V20H7z" />
        <path d="M13 3.5V8h4" />
        <path d="m9.5 14 2 2 4-4" />
      </svg>
    );
  }

  if (icon === "transit") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M6 17.5c3.5 0 3.5-11 7-11 2.8 0 3.5 5.5 5 5.5" />
        <path d="M6 19.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
        <path d="M18 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
      </svg>
    );
  }

  if (icon === "production" || icon === "complete") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="m5 12.5 4.2 4.2L19 6.8" />
      </svg>
    );
  }

  if (icon === "submit") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="m4 12 15-7-4 14-3-6-8-1Z" />
        <path d="m12 13 7-8" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M5 12h13" />
      <path d="m13 7 5 5-5 5" />
    </svg>
  );
}

function formatActivityTimestamp(value?: string | null) {
  if (!value) return "Just now";
  try {
    return new Date(value).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
}

function projectActivityLabel(event: ApiProjectAuditEvent) {
  const detail = event.detail || {};
  switch (event.eventType) {
    case "project.created":
      return "created this project";
    case "project.updated":
      return "updated project details";
    case "project.submitted":
      return "submitted the order";
    case "project.production_released":
      return "released the campaign to production";
    case "creative.uploaded":
      return `uploaded ${String(detail.filename || "artwork")}`;
    case "creative.updated":
      return `replaced ${String(detail.filename || "artwork")}`;
    case "creative.deleted":
      return `deleted ${String(detail.filename || "artwork")}`;
    case "assignment.updated":
      return `assigned ${String(detail.inventoryLabel || "inventory")}`;
    case "assignment.cleared":
      return `cleared ${String(detail.inventoryLabel || "inventory")}`;
    case "proof.updated":
      return `updated proof line to ${String(detail.status || "pending")}`;
    case "transit.updated":
      return `updated transit approval to ${String(detail.status || "pending")}`;
    case "share_link.created":
      return "created a share link";
    case "share_link.updated":
      return "updated a share link";
    case "share_link.regenerated":
      return "regenerated a share link";
    case "share_participant.identified":
      return "identified themselves through a shared link";
    case "share_participant.returned":
      return "returned through a shared link";
    case "workflow.error":
      return String(detail?.message || "reported a workflow error");
    default:
      return event.eventType.replaceAll("_", " ");
  }
}

function projectActivityMeta(event: ApiProjectAuditEvent) {
  if (event.actorType === "share_participant") {
    return event.shareLinkId ? "Shared collaborator" : "Shared access";
  }
  return "Admin activity";
}

function projectActivityCategory(event: ApiProjectAuditEvent): ActivityFilterKey {
  if (
    event.eventType.endsWith(".error") ||
    event.eventType.startsWith("error.") ||
    String(event.detail?.severity || "").toLowerCase() === "error"
  ) {
    return "errors";
  }
  switch (event.eventType) {
    case "creative.uploaded":
    case "creative.updated":
    case "creative.deleted":
      return "uploads";
    case "proof.updated":
    case "transit.updated":
      return "approvals";
    case "share_link.created":
    case "share_link.updated":
    case "share_link.regenerated":
    case "share_participant.identified":
    case "share_participant.returned":
      return "collaboration";
    default:
      return "workflow";
  }
}

function projectActivityCategoryLabel(event: ApiProjectAuditEvent) {
  const category = projectActivityCategory(event);
  if (category === "errors") return "Error";
  if (category === "approvals") return "Approval";
  if (category === "uploads") return "Upload";
  if (category === "collaboration") return "Collaboration";
  return "Workflow";
}

type HubMobileChip = {
  label: string;
  tone?: HubTone;
};

type HubMobileMetric = {
  label: string;
  value: ReactNode;
  tone?: HubTone;
};

function scrollHubMobileTarget(targetId: string) {
  if (typeof document === "undefined") return;
  document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function HubMobileProjectHeader({
  eyebrow,
  title,
  chips,
  metrics,
  tools,
}: {
  eyebrow: string;
  title: string;
  chips: HubMobileChip[];
  metrics: HubMobileMetric[];
  tools?: ReactNode;
}) {
  return (
    <section className="hub-mobileHero" aria-label="Project summary">
      <div className="hub-mobileHeroRail" aria-hidden="true" />
      <div className="hub-mobileEyebrow">{eyebrow}</div>
      <h1>{title}</h1>
      <div className="hub-mobileChipRow">
        {chips.map((chip) => (
          <span key={`${chip.label}-${chip.tone || "neutral"}`} className={`hub-mobileChip hub-mobileTone-${chip.tone || "neutral"}`}>
            {chip.label}
          </span>
        ))}
      </div>
      <div className="hub-mobileMetricGrid">
        {metrics.map((metric) => (
          <span key={String(metric.label)} className={`hub-mobileMetric hub-mobileTone-${metric.tone || "neutral"}`}>
            <em>{metric.label}</em>
            <strong>{metric.value}</strong>
          </span>
        ))}
      </div>
      {tools ? <div className="hub-mobileToolGrid">{tools}</div> : null}
    </section>
  );
}

function HubMobileNextStep({
  banner,
  iconName,
  onPrimary,
  onSecondary,
}: {
  banner: any;
  iconName: HubPrimaryBannerIconName;
  onPrimary?: () => void;
  onSecondary?: () => void;
}) {
  const tone = primaryBannerToneClass(banner.tone);
  return (
    <section className={`hub-mobileNext hub-mobileTone-${tone}`} aria-label="Recommended next step">
      <div className={`hub-mobileNextIcon hub-primary-icon-${tone}`} aria-hidden="true">
        <HubPrimaryBannerIcon icon={iconName} />
      </div>
      <div className="hub-mobileNextCopy">
        <span>Next step</span>
        <strong>{banner.title}</strong>
        <p>{banner.body}</p>
      </div>
      {"ctaLabel" in banner && banner.ctaLabel ? (
        <div className="hub-mobileNextActions">
          <button className="btn btn-primary" type="button" onClick={onPrimary}>
            {banner.ctaLabel}
          </button>
          {"ctaSecondaryLabel" in banner && banner.ctaSecondaryLabel ? (
            <button className="btn btn-ghost btn-soft" type="button" onClick={onSecondary}>
              {banner.ctaSecondaryLabel}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function HubMobileProgressDock({
  stepper,
  assignmentLabel,
  proofLabel,
  activityCount,
}: {
  stepper: HubStepperModel;
  assignmentLabel: string;
  proofLabel: string;
  activityCount: number;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const currentStep = stepper.steps.find((step) => step.state === "current" && !step.hidden) || stepper.steps.find((step) => !step.hidden);

  return (
    <div className={`hub-mobileProgressDock ${isExpanded ? "is-expanded" : ""}`} aria-label="Project workflow controls">
      <div className="hub-mobileProgressDockBar">
        <button
          type="button"
          className="hub-mobileProgressSummary"
          onClick={() => setIsExpanded((value) => !value)}
          aria-expanded={isExpanded}
        >
          <ListChecks size={17} strokeWidth={2.4} aria-hidden="true" />
          <span>
            <strong>{currentStep?.label || "Workflow"}</strong>
            <em>{assignmentLabel} · {proofLabel}</em>
          </span>
          <ChevronDown size={16} strokeWidth={2.6} aria-hidden="true" />
        </button>
        <button type="button" className="hub-mobileProgressButton" onClick={() => scrollHubMobileTarget("hub-mobile-workflows")}>
          Work
        </button>
        <button type="button" className="hub-mobileProgressButton" onClick={() => scrollHubMobileTarget("hub-mobile-activity")}>
          {activityCount > 0 ? "Log" : "Activity"}
        </button>
        <button type="button" className="hub-mobileProgressIcon" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} aria-label="Back to top">
          <ArrowUp size={16} strokeWidth={2.6} aria-hidden="true" />
        </button>
      </div>
      {isExpanded ? (
        <div className="hub-mobileProgressSteps">
          {stepper.steps.filter((step) => !step.hidden).map((step) => (
            <span key={step.key} className={`hub-mobileProgressStep is-${step.state}`}>
              <i aria-hidden="true" />
              <strong>{step.label}</strong>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function HubMobileWorkflowCard({
  title,
  meta,
  tone = "neutral",
  badge,
  description,
  metrics,
  actions,
  id,
}: {
  title: string;
  meta?: ReactNode;
  tone?: HubTone;
  badge?: ReactNode;
  description?: ReactNode;
  metrics?: HubMobileMetric[];
  actions?: ReactNode;
  id?: string;
}) {
  return (
    <article id={id} className={`hub-mobileWorkflowCard hub-mobileTone-${tone}`}>
      <span className="hub-mobileWorkflowRail" aria-hidden="true" />
      <header>
        <div>
          <h2>{title}</h2>
          {meta ? <p>{meta}</p> : null}
        </div>
        {badge ? <span className={`hub-mobileStatusBadge hub-mobileTone-${tone}`}>{badge}</span> : null}
      </header>
      {description ? <div className="hub-mobileWorkflowDesc">{description}</div> : null}
      {metrics?.length ? (
        <div className="hub-mobileWorkflowMetrics">
          {metrics.map((metric) => (
            <span key={String(metric.label)} className={`hub-mobileWorkflowMetric hub-mobileTone-${metric.tone || "neutral"}`}>
              <strong>{metric.value}</strong>
              <em>{metric.label}</em>
            </span>
          ))}
        </div>
      ) : null}
      {actions ? <div className="hub-mobileWorkflowActions">{actions}</div> : null}
    </article>
  );
}

function activityGroupLabel(value?: string | null) {
  if (!value) return "Recent activity";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Recent activity";

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const eventDay = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());

  if (eventDay.getTime() === today.getTime()) return "Today";
  if (eventDay.getTime() === yesterday.getTime()) return "Yesterday";
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function ProjectHubPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const api = useApiClient();
  

  const [searchParams] = useSearchParams();
  const mode = searchParams.get("mode");
  const modeSuffix = mode === "customer" ? "?mode=customer" : "";
  const isCustomerMode = mode === "customer";
  const shareAccess = useShareAccess(projectId);

  const isDemo = isDemoProjectRoute(projectId, (location.state as any)?.demo === true);

  useEffect(() => {
    if (isDemo) demoStore.actions.hydrateDemo();
  }, [isDemo]);

  const demoActiveProjectId = useDemoStore((s) => s.activeProjectId);
  const demoCreativesAll = useDemoStore((s) => s.creatives);
  const demoVenues = useDemoStore((s) => s.venues);
  const shareLinks = useDemoStore((s) => s.shareLinks);
  const auditEvents = useDemoStore((s) => s.auditEvents);

  // Canonical demo context
  const ctx = useDemoProjectContext(demoActiveProjectId);
  
  //Clear any leftover toast when Hub loads (demo only)
  useEffect(() => {
	  if (!isDemo) return;
	  demoStore.actions.clearToast();
	}, [isDemo]);

  // Legacy UI shapes for existing modals
  const demoInventoryLegacy = useMemo(() => toLegacyInventory(ctx), [ctx]);

  const demoCreativesLegacy = useMemo(() => {
    return toLegacyCreatives({
      ctx,
      legacyInventory: demoInventoryLegacy,
      demoCreativesAll,
    });
  }, [ctx, demoInventoryLegacy, demoCreativesAll]);

  const demoRollup: ProjectRollup | undefined = useMemo(() => {
    if (!isDemo) return undefined;

    const venueName = ctx.venueName || "Penn Station";

    const r: any = {
      projectId: ctx.projectId,
      title: ctx.title,
      venueName,
      extId: ctx.projectId,
      poNumber: ctx.poNumber,
      liftOrderId: ctx.liftOrderNumber,

      dates: {
        artworkDue: ctx.artworkDueDate || null,
        postDate: ctx.postDate || null,
      },

      assignment: {
        required: ctx.allocation.required,
        assigned: ctx.allocation.assigned,
      },

      proofs: {
        total: ctx.proofs.total,
        approved: ctx.proofs.approved,
        pending: ctx.proofs.pending,
        revised: ctx.proofs.revised,
        waitingForProof: ctx.proofs.waiting,
      },

      transit: { enabled: true, status: ctx.transit.status },

      production: {
        policy: ctx.productionApprovalMode === "immediate" ? "direct" : "hold_for_release",
        ready: ctx.canReleaseProduction,
        released: ctx.productionReleased,
      },

      needsAttention: ctx.isSubmitted
        ? ctx.proofs.total > 0 && ctx.proofs.approved !== ctx.proofs.total
        : ctx.allocation.required > 0 && ctx.allocation.assigned !== ctx.allocation.required,
    };

    return r as ProjectRollup;
  }, [isDemo, ctx]);

  const [backendProject, setBackendProject] = useState<any | null>(null);
  const [backendWorkspace, setBackendWorkspace] = useState<{
    maps: typeof mockMaps;
    creatives: typeof mockCreatives;
    inventory: typeof mockInventory;
    variants: typeof mockMediaVariants;
  } | null>(null);
  const [scopeVenueMaps, setScopeVenueMaps] = useState<typeof mockMaps>([]);
  const [scopeVenueInventory, setScopeVenueInventory] = useState<typeof mockInventory>([]);
  const [scopeVenuePresets, setScopeVenuePresets] = useState<ApiVenueInventoryPreset[]>([]);
  const [projectScopeMeta, setProjectScopeMeta] = useState<{
    sourceType?: "full_venue" | "venue_preset" | "manual";
    presetId?: string | null;
    presetName?: string | null;
    appliedAt?: string | null;
  }>({});
  const [backendTransit, setBackendTransit] = useState<{
    status: "not_started" | "pending" | "approved" | "rejected";
    submittedByName?: string | null;
    submittedDate?: string | null;
    comment?: string | null;
    submittedAt?: string | null;
  } | null>(null);
  const [projectActivity, setProjectActivity] = useState<ApiProjectAuditEvent[]>([]);
  const [viewerCanManageLiftOrder, setViewerCanManageLiftOrder] = useState(false);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityFilter, setActivityFilter] = useState<ActivityFilterKey>("all");
  const [activityPage, setActivityPage] = useState(1);
  const [projectLoading, setProjectLoading] = useState(false);
  const [liftOrderUrlLoading, setLiftOrderUrlLoading] = useState(false);
  const [creativePackageGenerating, setCreativePackageGenerating] = useState(false);
  const [workspaceReloadKey, setWorkspaceReloadKey] = useState(0);

  const loadProjectActivity = useCallback(async () => {
    if (!projectId || isDemo || shareAccess.isShareMode || shareAccess.isResolving || !isCustomerMode) return;
    setActivityLoading(true);
    try {
      const response = await fetchProjectActivity(api, projectId);
      setProjectActivity(response.events || []);
    } catch (error) {
      console.error("Failed to load project activity", error);
    } finally {
      setActivityLoading(false);
    }
  }, [api, isCustomerMode, isDemo, projectId, shareAccess.isResolving, shareAccess.isShareMode]);

  const handleGenerateCreativePackage = useCallback(async () => {
    if (!projectId || isDemo || shareAccess.isShareMode) return;
    setCreativePackageGenerating(true);
    try {
      const response = await generateProjectCreativePackage(api, projectId);
      if (response.document.fullUrl) {
        triggerBrowserDownload(response.document.fullUrl, response.document.filename);
      }
      void loadProjectActivity();
    } catch (error) {
      console.error("Failed to generate creative allocation package", error);
      window.alert("We couldn’t generate the artwork package yet. Please try again.");
    } finally {
      setCreativePackageGenerating(false);
    }
  }, [api, isDemo, loadProjectActivity, projectId, shareAccess.isShareMode]);

  useEffect(() => {
    let cancelled = false;

    async function loadWorkspace() {
      if (!projectId || isDemo || shareAccess.isResolving) return;
      try {
        setProjectLoading(true);
        const cached = peekProjectWorkspaceCache(projectId, shareAccess.isShareMode);
        if (cached && !cancelled) {
          setBackendProject(cached.project);
          setIncludedIds(cached.scope?.includedIds || []);
          setProjectScopeMeta({
            sourceType: cached.scope?.sourceType,
            presetId: cached.scope?.presetId,
            presetName: cached.scope?.presetName,
            appliedAt: cached.scope?.appliedAt,
          });
          setBackendWorkspace({
            maps: normalizeWorkspaceMaps(cached.workspace.maps),
            creatives: cached.workspace.creatives.map(normalizeCreativeAsset),
            inventory: normalizeWorkspaceInventory(cached.workspace.inventory),
            variants: normalizeWorkspaceVariants(cached.workspace.variants),
          });
        }
        const response = await (shareAccess.isShareMode
          ? fetchProjectWorkspace(api, projectId, true)
          : fetchProjectHubBootstrap(api, projectId));
        if (cancelled) return;
        setBackendProject(response.project);
        setIncludedIds(response.scope?.includedIds || []);
        setProjectScopeMeta({
          sourceType: response.scope?.sourceType,
          presetId: response.scope?.presetId,
          presetName: response.scope?.presetName,
          appliedAt: response.scope?.appliedAt,
        });
        setBackendWorkspace({
          maps: normalizeWorkspaceMaps(response.workspace.maps),
          creatives: response.workspace.creatives.map(normalizeCreativeAsset),
          inventory: normalizeWorkspaceInventory(response.workspace.inventory),
          variants: normalizeWorkspaceVariants(response.workspace.variants),
        });
        if (!shareAccess.isShareMode) {
          const bootstrapResponse = response as Awaited<ReturnType<typeof fetchProjectHubBootstrap>>;
          setViewerCanManageLiftOrder(bootstrapResponse.viewer?.isPlatformAdmin === true);
          setBackendTransit(bootstrapResponse.transit);
          setProjectActivity(bootstrapResponse.events || []);
        } else {
          setViewerCanManageLiftOrder(false);
        }
      } catch (error) {
        if (cancelled) return;
        console.error("Failed to load project workspace for review allocation", error);
      } finally {
        if (!cancelled) setProjectLoading(false);
      }
    }

    void loadWorkspace();
    return () => {
      cancelled = true;
    };
  }, [api, isDemo, projectId, shareAccess.isResolving, shareAccess.isShareMode, workspaceReloadKey]);

  useEffect(() => {
    if (shareAccess.isShareMode) void loadProjectActivity();
  }, [loadProjectActivity]);

  useEffect(() => {
    let cancelled = false;

    async function loadTransitDetail() {
      if (!projectId || isDemo || shareAccess.isResolving || !shareAccess.isShareMode) return;
      try {
        const response = await fetchProjectTransit(api, projectId, shareAccess.isShareMode);
        if (cancelled) return;
        setBackendTransit(response.transit);
      } catch (error) {
        if (cancelled) return;
        console.error("Failed to load backend transit detail", error);
      }
    }

    void loadTransitDetail();
    return () => {
      cancelled = true;
    };
  }, [api, isDemo, projectId, shareAccess.isResolving, shareAccess.isShareMode]);

  const [localProjectDetails, setLocalProjectDetails] = useState<ProjectDetailsDraft | null>(null);

  useEffect(() => {
    setLocalProjectDetails(null);
  }, [projectId]);

  const rawStateRollup = (location.state as any)?.rollup as ProjectRollup | undefined;
  const stateRollup = rawStateRollup && !isPlaceholderProjectTitle(rawStateRollup.title, projectId)
    ? rawStateRollup
    : undefined;
  const backendRollup: ProjectRollup | undefined = backendProject
    ? {
        projectId: backendProject.id,
        accountId: `acct_${backendProject.customerId}`,
        projectMode: backendProject.projectMode || "live",
        title: backendProject.title,
        venueName: backendProject.venueName,
        marketName: backendProject.marketName,
        endClientName: backendProject.endClientName,
        sourceCustomerName: backendProject.sourceCustomerName || undefined,
        adspaceOrderNumber: backendProject.adspaceOrderNumber,
        extId: backendProject.extId,
        poNumber: backendProject.poNumber || "—",
        liftOrderId: backendProject.liftOrderId || null,
        dates: {
          artworkDue: backendProject.artworkDueDate || null,
          postDate: backendProject.postDate || null,
        },
        assignment: {
          required: backendProject.assignment.required,
          assigned: backendProject.assignment.assigned,
          complete: backendProject.assignment.complete,
        },
        proofs: {
          total: backendProject.proofs.total,
          approved: backendProject.proofs.approved,
          pending: backendProject.proofs.pending,
          revised: backendProject.proofs.revised,
          waitingForProof: backendProject.proofs.waitingForProof,
        },
        transit: {
          enabled: backendProject.transit.enabled,
          status: backendProject.transit.status,
        },
        production: {
          policy: backendProject.production.policy,
          ready: backendProject.production.ready,
          awaitingRelease: backendProject.production.awaitingRelease,
          released: backendProject.production.released,
        },
        liftSync: backendProject.liftSync,
        needsAttention: backendProject.needsAttention,
      }
    : undefined;

  const routeMockRollup = isDemo || projectId === "proj_001"
    ? (getRollupById(projectId || "") as ProjectRollup | undefined)
    : undefined;

  const activityFeed = useMemo<ApiProjectAuditEvent[]>(() => {
    if (isDemo) {
      return auditEvents
        .filter((event) => event.projectId === `PROJECT#${ctx.projectId}` || event.projectId === ctx.projectId)
        .slice()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((event) => ({
          eventType: event.eventType,
          createdAt: event.createdAt,
          actorType: event.participantId ? "share_participant" : "user",
          actorId: event.participantId || event.id,
          actorName: event.actorLabel || "Adspace360",
          shareLinkId: event.shareLinkId || null,
          detail: event.description ? { description: event.description } : undefined,
        }));
    }
    return projectActivity;
  }, [auditEvents, ctx.projectId, isDemo, projectActivity]);

  const filteredActivityFeed = useMemo(() => {
    if (activityFilter === "all") return activityFeed;
    return activityFeed.filter((event) => projectActivityCategory(event) === activityFilter);
  }, [activityFeed, activityFilter]);

  useEffect(() => {
    setActivityPage(1);
  }, [activityFilter, filteredActivityFeed.length]);

  const activityPageCount = Math.max(1, Math.ceil(filteredActivityFeed.length / ACTIVITY_FEED_LIMIT));
  const visibleActivityEvents = useMemo(() => {
    const start = (activityPage - 1) * ACTIVITY_FEED_LIMIT;
    return filteredActivityFeed.slice(start, start + ACTIVITY_FEED_LIMIT);
  }, [activityPage, filteredActivityFeed]);

  const groupedActivityFeed = useMemo(() => {
    const groups: Array<{ label: string; events: ApiProjectAuditEvent[] }> = [];
    for (const event of visibleActivityEvents) {
      const label = activityGroupLabel(event.createdAt);
      const current = groups[groups.length - 1];
      if (current && current.label === label) {
        current.events.push(event);
      } else {
        groups.push({ label, events: [event] });
      }
    }
    return groups;
  }, [visibleActivityEvents]);

  const baseRollup: ProjectRollup | undefined =
    (isDemo ? demoRollup : undefined) ||
    routeMockRollup ||
    backendRollup ||
    stateRollup;

  const rollup: ProjectRollup | undefined =
    baseRollup && localProjectDetails
      ? {
          ...baseRollup,
          title: localProjectDetails.title || baseRollup.title,
          venueName: localProjectDetails.venueName || baseRollup.venueName,
          poNumber: localProjectDetails.poNumber ?? baseRollup.poNumber,
          liftOrderId: localProjectDetails.liftOrderId ?? baseRollup.liftOrderId,
          endClientName: localProjectDetails.endClientName ?? baseRollup.endClientName,
          dates: {
            ...baseRollup.dates,
            artworkDue: localProjectDetails.artworkDueDate ?? baseRollup.dates.artworkDue,
            postDate: localProjectDetails.postDate ?? baseRollup.dates.postDate,
          },
        }
      : baseRollup;
  const displayContractNumber = localProjectDetails?.contractNumber ?? backendProject?.contractNumber ?? "—";

  // UI state
  const [isReviewOpen, setReviewOpen] = useState(false);
  const [isScopeOpen, setScopeOpen] = useState(false);
  const [isEditOpen, setEditOpen] = useState(false);
  const [isShareAccessOpen, setShareAccessOpen] = useState(false);

  const [includedIds, setIncludedIds] = useState<string[]>([]);
  useEffect(() => {
    if (!isDemo) return;
    if (!ctx.scope) return;
    setIncludedIds(ctx.scope.includedIds.slice());
  }, [isDemo, ctx.scope]);

  useEffect(() => {
    let cancelled = false;

    async function loadScopeVenueDetail() {
      if ((!isScopeOpen && !isEditOpen) || !backendProject?.venueId || isDemo) return;
      try {
        const response = await fetchVenueDetail(api, backendProject.venueId);
        if (cancelled) return;

        const fullMaps = response.maps.map((map) => {
          const total = response.inventory.filter((item) => item.locationId === map.id && item.isActive !== false).length;
          return {
            id: map.id,
            name: map.name,
            assigned: 0,
            total,
            imageUrl: map.mapUrl || map.imageUrl || "",
          };
        });

        const fullInventory = response.inventory
          .filter((item) => item.isActive !== false)
          .map((item) => ({
            id: item.inventoryId || item.id,
            recordId: item.id,
            locationName: item.locationDetail || item.mapName || "",
            mapId: item.locationId,
            mediaVariantKey: item.mediaVariantKey,
            unitNumber: item.unitNumber || "",
            assignedCreativeId: null,
            assignmentUpdatedAt: null,
            isActive: true,
            x: typeof item.x === "number" ? item.x : 0.5,
            y: typeof item.y === "number" ? item.y : 0.5,
          }));

        setScopeVenueMaps(fullMaps as typeof mockMaps);
        setScopeVenueInventory(fullInventory as typeof mockInventory);
        setScopeVenuePresets(response.presets || []);
      } catch (error) {
        if (cancelled) return;
        console.error("Failed to load venue inventory scope detail", error);
      }
    }

    void loadScopeVenueDetail();
    return () => {
      cancelled = true;
    };
  }, [api, backendProject?.venueId, isDemo, isEditOpen, isScopeOpen]);

// Derived models
const actionCard = useMemo(() => (rollup ? getEndClientPrimaryActionCard(rollup) : null), [rollup]);

const stepper = useMemo<HubStepperModel | null>(() => {
  if (!rollup) return null;
  if (isDemo) return buildDemoStepperModel(ctx);
  const model = getEndClientStepperModel(rollup);
  return { ...model, currentKey: getCurrentStepKey(model) };
}, [rollup, isDemo, ctx]);

const proofEnabled = useMemo(() => (rollup ? isProofApprovalEnabled(rollup) : false), [rollup]);

// Transit "banner" info (we'll fold it into the ONE primary banner)
const transitBanner = useMemo(() => (rollup ? getTransitBanner(rollup) : null), [rollup]);

const proofsWaiting = rollup?.proofs?.waitingForProof ?? 0;
const proofsPending = rollup?.proofs?.pending ?? 0;
const proofsBlocking = proofsPending > 0 || proofsWaiting > 0;

const showApproveForProduction =
  isDemo
    ? ctx.productionApprovalMode === "project_release" && ctx.canReleaseProduction
    : !!(
        rollup &&
        !isLiftProductionReference(rollup) &&
        rollup.production.policy === "hold_for_release" &&
        rollup.production.ready &&
        !rollup.production.released
      );

const productionReleased =
  isDemo ? ctx.productionReleased : !!rollup?.production.released;

const transitApprovalStatus = (isDemo ? ctx.transit.status : backendTransit?.status || rollup?.transit.status || "not_started") as string;
const transitReadyForAction = !!rollup?.liftOrderId;
const resolvedProjectId = rollup?.projectId || projectId || "";
const showTransitCard = !shareAccess.isShareMode;

  const assignedRemaining = useMemo(() => {
    if (!rollup) return 0;
    return Math.max(0, rollup.assignment.required - rollup.assignment.assigned);
  }, [rollup]);

  const transitLink = useMemo(
    () => {
      if (!rollup) return "";
      const scopedTransitLink = shareLinks.find(
        (link) => link.projectId === rollup.projectId && link.accessType === "transit_approval" && link.status === "active"
      );
      if (!scopedTransitLink) return `${window.location.origin}/p/${rollup.projectId}/transit${modeSuffix}`;
      return `${window.location.origin}/p/${rollup.projectId}/transit?share=${encodeURIComponent(scopedTransitLink.token)}`;
    },
    [rollup, shareLinks, modeSuffix]
  );

const venueMarket = ctx.venueMarket || rollup?.marketName || "New York City";
const venueName = rollup?.venueName || "Penn Station";
const isSandboxProject = (backendProject?.projectMode || rollup?.projectMode || "live") === "internal_sandbox";
const documentSourceMode = backendProject?.documentSourceMode || (backendProject?.documentLibraryUrl ? "hybrid" : "adspace");
const externalDocumentUrl = String(backendProject?.documentLibraryUrl || "").trim();
const showExternalDocsAction = Boolean(
  externalDocumentUrl && (documentSourceMode === "external" || documentSourceMode === "hybrid")
);
const externalDocsLabel = externalRepoLabel(externalDocumentUrl);
const demoNavState = isDemo ? { state: { demo: true } } : undefined;
const artworkWorkspaceLoading = !isDemo && !backendWorkspace;
const artworkCreatives = isDemo ? demoCreativesLegacy : (backendWorkspace?.creatives || []);
const artworkInventory = isDemo ? demoInventoryLegacy : (backendWorkspace?.inventory || []);
const artworkVariantKeys = new Set(artworkInventory.map((item: any) => item.mediaVariantKey).filter(Boolean));
const artworkCoveredKeys = new Set(artworkCreatives.map((creative: any) => creative.mediaVariantKey).filter((key: string) => artworkVariantKeys.has(key)));
const artworkNeedsCount = Math.max(0, artworkVariantKeys.size - artworkCoveredKeys.size);
/**
 * Primary banner should ALWAYS track the current step.
 * This prevents showing "assignment remaining" messaging after the order is submitted
 * when the user should be focused on proofs/transit/production.
 */
const primaryBanner = useMemo(() => {
  if (!stepper) return null;

  if (rollup && isLiftOrderLinkBlocked(rollup)) {
    return {
      tone: "warning" as const,
      title: rollup.liftSync?.label || "Lift order needs review",
      body:
        rollup.liftSync?.healthMessage ||
        "The linked Lift order needs operator review before proofing or production continues.",
      ctaKind: "open_proofs" as const,
      ctaLabel: "Open Proof Reference",
      ctaSecondaryKind: "download_allocation_pdf" as const,
      ctaSecondaryLabel: "Download Allocation PDF",
    };
  }

  if (rollup && isLiftProductionReference(rollup)) {
    return {
      tone: "success" as const,
      title: isLiftOrderCompleted(rollup) ? "Order completed" : "Order in production",
      body: isLiftOrderCompleted(rollup)
        ? "Lift marks this order complete. Project records remain available for reference."
        : "Proofs are approved and this project remains available as a production reference.",
      ctaKind: "open_proofs" as const,
      ctaLabel: "Open Proof Reference",
      ctaSecondaryKind: "download_allocation_pdf" as const,
      ctaSecondaryLabel: "Download Allocation PDF",
    };
  }

  const proofsTotal = rollup?.proofs?.total ?? 0;
  const assignmentRequired = rollup?.assignment?.required ?? 0;
  const assignmentAssigned = rollup?.assignment?.assigned ?? 0;
  const assignmentRemaining = Math.max(0, assignmentRequired - assignmentAssigned);
  const artworkUploadedCount = artworkCreatives.length;
  const isFreshProject =
    stepper.currentKey === "assignment" &&
    !rollup?.liftOrderId &&
    artworkUploadedCount === 0 &&
    assignmentAssigned === 0;

  switch (stepper.currentKey) {
    case "assignment": {
      if (isFreshProject) {
        return {
          tone: "primary" as const,
          title: `Welcome to your project${rollup?.title ? `, ${rollup.title}` : ""}`,
          body: "Get started by uploading artwork and assigning files to locations throughout the venue.",
          ctaKind: "get_started" as const,
          ctaLabel: "Upload Artwork",
          ctaSecondaryLabel: "Assign Creatives",
        };
      }

      if (assignmentRemaining > 0) {
        return {
          tone: "warning" as const,
          title: "Assign remaining locations",
          body: `${assignmentRemaining} location${assignmentRemaining === 1 ? "" : "s"} still need artwork.`,
          ctaKind: "continue_assignment" as const,
          ctaLabel: "Continue Assignment",
        };
      }
      return {
        tone: "success" as const,
        title: "All locations assigned",
        body: "You’re ready to review the allocation and submit the order.",
        ctaKind: "continue_assignment" as const,
        ctaLabel: "Continue",
      };
    }

    case "submit": {
      return {
        tone: "primary" as const,
        title: "Ready to submit order",
        body: "Review the allocation summary, confirm terms of submission, then submit.",
        ctaKind: "continue_assignment" as const,
        ctaLabel: "Review Allocation",
      };
    }

    case "proofs": {
      const pendingMsg =
        proofsPending > 0 && proofsWaiting > 0
          ? `${proofsPending} proof${proofsPending === 1 ? "" : "s"} ready for approval and ${proofsWaiting} still waiting for proof.`
          : proofsPending > 0
            ? `Proofs ready for approval (${proofsPending} pending).`
            : proofsWaiting > 0
              ? `${proofsWaiting} proof${proofsWaiting === 1 ? "" : "s"} still waiting for proof.`
              : proofsTotal > 0
                ? "All proofs approved."
                : "Proofs will appear here once available.";
      return {
        tone: proofsPending > 0 || proofsWaiting > 0 ? ("warning" as const) : ("success" as const),
        title: "Review proofs",
        body:
          transitReadyForAction && showTransitCard && transitApprovalStatus !== "approved"
            ? `${pendingMsg} Transit approval can also run now while proofing continues.`
            : pendingMsg,
        ctaKind: "open_proofs" as const,
        ctaLabel: "Open Proof Review",
        ctaSecondaryLabel:
          transitReadyForAction && showTransitCard && transitApprovalStatus !== "approved"
            ? "Open Transit Review"
            : undefined,
        ctaSecondaryKind:
          transitReadyForAction && showTransitCard && transitApprovalStatus !== "approved"
            ? ("open_transit" as const)
            : undefined,
      };
    }

    case "transit": {
      if (transitBanner) {
        return {
          tone: transitBanner.tone,
          title: "Transit approval",
          body: transitBanner.text,
          ctaKind: "open_transit" as const,
          ctaLabel: "Open Transit Review",
        };
      }
      return {
        tone: "warning" as const,
        title: "Transit approval",
        body: "Transit approval can run in parallel with proof approval, and both must be complete before production release.",
        ctaKind: "open_transit" as const,
        ctaLabel: "Open Transit Review",
      };
    }

    case "production": {
      if (showApproveForProduction) {
        return {
          tone: "primary" as const,
          title: "Ready for production release",
          body: "All proofs are approved and transit approval is complete. This project can now be released to production.",
          ctaKind: "approve_production" as const,
          ctaLabel: "Approve for Production",
        };
      }

      if (productionReleased) {
        return {
          tone: "success" as const,
          title: "Approved for production",
          body: "All required approvals are complete and this campaign is moving forward.",
        };
      }

      return {
        tone: "neutral" as const,
        title: "Production",
        body: "Production will unlock once proofs and transit approval are complete.",
      };
    }

    default:
      return actionCard ?? null;
  }
}, [
  stepper,
  rollup,
  transitBanner,
  actionCard,
  proofsPending,
  proofsWaiting,
  showApproveForProduction,
  productionReleased,
  artworkCreatives.length,
]);

const editVenueOptions = useMemo(() => {
  if (isDemo && demoVenues.length > 0) {
    return demoVenues.map((venue) => ({
      id: venue.id,
      name: venue.name,
      market: venue.market || "Unassigned market",
    }));
  }

  return [
    { id: "venue_penn_station", name: venueName, market: venueMarket },
    { id: "venue_wtc", name: "World Trade Center", market: "New York City" },
    { id: "venue_30th_street", name: "30th Street Station", market: "Philadelphia" },
  ];
}, [isDemo, demoVenues, venueName, venueMarket]);
const currentVenueOption =
  editVenueOptions.find((venue) => venue.name === venueName && venue.market === venueMarket) || editVenueOptions[0];

  const allocationReportProjectId = isDemo ? "demo_001" : rollup?.projectId;
  const handleDownloadAllocationPdf = useCallback(() => {
    if (!allocationReportProjectId) return;
    window.open(`/p/${allocationReportProjectId}/allocation-report?print=1`, "_blank");
  }, [allocationReportProjectId]);

  if (!rollup || !stepper || !primaryBanner) {
    if (!isDemo && projectLoading) {
      return (
        <AppShell pageClassName="wide">
          <div className="app-loadingWrap app-loadingWrap-page">
            <div className="app-loadingCard app-loadingCard-wide" role="status" aria-live="polite">
              <div className="app-loadingOrb" aria-hidden="true">
                <span className="app-loadingOrbRing" />
                <span className="app-loadingOrbDot" />
              </div>
              <div className="app-loadingTitle">Loading Project Hub</div>
              <div className="app-loadingBody">Pulling the live project state, workflow progress, and collaboration access.</div>
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
    return (
      <AppShell pageClassName="wide">
        <h1 className="page-title">Project not found</h1>
        <p className="page-subtitle">Check the link and try again.</p>
      </AppShell>
    );
  }

  const isAssignmentComplete = rollup.assignment.required > 0 && rollup.assignment.assigned >= rollup.assignment.required;
  // --- Card models (calmer, consistent) ---
  const assignmentStatusTone: HubTone =
    rollup.liftOrderId ? "success" : assignedRemaining > 0 ? "warning" : "success";
  const assignmentStatusText =
    rollup.liftOrderId
      ? "Order submitted successfully"
      : assignedRemaining > 0
      ? `${assignedRemaining} locations still need artwork`
      : "All locations assigned";

  const proofStatusTone: HubTone =
    rollup.liftOrderId
      ? proofsBlocking
        ? "warning"
        : "success"
      : "neutral";
  const proofStatusText =
    rollup.liftOrderId
      ? proofsPending > 0 && proofsWaiting > 0
        ? `${proofsPending} pending · ${proofsWaiting} waiting`
        : proofsPending > 0
        ? `Proofs ready for approval (${proofsPending} pending)`
        : proofsWaiting > 0
        ? `${proofsWaiting} waiting for proof`
        : "All proofs approved"
      : "Available after order submission";

  const assignmentRequired = rollup.assignment.required || 0;
  const assignmentAssigned = rollup.assignment.assigned || 0;
  const assignmentRemainingCount = Math.max(0, assignmentRequired - assignmentAssigned);
  const isProjectVenueLocked = artworkCreatives.length > 0 || assignmentAssigned > 0 || !!rollup.liftOrderId;
  const assignmentCoverageText =
    assignmentRequired === 0
      ? "—"
      : assignmentAssigned >= assignmentRequired
      ? "Complete"
      : `${Math.round((assignmentAssigned / assignmentRequired) * 100)}%`;
  const assignmentCoverageClass =
    isAssignmentComplete || !!rollup.liftOrderId
      ? "hub-stepStat hub-stepStat-acceptance hub-stepStat-acceptance-success"
      : "hub-stepStat";
  const proofTotal = rollup.proofs.total || 0;
  const proofPendingCount = rollup.proofs.pending || 0;
  const proofApprovedCount = rollup.proofs.approved || 0;
  const proofRevisedCount = rollup.proofs.revised || 0;
  const proofWaitingCount = rollup.proofs.waitingForProof || 0;
  const proofFourthLabel = proofRevisedCount > 0 ? "Revised" : "Waiting";
  const proofFourthValue = proofRevisedCount > 0 ? proofRevisedCount : proofWaitingCount;
  const allProofsApproved = proofTotal > 0 && proofPendingCount === 0 && proofWaitingCount === 0 && proofApprovedCount >= proofTotal;
  const proofApprovedClass =
    allProofsApproved
      ? "hub-stepStat hub-stepStat-acceptance hub-stepStat-acceptance-success"
      : "hub-stepStat";

  const transitStatusTone: HubTone =
    !transitReadyForAction
      ? "neutral"
      : transitApprovalStatus === "approved"
      ? "success"
      : transitApprovalStatus === "rejected"
      ? "danger"
      : transitApprovalStatus === "pending" || transitApprovalStatus === "changes_requested"
      ? "warning"
      : "neutral";
  const transitStatusText =
    !rollup.liftOrderId
      ? "Available after order submission"
      : transitApprovalStatus === "approved"
      ? "Transit accepted"
      : transitApprovalStatus === "rejected"
      ? "Transit rejected"
      : transitApprovalStatus === "pending" || transitApprovalStatus === "changes_requested"
      ? "Transit review pending"
      : "Ready to send for transit review";
  const transitAcceptanceText = !transitReadyForAction
    ? "Locked"
    : transitApprovalStatus === "approved"
    ? "Accepted"
    : transitApprovalStatus === "rejected"
    ? "Rejected"
    : transitApprovalStatus === "pending" || transitApprovalStatus === "changes_requested"
    ? "Pending"
    : "Not started";
  const transitAcceptanceClass =
    transitApprovalStatus === "approved"
      ? "hub-stepStat-acceptance-success"
      : transitApprovalStatus === "rejected"
      ? "hub-stepStat-acceptance-danger"
      : transitApprovalStatus === "pending" || transitApprovalStatus === "changes_requested"
      ? "hub-stepStat-acceptance-warning"
      : "hub-stepStat-acceptance-neutral";
  const transitActionDateText = isDemo
    ? ctx.transit.submittedDate || "—"
    : backendTransit?.submittedDate || "—";
  const transitSubmittedByText = isDemo
    ? ctx.transit.submittedByName || "—"
    : backendTransit?.submittedByName || "—";
  const transitNoteText = isDemo
    ? ctx.transit.comment?.trim() || "No note yet"
    : backendTransit?.comment?.trim() || "No note yet";
  const canResetTransitStatus =
    isCustomerMode && (transitApprovalStatus === "rejected" || transitApprovalStatus === "approved");
  const canViewArtwork = shareAccess.canView("artwork");
  const canViewAssignment = shareAccess.canView("assignment");
  const canViewProofs = shareAccess.canView("proofs");

  // Primary CTA targets
  const goAssignment = () => resolvedProjectId && navigate(shareAccess.buildProjectUrl(`/p/${resolvedProjectId}/assignment${modeSuffix}`), demoNavState as any);
  const goArtwork = () => resolvedProjectId && navigate(shareAccess.buildProjectUrl(`/p/${resolvedProjectId}/artwork${modeSuffix}`), demoNavState as any);
  const goProofs = () => resolvedProjectId && navigate(shareAccess.buildProjectUrl(`/p/${resolvedProjectId}/proofs${modeSuffix}`), demoNavState as any);
  const goTransit = () => resolvedProjectId && navigate(shareAccess.buildProjectUrl(`/p/${resolvedProjectId}/transit${modeSuffix}`), demoNavState as any);
  const goAllocationOverride = () => resolvedProjectId && navigate(`/p/${resolvedProjectId}/allocation-override`, demoNavState as any);
  const openLiftOrder = async () => {
    if (!rollup.projectId) return;
    const popup = window.open("about:blank", "_blank", "noopener,noreferrer");
    setLiftOrderUrlLoading(true);
    try {
      const response = await fetchProjectLiftOrderUrl(api, rollup.projectId);
      if (popup) {
        popup.location.href = response.url;
      } else {
        window.open(response.url, "_blank", "noopener,noreferrer");
      }
    } catch (error) {
      popup?.close();
      const message = error instanceof Error ? error.message : "We couldn't open the Lift order yet.";
      demoStore.actions.pushToast("danger", message);
    } finally {
      setLiftOrderUrlLoading(false);
    }
  };
  const handleApproveProduction = () => {
    if (isDemo) {
      demoStore.actions.approveForProduction(demoActiveProjectId);
      return;
    }
    if (!projectId) return;
    void (async () => {
      try {
        const response = await releaseProjectProduction(api, projectId);
        setBackendProject(response.project);
        void loadProjectActivity();
        demoStore.actions.pushToast("success", "Project released to production");
      } catch (error) {
        const message = error instanceof Error ? error.message : "We couldn't release the project yet.";
        demoStore.actions.pushToast("danger", message);
        void logProjectErrorEvent(api, projectId, {
          actionType: "project.release",
          errorCode: "production_release_failed",
          message,
          severity: "error",
          surface: "hub.production",
          workspace: "hub",
        }).catch(() => undefined);
      }
    })();
  };
  const handlePrimaryBannerAction = () => {
    if (!("ctaKind" in primaryBanner)) return;
    if (primaryBanner.ctaKind === "get_started") {
      if (canViewArtwork) goArtwork();
      else demoStore.actions.pushToast("warning", "This shared link does not allow artwork access");
    }
    if (primaryBanner.ctaKind === "continue_assignment") {
      if (canViewAssignment) goAssignment();
      else if (canViewArtwork) goArtwork();
      else demoStore.actions.pushToast("warning", "This shared link does not allow assignment access");
    }
    if (primaryBanner.ctaKind === "open_proofs") {
      if (canViewProofs) goProofs();
      else demoStore.actions.pushToast("warning", "This shared link does not allow proof access");
    }
    if (primaryBanner.ctaKind === "open_transit") goTransit();
    if (primaryBanner.ctaKind === "approve_production") handleApproveProduction();
  };
  const handlePrimaryBannerSecondaryAction = () => {
    if (!("ctaSecondaryKind" in primaryBanner)) {
      if (canViewAssignment) goAssignment();
      else if (canViewArtwork) goArtwork();
      else demoStore.actions.pushToast("warning", "This shared link does not allow assignment access");
      return;
    }
    if (primaryBanner.ctaSecondaryKind === "open_transit") {
      goTransit();
      return;
    }
    if (primaryBanner.ctaSecondaryKind === "download_allocation_pdf") {
      handleDownloadAllocationPdf();
      return;
    }
    if (canViewAssignment) goAssignment();
    else if (canViewArtwork) goArtwork();
    else demoStore.actions.pushToast("warning", "This shared link does not allow assignment access");
  };

  if (!rollup) {
    const isStillLoadingLiveProject = !isDemo && (projectLoading || shareAccess.isResolving || !!projectId);
    const isDeniedShareHub =
      shareAccess.isShareMode && !shareAccess.isResolving && (!shareAccess.shareLink || shareAccess.isRevoked || !shareAccess.canView("hub"));
    if (isDeniedShareHub) {
      return (
        <AppShell pageClassName="wide" projectTitle={backendProject?.title}>
          <ShareAccessDenied
            title={shareAccess.isRevoked ? "This shared link has been revoked" : "This shared link cannot open the project hub"}
            body="Ask the project owner for a collaboration or view-only link if you need project hub access."
          />
        </AppShell>
      );
    }
    return (
      <AppShell pageClassName="wide" projectTitle={backendProject?.title}>
        <div className="app-loadingWrap app-loadingWrap-page">
          <div className="app-loadingCard app-loadingCard-wide" role="status" aria-live="polite">
            <div className="app-loadingOrb" aria-hidden="true">
              <span className="app-loadingOrbRing" />
              <span className="app-loadingOrbDot" />
            </div>
            <div className="app-loadingTitle">
            {isStillLoadingLiveProject ? "Loading project hub" : "Project hub unavailable"}
            </div>
            <div className="app-loadingBody">
              {isStillLoadingLiveProject
                ? "Pulling the latest workflow summary, share access, and project activity."
                : "We couldn't load this project summary yet. Please refresh or reopen the project from the dashboard."}
            </div>
            {isStillLoadingLiveProject ? (
              <div className="app-loadingRail" aria-hidden="true">
                <span className="app-loadingRailBar app-loadingRailBar-wide" />
                <span className="app-loadingRailBar" />
                <span className="app-loadingRailBar app-loadingRailBar-short" />
              </div>
            ) : null}
          </div>
        </div>
      </AppShell>
    );
  }

  if (shareAccess.isShareMode && shareAccess.isResolving) {
    return (
      <AppShell pageClassName="wide" projectTitle={rollup?.title}>
        <div className="app-loadingWrap app-loadingWrap-page">
          <div className="app-loadingCard app-loadingCard-wide" role="status" aria-live="polite">
            <div className="app-loadingOrb" aria-hidden="true">
              <span className="app-loadingOrbRing" />
              <span className="app-loadingOrbDot" />
            </div>
            <div className="app-loadingTitle">Loading shared project access</div>
            <div className="app-loadingBody">Checking your link and pulling the live workflow summary.</div>
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

  if (shareAccess.isShareMode && (!shareAccess.shareLink || shareAccess.isRevoked || !shareAccess.canView("hub"))) {
    return (
      <AppShell pageClassName="wide" projectTitle={rollup?.title}>
        <ShareAccessDenied
          title={shareAccess.isRevoked ? "This shared link has been revoked" : "This shared link cannot open the project hub"}
          body="Ask the project owner for a collaboration or view-only link if you need project hub access."
        />
      </AppShell>
    );
  }

  return (
    <AppShell pageClassName="wide" projectTitle={rollup.title}>
      <div className="hub-mobileOnly">
        <div className="hub-mobileShell">
          <HubMobileProjectHeader
            eyebrow="Project Hub"
            title={rollup.title}
            chips={[
              ...(isSandboxProject ? [{ label: "Internal Sandbox", tone: "warning" as const }] : []),
              { label: venueMarket, tone: "success" },
              { label: venueName, tone: "neutral" },
              ...(rollup.liftOrderId ? [{ label: `Lift ${rollup.liftOrderId}`, tone: "neutral" as const }] : []),
              ...(isSandboxProject && rollup.sourceCustomerName ? [{ label: `Source ${rollup.sourceCustomerName}`, tone: "neutral" as const }] : []),
            ]}
            metrics={[
              { label: "AS360 #", value: rollup.adspaceOrderNumber || rollup.extId.replace(/^AS360-/i, ""), tone: "primary" },
              { label: "Contract #", value: displayContractNumber, tone: "warning" },
              { label: "Artwork Due", value: formatDateLabel(rollup.dates.artworkDue), tone: "success" },
              { label: "Post Date", value: formatDateLabel(rollup.dates.postDate), tone: "danger" },
            ]}
            tools={
              <>
                {rollup.liftOrderId && !shareAccess.isShareMode ? (
                  <button className="btn btn-ghost btn-soft" type="button" disabled={liftOrderUrlLoading} onClick={() => void openLiftOrder()}>
                    {liftOrderUrlLoading ? "Opening Lift…" : "Open Lift"}
                  </button>
                ) : null}
                {viewerCanManageLiftOrder && !shareAccess.isShareMode && !isDemo ? (
                  <button className="btn btn-ghost btn-soft" type="button" onClick={goAllocationOverride}>
                    Allocation
                  </button>
                ) : null}
                {isCustomerMode && !isSandboxProject ? (
                  <button className="btn btn-ghost btn-soft" type="button" onClick={() => setShareAccessOpen(true)}>
                    Share
                  </button>
                ) : null}
                {!shareAccess.isShareMode ? (
                  <button className="btn btn-ghost btn-soft" type="button" onClick={() => setEditOpen(true)}>
                    Edit Details
                  </button>
                ) : null}
              </>
            }
          />

          <HubMobileNextStep
            banner={primaryBanner}
            iconName={getPrimaryBannerIconName({
              tone: primaryBanner.tone,
              title: primaryBanner.title,
              ctaKind: "ctaKind" in primaryBanner ? primaryBanner.ctaKind : undefined,
            })}
            onPrimary={handlePrimaryBannerAction}
            onSecondary={handlePrimaryBannerSecondaryAction}
          />

          <HubMobileProgressDock
            stepper={stepper}
            assignmentLabel={`${assignmentAssigned}/${assignmentRequired} assigned`}
            proofLabel={proofStatusText}
            activityCount={activityFeed.length}
          />

          <div id="hub-mobile-workflows" className="hub-mobileWorkflowList">
            {isSandboxProject ? (
              <HubMobileWorkflowCard
                title="Sandbox rehearsal lane"
                meta="Internal-only workflow rehearsal"
                tone="warning"
                badge="Zero write"
                description="Routes Lift previews to demo customer 1249 and keeps customer-facing share access disabled."
                metrics={[
                  { label: "Source customer", value: rollup.sourceCustomerName || "Linked" },
                  { label: "Share links", value: "Blocked", tone: "warning" },
                  { label: "Lift demo", value: "1249" },
                ]}
                actions={
                  <>
                    <button className="btn btn-primary" type="button" onClick={() => setReviewOpen(true)}>
                      Review Allocation
                    </button>
                    <button className="btn btn-ghost btn-soft" type="button" onClick={() => navigate(shareAccess.buildProjectUrl(`/p/${resolvedProjectId}/docs${modeSuffix}`), demoNavState as any)}>
                      Documents
                    </button>
                  </>
                }
              />
            ) : null}

            {canViewArtwork ? (
              <HubMobileWorkflowCard
                title="Artwork Folder"
                meta={artworkWorkspaceLoading ? "Syncing artwork coverage" : `${artworkCreatives.length} files · ${artworkCoveredKeys.size}/${artworkVariantKeys.size} variants`}
                tone={artworkNeedsCount > 0 ? "warning" : "success"}
                badge={artworkWorkspaceLoading ? "Syncing" : artworkNeedsCount > 0 ? `${artworkNeedsCount} needed` : "Ready"}
                metrics={[
                  { label: "Files", value: artworkWorkspaceLoading ? "—" : artworkCreatives.length },
                  { label: "Covered", value: artworkWorkspaceLoading ? "—" : artworkCoveredKeys.size },
                  { label: "Need artwork", value: artworkWorkspaceLoading ? "—" : artworkNeedsCount, tone: artworkNeedsCount > 0 ? "warning" : "success" },
                ]}
                actions={
                  <>
                    <button className="btn btn-primary" type="button" onClick={goArtwork}>
                      Open Artwork
                    </button>
                    {!shareAccess.isShareMode && !isDemo ? (
                      <button
                        className="btn btn-ghost btn-soft"
                        type="button"
                        disabled={creativePackageGenerating || artworkWorkspaceLoading || artworkCreatives.length === 0}
                        onClick={() => void handleGenerateCreativePackage()}
                      >
                        {creativePackageGenerating ? "Building…" : "Download Package"}
                      </button>
                    ) : null}
                  </>
                }
              />
            ) : null}

            {canViewAssignment ? (
              <HubMobileWorkflowCard
                title="Creative Assignment"
                meta={assignmentStatusText}
                tone={assignmentStatusTone}
                badge={assignmentStatusTone === "warning" ? "Action" : "Complete"}
                metrics={[
                  { label: "Required", value: assignmentRequired },
                  { label: "Assigned", value: assignmentAssigned, tone: "success" },
                  { label: "Remaining", value: assignmentRemainingCount, tone: assignmentRemainingCount > 0 ? "warning" : "success" },
                ]}
                actions={
                  <>
                    <button className="btn btn-primary" type="button" onClick={goAssignment}>
                      {rollup.liftOrderId ? "Review Assignment" : "Open Assignment"}
                    </button>
                    <button className="btn btn-ghost btn-soft" type="button" onClick={() => setReviewOpen(true)}>
                      Review Allocation
                    </button>
                    {isCustomerMode && !rollup.liftOrderId ? (
                      <button className="btn btn-ghost btn-soft" type="button" onClick={() => setScopeOpen(true)}>
                        Edit Inventory
                      </button>
                    ) : null}
                  </>
                }
              />
            ) : null}

            {canViewProofs ? (
              <HubMobileWorkflowCard
                title="Proof Approval"
                meta={proofStatusText}
                tone={proofStatusTone}
                badge={proofStatusTone === "warning" ? "Pending" : proofStatusTone === "success" ? "Complete" : "Locked"}
                metrics={[
                  { label: "Lines", value: proofTotal },
                  { label: "Pending", value: proofPendingCount, tone: proofPendingCount > 0 ? "warning" : "success" },
                  { label: proofFourthLabel, value: proofFourthValue },
                ]}
                actions={
                  <button className="btn btn-primary" type="button" disabled={!proofEnabled} onClick={goProofs}>
                    Open Proof Review
                  </button>
                }
              />
            ) : null}

            {showTransitCard ? (
              <HubMobileWorkflowCard
                title="Transit Approval"
                meta={transitStatusText}
                tone={transitStatusTone}
                badge={transitAcceptanceText}
                metrics={[
                  { label: "Acceptance", value: transitAcceptanceText, tone: transitStatusTone },
                  { label: "Action date", value: transitActionDateText },
                  { label: "Submitted by", value: transitSubmittedByText },
                ]}
                actions={
                  <>
                    <button className="btn btn-primary" type="button" onClick={goTransit} disabled={!transitReadyForAction}>
                      Open Transit
                    </button>
                    <button className="btn btn-ghost btn-soft" type="button" onClick={() => copyText(transitLink)} disabled={!transitReadyForAction}>
                      Copy Link
                    </button>
                  </>
                }
              />
            ) : null}

            <HubMobileWorkflowCard
              title="Document Repository"
              meta={showExternalDocsAction ? `Adspace + ${externalDocsLabel}` : "Specs, templates, and instructions"}
              tone="neutral"
              metrics={[
                { label: "Source", value: documentSourceMode === "external" ? "External" : documentSourceMode === "hybrid" ? "Hybrid" : "Adspace" },
              ]}
              actions={
                <>
                  <button className="btn btn-primary" type="button" onClick={() => navigate(shareAccess.buildProjectUrl(`/p/${rollup.projectId}/docs${modeSuffix}`), demoNavState as any)}>
                    Open Documents
                  </button>
                  {showExternalDocsAction ? (
                    <a className="btn btn-ghost btn-soft" href={externalDocumentUrl} target="_blank" rel="noreferrer">
                      Open {externalDocsLabel}
                    </a>
                  ) : null}
                </>
              }
            />

            <HubMobileWorkflowCard
              title="Support"
              meta="Contact us if you need help"
              tone="neutral"
              metrics={[
                { label: "Email", value: "support@ltlco.com" },
                { label: "Phone", value: "(502) 555-0123" },
              ]}
            />

            {isCustomerMode && !shareAccess.isShareMode ? (
              <HubMobileWorkflowCard
                id="hub-mobile-activity"
                title="Project Activity"
                meta={activityFeed.length > 0 ? `${Math.min(filteredActivityFeed.length, ACTIVITY_FEED_LIMIT)} shown` : "No activity yet"}
                tone={activityFeed.length > 0 ? "primary" : "neutral"}
                description={
                  activityLoading
                    ? "Loading the latest project activity."
                    : filteredActivityFeed[0]
                    ? `${filteredActivityFeed[0].actorName || "Adspace360"} ${projectActivityLabel(filteredActivityFeed[0])}`
                    : "Recent uploads, assignments, approvals, shared-link activity, and release actions will appear here."
                }
                metrics={[
                  { label: "Events", value: activityFeed.length },
                  { label: "Filter", value: activityFilter === "all" ? "All" : projectActivityCategoryLabel(filteredActivityFeed[0] || activityFeed[0] || ({ eventType: "workflow", detail: {} } as any)) },
                ]}
                actions={
                  activityFeed.length > ACTIVITY_FEED_LIMIT ? (
                    <button className="btn btn-ghost btn-soft" type="button" onClick={() => setActivityPage((page) => Math.min(activityPageCount, page + 1))}>
                      More Activity
                    </button>
                  ) : null
                }
              />
            ) : null}
          </div>
        </div>
      </div>

      <div className="hub-desktopOnly">
      <PageHeader
        className="hub-pageHeader"
        backLabel={isCustomerMode ? "← Projects" : undefined}
        onBack={isCustomerMode ? () => navigate("/customer/projects") : undefined}
        eyebrow="Project Hub"
        title={rollup.title}
        meta={
          <div className="hub-headerMeta">
            {isSandboxProject ? <span className="hub-chip tone-warning">Internal Sandbox</span> : null}
            <span className="hub-chip tone-info">{venueMarket}</span>
            <span className="hub-chip tone-neutral">{venueName}</span>
            {rollup.liftOrderId ? (
              <span className="hub-chip tone-neutral">Lift {rollup.liftOrderId}</span>
            ) : null}
            {isSandboxProject && rollup?.sourceCustomerName ? (
              <span className="hub-chip tone-neutral">Source Customer {rollup.sourceCustomerName}</span>
            ) : null}
          </div>
        }
        actions={
          <>
            {rollup.liftOrderId && !shareAccess.isShareMode && (
              <button
                className="btn btn-ghost btn-soft btn-lg hub-headerAction hub-headerAction-lg"
                type="button"
                disabled={liftOrderUrlLoading}
                onClick={async () => {
                  if (!rollup.projectId) return;
                  const popup = window.open("about:blank", "_blank", "noopener,noreferrer");
                  setLiftOrderUrlLoading(true);
                  try {
                    const response = await fetchProjectLiftOrderUrl(api, rollup.projectId);
                    if (popup) {
                      popup.location.href = response.url;
                    } else {
                      window.open(response.url, "_blank", "noopener,noreferrer");
                    }
                  } catch (error) {
                    popup?.close();
                    const message = error instanceof Error ? error.message : "We couldn't open the Lift order yet.";
                    demoStore.actions.pushToast("danger", message);
                  } finally {
                    setLiftOrderUrlLoading(false);
                  }
                }}
              >
                {liftOrderUrlLoading ? "Opening Lift…" : "Open Lift Order"}
              </button>
            )}

            {viewerCanManageLiftOrder && !shareAccess.isShareMode && !isDemo && (
              <button
                className="btn btn-ghost btn-soft btn-lg hub-headerAction hub-headerAction-lg"
                type="button"
                onClick={goAllocationOverride}
              >
                Allocation Override
              </button>
            )}

            {isCustomerMode && !isSandboxProject && (
              <button
                className="btn btn-ghost btn-soft btn-lg hub-headerAction hub-headerAction-lg"
                type="button"
                onClick={() => setShareAccessOpen(true)}
              >
                Share Access
              </button>
            )}

            {!shareAccess.isShareMode && (
              <button
                className="btn btn-ghost btn-soft btn-lg hub-headerAction hub-headerAction-lg"
                type="button"
                onClick={() => setEditOpen(true)}
                title="Edit project details (stub)"
              >
                Edit Project Details
              </button>
            )}
          </>
        }
      />
      
      {/* KPI row */}
		<div className="hub-kpiRow">
		  <div className="hub-kpi hub-kpi-info">
			<div className="hub-kpi-label">AS360 #</div>
			<div className="hub-kpi-value">{rollup.adspaceOrderNumber || rollup.extId.replace(/^AS360-/i, "")}</div>
		  </div>
		
		  <div className="hub-kpi hub-kpi-warning">
			<div className="hub-kpi-label">Contract #</div>
			<div className="hub-kpi-value">{displayContractNumber}</div>
		  </div>
		
		  <div className="hub-kpi hub-kpi-success">
			<div className="hub-kpi-label">Artwork Due</div>
			<div className="hub-kpi-value">{formatDateLabel(rollup.dates.artworkDue)}</div>
		  </div>
		
		  <div className="hub-kpi hub-kpi-danger">
			<div className="hub-kpi-label">Post Date</div>
			<div className="hub-kpi-value">{formatDateLabel(rollup.dates.postDate)}</div>
		  </div>
		</div>

	{/* Stepper */}
	<Panel className="panel-tight hub-stepperPanel">
	  <div className="hub-stepper-wrap2">
		<Stepper model={stepper} />
	  </div>
	</Panel>

	      {/* Next step banner (single attention banner) */}
		<div className="hub-primaryWrap hub-section">
		  <div className={`hub-primary hub-primary-banner hub-primary-${primaryBannerToneClass(primaryBanner.tone)}`}>
			<div className="hub-primary-left">
			  <div className={`hub-primary-icon hub-primary-icon-${primaryBannerToneClass(primaryBanner.tone)}`} aria-hidden="true">
			    <HubPrimaryBannerIcon
			      icon={getPrimaryBannerIconName({
			        tone: primaryBanner.tone,
			        title: primaryBanner.title,
			        ctaKind: "ctaKind" in primaryBanner ? primaryBanner.ctaKind : undefined,
			      })}
			    />
			  </div>
			  <div className="hub-primary-copy">
			    <div className="hub-primary-title">{primaryBanner.title}</div>
			    <div className="hub-primary-body">{primaryBanner.body}</div>
			  </div>
			</div>
	
		{"ctaLabel" in primaryBanner && (
		  <div className="hub-primary-right">
			{primaryBanner.ctaKind === "get_started" ? (
			  <>
				<button
				  className="btn btn-primary btn-lg"
				  type="button"
				  onClick={() => {
					if (canViewArtwork) goArtwork();
					else demoStore.actions.pushToast("warning", "This shared link does not allow artwork access");
				  }}
				>
				  {primaryBanner.ctaLabel}
				</button>
				{"ctaSecondaryLabel" in primaryBanner && primaryBanner.ctaSecondaryLabel && (
				  <button
					className="btn btn-secondary btn-lg"
					type="button"
					onClick={() => {
					  if ("ctaSecondaryKind" in primaryBanner && primaryBanner.ctaSecondaryKind === "open_transit") {
						goTransit();
						return;
					  }
					  if (canViewAssignment) goAssignment();
					  else if (canViewArtwork) goArtwork();
					  else demoStore.actions.pushToast("warning", "This shared link does not allow assignment access");
					}}
				  >
					{primaryBanner.ctaSecondaryLabel}
				  </button>
				)}
			  </>
			) : (
			  <>
				{"ctaSecondaryLabel" in primaryBanner && primaryBanner.ctaSecondaryLabel && (
				  <button
					className="btn btn-ghost btn-soft btn-lg"
					type="button"
					onClick={handlePrimaryBannerSecondaryAction}
				  >
					{primaryBanner.ctaSecondaryLabel}
				  </button>
				)}
				<button
				  className="btn btn-primary btn-lg"
				  type="button"
				  onClick={handlePrimaryBannerAction}
				>
				  {primaryBanner.ctaLabel}
				</button>
			  </>
			)}
		  </div>
		)}
	  </div>
	</div>

      {isSandboxProject && (
          <Panel className="hub-card hub-sandboxCard hub-card-tone-info">
          <div className="hub-cardHeader">
            <div>
              <div className="hub-cardTitle">Sandbox rehearsal lane</div>
              <div className="hub-cardMetaLine">
                Validate payload shape and workflow guardrails here before any real Lift submit.
              </div>
            </div>
            <span className="hub-chip tone-warning">Zero write</span>
          </div>

          <div className="hub-cardBody">
            <div className="hub-cardDesc">
              This project stays internal-only, routes Lift previews to demo customer <strong>1249</strong>, and keeps
              customer-facing share access disabled while still exercising the live venue setup.
            </div>

            <div className="hub-stepStats hub-stepStats-four">
              <span className="hub-stepStat">
                <strong>{rollup.sourceCustomerName || "Source venue linked"}</strong>
                Source customer
              </span>
              <span className="hub-stepStat">
                <strong>Blocked</strong>
                Share links
              </span>
              <span className="hub-stepStat">
                <strong>1249</strong>
                Lift demo customer
              </span>
              <span className="hub-stepStat">
                <strong>{rollup.liftOrderId || "Preview first"}</strong>
                {rollup.liftOrderId ? "Submitted to Lift" : "Live Lift status"}
              </span>
            </div>

            <div className="hub-cardActions">
              <button className="btn btn-primary btn-wide" type="button" onClick={() => setReviewOpen(true)}>
                Open Review Allocation
              </button>
              <button
                className="btn btn-ghost btn-soft btn-wide"
                type="button"
                onClick={() => navigate(shareAccess.buildProjectUrl(`/p/${resolvedProjectId}/docs${modeSuffix}`), demoNavState as any)}
              >
                Open Documents
              </button>
            </div>
          </div>
        </Panel>
      )}

      {/* Cards */}
      <div className="hub-layout">
        <div className="hub-primaryWorkflowGrid">
          {/* Artwork Folder */}
          {canViewArtwork && (
            <Panel className={`hub-card hub-card-artwork hub-card-tone-${artworkNeedsCount > 0 ? "warning" : "success"}`}>
              <div className="hub-cardHeader">
                <div>
                  <div className="hub-cardTitle">Artwork Folder</div>
                  <div className="hub-cardMetaLine">
                    {artworkWorkspaceLoading
                      ? "Loading uploaded artwork and variant coverage…"
                      : `${artworkCreatives.length} file${artworkCreatives.length === 1 ? "" : "s"} uploaded · ${artworkCoveredKeys.size}/${artworkVariantKeys.size} variants covered`}
                  </div>
                </div>
                <div className={toneToChipClass(artworkNeedsCount > 0 ? "warning" : "success")}>
                  {artworkWorkspaceLoading ? "Syncing" : artworkNeedsCount > 0 ? `${artworkNeedsCount} needed` : "Ready"}
                </div>
              </div>

              <div className="hub-cardBody">
                <div className="hub-cardDesc">
                  Collect production artwork by media variant before the placement team starts assigning files to venue inventory.
                </div>

                <div className="hub-stepStats hub-stepStats-four">
                  <span className="hub-stepStat">
                    <strong>{artworkWorkspaceLoading ? "—" : artworkCreatives.length}</strong>
                    Artwork files
                  </span>
                  <span className="hub-stepStat">
                    <strong>{artworkWorkspaceLoading ? "—" : artworkCoveredKeys.size}</strong>
                    Covered variants
                  </span>
                  <span className="hub-stepStat">
                    <strong>{artworkWorkspaceLoading ? "—" : artworkNeedsCount}</strong>
                    Need artwork
                  </span>
                  <span className={artworkNeedsCount > 0 ? "hub-stepStat" : "hub-stepStat hub-stepStat-acceptance-success"}>
                    <strong>
                      {artworkWorkspaceLoading || artworkVariantKeys.size === 0
                        ? "—"
                        : `${Math.round((artworkCoveredKeys.size / artworkVariantKeys.size) * 100)}%`}
                    </strong>
                    Variant coverage
                  </span>
                </div>

                <div className="hub-cardActions">
                  <button className="btn btn-primary" type="button" onClick={goArtwork}>
                    Open Artwork Folder
                  </button>
                  {!shareAccess.isShareMode && !isDemo ? (
                    <button
                      className="btn btn-ghost btn-soft"
                      type="button"
                      disabled={creativePackageGenerating || artworkWorkspaceLoading || artworkCreatives.length === 0}
                      onClick={() => void handleGenerateCreativePackage()}
                    >
                      {creativePackageGenerating ? "Building Package..." : "Download Artwork Package"}
                    </button>
                  ) : null}
                </div>
              </div>
          </Panel>
          )}

          {/* Creative Assignment */}
          {canViewAssignment && (
            <Panel className={`hub-card hub-card-tone-${assignmentStatusTone}`}>
              <div className="hub-cardHeader">
                <div>
                  <div className="hub-cardTitle">Creative Assignment</div>
                  <div className="hub-cardMetaLine">{assignmentStatusText}</div>
                </div>
                <div className={toneToChipClass(assignmentStatusTone)}>{assignmentStatusTone === "warning" ? "Action" : assignmentStatusTone === "success" ? "Complete" : "Status"}</div>
              </div>

              <div className="hub-cardBody">
                <div className="hub-cardDesc">
                  {rollup.liftOrderId
                    ? "Review the final creative allocation, inventory coverage, and installer packet for this campaign."
                    : "Upload and assign creative files for all included locations in this campaign."}
                </div>

                <div className="hub-stepStats hub-stepStats-four">
                  <span className="hub-stepStat">
                    <strong>{assignmentRequired}</strong>
                    Required
                  </span>
                  <span className="hub-stepStat">
                    <strong>{assignmentAssigned}</strong>
                    Assigned
                  </span>
                  <span className="hub-stepStat">
                    <strong>{assignmentRemainingCount}</strong>
                    Remaining
                  </span>
                  <span className={assignmentCoverageClass}>
                    <strong>{assignmentCoverageText}</strong>
                    {!!rollup.liftOrderId ? "Order Submitted" : "Coverage"}
                  </span>
                </div>

                <div className="hub-assignmentMeta hub-assignmentMeta-compact">
                  <span className="hub-assignmentMetaLine">
                    <span className="hub-assignmentMetaLabel">Venue</span>
                    <span className="hub-assignmentMetaValue">{venueName}</span>
                  </span>
                  <span className="hub-assignmentMetaDivider">•</span>
                  <span className="hub-assignmentMetaLine">
                    <span className="hub-assignmentMetaLabel">Market</span>
                    <span className="hub-assignmentMetaValue">{venueMarket}</span>
                  </span>
                  <span className="hub-assignmentMetaDivider">•</span>
                  <span className="hub-assignmentMetaLine">
                    <span className="hub-assignmentMetaLabel">Mode</span>
                    <span className="hub-assignmentMetaValue">{rollup.liftOrderId ? "Review Only" : "Editable Before Submit"}</span>
                  </span>
                </div>
          
                <div className="hub-cardActions">
                  <button className="btn btn-primary" type="button" onClick={goAssignment}>
                    {rollup.liftOrderId ? "Review Assignment" : "Open Assignment"}
                  </button>
          
                  <button className="btn btn-ghost btn-soft" type="button" onClick={() => setReviewOpen(true)}>
                    Open Review Allocation
                  </button>
          
                  {isCustomerMode && !rollup.liftOrderId && (
                    <button className="btn btn-ghost btn-soft" type="button" onClick={() => setScopeOpen(true)}>
                      Edit Included Inventory
                    </button>
                  )}
                </div>
              </div>
          </Panel>
          )}
        </div>

        <div className={`hub-workflowGrid ${showTransitCard ? "" : "hub-workflowGrid-single"}`}>
        {/* Proof Approval */}
        {canViewProofs && (
          <Panel className={`hub-card hub-card-tone-${proofStatusTone}`}>
            <div className="hub-cardHeader">
              <div>
                <div className="hub-cardTitle">Proof Approval</div>
                <div className="hub-cardMetaLine">{proofStatusText}</div>
              </div>
              <div className={toneToChipClass(proofStatusTone)}>
                {proofStatusTone === "warning" ? "Pending" : proofStatusTone === "success" ? "Complete" : "Locked"}
            </div>
          </div>

          <div className="hub-cardBody">
            <div className="hub-cardDesc">Review and approve proofs for print production.</div>

            <div className="hub-stepStats hub-stepStats-four">
              <span className="hub-stepStat">
                <strong>{proofTotal}</strong>
                Proof lines
              </span>
              <span className="hub-stepStat">
                <strong>{proofPendingCount}</strong>
                Pending
              </span>
              <span className={proofApprovedClass}>
                <strong>{allProofsApproved ? "Complete" : proofApprovedCount}</strong>
                {allProofsApproved ? "All Proofs Approved" : "Approved"}
              </span>
              <span className="hub-stepStat">
                <strong>{proofFourthValue}</strong>
                {proofFourthLabel}
              </span>
            </div>

            <div className="hub-cardActions">
              <button
                className="btn btn-primary btn-wide"
                type="button"
                disabled={!proofEnabled}
                onClick={goProofs}
              >
                Open Proof Review
              </button>
            </div>
          </div>
        </Panel>
        )}

        {/* Transit Approval (customer-only) */}
        {showTransitCard && (
          <Panel className={`hub-card hub-card-tone-${transitStatusTone}`}>
            <div className="hub-cardHeader">
              <div>
                <div className="hub-cardTitle">Transit Approval</div>
                <div className="hub-cardMetaLine">{transitStatusText}</div>
              </div>
              <div className={toneToChipClass(transitStatusTone)}>
                {transitAcceptanceText}
              </div>
            </div>

            <div className="hub-cardBody">
              <div className="hub-cardDesc">
                {transitReadyForAction
                  ? "Share the Transit Approval link as soon as the order is submitted. Transit review can run in parallel with proof approval."
                  : "Transit approval becomes available as soon as the order is submitted."}
              </div>

              <div className="hub-stepStats hub-stepStats-four">
                <span className={`hub-stepStat hub-stepStat-acceptance ${transitAcceptanceClass}`}>
                  <strong>{transitAcceptanceText}</strong>
                  Acceptance
                </span>
                <span className="hub-stepStat">
                  <strong>{transitActionDateText}</strong>
                  Action date
                </span>
                <span className="hub-stepStat">
                  <strong>{transitSubmittedByText}</strong>
                  Submitted by
                </span>
                <span className="hub-stepStat hub-stepStat-note">
                  <strong>{transitNoteText}</strong>
                  TA note
                </span>
              </div>

              <div className="hub-cardActions">
                <button className="btn btn-primary btn-wide" type="button" onClick={goTransit} disabled={!transitReadyForAction}>
                  Open Transit Review
                </button>
                <button className="btn btn-ghost btn-soft btn-wide" type="button" onClick={() => copyText(transitLink)} disabled={!transitReadyForAction}>
                  Copy Link
                </button>
                {canResetTransitStatus && (
                  <button
                    className="btn btn-ghost btn-soft btn-wide"
                    type="button"
                    onClick={() => {
                      if (isDemo) {
                        demoStore.actions.upsertTransitApproval(rollup.projectId, {
                          status: "not_started",
                          submittedByName: undefined,
                          submittedDate: undefined,
                          comment: undefined,
                          submittedAt: undefined,
                        });
                        demoStore.actions.pushToast("success", "Transit Approval status reset");
                        return;
                      }

                      void updateProjectTransit(api, rollup.projectId, {
                        status: "not_started",
                        submittedByName: null,
                        submittedDate: null,
                        comment: null,
                        submittedAt: null,
                      }).then((response) => {
                        setBackendTransit(response.transit);
                        void loadProjectActivity();
                      }).catch((error) => {
                        console.error("Failed to reset transit approval", error);
                      });
                    }}
                  >
                    Reset Status
                  </button>
                )}
              </div>
            </div>
          </Panel>
        )}
        </div>

        <div className="hub-secondaryGrid">
          <Panel className="hub-card hub-card-tone-info">
            <div className="hub-cardHeader">
              <div>
                <div className="hub-cardTitle">Document Repository</div>
                <div className="hub-cardMetaLine">Specs, templates, and project instructions</div>
              </div>
              {/* no chip */}
            </div>

            <div className="hub-cardBody">
              <div className="hub-cardDesc">
                {documentSourceMode === "external"
                  ? "Open the customer-approved external repository. Adspace keeps generated order records and package snapshots available in Documents."
                  : documentSourceMode === "hybrid"
                    ? "Open the venue’s external repository or review Adspace uploads, generated order records, package snapshots, and project instructions."
                    : "Access helpful reference files, generated order records, package snapshots, and project instructions."}
              </div>
              <div className="hub-cardActions">
                <button className="btn btn-primary btn-wide" type="button" onClick={() => navigate(shareAccess.buildProjectUrl(`/p/${rollup.projectId}/docs${modeSuffix}`), demoNavState as any)}>
                  Open Documents
                </button>
                {showExternalDocsAction ? (
                  <a className="btn btn-ghost btn-soft btn-wide" href={externalDocumentUrl} target="_blank" rel="noreferrer">
                    Open {externalDocsLabel}
                  </a>
                ) : null}
              </div>
            </div>
          </Panel>

          <Panel className="hub-card hub-card-tone-neutral">
            <div className="hub-cardHeader">
              <div>
                <div className="hub-cardTitle">Support</div>
                <div className="hub-cardMetaLine">Contact us if you need help.</div>
              </div>
            </div>

            <div className="hub-cardBody">
              <div className="hub-supportMini">
                <div className="hub-supportLine">
                  <span className="hub-supportLabel">Email</span>
                  <span className="hub-supportValue">support@ltlco.com</span>
                </div>
                <div className="hub-supportLine">
                  <span className="hub-supportLabel">Phone</span>
                  <span className="hub-supportValue">(502) 555-0123</span>
                </div>
              </div>
            </div>
          </Panel>
        </div>

        {isCustomerMode && !shareAccess.isShareMode && (
          <Panel className={`hub-card hub-activityCard hub-card-tone-${activityFeed.length > 0 ? "primary" : "neutral"}`}>
            <div className="hub-cardHeader">
              <div>
                <div className="hub-cardTitle">Project Activity</div>
                <div className="hub-cardMetaLine">Recent uploads, assignments, approvals, shared-link activity, and release actions</div>
              </div>
              <div className={toneToChipClass(activityFeed.length > 0 ? "primary" : "neutral")}>
                {activityFeed.length > 0 ? `${Math.min(filteredActivityFeed.length, ACTIVITY_FEED_LIMIT)} shown` : "No activity"}
              </div>
            </div>

            <div className="hub-cardBody">
              <div className="hub-cardDesc">
                This feed helps customer admins track who changed the project, when it happened, and whether the action came from an internal user or a forwarded collaboration link.
              </div>

              <div className="hub-activityFilters">
                {([
                  ["all", "All"],
                  ["workflow", "Workflow"],
                  ["approvals", "Approvals"],
                  ["uploads", "Uploads"],
                  ["collaboration", "Collaboration"],
                  ["errors", "Errors"],
                ] as Array<[ActivityFilterKey, string]>).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className={`hub-activityFilter ${activityFilter === key ? "is-active" : ""}`}
                    onClick={() => setActivityFilter(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {activityLoading ? (
                <div className="hub-activityEmpty">
                  <div className="hub-activityEmptyTitle">Loading project activity</div>
                  <div className="hub-activityEmptyBody">Pulling the latest audit trail from the live project record.</div>
                </div>
              ) : filteredActivityFeed.length === 0 ? (
                <div className="hub-activityEmpty">
                  <div className="hub-activityEmptyTitle">{activityFilter === "errors" ? "No tracked errors yet" : "No matching activity yet"}</div>
                  <div className="hub-activityEmptyBody">
                    {activityFilter === "errors"
                      ? "This lane shows structured workflow and integration failures such as upload issues, Lift sync mismatches, proofing errors, and submission problems without needing to read logs."
                      : "Try another filter or continue working through the project flow to populate this category."}
                  </div>
                </div>
              ) : (
                <div className="hub-activityList">
                  {filteredActivityFeed.length > ACTIVITY_FEED_LIMIT ? (
                    <div className="hub-activityPager">
                      <div className="hub-activityPagerMeta">
                        Showing {(activityPage - 1) * ACTIVITY_FEED_LIMIT + 1}
                        {"–"}
                        {Math.min(activityPage * ACTIVITY_FEED_LIMIT, filteredActivityFeed.length)} of {filteredActivityFeed.length}
                      </div>
                      <div className="hub-activityPagerActions">
                        <button
                          type="button"
                          className="hub-activityPagerButton"
                          onClick={() => setActivityPage((page) => Math.max(1, page - 1))}
                          disabled={activityPage === 1}
                        >
                          Newer
                        </button>
                        <div className="hub-activityPagerPage">
                          Page {activityPage} / {activityPageCount}
                        </div>
                        <button
                          type="button"
                          className="hub-activityPagerButton"
                          onClick={() => setActivityPage((page) => Math.min(activityPageCount, page + 1))}
                          disabled={activityPage >= activityPageCount}
                        >
                          Older
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {groupedActivityFeed.map((group) => (
                    <div key={group.label} className="hub-activityGroup">
                      <div className="hub-activityGroupLabel">{group.label}</div>
                      <div className="hub-activityGroupRows">
                        {group.events.map((event) => (
                          <div key={`${event.createdAt}-${event.eventType}-${event.actorId}`} className="hub-activityRow">
                            <div className="hub-activityMain">
                              <div className="hub-activityTitle">
                                <span className="hub-activityActor">{event.actorName || "Adspace360"}</span>
                                <span className="hub-activityVerb">{projectActivityLabel(event)}</span>
                              </div>
                              <div className="hub-activityMeta">
                                <span>{projectActivityMeta(event)}</span>
                                {event.shareLinkId && <span className="hub-activityMetaDot">•</span>}
                                {event.shareLinkId && <span>Shared link</span>}
                                <span className="hub-activityMetaDot">•</span>
                                <span>{projectActivityCategoryLabel(event)}</span>
                              </div>
                            </div>
                            <div className="hub-activityTime">{formatActivityTimestamp(event.createdAt)}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Panel>
        )}
      </div>
      </div>

      {/* Modals */}
      {isCustomerMode && (
        <InventoryScopeModal
          isOpen={isScopeOpen}
          onClose={() => setScopeOpen(false)}
          projectTitle={rollup.title}
          venueName={venueName}
          maps={isDemo ? mockMaps : (scopeVenueMaps.length > 0 ? scopeVenueMaps : (backendWorkspace?.maps || []))}
          inventory={isDemo ? (demoInventoryLegacy as any) : (scopeVenueInventory.length > 0 ? scopeVenueInventory : (backendWorkspace?.inventory || []))}
          initialIncludedIds={isDemo && ctx.scope ? ctx.scope.includedIds : includedIds}
          onConfirm={async (ids) => {
            try {
              setIncludedIds(ids);
              if (isDemo) {
                demoStore.actions.updateScope(demoActiveProjectId, ids);
                return;
              }

              const response = await api.request<ProjectScopeUpdateResponse>(
                `/api/projects/${rollup.projectId}`,
                {
                  method: "PATCH",
                  body: JSON.stringify({ includedIds: ids }),
                }
              );
              setBackendProject(response.project);
              setIncludedIds(response.scope?.includedIds || ids);
              setProjectScopeMeta({
                sourceType: response.scope?.sourceType,
                presetId: response.scope?.presetId,
                presetName: response.scope?.presetName,
                appliedAt: response.scope?.appliedAt,
              });

              invalidateProjectWorkspaceCache(rollup.projectId, false);
              const workspace = await fetchProjectWorkspace(api, rollup.projectId, false);
              setBackendWorkspace({
                maps: normalizeWorkspaceMaps(workspace.workspace.maps),
                creatives: workspace.workspace.creatives.map(normalizeCreativeAsset),
                inventory: normalizeWorkspaceInventory(workspace.workspace.inventory),
                variants: normalizeWorkspaceVariants(workspace.workspace.variants),
              });

              demoStore.actions.pushToast("success", "Included inventory updated");
            } catch (error) {
              const message = error instanceof Error ? error.message : "We couldn't update the included inventory yet.";
              void logProjectErrorEvent(api, rollup.projectId, {
                actionType: "project.scope.update",
                errorCode: "scope_update_failed",
                message,
                severity: "error",
                surface: "hub.scope",
                workspace: "hub",
              }).catch(() => undefined);
              demoStore.actions.pushToast(
                "danger",
                message
              );
              throw error;
            }
          }}
        />
      )}

      {isCustomerMode && (
        <ShareAccessModal
          isOpen={isShareAccessOpen}
          projectId={rollup.projectId}
          projectTitle={rollup.title}
          onClose={() => setShareAccessOpen(false)}
        />
      )}

	<ReviewAllocationModal
	  isOpen={isReviewOpen}
	  onClose={() => setReviewOpen(false)}
	  onAfterSubmit={() => {
		const pid = isDemo ? "demo_001" : rollup.projectId;
		navigate(shareAccess.buildProjectUrl(`/p/${pid}${modeSuffix}`), isDemo ? { state: { demo: true } } : undefined);
	  }}
	  project={{
		id: isDemo ? "demo_001" : rollup.projectId,
		title: rollup.title,
		venueName: venueName,
		customerName: backendProject?.customerName || rollup.sourceCustomerName || "Adspace360",
		projectMode: isSandboxProject ? "internal_sandbox" : "live",
		sourceCustomerName: rollup.sourceCustomerName || backendProject?.sourceCustomerName || undefined,
		artworkDueDate: rollup.dates.artworkDue || undefined,
		postDate: rollup.dates.postDate || undefined,
		orderNumber: rollup.liftOrderId || undefined,
		extId: rollup.extId || undefined,
		poNumber: rollup.poNumber || undefined,
		contractNumber: backendProject?.contractNumber || undefined,
		termsOfSubmissionText:
		  `TERMS OF SUBMISSION\n\nBy clicking Submit Order, you are confirming all order information is correct, creative allocations are complete and that all creative are in compliance with the Transit Authorities ad policy.\n\nOnce your order has been submitted the print manufacturer will evaluate each creative using a pre-press review process checking to ensure each file meets the correct size and resolution requirements.\n\nYou will be required to review and approve each pdf proof BEFORE the order can be printed.\n\nDuring this process you will have the opportunity to provide revised artwork.\n\nThe pdf proof is provided for content only and is NOT intended for color matching.\n\nCheck the box below to confirm you have read and understand the terms of submission.`,
	  }}
	  maps={isDemo ? mockMaps : (backendWorkspace?.maps || [])}
	  creatives={isDemo ? (demoCreativesLegacy as any) : (backendWorkspace?.creatives || [])}
	  inventory={isDemo ? (demoInventoryLegacy as any) : (backendWorkspace?.inventory || [])}
    variantCatalog={isDemo ? mockMediaVariants : (backendWorkspace?.variants || [])}
	  canSubmitOrder={shareAccess.canEdit("assignment")}
	  onRequestSubmitOrder={(submit) =>
	    shareAccess.requireEdit("assignment", "order.submit", "submitted the project order", submit)
	  }
	  onSubmitted={(result) => {
		invalidateProjectWorkspaceCache(rollup.projectId, shareAccess.isShareMode);
		setBackendProject((prev: any) =>
		  prev
		    ? {
		        ...prev,
		        liftOrderId: result.liftOrderId,
		        orderSubmittedAt: result.submittedAt,
		        orderSubmittedByName: result.submittedByName,
		        orderSubmissionNote: result.note || null,
		      }
		    : prev
		);
		setWorkspaceReloadKey((current) => current + 1);
		void loadProjectActivity();
	  }}
	  onDownloadPdf={handleDownloadAllocationPdf}
	/>

      <EditProjectDetailsModal
        isOpen={isEditOpen}
        onClose={() => setEditOpen(false)}
        initial={{
          title: rollup.title,
          market: venueMarket,
          venueId: currentVenueOption?.id,
          venueName,
          artworkDueDate: backendProject?.artworkDueDate ?? rollup.dates.artworkDue ?? undefined,
          postDate: backendProject?.postDate ?? rollup.dates.postDate ?? undefined,
          poNumber: backendProject?.poNumber ?? rollup.poNumber ?? undefined,
          endClientName: backendProject?.endClientName ?? rollup.endClientName ?? undefined,
          contractNumber: backendProject?.contractNumber ?? undefined,
          liftOrderId: backendProject?.liftOrderId ?? rollup.liftOrderId ?? undefined,
          inventoryPresetId: projectScopeMeta.presetId || "full_venue",
          inventoryPresetName: projectScopeMeta.presetName || "Full Venue",
        }}
        venues={editVenueOptions}
        isVenueLocked={isProjectVenueLocked}
        canManageLiftOrder={viewerCanManageLiftOrder}
        inventoryPresets={scopeVenuePresets}
        isInventoryScopeLocked={Boolean(rollup.liftOrderId)}
        onSave={(draft) => {
          if (isDemo) {
            demoStore.actions.updateProjectDetails(demoActiveProjectId, {
              title: draft.title,
              poNumber: draft.poNumber,
              artworkDueDate: draft.artworkDueDate,
              postDate: draft.postDate,
              ...(isProjectVenueLocked || !draft.venueId ? {} : { venueId: draft.venueId }),
            });
            return;
          }

          void (async () => {
            try {
              const response = await api.request<ProjectScopeUpdateResponse>(
                `/api/projects/${rollup.projectId}`,
                {
                  method: "PATCH",
                  body: JSON.stringify({
                    title: draft.title,
                  venueId: !isProjectVenueLocked ? draft.venueId : undefined,
                  artworkDueDate: draft.artworkDueDate,
                  postDate: draft.postDate,
                  poNumber: draft.poNumber,
                  endClientName: draft.endClientName,
                  contractNumber: draft.contractNumber,
                  ...(!rollup.liftOrderId ? { inventoryPresetId: draft.inventoryPresetId || "full_venue" } : {}),
                  ...(viewerCanManageLiftOrder
                    ? {
                        liftOrderId: draft.liftOrderId || null,
                        liftOrderOverrideNote: draft.liftOrderOverrideNote,
                      }
                    : {}),
                }),
              }
            );
              setBackendProject(response.project);
              setIncludedIds(response.scope?.includedIds || includedIds);
              setProjectScopeMeta({
                sourceType: response.scope?.sourceType,
                presetId: response.scope?.presetId,
                presetName: response.scope?.presetName,
                appliedAt: response.scope?.appliedAt,
              });
              setLocalProjectDetails(draft);
              invalidateProjectWorkspaceCache(rollup.projectId, false);
              const workspace = await fetchProjectWorkspace(api, rollup.projectId, false);
              setBackendWorkspace({
                maps: normalizeWorkspaceMaps(workspace.workspace.maps),
                creatives: workspace.workspace.creatives.map(normalizeCreativeAsset),
                inventory: normalizeWorkspaceInventory(workspace.workspace.inventory),
                variants: normalizeWorkspaceVariants(workspace.workspace.variants),
              });
              demoStore.actions.pushToast("success", "Project details updated");
            } catch (error) {
              const message = error instanceof Error ? error.message : "Could not update project details";
              void logProjectErrorEvent(api, rollup.projectId, {
                actionType: "project.details.update",
                errorCode: "project_update_failed",
                message,
                severity: "error",
                surface: "hub.project_details",
                workspace: "hub",
              }).catch(() => undefined);
              demoStore.actions.pushToast(
                "danger",
                message
              );
            }
          })();
        }}
      />
    </AppShell>
  );
}
