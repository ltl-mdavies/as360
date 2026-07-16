import { useEffect, useMemo, useRef, useState } from "react";
import { Download, ExternalLink, FileClock, Info, MapPin, MessageSquare, PackageCheck, Paperclip, RefreshCw, Save, Search, Upload } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import AppShell from "../../app/AppShell";
import PageHeader from "../../components/common/PageHeader";
import Panel from "../../components/common/Panel";
import Lightbox from "../../components/common/Lightbox";
import {
  fetchVendorOrder,
  generateVendorOrderPackage,
  requestArtworkUploadUrl,
  submitVendorOrderLineProof,
  updateVendorOrder,
  updateVendorOrderLines,
  updateVendorOrderLine,
  type ApiProjectAuditEvent,
  type ApiVendorOrderDetail,
  type ApiVendorOrderLine,
  type ApiVendorProductionStatus,
  type ApiVendorWorkflowStage,
  type ApiShippingDestination,
  type VendorLineUpdateInput,
} from "../../api/projects";
import { useApiClient } from "../../api/useApiClient";
import { generatePdfThumbnail, sanitizeFilename } from "../../components/uploader/uploadFiles";
import { triggerBrowserDownload } from "../../logic/downloads";
import "../../styles/vendorWorkspace.css";

const statusLabels: Record<ApiVendorProductionStatus, string> = {
  not_started: "Not Started",
  in_production: "In Production",
  blocked: "Blocked",
  shipped: "Shipped",
  complete: "Complete",
};

const workflowLabels: Record<ApiVendorWorkflowStage, string> = {
  incoming: "Incoming",
  needs_proof: "Needs Vendor Proof",
  client_review: "Client Review",
  client_approved: "Client Approved",
  production_ready: "Ready for Production",
  in_production: "In Production",
  shipped: "Shipped",
  complete: "Complete",
  blocked: "Blocked",
};

type LineDraft = VendorLineUpdateInput;

type BulkLineDraft = {
  applyStatus: boolean;
  productionStatus: ApiVendorProductionStatus;
  applyVendorReference: boolean;
  vendorReference: string;
  applyShippingCarrier: boolean;
  shippingCarrier: string;
  applyTrackingNumber: boolean;
  trackingNumber: string;
  applyShippedAt: boolean;
  shippedAt: string;
  applyNote: boolean;
  note: string;
};

type VendorProofStage =
  | "artwork_pending"
  | "needs_proof"
  | "vendor_submitted"
  | "client_review"
  | "revised_artwork_submitted"
  | "revised_proof_uploaded"
  | "client_approved"
  | "production_ready";

type LineBucket =
  | "all"
  | "needs_proof"
  | "client_review"
  | "revision_requested"
  | "client_approved"
  | "production_ready"
  | "in_production"
  | "shipped_complete"
  | "blocked";

type StagedVendorProofFile = {
  file: File;
  filename: string;
  contentType: string;
  sizeBytes: number;
  previewKind: "image" | "pdf" | "file";
  previewUrl?: string | null;
  previewReady: boolean;
};

function formatDate(value?: string | null, includeTime = false) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(includeTime ? { hour: "numeric", minute: "2-digit" } : {}),
  });
}

function formatVendorFileSize(bytes?: number | null) {
  if (!bytes) return "";
  const mb = bytes / 1024 / 1024;
  return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
}

function vendorProofPreviewKind(file: File, filename: string): StagedVendorProofFile["previewKind"] {
  if (file.type.startsWith("image/")) return "image";
  if (/\.pdf$/i.test(filename) || file.type === "application/pdf") return "pdf";
  return "file";
}

function workflowClass(stage: ApiVendorWorkflowStage) {
  return `vendor-status vendor-workflow-${stage}`;
}

function isPrimaryPrintOrder(order: ApiVendorOrderDetail) {
  return order.integrationHealth.route === "primary_print_vendor";
}

function vendorLineReference(line: ApiVendorOrderLine, primaryPrintRoute: boolean) {
  if (primaryPrintRoute) return line.lineNumber ? `Line ${line.lineNumber}` : "—";
  return line.lineNumber ? `Line ${line.lineNumber}` : line.id.replace(/^(proof|override|assignment)_/, "");
}

const proofStageLabels: Record<VendorProofStage, string> = {
  artwork_pending: "Artwork Pending",
  needs_proof: "Needs Vendor Proof",
  vendor_submitted: "Vendor Proof Submitted",
  client_review: "Client Review",
  revised_artwork_submitted: "Revised Art Waiting Proof",
  revised_proof_uploaded: "Revised Proof Uploaded",
  client_approved: "Client Approved",
  production_ready: "Production Ready",
};

const lineBucketLabels: Record<LineBucket, string> = {
  all: "All",
  needs_proof: "Needs Proof",
  client_review: "Client Review",
  revision_requested: "Revision",
  client_approved: "Client Approved",
  production_ready: "Production Ready",
  in_production: "In Production",
  shipped_complete: "Shipped / Complete",
  blocked: "Blocked",
};

const lineBuckets: LineBucket[] = [
  "all",
  "needs_proof",
  "client_review",
  "revision_requested",
  "client_approved",
  "production_ready",
  "in_production",
  "shipped_complete",
  "blocked",
];

function proofStage(line: ApiVendorOrderLine): VendorProofStage {
  if (
    line.workflow.stage === "production_ready" ||
    line.workflow.stage === "in_production" ||
    line.workflow.stage === "shipped" ||
    line.workflow.stage === "complete"
  ) return "production_ready";
  if (line.proof?.status === "approved") return "client_approved";
  const hasPublishedProof = Boolean(line.proof?.fullUrl || line.proof?.thumbUrl || line.proof?.liftProofStatus || line.proof?.vendorSubmittedAt || line.proof?.status === "pending");
  if (line.proof?.revised && !hasPublishedProof) return "revised_artwork_submitted";
  if (line.proof?.revised && hasPublishedProof) return "revised_proof_uploaded";
  if (line.proof?.vendorSubmittedAt) return "vendor_submitted";
  if (line.proof?.fullUrl || line.proof?.thumbUrl || line.proof?.liftProofStatus || line.proof?.status === "pending") return "client_review";
  if (line.creative?.fullUrl || line.creative?.thumbUrl) return "needs_proof";
  return "artwork_pending";
}

function lineMatchesBucket(line: ApiVendorOrderLine, bucket: LineBucket) {
  if (bucket === "all") return true;
  const stage = proofStage(line);
  if (bucket === "needs_proof") return stage === "needs_proof" || stage === "artwork_pending";
  if (bucket === "client_review") return stage === "vendor_submitted" || stage === "client_review" || stage === "revised_proof_uploaded";
  if (bucket === "revision_requested") return stage === "revised_artwork_submitted" || stage === "revised_proof_uploaded";
  if (bucket === "client_approved") return stage === "client_approved" || line.workflow.stage === "client_approved";
  if (bucket === "production_ready") return stage === "production_ready" || line.workflow.stage === "production_ready";
  if (bucket === "in_production") return line.workflow.stage === "in_production" || line.productionStatus === "in_production";
  if (bucket === "shipped_complete") {
    return line.workflow.stage === "shipped" || line.workflow.stage === "complete" || line.productionStatus === "shipped" || line.productionStatus === "complete";
  }
  if (bucket === "blocked") return line.workflow.stage === "blocked" || line.productionStatus === "blocked";
  return true;
}

function proofStageClass(stage: VendorProofStage) {
  return `vendor-proof-status vendor-proof-status-${stage}`;
}

function proofStatusLabel(value?: string | null) {
  if (!value) return "—";
  const normalized = value.trim().toLowerCase();
  if (normalized === "pending") return "Pending Approval";
  if (normalized === "waiting") return "Waiting for Proof";
  if (normalized === "approved") return "Approved";
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function proofTimestampLabel(line: ApiVendorOrderLine) {
  if (line.proof?.proofSource === "vendor_upload" || line.proof?.vendorSubmittedAt) return "Proof uploaded";
  if (line.proof?.proofSource === "lift_sync" || line.proof?.liftProofStatus) return "Proof synced from Lift";
  return "Proof added";
}

function currentProofApproved(line: ApiVendorOrderLine, currentProofVersion?: NonNullable<NonNullable<ApiVendorOrderLine["proof"]>["proofVersions"]>[number] | null) {
  const currentStatus = String(currentProofVersion?.status || line.proof?.liftProofStatus || line.proof?.status || "").toLowerCase();
  return currentStatus === "approved";
}

function compactLocationList(line: ApiVendorOrderLine, limit = 4) {
  const locations = Array.from(new Set(line.inventory.map((item) => item.inventoryId).filter(Boolean)));
  if (!locations.length) return { label: "—", title: "" };
  const full = locations.join(", ");
  if (locations.length <= limit) return { label: full, title: full };
  return {
    label: `${locations.slice(0, limit).join(", ")} +${locations.length - limit} more`,
    title: full,
  };
}

function liftLineStepLabel(step?: number | null) {
  if (step == null) return "—";
  if (step === 7.02) return "7.02 Approve Art";
  if (step >= 18) return `${step} Complete`;
  if (step >= 10) return `${step} Production`;
  return `Step ${step}`;
}

function liftOrderStatusLabel(value?: string | null) {
  if (!value) return "Pending Sync";
  return proofStatusLabel(value);
}

function liftValue(value?: string | number | null) {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function syncedLiftValue(value?: string | number | null) {
  if (value === null || value === undefined || value === "") return "Pending sync";
  return String(value);
}

function formatLiftSize(height?: number | null, width?: number | null) {
  if (height == null && width == null) return "—";
  const h = height == null ? "—" : String(height);
  const w = width == null ? "—" : String(width);
  return `${h}"h × ${w}"w`;
}

function liftLineSnapshotStep(line: ApiVendorOrderLine) {
  return line.proof?.liftLineSnapshot?.lineStepNumber ?? line.proof?.lineStepNumber ?? null;
}

function proofDisplayName(line: ApiVendorOrderLine) {
  return line.proof?.vendorFilename || line.creative?.filename || "Vendor proof";
}

function proofSourceLabel(line: ApiVendorOrderLine) {
  if (line.proof?.proofSource === "vendor_upload" || line.proof?.vendorSubmittedAt) return "Vendor Upload";
  if (line.proof?.proofSource === "lift_sync" || line.proof?.liftProofStatus) return "Lift Sync";
  if (line.proof?.proofSource === "adspace_upload") return "Adspace Upload";
  return "Proof Source Pending";
}

function clientApprovalSummary(stage: VendorProofStage, primaryPrintRoute: boolean) {
  if (stage === "production_ready") return "Client-approved artwork is ready for production.";
  if (stage === "client_approved") return "Client approved artwork. Production release may still be required.";
  if (stage === "revised_artwork_submitted") return "Client submitted revised artwork; waiting for a new proof.";
  if (stage === "revised_proof_uploaded") return "A revised proof has been uploaded and is waiting on the client.";
  if (stage === "vendor_submitted") return "Vendor proof submitted and waiting on client review.";
  if (stage === "client_review") return "Waiting on client proof decision.";
  if (stage === "needs_proof") return primaryPrintRoute ? "Artwork is ready for proof generation." : "Vendor proof is needed.";
  return "Artwork is not ready for proofing yet.";
}

function proofVersionDate(version: NonNullable<NonNullable<ApiVendorOrderLine["proof"]>["proofVersions"]>[number]) {
  return version.createdAt || version.replacedAt || null;
}

type VendorArtHistoryItem = {
  key: string;
  kind: "client_upload" | "proof_upload";
  filename: string;
  thumbUrl?: string | null;
  fullUrl?: string | null;
  at?: string | null;
  actor: string;
  status?: string | null;
  currentClient?: boolean;
  currentProof?: boolean;
};

function artHistorySortValue(value?: string | null) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function proofHistoryActor(line: ApiVendorOrderLine) {
  if (line.proof?.vendorSubmittedByName) return line.proof.vendorSubmittedByName;
  if (line.proof?.proofSource === "vendor_upload" || line.proof?.vendorSubmittedAt) return "Print provider";
  if (line.proof?.proofSource === "adspace_upload") return "Adspace";
  return "Lift Sync";
}

function buildVendorArtHistory(line: ApiVendorOrderLine): VendorArtHistoryItem[] {
  const items: VendorArtHistoryItem[] = [];
  if (line.creative?.filename || line.creative?.fullUrl || line.creative?.thumbUrl) {
    items.push({
      key: `client-${line.creative.id || line.creative.filename || "current"}`,
      kind: "client_upload",
      filename: line.creative.filename || "Client artwork",
      thumbUrl: line.creative.thumbUrl || line.creative.fullUrl || null,
      fullUrl: line.creative.fullUrl || line.creative.thumbUrl || null,
      at: line.creative.uploadedAt || null,
      actor: line.creative.uploadedByName || "Client / Adspace",
      currentClient: true,
    });
  }

  const proofVersions = [...(line.proof?.proofVersions || [])];
  const currentProofKnown = proofVersions.some((version) =>
    version.current ||
    (line.liftProofingId != null && version.attachmentId === line.liftProofingId) ||
    (line.proof?.fullUrl && version.proofFullUrl === line.proof.fullUrl)
  );
  if (!currentProofKnown && (line.proof?.fullUrl || line.proof?.thumbUrl || line.proof?.vendorFilename || line.liftProofingId)) {
    proofVersions.push({
      attachmentId: line.liftProofingId ?? null,
      orderLineId: line.liftOrderLineId ?? null,
      proofFilename: proofDisplayName(line),
      proofThumbUrl: line.proof?.thumbUrl || null,
      proofFullUrl: line.proof?.fullUrl || null,
      status: line.proof?.liftProofStatus || line.proof?.status || null,
      createdAt: line.proof?.vendorSubmittedAt || line.proof?.proofApprovedDate || null,
      current: true,
      comments: line.proof?.proofComments || [],
    });
  }

  const seenProofKeys = new Set<string>();
  proofVersions.forEach((version, index) => {
    const filename = version.proofFilename || (version.attachmentId ? `Proof attachment ${version.attachmentId}` : "");
    if (!filename && !version.proofFullUrl && !version.proofThumbUrl) return;
    const currentProof = Boolean(
      version.current ||
      (line.liftProofingId != null && version.attachmentId === line.liftProofingId) ||
      (line.proof?.fullUrl && version.proofFullUrl === line.proof.fullUrl)
    );
    const key = `proof-${version.attachmentId || version.proofFullUrl || filename || index}`;
    if (seenProofKeys.has(key)) return;
    seenProofKeys.add(key);
    items.push({
      key,
      kind: "proof_upload",
      filename: filename || "Proof file",
      thumbUrl: version.proofThumbUrl || version.proofFullUrl || null,
      fullUrl: version.proofFullUrl || version.proofThumbUrl || null,
      at: proofVersionDate(version) || (currentProof ? line.proof?.vendorSubmittedAt || line.proof?.proofApprovedDate || null : null),
      actor: currentProof ? proofHistoryActor(line) : "Lift Sync",
      status: proofStatusLabel(version.status || (currentProof ? line.proof?.liftProofStatus || line.proof?.status || null : null)),
      currentProof,
    });
  });

  return items.sort((a, b) => artHistorySortValue(b.at) - artHistorySortValue(a.at));
}

function displayWorkflowForOrder(order: ApiVendorOrderDetail) {
  const lines = order.lines;
  const serverWorkflow = order.summary.workflow;
  if (!order.project.orderSubmittedAt && !order.project.liftOrderId) return serverWorkflow;
  if (lines.some((line) => line.workflow.stage === "blocked")) {
    return { ...serverWorkflow, stage: "blocked" as const, label: "Blocked" };
  }
  if (lines.some((line) => line.workflow.stage === "needs_proof")) {
    return { ...serverWorkflow, stage: "needs_proof" as const, label: "Needs Vendor Proof" };
  }
  if (lines.some((line) => line.workflow.stage === "client_review")) {
    return { ...serverWorkflow, stage: "client_review" as const, label: "Client Review" };
  }
  if (lines.some((line) => line.workflow.stage === "client_approved")) {
    return { ...serverWorkflow, stage: "client_approved" as const, label: "Client Approved" };
  }
  const everyLineProductionReady = lines.length > 0 && lines.every((line) =>
    line.workflow.stage === "production_ready" ||
    line.workflow.stage === "in_production" ||
    line.workflow.stage === "shipped" ||
    line.workflow.stage === "complete"
  );
  if (!everyLineProductionReady) return serverWorkflow;
  if (lines.some((line) => line.workflow.stage === "in_production")) {
    return { ...serverWorkflow, stage: "in_production" as const, label: "In Production" };
  }
  if (lines.every((line) => line.workflow.stage === "complete")) {
    return { ...serverWorkflow, stage: "complete" as const, label: "Complete" };
  }
  if (lines.every((line) => line.workflow.stage === "shipped" || line.workflow.stage === "complete")) {
    return { ...serverWorkflow, stage: "shipped" as const, label: "Shipped" };
  }
  return { ...serverWorkflow, stage: "production_ready" as const, label: "Ready for Production" };
}

function shippingAddressLines(destination: ApiShippingDestination) {
  const cityLine = [destination.city, destination.region, destination.postalCode].filter(Boolean).join(", ");
  return [
    destination.company || destination.label,
    destination.attention ? `Attn: ${destination.attention}` : "",
    destination.addressLine1,
    destination.addressLine2,
    cityLine,
    destination.country,
  ].filter(Boolean);
}

function liftShippingDestination(line: ApiVendorOrderLine) {
  const shipping = line.liftShipping;
  if (!shipping) return "—";
  const cityLine = [shipping.city, shipping.state, shipping.zip].filter(Boolean).join(", ");
  return [shipping.locationName, cityLine].filter(Boolean).join(" · ") || "—";
}

function humanizeEventType(eventType: string) {
  return eventType
    .split(".")
    .map((part) => part.replaceAll("_", " "))
    .join(" ")
    .replace(/^\w/, (letter) => letter.toUpperCase());
}

function formatDetailValue(key: string, value: unknown) {
  if (key === "productionStatus" && typeof value === "string" && value in statusLabels) {
    return statusLabels[value as ApiVendorProductionStatus];
  }
  if (value == null || value === "") return "cleared";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return "updated";
}

function describeActivity(event: ApiProjectAuditEvent) {
  const detail = event.detail || {};
  if (event.eventType === "vendor.line.updated") {
    const changes = typeof detail.changes === "object" && detail.changes ? detail.changes as Record<string, unknown> : {};
    const changedFields = Object.entries(changes)
      .map(([key, value]) => `${key.replace(/([A-Z])/g, " $1").toLowerCase()}: ${formatDetailValue(key, value)}`)
      .join("; ");
    return changedFields ? `Line ${String(detail.vendorLineId || "").replace(/^override_/, "")}: ${changedFields}` : "Vendor line updated";
  }
  if (event.eventType === "vendor.order.updated") {
    return "Order-level vendor status updated";
  }
  if (event.eventType === "vendor.lines.bulk_updated") {
    const lineCount = Number(detail.lineCount || 0);
    const changes = typeof detail.changes === "object" && detail.changes ? detail.changes as Record<string, unknown> : {};
    const changedFields = Object.entries(changes)
      .map(([key, value]) => `${key.replace(/([A-Z])/g, " $1").toLowerCase()}: ${formatDetailValue(key, value)}`)
      .join("; ");
    return `${lineCount} selected ${lineCount === 1 ? "line" : "lines"} updated${changedFields ? `: ${changedFields}` : ""}`;
  }
  if (event.eventType === "vendor.proof.submitted") {
    const route = detail.route === "primary_print_vendor" ? "Lift-backed" : "Adspace-managed";
    const lineRef = detail.lineNumber ? `line ${detail.lineNumber}` : "assigned line";
    const filename = detail.filename ? ` · ${detail.filename}` : "";
    return `${route} proof submitted for ${lineRef}${filename}`;
  }
  if (event.eventType === "vendor.package.generated") {
    const lineCount = Number(detail.lineCount || 0);
    const fileCount = Number(detail.packagedFileCount || 0);
    const missingCount = Number(detail.missingFileCount || 0);
    return `${lineCount} lines, ${fileCount} artwork files packaged${missingCount ? `, ${missingCount} missing` : ""}`;
  }
  return humanizeEventType(event.eventType);
}

function lineDraft(line: ApiVendorOrderLine): LineDraft {
  return {
    productionStatus: line.productionStatus,
    vendorReference: line.vendorReference || "",
    note: line.note || "",
    shippingCarrier: line.shippingCarrier || "",
    trackingNumber: line.trackingNumber || "",
    shippedAt: line.shippedAt || "",
  };
}

function defaultOrderDraft(order: ApiVendorOrderDetail): LineDraft {
  return {
    productionStatus: order.summary.status,
    vendorReference: "",
    note: "",
    shippingCarrier: "",
    trackingNumber: "",
    shippedAt: "",
  };
}

function defaultBulkDraft(order: ApiVendorOrderDetail): BulkLineDraft {
  return {
    applyStatus: true,
    productionStatus: order.summary.status,
    applyVendorReference: false,
    vendorReference: "",
    applyShippingCarrier: false,
    shippingCarrier: "",
    applyTrackingNumber: false,
    trackingNumber: "",
    applyShippedAt: false,
    shippedAt: "",
    applyNote: false,
    note: "",
  };
}

function draftChanged(line: ApiVendorOrderLine, draft: LineDraft) {
  return JSON.stringify(lineDraft(line)) !== JSON.stringify(draft);
}

function datetimeInputValue(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return offsetDate.toISOString().slice(0, 16);
}

function isoFromDatetimeInput(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

export default function VendorOrderPage() {
  const api = useApiClient();
  const navigate = useNavigate();
  const params = useParams<{ vendorOrderId: string }>();
  const vendorOrderId = params.vendorOrderId || "";
  const [order, setOrder] = useState<ApiVendorOrderDetail | null>(null);
  const [vendorName, setVendorName] = useState("Vendor Workspace");
  const [drafts, setDrafts] = useState<Record<string, LineDraft>>({});
  const [orderDraft, setOrderDraft] = useState<LineDraft | null>(null);
  const [bulkDraft, setBulkDraft] = useState<BulkLineDraft | null>(null);
  const [selectedLineIds, setSelectedLineIds] = useState<string[]>([]);
  const [lineSearch, setLineSearch] = useState("");
  const [productFilter, setProductFilter] = useState("all");
  const [lineBucket, setLineBucket] = useState<LineBucket>("all");
  const [savingLineId, setSavingLineId] = useState<string | null>(null);
  const [savingOrder, setSavingOrder] = useState(false);
  const [savingBulk, setSavingBulk] = useState(false);
  const [refreshingLift, setRefreshingLift] = useState(false);
  const [packageGenerating, setPackageGenerating] = useState(false);
  const [packageNotice, setPackageNotice] = useState<ApiVendorOrderDetail["documents"][number] | null>(null);
  const [uploadingProofLineId, setUploadingProofLineId] = useState<string | null>(null);
  const [stagedProofs, setStagedProofs] = useState<Record<string, StagedVendorProofFile>>({});
  const stagedProofPreviewUrls = useRef(new Set<string>());
  const [proofNotes, setProofNotes] = useState<Record<string, string>>({});
  const [lightbox, setLightbox] = useState<{ url: string; alt: string } | null>(null);
  const [proofNotesModal, setProofNotesModal] = useState<{
    title: string;
    comments: NonNullable<NonNullable<ApiVendorOrderLine["proof"]>["proofComments"]>;
    feedback?: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!vendorOrderId) return;
      setLoading(true);
      setError(null);
      try {
        const response = await fetchVendorOrder(api, vendorOrderId);
        if (cancelled) return;
        setOrder(response.order);
        setVendorName(response.vendor.accounts[0]?.name || response.order.vendorName || "Vendor Workspace");
        setDrafts(Object.fromEntries(response.order.lines.map((line) => [line.id, lineDraft(line)])));
        setOrderDraft(defaultOrderDraft(response.order));
        setBulkDraft(defaultBulkDraft(response.order));
        setSelectedLineIds([]);
        setLineSearch("");
        setProductFilter("all");
        setLineBucket("all");
      } catch (loadError) {
        if (!cancelled) {
          console.error("Failed to load vendor order", loadError);
          setError("We could not load this vendor order.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [api, vendorOrderId]);

  useEffect(() => {
    return () => {
      stagedProofPreviewUrls.current.forEach((url) => URL.revokeObjectURL(url));
      stagedProofPreviewUrls.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!feedback) return undefined;
    const timeout = window.setTimeout(() => setFeedback(null), 4500);
    return () => window.clearTimeout(timeout);
  }, [feedback]);

  const latestPackage = useMemo(
    () => order?.documents.filter((document) => document.category === "order_package")[0] || null,
    [order]
  );
  const packageActionLabel = latestPackage ? "Regenerate Package" : "Generate Package";
  const productOptions = useMemo(() => {
    const names = new Set((order?.lines || []).map((line) => line.productLabel).filter(Boolean));
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [order]);
  const searchProductFilteredLines = useMemo(() => {
    const query = lineSearch.trim().toLowerCase();
    return (order?.lines || []).filter((line) => {
      const productMatches = productFilter === "all" || line.productLabel === productFilter;
      if (!productMatches) return false;
      if (!query) return true;
      const haystack = [
        line.productLabel,
        line.creative?.filename,
        line.lineNumber,
        line.liftOrderLineId,
        line.liftProofingId,
        line.proof?.liftLineSnapshot?.productName,
        line.proof?.liftLineSnapshot?.material,
        line.proof?.liftLineSnapshot?.unitNumber,
        line.proof?.liftLineSnapshot?.lineStepNumber,
        line.proofLineId,
        proofStageLabels[proofStage(line)],
        line.workflow.label,
        line.inventory.map((item) => item.inventoryId).join(" "),
      ].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(query);
    });
  }, [lineSearch, order, productFilter]);
  const lineBucketCounts = useMemo(() => {
    return Object.fromEntries(
      lineBuckets.map((bucket) => [bucket, searchProductFilteredLines.filter((line) => lineMatchesBucket(line, bucket)).length])
    ) as Record<LineBucket, number>;
  }, [searchProductFilteredLines]);
  const visibleLines = useMemo(
    () => searchProductFilteredLines.filter((line) => lineMatchesBucket(line, lineBucket)),
    [lineBucket, searchProductFilteredLines]
  );
  const productionEditableLineIds = useMemo(
    () => new Set((order?.lines || []).filter((line) => line.workflow.canUpdateProduction).map((line) => line.id)),
    [order]
  );
  const visibleProductionEditableLineIds = useMemo(
    () => new Set(visibleLines.filter((line) => line.workflow.canUpdateProduction).map((line) => line.id)),
    [visibleLines]
  );
  const selectedLineIdSet = useMemo(() => new Set(selectedLineIds), [selectedLineIds]);
  const selectedLineCount = selectedLineIds.length;
  const allLinesSelected = Boolean(visibleProductionEditableLineIds.size) && Array.from(visibleProductionEditableLineIds).every((lineId) => selectedLineIdSet.has(lineId));
  const proofSummary = useMemo(() => {
    const stages = order?.lines.map(proofStage) || [];
    return {
      needsProof: stages.filter((stage) => stage === "needs_proof").length,
      vendorSubmitted: stages.filter((stage) => stage === "vendor_submitted").length,
      clientReview: stages.filter((stage) => stage === "client_review").length,
      revisionRequested: stages.filter((stage) => stage === "revised_artwork_submitted" || stage === "revised_proof_uploaded").length,
      approved: stages.filter((stage) => stage === "client_approved").length,
      productionReady: stages.filter((stage) => stage === "production_ready").length,
      artworkPending: stages.filter((stage) => stage === "artwork_pending").length,
    };
  }, [order]);
  const proofSummaryItems = useMemo(
    () => [
      { label: "Artwork Pending", value: proofSummary.artworkPending },
      { label: "Needs Proof", value: proofSummary.needsProof },
      { label: "Submitted", value: proofSummary.vendorSubmitted },
      { label: "Client Review", value: proofSummary.clientReview },
      { label: "Revision", value: proofSummary.revisionRequested },
      { label: "Approved", value: proofSummary.approved },
      { label: "Production Ready", value: proofSummary.productionReady },
    ],
    [proofSummary]
  );
  const bulkPatch = useMemo(() => {
    if (!bulkDraft || !selectedLineCount) return null;
    const patch: VendorLineUpdateInput = {};
    if (bulkDraft.applyStatus) patch.productionStatus = bulkDraft.productionStatus;
    if (bulkDraft.applyVendorReference) patch.vendorReference = bulkDraft.vendorReference;
    if (bulkDraft.applyShippingCarrier) patch.shippingCarrier = bulkDraft.shippingCarrier;
    if (bulkDraft.applyTrackingNumber) patch.trackingNumber = bulkDraft.trackingNumber;
    if (bulkDraft.applyShippedAt) patch.shippedAt = bulkDraft.shippedAt;
    if (bulkDraft.applyNote) patch.note = bulkDraft.note;
    return Object.keys(patch).length ? patch : null;
  }, [bulkDraft, selectedLineCount]);
  const orderPatch = useMemo(() => {
    if (!order || !order.summary.workflow.canUpdateProduction || !orderDraft?.productionStatus) return null;
    const patch: VendorLineUpdateInput = {
      productionStatus: orderDraft.productionStatus,
    };
    if (orderDraft.vendorReference?.trim()) patch.vendorReference = orderDraft.vendorReference.trim();
    if (orderDraft.shippingCarrier?.trim()) patch.shippingCarrier = orderDraft.shippingCarrier.trim();
    if (orderDraft.trackingNumber?.trim()) patch.trackingNumber = orderDraft.trackingNumber.trim();
    if (orderDraft.note?.trim()) patch.note = orderDraft.note.trim();
    if (orderDraft.shippedAt?.trim()) patch.shippedAt = orderDraft.shippedAt.trim();
    const hasFilledField = Object.keys(patch).some((key) => key !== "productionStatus");
    const statusWouldChange = order.lines.some((line) => line.productionStatus !== patch.productionStatus);
    return hasFilledField || statusWouldChange ? patch : null;
  }, [order, orderDraft]);
  const primaryPrintOrder = order ? isPrimaryPrintOrder(order) : false;
  const displayWorkflow = order ? displayWorkflowForOrder(order) : null;
  const showBulkLineTools = !primaryPrintOrder && productionEditableLineIds.size > 1;

  function toggleLineSelection(lineId: string) {
    if (!productionEditableLineIds.has(lineId)) return;
    setSelectedLineIds((current) =>
      current.includes(lineId) ? current.filter((selectedId) => selectedId !== lineId) : [...current, lineId]
    );
  }

  function toggleAllLines() {
    const visibleIds = Array.from(visibleProductionEditableLineIds);
    if (!visibleIds.length) return;
    setSelectedLineIds((current) => {
      const visibleIdSet = new Set(visibleIds);
      if (allLinesSelected) return current.filter((lineId) => !visibleIdSet.has(lineId));
      return Array.from(new Set([...current, ...visibleIds]));
    });
  }

  async function saveBulkUpdate() {
    if (!order || !bulkPatch || !selectedLineCount) return;
    const lineIds = selectedLineIds.slice();
    setSavingBulk(true);
    setFeedback(null);
    setError(null);
    try {
      const response = await updateVendorOrderLines(api, order.id, { lineIds, update: bulkPatch });
      setOrder(response.order);
      setDrafts(Object.fromEntries(response.order.lines.map((line) => [line.id, lineDraft(line)])));
      setOrderDraft(defaultOrderDraft(response.order));
      setBulkDraft(defaultBulkDraft(response.order));
      setSelectedLineIds([]);
      setFeedback(`Bulk update applied to ${lineIds.length} selected ${lineIds.length === 1 ? "line" : "lines"}.`);
    } catch (saveError) {
      console.error("Failed to update selected vendor lines", saveError);
      setError("We could not apply that bulk line update.");
    } finally {
      setSavingBulk(false);
    }
  }

  async function saveOrderUpdate() {
    if (!order || !orderPatch) return;
    setSavingOrder(true);
    setFeedback(null);
    setError(null);
    try {
      const response = await updateVendorOrder(api, order.id, orderPatch);
      setOrder(response.order);
      setDrafts(Object.fromEntries(response.order.lines.map((line) => [line.id, lineDraft(line)])));
      setOrderDraft(defaultOrderDraft(response.order));
      setBulkDraft(defaultBulkDraft(response.order));
      setFeedback("Order update applied to assigned lines.");
    } catch (saveError) {
      console.error("Failed to update vendor order", saveError);
      setError("We could not apply that order update.");
    } finally {
      setSavingOrder(false);
    }
  }

  async function saveLine(line: ApiVendorOrderLine) {
    if (!order || !line.workflow.canUpdateProduction) return;
    const draft = drafts[line.id] || lineDraft(line);
    setSavingLineId(line.id);
    setFeedback(null);
    setError(null);
    try {
      const response = await updateVendorOrderLine(api, order.id, line.id, draft);
      setOrder(response.order);
      setDrafts(Object.fromEntries(response.order.lines.map((nextLine) => [nextLine.id, lineDraft(nextLine)])));
      setOrderDraft(defaultOrderDraft(response.order));
      setBulkDraft(defaultBulkDraft(response.order));
      setFeedback("Vendor line updated.");
    } catch (saveError) {
      console.error("Failed to update vendor line", saveError);
      setError("We could not save that vendor update.");
    } finally {
      setSavingLineId(null);
    }
  }

  async function generatePackage() {
    if (!order || !order.summary.workflow.canGeneratePackage) return;
    setPackageGenerating(true);
    setFeedback(null);
    setError(null);
    try {
      const response = await generateVendorOrderPackage(api, order.id);
      triggerBrowserDownload(response.document.fullUrl, response.document.filename);
      setPackageNotice(response.document);
      const refreshed = await fetchVendorOrder(api, order.id);
      setOrder(refreshed.order);
      setDrafts(Object.fromEntries(refreshed.order.lines.map((line) => [line.id, lineDraft(line)])));
      setOrderDraft(defaultOrderDraft(refreshed.order));
      setBulkDraft(defaultBulkDraft(refreshed.order));
    } catch (packageError) {
      console.error("Failed to generate vendor package", packageError);
      setError("We could not generate the vendor package.");
    } finally {
      setPackageGenerating(false);
    }
  }

  async function refreshLiftData() {
    if (!order || !primaryPrintOrder) return;
    setRefreshingLift(true);
    setFeedback(null);
    setError(null);
    try {
      const response = await fetchVendorOrder(api, order.id, { refreshLift: true });
      setOrder(response.order);
      setDrafts(Object.fromEntries(response.order.lines.map((line) => [line.id, lineDraft(line)])));
      setOrderDraft(defaultOrderDraft(response.order));
      setBulkDraft(defaultBulkDraft(response.order));
      setFeedback("Lift sync data refreshed.");
    } catch (refreshError) {
      console.error("Failed to refresh Lift data", refreshError);
      setError("We could not refresh the Lift sync yet. If this is local, the deployed API may not include the latest sync handler.");
    } finally {
      setRefreshingLift(false);
    }
  }

  function rememberPreviewUrl(url?: string | null) {
    if (url) stagedProofPreviewUrls.current.add(url);
  }

  function releasePreviewUrl(url?: string | null) {
    if (!url) return;
    URL.revokeObjectURL(url);
    stagedProofPreviewUrls.current.delete(url);
  }

  function clearStagedVendorProof(lineId: string) {
    setStagedProofs((current) => {
      const existing = current[lineId];
      if (existing?.previewUrl) releasePreviewUrl(existing.previewUrl);
      const next = { ...current };
      delete next[lineId];
      return next;
    });
  }

  async function stageVendorProof(file: File, line: ApiVendorOrderLine) {
    const filename = sanitizeFilename(file.name || "vendor-proof");
    const contentType = file.type || "application/octet-stream";
    const previewKind = vendorProofPreviewKind(file, filename);
    const initial: StagedVendorProofFile = {
      file,
      filename,
      contentType,
      sizeBytes: file.size,
      previewKind,
      previewReady: previewKind === "file",
    };
    setStagedProofs((current) => {
      const existing = current[line.id];
      if (existing?.previewUrl) releasePreviewUrl(existing.previewUrl);
      return { ...current, [line.id]: initial };
    });
    try {
      let previewUrl: string | null = null;
      if (previewKind === "image") {
        previewUrl = URL.createObjectURL(file);
      } else if (previewKind === "pdf") {
        const thumbnailFile = await generatePdfThumbnail(file, filename);
        previewUrl = URL.createObjectURL(thumbnailFile);
      }
      rememberPreviewUrl(previewUrl);
      setStagedProofs((current) => {
        const currentStaged = current[line.id];
        if (!currentStaged || currentStaged.file !== file) {
          releasePreviewUrl(previewUrl);
          return current;
        }
        return {
          ...current,
          [line.id]: {
            ...currentStaged,
            previewUrl,
            previewReady: true,
          },
        };
      });
    } catch (previewError) {
      console.warn("Failed to generate staged vendor proof preview", previewError);
      setStagedProofs((current) => {
        const currentStaged = current[line.id];
        if (!currentStaged || currentStaged.file !== file) return current;
        return {
          ...current,
          [line.id]: {
            ...currentStaged,
            previewReady: true,
          },
        };
      });
    }
  }

  async function uploadVendorProof(line: ApiVendorOrderLine) {
    if (!order) return;
    const staged = stagedProofs[line.id];
    if (!staged) {
      setError("Choose a proof file before submitting.");
      return;
    }
    if (!line.workflow.canSubmitProof) {
      setError(line.workflow.lockReason || "Proof upload is not available for this line yet.");
      return;
    }
    if (!line.proofLineId) {
      setError("This line is not linked to an Adspace proof line yet.");
      return;
    }
    const { file, filename, contentType } = staged;
    const note = (proofNotes[line.id] || "").trim();
    setUploadingProofLineId(line.id);
    setFeedback(null);
    setError(null);
    try {
      let thumbnailFile: File | null = null;
      if (contentType === "application/pdf" || filename.toLowerCase().endsWith(".pdf")) {
        try {
          thumbnailFile = await generatePdfThumbnail(file, filename);
        } catch (thumbnailError) {
          console.warn("Failed to generate vendor proof thumbnail", thumbnailError);
        }
      }

      const signed = await requestArtworkUploadUrl(api, {
        projectId: order.project.id,
        filename,
        contentType,
        assetKind: "proof",
      });

      let thumbKey: string | undefined;
      let thumbUploadUrl: string | undefined;
      if (thumbnailFile) {
        const thumbSigned = await requestArtworkUploadUrl(api, {
          projectId: order.project.id,
          filename: thumbnailFile.name,
          contentType: thumbnailFile.type || "image/jpeg",
          assetKind: "proof",
        });
        thumbKey = thumbSigned.key;
        thumbUploadUrl = thumbSigned.uploadUrl;
      }

      const uploadResponse = await fetch(signed.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body: file,
      });
      if (!uploadResponse.ok) throw new Error(`Upload failed for ${filename}`);

      if (thumbnailFile && thumbUploadUrl) {
        const thumbResponse = await fetch(thumbUploadUrl, {
          method: "PUT",
          headers: { "Content-Type": thumbnailFile.type || "image/jpeg" },
          body: thumbnailFile,
        });
        if (!thumbResponse.ok) throw new Error(`Thumbnail upload failed for ${filename}`);
      }

      const response = await submitVendorOrderLineProof(api, order.id, line.id, {
        proofObjectKey: signed.key,
        proofThumbObjectKey: thumbKey,
        filename,
        contentType,
        sizeBytes: staged.sizeBytes,
        note,
      });
      setOrder(response.order);
      setDrafts(Object.fromEntries(response.order.lines.map((nextLine) => [nextLine.id, lineDraft(nextLine)])));
      setOrderDraft(defaultOrderDraft(response.order));
      setBulkDraft(defaultBulkDraft(response.order));
      setProofNotes((current) => {
        const next = { ...current };
        delete next[line.id];
        return next;
      });
      clearStagedVendorProof(line.id);
      setFeedback(`Vendor proof submitted for line ${line.lineNumber || line.id}.`);
    } catch (uploadError) {
      console.error("Failed to submit vendor proof", uploadError);
      setError(uploadError instanceof Error ? uploadError.message : "We could not submit that vendor proof.");
    } finally {
      setUploadingProofLineId(null);
    }
  }

  return (
    <AppShell customerName={vendorName} pageClassName="vendor-workspace-page" showNavTrigger projectTitle={order?.project.title}>
      <PageHeader
        variant="workspace"
        eyebrow="Vendor Order"
        title={order?.project.title || "Vendor Order"}
        subtitle={order ? `${order.project.customerName} · ${order.project.venueName}` : "Assigned production order"}
        backLabel="Vendor Orders"
        onBack={() => navigate("/vendor/orders")}
        meta={
          order ? (
            <>
              <span>AS360 {order.project.adspaceOrderNumber}</span>
              {isPrimaryPrintOrder(order) ? <span>Lift {order.project.liftOrderId || "—"}</span> : null}
              {!isPrimaryPrintOrder(order) && order.project.poNumber ? <span>PO {order.project.poNumber}</span> : null}
              {!isPrimaryPrintOrder(order) && order.project.contractNumber ? <span>Contract {order.project.contractNumber}</span> : null}
              <span>{order.summary.lineCount} lines</span>
            </>
          ) : null
        }
        actions={
          order ? (
            <div className="vendor-page-actions">
              {packageNotice ? (
                <div className="vendor-package-notice" role="status">
                  <PackageCheck size={16} aria-hidden="true" />
                  <div>
                    <strong>Vendor package generated</strong>
                    <span>Download started</span>
                  </div>
                  <button type="button" aria-label="Dismiss package notice" onClick={() => setPackageNotice(null)}>×</button>
                </div>
              ) : latestPackage ? (
                <button className="vendor-package-link" type="button" onClick={() => triggerBrowserDownload(latestPackage.fullUrl, latestPackage.filename)}>
                  <PackageCheck size={15} aria-hidden="true" />
                  <span title={latestPackage.filename}>{latestPackage.filename}</span>
                  <small>{formatDate(latestPackage.createdAt, true)}</small>
                </button>
              ) : null}
              <button className="btn btn-primary" type="button" onClick={() => void generatePackage()} disabled={packageGenerating || !order.summary.workflow.canGeneratePackage}>
                <Download size={16} aria-hidden="true" />
                {packageGenerating ? "Generating..." : packageActionLabel}
              </button>
            </div>
          ) : null
        }
      />

      {loading ? <div className="vendor-empty">Loading vendor order...</div> : null}
      {error ? <div className="vendor-error">{error}</div> : null}
      {feedback ? (
        <div className="vendor-feedback" role="status">
          <span>{feedback}</span>
          <button type="button" aria-label="Dismiss message" onClick={() => setFeedback(null)}>
            x
          </button>
        </div>
      ) : null}

      {order ? (
        <>
          {order.summary.workflow.lockReason ? (
            <div className="vendor-workflow-banner">
              <strong>{displayWorkflow?.label || order.summary.workflow.label || workflowLabels[order.summary.workflow.stage]}</strong>
              <span>{order.summary.workflow.lockReason}</span>
            </div>
          ) : null}
          <div className={`vendor-order-overview${primaryPrintOrder ? " is-primary-sync" : " is-external-route"}`}>
            <Panel
              title="Job Brief"
              className="vendor-panel vendor-panel-job"
              right={displayWorkflow ? (
                <span className={workflowClass(displayWorkflow.stage)}>{displayWorkflow.label || workflowLabels[displayWorkflow.stage]}</span>
              ) : null}
            >
              <div className="vendor-job-brief">
                <div className="vendor-job-main">
                  <div className="vendor-detail-grid">
                    <span><small>Customer</small>{order.project.customerName}</span>
                    <span><small>Venue</small>{order.project.venueName}</span>
                    <span><small>PO</small>{order.project.poNumber || "—"}</span>
                    <span><small>Contract</small>{order.project.contractNumber || "—"}</span>
                    <span><small>Artwork Due</small>{formatDate(order.project.artworkDueDate)}</span>
                    <span><small>Post Date</small>{formatDate(order.project.postDate)}</span>
                  </div>
                </div>
                <div className={`vendor-ship-to ${order.shippingDestination.configured ? "" : "is-missing"}`}>
                  <MapPin size={20} aria-hidden="true" />
                  <div>
                    <small className="vendor-ship-to-title">Ship To</small>
                    <strong>{order.shippingDestination.configured ? order.shippingDestination.label || order.shippingDestination.company || "Configured destination" : "Shipping destination not configured"}</strong>
                    <small className="vendor-ship-to-source">{order.shippingDestination.sourceLabel}</small>
                    {order.shippingDestination.configured ? (
                      <>
                        <address>
                          {shippingAddressLines(order.shippingDestination).map((line) => (
                            <span key={line}>{line}</span>
                          ))}
                        </address>
                        {order.shippingDestination.phone || order.shippingDestination.email ? (
                          <p>{[order.shippingDestination.phone, order.shippingDestination.email].filter(Boolean).join(" · ")}</p>
                        ) : null}
                        {order.shippingDestination.instructions ? <p>{order.shippingDestination.instructions}</p> : null}
                      </>
                    ) : (
                      <p>Ask Adspace operations to configure a market default or venue override before shipping this order.</p>
                    )}
                  </div>
                </div>
              </div>
            </Panel>

            <Panel
              title={primaryPrintOrder ? "Lift Order Data" : "Vendor Status"}
              subtitle={primaryPrintOrder ? "Synced order header details from Lift." : "Your assigned work for this order."}
              className="vendor-panel vendor-panel-state"
            >
              {primaryPrintOrder ? (
                <div className="vendor-lift-order-snapshot" aria-label="Lift order details">
                  <div className="vendor-lift-order-snapshot-head">
                    <div className="vendor-lift-order-primary">
                      <div>
                        <small>Lift Order</small>
                        <strong>{order.project.liftOrderSnapshot?.orderNumber || order.project.liftOrderId || "—"}</strong>
                      </div>
                    </div>
                    <div>
                      <small>Lift Order Status</small>
                      <strong>{liftOrderStatusLabel(order.project.liftOrderSnapshot?.orderStatus || order.project.liftOrderStatus || order.integrationHealth.liftSync?.orderStatusRaw)}</strong>
                    </div>
                    <div>
                      <small>Order Sync</small>
                      <strong>{formatDate(order.project.lastLiftOrderSyncAt || order.integrationHealth.liftSync?.lastOrderSyncAt, true)}</strong>
                    </div>
                    <button className="btn btn-ghost btn-soft" type="button" onClick={() => void refreshLiftData()} disabled={refreshingLift}>
                      <RefreshCw size={15} aria-hidden="true" />
                      {refreshingLift ? "Refreshing..." : "Refresh Sync"}
                    </button>
                  </div>
                  <div className="vendor-lift-order-body">
                    <dl>
                      <div><dt>Customer</dt><dd>{order.project.liftOrderSnapshot?.customerName || order.project.customerName}</dd></div>
                      <div><dt>Lift Customer</dt><dd>{liftValue(order.project.liftOrderSnapshot?.customerId)}</dd></div>
                      <div><dt>Order Type</dt><dd>{order.project.liftOrderSnapshot?.orderTypeName || "—"}</dd></div>
                      <div><dt>Created</dt><dd>{formatDate(order.project.liftOrderSnapshot?.creationDate)}</dd></div>
                      <div><dt>Created By</dt><dd>{order.project.liftOrderSnapshot?.createdBy || "—"}</dd></div>
                      <div><dt>PO</dt><dd>{order.project.liftOrderSnapshot?.poNumber || order.project.poNumber || "—"}</dd></div>
                    </dl>
                  </div>
                </div>
              ) : (
                <div className="vendor-route-card">
                  <span className={workflowClass(displayWorkflow?.stage || order.summary.workflow.stage)}>{displayWorkflow?.label || order.summary.workflow.label || workflowLabels[order.summary.workflow.stage]}</span>
                  <div>
                    <strong>{order.summary.lineCount === 1 ? "1 assigned line" : `${order.summary.lineCount} assigned lines`}</strong>
                    <p>Use the order references below when coordinating this job.</p>
                    <small>
                      {[
                        order.project.adspaceOrderNumber ? `AS360 ${order.project.adspaceOrderNumber}` : null,
                        order.project.poNumber ? `PO ${order.project.poNumber}` : null,
                        order.project.contractNumber ? `Contract ${order.project.contractNumber}` : null,
                      ].filter(Boolean).join(" · ")}
                    </small>
                  </div>
                </div>
              )}
            </Panel>

            <Panel title="Proof Queue" subtitle={primaryPrintOrder ? "Proof sync status and line action buckets." : "Action buckets for assigned lines."} className="vendor-panel vendor-panel-proof-queue">
              <div>
                {primaryPrintOrder ? (
                  <div className="vendor-proof-sync-row">
                    <span><small>Proof Sync</small>{formatDate(order.project.lastLiftProofSyncAt, true)}</span>
                  </div>
                ) : null}
                <div className="vendor-proof-summary" aria-label="Proofing status">
                  {proofSummaryItems.map((item) => (
                    <span key={item.label} className={item.value ? "" : "is-empty"}>
                      <small>{item.label}</small>
                      <strong>{item.value}</strong>
                    </span>
                  ))}
                </div>
              </div>
            </Panel>
          </div>

          {orderDraft && order.summary.workflow.canUpdateProduction && !primaryPrintOrder ? (
            <Panel title="Order Update" subtitle="Apply a production update to every assigned line in this vendor order." className="vendor-panel">
              <div className="vendor-order-update">
                <label>
                  <span>Status</span>
                  <select
                    value={orderDraft.productionStatus}
                    onChange={(event) => setOrderDraft((current) => current ? { ...current, productionStatus: event.target.value as ApiVendorProductionStatus } : current)}
                  >
                    <option value="not_started">Not Started</option>
                    <option value="in_production">In Production</option>
                    <option value="blocked">Blocked</option>
                    <option value="shipped">Shipped</option>
                    <option value="complete">Complete</option>
                  </select>
                </label>
                <label>
                  <span>Vendor Ref / PO</span>
                  <input
                    value={orderDraft.vendorReference || ""}
                    onChange={(event) => setOrderDraft((current) => current ? { ...current, vendorReference: event.target.value } : current)}
                  />
                </label>
                <label>
                  <span>Carrier</span>
                  <input
                    value={orderDraft.shippingCarrier || ""}
                    onChange={(event) => setOrderDraft((current) => current ? { ...current, shippingCarrier: event.target.value } : current)}
                  />
                </label>
                <label>
                  <span>Tracking</span>
                  <input
                    value={orderDraft.trackingNumber || ""}
                    onChange={(event) => setOrderDraft((current) => current ? { ...current, trackingNumber: event.target.value } : current)}
                  />
                </label>
                <label>
                  <span>Shipped At</span>
                  <input
                    type="datetime-local"
                    value={datetimeInputValue(orderDraft.shippedAt)}
                    onChange={(event) => setOrderDraft((current) => current ? { ...current, shippedAt: isoFromDatetimeInput(event.target.value) } : current)}
                  />
                </label>
                <label className="vendor-order-update-note">
                  <span>Internal Note</span>
                  <textarea
                    value={orderDraft.note || ""}
                    onChange={(event) => setOrderDraft((current) => current ? { ...current, note: event.target.value } : current)}
                  />
                </label>
                <div className="vendor-order-update-actions">
                  <button className="btn btn-primary" type="button" disabled={!orderPatch || savingOrder} onClick={() => void saveOrderUpdate()}>
                    <Save size={16} aria-hidden="true" />
                    {savingOrder ? "Applying..." : "Apply to Assigned Lines"}
                  </button>
                </div>
              </div>
            </Panel>
          ) : null}

          <Panel title="Assigned Lines" subtitle="Only lines assigned to your vendor account are visible here." className="vendor-panel">
            <div className="vendor-lines-toolbar">
              <div className="vendor-lines-filters">
                <label className="vendor-lines-search">
                  <Search size={16} aria-hidden="true" />
                  <input
                    type="search"
                    value={lineSearch}
                    placeholder="Search lines, artwork, locations..."
                    onChange={(event) => {
                      setLineSearch(event.target.value);
                      setSelectedLineIds([]);
                    }}
                  />
                </label>
                <label className="vendor-lines-filter">
                  <span>Product</span>
                  <select
                    value={productFilter}
                    onChange={(event) => {
                      setProductFilter(event.target.value);
                      setSelectedLineIds([]);
                    }}
                  >
                    <option value="all">All Products</option>
                    {productOptions.map((product) => (
                      <option key={product} value={product}>{product}</option>
                    ))}
                  </select>
                </label>
                {showBulkLineTools ? (
                  <label className="vendor-select-all">
                    <input type="checkbox" checked={allLinesSelected} onChange={toggleAllLines} disabled={!visibleProductionEditableLineIds.size} />
                    <span>Select visible production-ready lines</span>
                  </label>
                ) : null}
              </div>
              <div className="vendor-line-buckets" aria-label="Line status buckets">
                {lineBuckets.map((bucket) => (
                  <button
                    key={bucket}
                    className={`vendor-line-bucket${lineBucket === bucket ? " is-active" : ""}`}
                    type="button"
                    onClick={() => {
                      setLineBucket(bucket);
                      setSelectedLineIds([]);
                    }}
                  >
                    <span>{lineBucketLabels[bucket]}</span>
                    <strong>{lineBucketCounts[bucket]}</strong>
                  </button>
                ))}
              </div>

              {bulkDraft && showBulkLineTools ? (
                <div className="vendor-lines-bulk-tools">
                  <div className="vendor-lines-selection">
                    <strong>{selectedLineCount}</strong>
                    <span>{selectedLineCount === 1 ? "line selected" : "lines selected"}</span>
                    {selectedLineCount ? (
                      <button className="btn btn-ghost btn-soft" type="button" onClick={() => setSelectedLineIds([])}>
                        Clear
                      </button>
                    ) : null}
                  </div>
                  <div className="vendor-bulk-update">
                    <label className="vendor-bulk-field">
                      <span>
                        <input
                          type="checkbox"
                          checked={bulkDraft.applyStatus}
                          disabled={!selectedLineCount}
                          onChange={(event) => setBulkDraft((current) => current ? { ...current, applyStatus: event.target.checked } : current)}
                        />
                        Status
                      </span>
                      <select
                        value={bulkDraft.productionStatus}
                        disabled={!selectedLineCount || !bulkDraft.applyStatus}
                        onChange={(event) => setBulkDraft((current) => current ? { ...current, productionStatus: event.target.value as ApiVendorProductionStatus } : current)}
                      >
                        <option value="not_started">Not Started</option>
                        <option value="in_production">In Production</option>
                        <option value="blocked">Blocked</option>
                        <option value="shipped">Shipped</option>
                        <option value="complete">Complete</option>
                      </select>
                    </label>
                    <label className="vendor-bulk-field">
                      <span>
                        <input
                          type="checkbox"
                          checked={bulkDraft.applyVendorReference}
                          disabled={!selectedLineCount}
                          onChange={(event) => setBulkDraft((current) => current ? { ...current, applyVendorReference: event.target.checked } : current)}
                        />
                        Vendor Ref / PO
                      </span>
                      <input
                        value={bulkDraft.vendorReference}
                        disabled={!selectedLineCount || !bulkDraft.applyVendorReference}
                        onChange={(event) => setBulkDraft((current) => current ? { ...current, vendorReference: event.target.value, applyVendorReference: true } : current)}
                      />
                    </label>
                    <label className="vendor-bulk-field">
                      <span>
                        <input
                          type="checkbox"
                          checked={bulkDraft.applyShippingCarrier}
                          disabled={!selectedLineCount}
                          onChange={(event) => setBulkDraft((current) => current ? { ...current, applyShippingCarrier: event.target.checked } : current)}
                        />
                        Carrier
                      </span>
                      <input
                        value={bulkDraft.shippingCarrier}
                        disabled={!selectedLineCount || !bulkDraft.applyShippingCarrier}
                        onChange={(event) => setBulkDraft((current) => current ? { ...current, shippingCarrier: event.target.value, applyShippingCarrier: true } : current)}
                      />
                    </label>
                    <label className="vendor-bulk-field">
                      <span>
                        <input
                          type="checkbox"
                          checked={bulkDraft.applyTrackingNumber}
                          disabled={!selectedLineCount}
                          onChange={(event) => setBulkDraft((current) => current ? { ...current, applyTrackingNumber: event.target.checked } : current)}
                        />
                        Tracking
                      </span>
                      <input
                        value={bulkDraft.trackingNumber}
                        disabled={!selectedLineCount || !bulkDraft.applyTrackingNumber}
                        onChange={(event) => setBulkDraft((current) => current ? { ...current, trackingNumber: event.target.value, applyTrackingNumber: true } : current)}
                      />
                    </label>
                    <label className="vendor-bulk-field">
                      <span>
                        <input
                          type="checkbox"
                          checked={bulkDraft.applyShippedAt}
                          disabled={!selectedLineCount}
                          onChange={(event) => setBulkDraft((current) => current ? { ...current, applyShippedAt: event.target.checked } : current)}
                        />
                        Shipped At
                      </span>
                      <input
                        type="datetime-local"
                        value={datetimeInputValue(bulkDraft.shippedAt)}
                        disabled={!selectedLineCount || !bulkDraft.applyShippedAt}
                        onChange={(event) => setBulkDraft((current) => current ? { ...current, shippedAt: isoFromDatetimeInput(event.target.value), applyShippedAt: true } : current)}
                      />
                    </label>
                    <label className="vendor-bulk-field vendor-bulk-note">
                      <span>
                        <input
                          type="checkbox"
                          checked={bulkDraft.applyNote}
                          disabled={!selectedLineCount}
                          onChange={(event) => setBulkDraft((current) => current ? { ...current, applyNote: event.target.checked } : current)}
                        />
                        Note
                      </span>
                      <input
                        value={bulkDraft.note}
                        disabled={!selectedLineCount || !bulkDraft.applyNote}
                        onChange={(event) => setBulkDraft((current) => current ? { ...current, note: event.target.value, applyNote: true } : current)}
                      />
                    </label>
                    <div className="vendor-bulk-actions">
                      <button className="btn btn-primary" type="button" disabled={!bulkPatch || savingBulk} onClick={() => void saveBulkUpdate()}>
                        <Save size={16} aria-hidden="true" />
                        {savingBulk ? "Applying..." : `Apply to ${selectedLineCount || 0}`}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
            <div className="vendor-lines">
              {visibleLines.map((line) => {
                const draft = drafts[line.id] || lineDraft(line);
                const changed = draftChanged(line, draft);
                const selected = selectedLineIdSet.has(line.id);
                const stage = proofStage(line);
                const canUpdateProduction = line.workflow.canUpdateProduction;
                const canSubmitProof = line.workflow.canSubmitProof;
                const primaryPrintRoute = isPrimaryPrintOrder(order);
                const proofVersions = line.proof?.proofVersions || [];
                const currentProofVersion = proofVersions.find((version) => version.current) || null;
                const directProofComments = line.proof?.proofComments || [];
                const proofComments = directProofComments.length ? directProofComments : currentProofVersion?.comments || [];
                const proofCommentCount = line.proof?.proofCommentCount || proofComments.length || 0;
                const proofCommentAttachmentCount = line.proof?.proofCommentAttachmentCount || proofComments.reduce((sum, comment) => sum + comment.attachments.length, 0);
                const artHistoryItems = buildVendorArtHistory(line);
                const liftLine = line.proof?.liftLineSnapshot || null;
                const liftShipping = line.liftShipping || null;
                const hasCurrentProofFile = Boolean(
                  currentProofVersion?.proofFilename ||
                  currentProofVersion?.proofFullUrl ||
                  currentProofVersion?.proofThumbUrl ||
                  line.proof?.fullUrl ||
                  line.proof?.thumbUrl ||
                  line.proof?.vendorFilename
                );
                const currentProofFilename = hasCurrentProofFile ? currentProofVersion?.proofFilename || proofDisplayName(line) : "No proof submitted";
                const currentProofStatus = hasCurrentProofFile ? proofStatusLabel(line.proof?.liftProofStatus || line.proof?.status) : "Waiting for Proof";
                const currentProofIsApproved = currentProofApproved(line, currentProofVersion);
                const locationDisplay = compactLocationList(line);
                const stagedProof = stagedProofs[line.id] || null;
                return (
                  <article key={line.id} className={`vendor-line-card${primaryPrintRoute ? " is-primary-sync" : ""}${selected ? " is-selected" : ""}${!canUpdateProduction ? " is-readonly" : ""}`}>
                    {!primaryPrintRoute ? (
                      <label className="vendor-line-select">
                        <input type="checkbox" checked={selected} disabled={!canUpdateProduction} onChange={() => toggleLineSelection(line.id)} />
                        <span>Select line</span>
                      </label>
                    ) : null}

                    <div className="vendor-line-main">
                      <div className="vendor-line-head">
                        <div>
                          <div className="vendor-line-title-row">
                            <h3>{line.productLabel}</h3>
                            {line.proof?.revised ? <span className="vendor-line-tag">Revised artwork</span> : null}
                          </div>
                        </div>
                        <span className={workflowClass(line.workflow.stage)}>{line.workflow.label || workflowLabels[line.workflow.stage]}</span>
                      </div>

                      {line.workflow.lockReason ? (
                        <div className="vendor-line-lock">{line.workflow.lockReason}</div>
                      ) : null}

                      <div className="vendor-line-meta">
                        <span><small>Qty</small>{line.quantity}</span>
                        <span title={locationDisplay.title}><small>Locations</small>{locationDisplay.label}</span>
                        <span><small>Proof</small>{proofStageLabels[stage]}</span>
                        {!primaryPrintRoute ? <span><small>Adspace Line</small>{vendorLineReference(line, primaryPrintRoute)}</span> : null}
                      </div>

                      {primaryPrintRoute ? (
                        <div className="vendor-lift-line-reference" aria-label="Lift line details">
                          <span><small>Line #</small>{vendorLineReference(line, primaryPrintRoute)}</span>
                          <span className="is-wide"><small>Product Name</small><strong title={liftLine?.productName || ""}>{syncedLiftValue(liftLine?.productName)}</strong></span>
                          <span><small>Line Step</small>{liftLineStepLabel(liftLine?.lineStepNumber ?? line.proof?.lineStepNumber)}</span>
                          <span><small>Material</small>{liftLine?.material || "—"}</span>
                          <span><small>Print Size</small>{formatLiftSize(liftLine?.printHeightIn, liftLine?.printWidthIn)}</span>
                          <span><small>Unit #</small>{liftLine?.unitNumber || "—"}</span>
                        </div>
                      ) : null}

                      {primaryPrintRoute && liftShipping ? (
                        <div className="vendor-lift-shipping-reference" aria-label="Lift shipping details">
                          <span><small>Ship Status</small><strong title={liftShipping.trackerMessage || ""}>{liftShipping.trackerShortMessage || "—"}</strong></span>
                          <span><small>Method</small>{liftShipping.shipMethod || "—"}</span>
                          <span><small>Tracking</small><strong title={liftShipping.trackingNumber || ""}>{liftShipping.trackingNumber || "—"}</strong></span>
                          <span><small>Ship Date</small>{formatDate(liftShipping.actualShipDate)}</span>
                          <span className="is-wide"><small>Destination</small><strong title={liftShippingDestination(line)}>{liftShippingDestination(line)}</strong></span>
                        </div>
                      ) : null}

                      <div className="vendor-line-section-title">Artwork & Proof</div>
                      <div className="vendor-proof-workflow">
                        <div className="vendor-proof-cell">
                          <small>Client Artwork</small>
                          {line.creative?.thumbUrl || line.creative?.fullUrl ? (
                            <button
                              className="vendor-proof-preview vendor-asset-preview"
                              type="button"
                              onClick={() => setLightbox({ url: line.creative?.fullUrl || line.creative?.thumbUrl || "", alt: line.creative?.filename || "Artwork" })}
                            >
                              <img src={line.creative.thumbUrl || line.creative.fullUrl || ""} alt={line.creative.filename} />
                            </button>
                          ) : (
                            <div className="vendor-asset-placeholder">Artwork pending</div>
                          )}
                          <strong>{line.creative?.filename || "Pending"}</strong>
                          {line.creative?.uploadedAt ? <p>Uploaded {formatDate(line.creative.uploadedAt, true)}</p> : null}
                          {line.creative?.fullUrl ? (
                            <button className="btn btn-ghost btn-soft" type="button" onClick={() => triggerBrowserDownload(line.creative?.fullUrl || "", line.creative?.filename || "artwork")}>
                              <Download size={15} aria-hidden="true" />
                              Download Artwork
                            </button>
                          ) : null}
                        </div>
                        <div className="vendor-proof-cell">
                          <div className="vendor-proof-cell-head">
                            <small>Vendor Proof</small>
                            <span>{proofSourceLabel(line)}</span>
                          </div>
                          {line.proof?.thumbUrl || line.proof?.fullUrl ? (
                            <button
                              className="vendor-proof-preview"
                              type="button"
                              onClick={() => setLightbox({ url: line.proof?.fullUrl || line.proof?.thumbUrl || "", alt: proofDisplayName(line) })}
                            >
                              <img src={line.proof.thumbUrl || line.proof.fullUrl || ""} alt={proofDisplayName(line)} />
                            </button>
                          ) : null}
                          <strong>{line.proof?.fullUrl || line.proof?.thumbUrl ? proofDisplayName(line) : "Not Submitted"}</strong>
                          {currentProofVersion?.createdAt ? <p>{proofTimestampLabel(line)} {formatDate(currentProofVersion.createdAt, true)}</p> : null}
                          {line.proof?.vendorSubmittedAt ? (
                            <p>
                              Submitted {formatDate(line.proof.vendorSubmittedAt, true)}
                              {line.proof.vendorSubmittedByName ? ` by ${line.proof.vendorSubmittedByName}` : ""}
                            </p>
                          ) : null}
                          {line.proof?.vendorNote ? <p>{line.proof.vendorNote}</p> : null}
                          {line.proof?.printTeamFeedback && stage === "revised_artwork_submitted" ? (
                            <p className="vendor-proof-feedback">Revision note: {line.proof.printTeamFeedback}</p>
                          ) : null}
                          {line.proof?.fullUrl ? (
                            <a className="btn btn-ghost btn-soft" href={line.proof.fullUrl} target="_blank" rel="noreferrer">
                              <ExternalLink size={15} aria-hidden="true" />
                              Open Proof
                            </a>
                          ) : null}
                          {!primaryPrintRoute && line.proofLineId && line.proof?.status !== "approved" && canSubmitProof ? (
                            <div
                              className={`vendor-proof-submit${stagedProof ? " is-staged" : " is-idle"}`}
                              onDragOver={(event) => {
                                event.preventDefault();
                              }}
                              onDrop={(event) => {
                                event.preventDefault();
                                const file = event.dataTransfer.files?.[0];
                                if (file) void stageVendorProof(file, line);
                              }}
                            >
                              {stagedProof ? (
                                <>
                                  <div className="vendor-staged-proof">
                                    <div className={`vendor-staged-proof-thumb ${stagedProof.previewUrl ? "has-preview" : ""}`}>
                                      {stagedProof.previewUrl ? (
                                        <img src={stagedProof.previewUrl} alt="" />
                                      ) : (
                                        <span>{stagedProof.previewReady ? stagedProof.previewKind.toUpperCase() : "..."}</span>
                                      )}
                                    </div>
                                    <div className="vendor-staged-proof-copy">
                                      <strong title={stagedProof.filename}>{stagedProof.filename}</strong>
                                      <span>{formatVendorFileSize(stagedProof.sizeBytes) || "Ready to submit"}</span>
                                    </div>
                                  </div>
                                  <textarea
                                    value={proofNotes[line.id] || ""}
                                    placeholder="Add a note to the customer with this proof"
                                    onChange={(event) => setProofNotes((current) => ({ ...current, [line.id]: event.target.value }))}
                                  />
                                </>
                              ) : null}
                              <div className="vendor-proof-submit-actions">
                                {stagedProof ? (
                                  <>
                                    <button
                                      className="btn btn-primary"
                                      type="button"
                                      disabled={uploadingProofLineId === line.id}
                                      onClick={() => void uploadVendorProof(line)}
                                    >
                                      <Upload size={15} aria-hidden="true" />
                                      {uploadingProofLineId === line.id ? "Submitting..." : line.proof?.fullUrl ? "Submit Replacement Proof" : "Submit Proof"}
                                    </button>
                                    <button className="btn btn-ghost btn-soft" type="button" disabled={uploadingProofLineId === line.id} onClick={() => clearStagedVendorProof(line.id)}>
                                      Cancel
                                    </button>
                                  </>
                                ) : (
                                  <label className={`btn btn-ghost btn-soft vendor-proof-upload${uploadingProofLineId === line.id ? " is-loading" : ""}`}>
                                    <Upload size={15} aria-hidden="true" />
                                    {line.proof?.fullUrl ? "Select Replacement Proof" : "Select Proof File"}
                                    <input
                                      type="file"
                                      accept="application/pdf,image/*"
                                      disabled={uploadingProofLineId === line.id || !canSubmitProof}
                                      onChange={(event) => {
                                        const file = event.currentTarget.files?.[0];
                                        event.currentTarget.value = "";
                                        if (file) void stageVendorProof(file, line);
                                      }}
                                    />
                                  </label>
                                )}
                              </div>
                            </div>
                          ) : null}
                        </div>
                        <div className="vendor-proof-cell vendor-proof-cell-wide">
                          <div className="vendor-approval-card-head">
                            <small>Client Approval</small>
                            <span className={proofStageClass(stage)}>{proofStageLabels[stage]}</span>
                          </div>
                          <strong>{clientApprovalSummary(stage, primaryPrintRoute)}</strong>
                          <div className="vendor-approval-feed" aria-label="Client approval details">
                            <div className="vendor-approval-feed-row">
                              <span>Current proof</span>
                              <strong title={currentProofFilename}>{currentProofFilename}</strong>
                              <small>
                                <em>{currentProofStatus}</em>
                                {currentProofIsApproved && line.proof?.proofApprovedDate ? <em>Approved {formatDate(line.proof.proofApprovedDate, true)}</em> : null}
                              </small>
                            </div>
                            {proofCommentCount ? (
                              <div className="vendor-approval-feed-row">
                                <span>Proof notes</span>
                                <button
                                  className="vendor-proof-notes-button"
                                  type="button"
                                  onClick={() => setProofNotesModal({
                                    title: `${line.productLabel} · ${vendorLineReference(line, primaryPrintRoute)}`,
                                    comments: proofComments,
                                    feedback: line.proof?.printTeamFeedback || null,
                                  })}
                                >
                                  <MessageSquare size={14} aria-hidden="true" />
                                  {proofCommentCount} comment{proofCommentCount === 1 ? "" : "s"}
                                  {proofCommentAttachmentCount ? (
                                    <>
                                      <Paperclip size={13} aria-hidden="true" />
                                      {proofCommentAttachmentCount}
                                    </>
                                  ) : null}
                                </button>
                              </div>
                            ) : null}
                            {line.proof?.printTeamFeedback ? (
                              <div className="vendor-approval-feed-row">
                                <span>Latest feedback</span>
                                <button
                                  className="vendor-proof-notes-button"
                                  type="button"
                                  onClick={() => setProofNotesModal({
                                    title: `${line.productLabel} · ${vendorLineReference(line, primaryPrintRoute)}`,
                                    comments: proofComments,
                                    feedback: line.proof?.printTeamFeedback || null,
                                  })}
                                >
                                  <MessageSquare size={14} aria-hidden="true" />
                                  View feedback
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      <div className="vendor-line-proof-history">
                        {artHistoryItems.length ? (
                          <details className="vendor-art-history-details">
                            <summary>
                              <FileClock size={15} aria-hidden="true" />
                              Art History
                              <span>{artHistoryItems.length}</span>
                            </summary>
                            <div className="vendor-art-history-list">
                              {artHistoryItems.map((item) => (
                                <div key={item.key} className={item.currentClient || item.currentProof ? "is-current" : ""}>
                                  {item.fullUrl || item.thumbUrl ? (
                                    <button
                                      className="vendor-art-history-thumb"
                                      type="button"
                                      onClick={() => setLightbox({ url: item.fullUrl || item.thumbUrl || "", alt: item.filename })}
                                    >
                                      <img src={item.thumbUrl || item.fullUrl || ""} alt={item.filename} />
                                    </button>
                                  ) : (
                                    <span className="vendor-art-history-thumb" aria-hidden="true">
                                      <FileClock size={15} />
                                    </span>
                                  )}
                                  <div className="vendor-art-history-content">
                                    <div className="vendor-art-history-top">
                                      <strong title={item.filename}>{item.filename}</strong>
                                      <span>{item.kind === "client_upload" ? "Client upload" : "Proof upload"}</span>
                                    </div>
                                    <small>{[formatDate(item.at, true), item.actor].filter((value) => value && value !== "—").join(" · ") || "Timestamp pending"}</small>
                                    <div className="vendor-art-history-tags">
                                      {item.currentClient ? <em className="is-current-tag">Current client upload</em> : null}
                                      {item.currentProof ? <em className="is-current-tag">Current proof</em> : null}
                                      {item.status && item.status !== "—" ? <em>{item.status}</em> : null}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </details>
                        ) : null}
                        <details className="vendor-line-tech-details">
                          <summary>
                            <Info size={15} aria-hidden="true" />
                            Technical Details
                          </summary>
                          <dl>
                            <div><dt>Lift order line ID</dt><dd>{line.liftOrderLineId || "—"}</dd></div>
                            <div><dt>Proof attachment ID</dt><dd>{line.liftProofingId || "—"}</dd></div>
                            <div><dt>Proof line ID</dt><dd>{line.proofLineId || "—"}</dd></div>
                            <div><dt>Line step</dt><dd>{liftLineStepLabel(liftLineSnapshotStep(line))}</dd></div>
                            <div><dt>Line step ID</dt><dd>{liftLine?.lineStepId ?? "—"}</dd></div>
                            <div><dt>Product name</dt><dd>{liftLine?.productName || "—"}</dd></div>
                            <div><dt>Material</dt><dd>{liftLine?.material || "—"}</dd></div>
                          </dl>
                        </details>
                      </div>

                      {!primaryPrintRoute ? (
                        <>
                          <div className="vendor-line-section-title">Production & Shipping</div>
                          <div className="vendor-line-form">
                            <label>
                              <span>Status</span>
                              <select
                                value={draft.productionStatus}
                                disabled={!canUpdateProduction}
                                onChange={(event) => setDrafts((current) => ({ ...current, [line.id]: { ...draft, productionStatus: event.target.value as ApiVendorProductionStatus } }))}
                              >
                                <option value="not_started">Not Started</option>
                                <option value="in_production">In Production</option>
                                <option value="blocked">Blocked</option>
                                <option value="shipped">Shipped</option>
                                <option value="complete">Complete</option>
                              </select>
                            </label>
                            <label>
                              <span>Vendor Ref / PO</span>
                              <input disabled={!canUpdateProduction} value={draft.vendorReference || ""} onChange={(event) => setDrafts((current) => ({ ...current, [line.id]: { ...draft, vendorReference: event.target.value } }))} />
                            </label>
                            <label>
                              <span>Carrier</span>
                              <input disabled={!canUpdateProduction} value={draft.shippingCarrier || ""} onChange={(event) => setDrafts((current) => ({ ...current, [line.id]: { ...draft, shippingCarrier: event.target.value } }))} />
                            </label>
                            <label>
                              <span>Tracking</span>
                              <input disabled={!canUpdateProduction} value={draft.trackingNumber || ""} onChange={(event) => setDrafts((current) => ({ ...current, [line.id]: { ...draft, trackingNumber: event.target.value } }))} />
                            </label>
                            <label>
                              <span>Shipped At</span>
                              <input
                                type="datetime-local"
                                disabled={!canUpdateProduction}
                                value={datetimeInputValue(draft.shippedAt)}
                                onChange={(event) => setDrafts((current) => ({ ...current, [line.id]: { ...draft, shippedAt: isoFromDatetimeInput(event.target.value) } }))}
                              />
                            </label>
                            <label className="vendor-line-note">
                              <span>Internal Note</span>
                              <textarea disabled={!canUpdateProduction} value={draft.note || ""} onChange={(event) => setDrafts((current) => ({ ...current, [line.id]: { ...draft, note: event.target.value } }))} />
                            </label>
                          </div>

                          <div className="vendor-line-actions">
                            <button className="btn btn-primary" type="button" disabled={!canUpdateProduction || !changed || savingLineId === line.id} onClick={() => void saveLine(line)}>
                              <Save size={16} aria-hidden="true" />
                              {savingLineId === line.id ? "Saving..." : changed ? "Save Line" : "Saved"}
                            </button>
                          </div>
                        </>
                      ) : null}
                    </div>
                  </article>
                );
              })}
              {!visibleLines.length ? (
                <div className="vendor-empty">No assigned lines match the current filters.</div>
              ) : null}
            </div>
          </Panel>

          <Panel title="Activity" subtitle="Vendor-visible internal activity for this order." className="vendor-panel">
            {!order.activity.length ? <div className="vendor-empty vendor-empty-compact">No vendor activity yet.</div> : null}
            <div className="vendor-activity">
              {order.activity.map((event, index) => (
                <div key={`${event.createdAt}-${index}`} className="vendor-activity-row">
                  <span>{formatDate(event.createdAt, true)}</span>
                  <strong>{event.actorName}</strong>
                  <p>
                    <b>{humanizeEventType(event.eventType)}</b>
                    {describeActivity(event)}
                  </p>
                </div>
              ))}
            </div>
          </Panel>
        </>
      ) : null}

      {lightbox ? (
        <Lightbox isOpen src={lightbox.url} title={lightbox.alt} onClose={() => setLightbox(null)} />
      ) : null}

      {proofNotesModal ? (
        <div className="vendor-modal-backdrop" role="presentation" onClick={() => setProofNotesModal(null)}>
          <section className="vendor-proof-notes-modal" role="dialog" aria-modal="true" aria-label="Proof notes" onClick={(event) => event.stopPropagation()}>
            <header>
              <div>
                <small>Proof Notes</small>
                <h2>{proofNotesModal.title}</h2>
              </div>
              <button className="btn btn-ghost btn-soft" type="button" onClick={() => setProofNotesModal(null)}>Close</button>
            </header>
            <div className="vendor-proof-notes-list">
              {proofNotesModal.feedback ? (
                <article>
                  <strong>Latest feedback</strong>
                  <p>{proofNotesModal.feedback}</p>
                </article>
              ) : null}
              {proofNotesModal.comments.map((comment) => (
                <article key={comment.id}>
                  <strong>{formatDate(comment.createdAt, true) || "Proof comment"}</strong>
                  {comment.body ? <p>{comment.body}</p> : null}
                  {comment.attachments.length ? (
                    <div>
                      {comment.attachments.map((attachment, attachmentIndex) => (
                        <a key={`${comment.id}-${attachment.url || attachmentIndex}`} href={attachment.url} target="_blank" rel="noreferrer">
                          <Paperclip size={14} aria-hidden="true" />
                          {attachment.filename || `Attachment ${attachmentIndex + 1}`}
                        </a>
                      ))}
                    </div>
                  ) : null}
                </article>
              ))}
              {!proofNotesModal.feedback && !proofNotesModal.comments.length ? (
                <p className="vendor-empty vendor-empty-compact">No proof notes or attachments are available for this line.</p>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </AppShell>
  );
}
