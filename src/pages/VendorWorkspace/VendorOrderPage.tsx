import { useEffect, useMemo, useState } from "react";
import { Download, ExternalLink, MapPin, PackageCheck, Save, Search, Upload } from "lucide-react";
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
  | "revision_requested"
  | "client_approved"
  | "production_ready";

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

function workflowClass(stage: ApiVendorWorkflowStage) {
  return `vendor-status vendor-workflow-${stage}`;
}

function isPrimaryPrintOrder(order: ApiVendorOrderDetail) {
  return order.integrationHealth.route === "primary_print_vendor";
}

function routeLabel(order: ApiVendorOrderDetail) {
  return isPrimaryPrintOrder(order) ? "Lift-backed primary print" : "Adspace-managed vendor";
}

function vendorLineReference(line: ApiVendorOrderLine, primaryPrintRoute: boolean) {
  if (primaryPrintRoute) return line.liftOrderLineId || "—";
  return line.lineNumber ? `Line ${line.lineNumber}` : line.id.replace(/^(proof|override|assignment)_/, "");
}

const proofStageLabels: Record<VendorProofStage, string> = {
  artwork_pending: "Artwork Pending",
  needs_proof: "Needs Vendor Proof",
  vendor_submitted: "Vendor Proof Submitted",
  client_review: "Client Review",
  revision_requested: "Revision Requested",
  client_approved: "Client Approved",
  production_ready: "Production Ready",
};

function proofStage(line: ApiVendorOrderLine): VendorProofStage {
  if (
    line.workflow.stage === "production_ready" ||
    line.workflow.stage === "in_production" ||
    line.workflow.stage === "shipped" ||
    line.workflow.stage === "complete"
  ) return "production_ready";
  if (line.proof?.status === "approved") return "client_approved";
  if (line.proof?.revised || (line.proof?.status === "waiting" && line.proof?.vendorSubmittedAt)) return "revision_requested";
  if (line.proof?.vendorSubmittedAt) return "vendor_submitted";
  if (line.proof?.fullUrl || line.proof?.thumbUrl || line.proof?.liftProofStatus || line.proof?.status === "pending") return "client_review";
  if (line.creative?.fullUrl || line.creative?.thumbUrl) return "needs_proof";
  return "artwork_pending";
}

function proofStageClass(stage: VendorProofStage) {
  return `vendor-proof-status vendor-proof-status-${stage}`;
}

function proofStatusLabel(value?: string | null) {
  if (!value) return "—";
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function proofDisplayName(line: ApiVendorOrderLine) {
  return line.proof?.vendorFilename || line.creative?.filename || "Vendor proof";
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

function formatBytes(value?: number | null) {
  if (!value) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
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
  const [savingLineId, setSavingLineId] = useState<string | null>(null);
  const [savingOrder, setSavingOrder] = useState(false);
  const [savingBulk, setSavingBulk] = useState(false);
  const [packageGenerating, setPackageGenerating] = useState(false);
  const [uploadingProofLineId, setUploadingProofLineId] = useState<string | null>(null);
  const [proofNotes, setProofNotes] = useState<Record<string, string>>({});
  const [lightbox, setLightbox] = useState<{ url: string; alt: string } | null>(null);
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

  const latestPackage = useMemo(
    () => order?.documents.filter((document) => document.category === "order_package")[0] || null,
    [order]
  );
  const packageActionLabel = latestPackage ? "Regenerate Package" : "Generate Package";
  const productOptions = useMemo(() => {
    const names = new Set((order?.lines || []).map((line) => line.productLabel).filter(Boolean));
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [order]);
  const visibleLines = useMemo(() => {
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
        line.proofLineId,
        proofStageLabels[proofStage(line)],
        line.workflow.label,
        line.inventory.map((item) => item.inventoryId).join(" "),
      ].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(query);
    });
  }, [lineSearch, order, productFilter]);
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
      revisionRequested: stages.filter((stage) => stage === "revision_requested").length,
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
  const proofActionTotal = proofSummary.artworkPending + proofSummary.needsProof + proofSummary.revisionRequested;
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
      const refreshed = await fetchVendorOrder(api, order.id);
      setOrder(refreshed.order);
      setDrafts(Object.fromEntries(refreshed.order.lines.map((line) => [line.id, lineDraft(line)])));
      setOrderDraft(defaultOrderDraft(refreshed.order));
      setBulkDraft(defaultBulkDraft(refreshed.order));
      setFeedback("Vendor package generated and download started.");
    } catch (packageError) {
      console.error("Failed to generate vendor package", packageError);
      setError("We could not generate the vendor package.");
    } finally {
      setPackageGenerating(false);
    }
  }

  async function uploadVendorProof(file: File, line: ApiVendorOrderLine) {
    if (!order) return;
    if (!line.workflow.canSubmitProof) {
      setError(line.workflow.lockReason || "Proof upload is not available for this line yet.");
      return;
    }
    if (!line.proofLineId) {
      setError("This line is not linked to an Adspace proof line yet.");
      return;
    }
    const filename = sanitizeFilename(file.name || "vendor-proof");
    const note = (proofNotes[line.id] || "").trim();
    const contentType = file.type || "application/octet-stream";
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
        sizeBytes: file.size,
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
            <button className="btn btn-primary" type="button" onClick={() => void generatePackage()} disabled={packageGenerating || !order.summary.workflow.canGeneratePackage}>
              <Download size={16} aria-hidden="true" />
              {packageGenerating ? "Generating..." : packageActionLabel}
            </button>
          ) : null
        }
      />

      {loading ? <div className="vendor-empty">Loading vendor order...</div> : null}
      {error ? <div className="vendor-error">{error}</div> : null}
      {feedback ? <div className="vendor-feedback">{feedback}</div> : null}

      {order ? (
        <>
          {order.summary.workflow.lockReason ? (
            <div className="vendor-workflow-banner">
              <strong>{order.summary.workflow.label || workflowLabels[order.summary.workflow.stage]}</strong>
              <span>{order.summary.workflow.lockReason}</span>
            </div>
          ) : null}
          <div className="vendor-order-overview">
            <Panel title="Job Brief" className="vendor-panel vendor-panel-job">
              <div className="vendor-job-brief">
                <div className="vendor-detail-grid">
                  <span><small>Customer</small>{order.project.customerName}</span>
                  <span><small>Venue</small>{order.project.venueName}</span>
                  <span><small>PO</small>{order.project.poNumber || "—"}</span>
                  <span><small>Contract</small>{order.project.contractNumber || "—"}</span>
                  <span><small>Artwork Due</small>{formatDate(order.project.artworkDueDate)}</span>
                  <span><small>Post Date</small>{formatDate(order.project.postDate)}</span>
                </div>
                <div className={`vendor-ship-to ${order.shippingDestination.configured ? "" : "is-missing"}`}>
                  <MapPin size={20} aria-hidden="true" />
                  <div>
                    <strong>{order.shippingDestination.configured ? order.shippingDestination.label || order.shippingDestination.company || "Configured destination" : "Shipping destination not configured"}</strong>
                    <small>{order.shippingDestination.sourceLabel}</small>
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

            <Panel title="Current State" subtitle={proofActionTotal ? `${proofActionTotal} proof action ${proofActionTotal === 1 ? "item" : "items"}` : "No proof blockers"} className="vendor-panel">
              <div className="vendor-health">
                <span className={workflowClass(order.summary.workflow.stage)}>{order.summary.workflow.label || workflowLabels[order.summary.workflow.stage]}</span>
                <div>
                  <strong>{routeLabel(order)}</strong>
                  <p>
                    {isPrimaryPrintOrder(order)
                      ? order.integrationHealth.liftSync?.label || "No Lift sync state available yet."
                      : "This vendor route is managed in Adspace and is not connected to Lift order/proof sync."}
                  </p>
                  <small>
                    {isPrimaryPrintOrder(order)
                      ? "Healing and resubmission actions are managed by Adspace operators."
                      : "Use AS360 order, PO, and contract references for this vendor work."}
                  </small>
                </div>
              </div>
              <div className="vendor-proof-summary" aria-label="Proofing status">
                {proofSummaryItems.map((item) => (
                  <span key={item.label} className={item.value ? "" : "is-empty"}>
                    <small>{item.label}</small>
                    <strong>{item.value}</strong>
                  </span>
                ))}
              </div>
              <div className="vendor-state-package">
                <PackageCheck size={18} aria-hidden="true" />
                <div>
                  <strong>{latestPackage ? latestPackage.filename : "Package not generated"}</strong>
                  <p>
                    {latestPackage
                      ? `${formatDate(latestPackage.createdAt, true)} · ${formatBytes(latestPackage.sizeBytes)}`
                      : "Scoped artwork ZIP and manifests."}
                  </p>
                </div>
                {latestPackage ? (
                  <button className="btn btn-ghost btn-soft" type="button" onClick={() => triggerBrowserDownload(latestPackage.fullUrl, latestPackage.filename)}>
                    <Download size={16} aria-hidden="true" />
                    Download
                  </button>
                ) : null}
              </div>
            </Panel>
          </div>

          {orderDraft && order.summary.workflow.canUpdateProduction ? (
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
                    onChange={(event) => setLineSearch(event.target.value)}
                  />
                </label>
                <label className="vendor-lines-filter">
                  <span>Product</span>
                  <select value={productFilter} onChange={(event) => setProductFilter(event.target.value)}>
                    <option value="all">All Products</option>
                    {productOptions.map((product) => (
                      <option key={product} value={product}>{product}</option>
                    ))}
                  </select>
                </label>
                {productionEditableLineIds.size ? (
                  <label className="vendor-select-all">
                    <input type="checkbox" checked={allLinesSelected} onChange={toggleAllLines} disabled={!visibleProductionEditableLineIds.size} />
                    <span>Select visible production-ready lines</span>
                  </label>
                ) : null}
              </div>

              {bulkDraft && productionEditableLineIds.size ? (
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
                return (
                  <article key={line.id} className={`vendor-line-card${selected ? " is-selected" : ""}${!canUpdateProduction ? " is-readonly" : ""}`}>
                    <label className="vendor-line-select">
                      <input type="checkbox" checked={selected} disabled={!canUpdateProduction} onChange={() => toggleLineSelection(line.id)} />
                      <span>Select line</span>
                    </label>
                    <div className="vendor-line-media">
                      {line.creative?.thumbUrl || line.creative?.fullUrl ? (
                        <button
                          type="button"
                          onClick={() => setLightbox({ url: line.creative?.fullUrl || line.creative?.thumbUrl || "", alt: line.creative?.filename || "Artwork" })}
                        >
                          <img src={line.creative.thumbUrl || line.creative.fullUrl || ""} alt={line.creative.filename} />
                        </button>
                      ) : (
                        <div className="vendor-line-placeholder">Artwork</div>
                      )}
                    </div>

                    <div className="vendor-line-main">
                      <div className="vendor-line-head">
                        <div>
                          <h3>{line.productLabel}</h3>
                          <p>{line.creative?.filename || "Artwork file pending"}</p>
                        </div>
                        <span className={workflowClass(line.workflow.stage)}>{line.workflow.label || workflowLabels[line.workflow.stage]}</span>
                      </div>

                      {line.workflow.lockReason ? (
                        <div className="vendor-line-lock">{line.workflow.lockReason}</div>
                      ) : null}

                      <div className="vendor-line-meta">
                        <span><small>Qty</small>{line.quantity}</span>
                        <span><small>Locations</small>{line.inventory.map((item) => item.inventoryId).join(", ") || "—"}</span>
                        <span><small>Proof</small>{proofStageLabels[stage]}</span>
                        <span><small>{primaryPrintRoute ? "Lift Line" : "Adspace Line"}</small>{vendorLineReference(line, primaryPrintRoute)}</span>
                      </div>

                      <div className="vendor-proof-workflow">
                        <div className="vendor-proof-cell">
                          <small>Client Artwork</small>
                          <strong>{line.creative?.filename || "Pending"}</strong>
                          {line.creative?.fullUrl ? (
                            <button className="btn btn-ghost btn-soft" type="button" onClick={() => triggerBrowserDownload(line.creative?.fullUrl || "", line.creative?.filename || "artwork")}>
                              <Download size={15} aria-hidden="true" />
                              Artwork
                            </button>
                          ) : null}
                        </div>
                        <div className="vendor-proof-cell">
                          <small>Vendor Proof</small>
                          <strong>{line.proof?.fullUrl ? proofDisplayName(line) : "Not Submitted"}</strong>
                          {line.proof?.vendorSubmittedAt ? (
                            <p>
                              Submitted {formatDate(line.proof.vendorSubmittedAt, true)}
                              {line.proof.vendorSubmittedByName ? ` by ${line.proof.vendorSubmittedByName}` : ""}
                            </p>
                          ) : null}
                          {line.proof?.vendorNote ? <p>{line.proof.vendorNote}</p> : null}
                          {line.proof?.printTeamFeedback && stage === "revision_requested" ? (
                            <p className="vendor-proof-feedback">Revision note: {line.proof.printTeamFeedback}</p>
                          ) : null}
                          {line.proof?.fullUrl ? (
                            <a className="btn btn-ghost btn-soft" href={line.proof.fullUrl} target="_blank" rel="noreferrer">
                              <ExternalLink size={15} aria-hidden="true" />
                              Proof
                            </a>
                          ) : null}
                          {line.proofLineId && line.proof?.status !== "approved" && canSubmitProof ? (
                            <div className="vendor-proof-submit">
                              <textarea
                                value={proofNotes[line.id] || ""}
                                placeholder="Proof note"
                                onChange={(event) => setProofNotes((current) => ({ ...current, [line.id]: event.target.value }))}
                              />
                              <label className={`btn btn-primary vendor-proof-upload${uploadingProofLineId === line.id ? " is-loading" : ""}`}>
                                <Upload size={15} aria-hidden="true" />
                                {uploadingProofLineId === line.id ? "Uploading..." : line.proof?.fullUrl ? "Replace Proof" : "Upload Proof"}
                                <input
                                  type="file"
                                  accept="application/pdf,image/*"
                                  disabled={uploadingProofLineId === line.id || !canSubmitProof}
                                  onChange={(event) => {
                                    const file = event.currentTarget.files?.[0];
                                    event.currentTarget.value = "";
                                    if (file) void uploadVendorProof(file, line);
                                  }}
                                />
                              </label>
                            </div>
                          ) : null}
                        </div>
                        <div className="vendor-proof-cell vendor-proof-cell-wide">
                          <small>Client Approval</small>
                          <span className={proofStageClass(stage)}>{proofStageLabels[stage]}</span>
                          <p>
                            {primaryPrintRoute
                              ? `Lift proof ${line.liftProofingId || "—"} · ${proofStatusLabel(line.proof?.liftProofStatus || line.proof?.status)}`
                              : `Adspace proof line ${line.lineNumber || "—"} · ${proofStatusLabel(line.proof?.status)}`}
                          </p>
                        </div>
                      </div>

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
                        {line.proof?.fullUrl ? (
                          <a className="btn btn-ghost btn-soft" href={line.proof.fullUrl} target="_blank" rel="noreferrer">
                            <ExternalLink size={16} aria-hidden="true" />
                            Open Proof
                          </a>
                        ) : null}
                        <button className="btn btn-primary" type="button" disabled={!canUpdateProduction || !changed || savingLineId === line.id} onClick={() => void saveLine(line)}>
                          <Save size={16} aria-hidden="true" />
                          {savingLineId === line.id ? "Saving..." : changed ? "Save Line" : "Saved"}
                        </button>
                      </div>
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
    </AppShell>
  );
}
