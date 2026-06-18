// src/components/reviewAllocation/ReviewAllocationModal.tsx
import { useEffect, useMemo, useState, useRef } from "react";
import Portal from "../common/Portal";
import Lightbox from "../common/Lightbox";
import { useApiClient } from "../../api/useApiClient";
import { logProjectErrorEvent, previewProjectOrderSubmission, submitProjectOrder, type ApiLiftPayloadPreview } from "../../api/projects";

import type { MapLayer, CreativeAsset, InventoryItem as LegacyInventoryItem, MediaVariant } from "../../logic/mockAssignment";
import { mediaLabelFromKey } from "../../logic/mockAssignment";
import { buildDocumentThumbUrl } from "../../logic/imageUrls";

import { buildCreateOrderPayload } from "../../logic/orderBuilder";
import { submitOrderToLiftStub } from "../../logic/submitOrder";

import { demoStore, useDemoStore } from "../../domain/store/demoStore";

import { getCreativeDisplayAssets } from "../../domain/selectors/displayAsset";
import { buildInventoryDisplayIdMap, getInventoryStableId, toDomainInventoryFromLegacy } from "../../logic/inventoryIdentity";

import type {
  Creative as DomainCreative,
  InventoryItem as DomainInventoryItem,
  Assignment as DomainAssignment,
  ProjectScope,
} from "../../domain/types";

import {
  getAllocationCompleteness,
  buildVariantSections,
  buildMapSummary,
  buildVariantSummary,
  buildInventoryListRows,
} from "../../domain/selectors/allocationSelectors";

export type ProjectMeta = {
  id: string;
  title: string;
  venueName: string;
  customerName: string;
  projectMode?: "live" | "internal_sandbox";
  sourceCustomerName?: string;
  artworkDueDate?: string;
  postDate?: string;
  orderNumber?: string;
  extId?: string;
  poNumber?: string;
  contractNumber?: string;
  termsOfSubmissionText: string;
};

type Props = {
  isOpen: boolean;
  onClose: () => void;

  project: ProjectMeta;
  maps: MapLayer[];

  // Legacy props (non-demo transitional)
  creatives: CreativeAsset[];
  inventory: LegacyInventoryItem[];
  variantCatalog?: MediaVariant[];

  onDownloadPdf?: () => void;
  canSubmitOrder?: boolean;
  onRequestSubmitOrder?: (submit: () => void) => void;
  onSubmitted?: (result: {
    liftOrderId: string;
    submittedAt: string;
    submittedByName: string;
    note?: string | null;
  }) => void;

  // Optional: navigate back to hub after submit
  onAfterSubmit?: () => void;
};

export default function ReviewAllocationModal({
  isOpen,
  onClose,
  project,
  maps,
  creatives,
  inventory,
  variantCatalog,
  onDownloadPdf,
  canSubmitOrder = true,
  onRequestSubmitOrder,
  onAfterSubmit,
  onSubmitted,
}: Props) {
  const api = useApiClient();
  const isDemo = project.id === "demo_001";
  const isShareMode = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("share");
  const [submittedOrderNumber, setSubmittedOrderNumber] = useState<string | null>(null);
  const isSubmittedContext = !!(project.orderNumber || submittedOrderNumber);

  useEffect(() => {
    if (isDemo && isOpen) demoStore.actions.hydrateDemo();
  }, [isDemo, isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }

    const scrollY = window.scrollY;
    const shouldFixBody =
      window.matchMedia?.("(pointer: coarse)").matches ||
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const prevOverflow = document.body.style.overflow;
    const prevPosition = document.body.style.position;
    const prevTop = document.body.style.top;
    const prevWidth = document.body.style.width;

    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    if (shouldFixBody) {
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
      if (shouldFixBody) window.scrollTo(0, scrollY);
    };
  }, [isOpen, onClose]);

  // UI state
  const [tab, setTab] = useState<"details" | "inventory" | "summary" | "submit">("details");
  const [termsChecked, setTermsChecked] = useState(false);
  const [submissionNote, setSubmissionNote] = useState("");
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [submitPreview, setSubmitPreview] = useState<ApiLiftPayloadPreview | null>(null);
  const [submitPreviewLoading, setSubmitPreviewLoading] = useState(false);
  const [submitPreviewError, setSubmitPreviewError] = useState<string | null>(null);
  const [submitPreviewSavedAt, setSubmitPreviewSavedAt] = useState<string | null>(null);
  
  const [redirectSeconds, setRedirectSeconds] = useState<number | null>(null);
  const redirectTimerRef = useRef<number | null>(null);

	function cancelRedirect() {
	  if (redirectTimerRef.current) window.clearInterval(redirectTimerRef.current);
	  redirectTimerRef.current = null;
	  setRedirectSeconds(null);
	}

  useEffect(() => {
    if (!isOpen) return;
    setSubmitSuccess(false);
    setSubmittedOrderNumber(project.orderNumber || null);
    setSubmitPreview(null);
    setSubmitPreviewError(null);
    setSubmitPreviewSavedAt(null);
  }, [isOpen, project.orderNumber]);
  
  useEffect(() => {
    if (!isOpen) cancelRedirect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const [lb, setLb] = useState<{
    src: string;
    fallbackSrc?: string;
    title?: string;
    subtitle?: string;
    openUrl?: string;
    assetType?: "image" | "document";
  } | null>(null);

  // Demo store reads (stable selectors only)
  const demoActiveProjectId = useDemoStore((s) => s.activeProjectId);
  const demoInventory = useDemoStore((s) => s.inventory);
  const demoCreativesAll = useDemoStore((s) => s.creatives);
  const demoAssignmentsAll = useDemoStore((s) => s.assignments);
  const demoScopes = useDemoStore((s) => s.scopes);
  const demoProofsByProject = useDemoStore((s) => s.proofs);

  const demoScope: ProjectScope | undefined = useMemo(
    () => demoScopes[demoActiveProjectId],
    [demoScopes, demoActiveProjectId]
  );

  const demoAssignments: DomainAssignment[] = useMemo(
    () => demoAssignmentsAll.filter((a) => a.projectId === demoActiveProjectId),
    [demoAssignmentsAll, demoActiveProjectId]
  );

  const demoCreatives: DomainCreative[] = useMemo(
    () => demoCreativesAll.filter((c) => c.projectId === demoActiveProjectId),
    [demoCreativesAll, demoActiveProjectId]
  );

  const demoProofLines = useMemo(() => {
    return demoProofsByProject[demoActiveProjectId] || [];
  }, [demoProofsByProject, demoActiveProjectId]);

  // Non-demo bridge legacy -> domain
  const bridgedDomain = useMemo(() => {
    if (isDemo) return null;

    const domInventory: DomainInventoryItem[] = toDomainInventoryFromLegacy(inventory as any[], "venue_unknown");

    const scope: ProjectScope = { includedIds: domInventory.map((i) => i.id) };

    const domCreatives: DomainCreative[] = (creatives as any[]).map((c) => ({
      id: c.id,
      projectId: project.id,
      filename: c.filename,
      fileMeta: c.fileMeta,
      mediaVariantKey: c.mediaVariantKey,
      color: c.color,
      // Legacy modal is “upload truth”
      thumbUrl: (c as any).thumbUrl || null,
      fullUrl: (c as any).fullUrl || null,
      createdAt: new Date().toISOString(),
    }));

    const domAssignments: DomainAssignment[] = (inventory as any[]).map((i) => ({
      projectId: project.id,
      inventoryId: getInventoryStableId(i),
      creativeId: i.assignedCreativeId ?? null,
      updatedAt: new Date().toISOString(),
    }));

    return { domInventory, domCreatives, domAssignments, scope };
  }, [isDemo, inventory, creatives, project.id]);

  // Choose canonical source
  const domInventory: DomainInventoryItem[] = useMemo(
    () => (isDemo ? demoInventory : bridgedDomain?.domInventory || []),
    [isDemo, demoInventory, bridgedDomain]
  );

  const domCreatives: DomainCreative[] = useMemo(
    () => (isDemo ? demoCreatives : bridgedDomain?.domCreatives || []),
    [isDemo, demoCreatives, bridgedDomain]
  );

  const domAssignments: DomainAssignment[] = useMemo(
    () => (isDemo ? demoAssignments : bridgedDomain?.domAssignments || []),
    [isDemo, demoAssignments, bridgedDomain]
  );

  const domScope: ProjectScope = useMemo(
    () => (isDemo ? demoScope || { includedIds: [] } : bridgedDomain?.scope || { includedIds: [] }),
    [isDemo, demoScope, bridgedDomain]
  );

  // Lookups
  const locationNameById = useMemo(() => {
    const out: Record<string, string> = {};
    maps.forEach((m) => (out[m.id] = m.name));
    return out;
  }, [maps]);

  const creativeById = useMemo(() => {
    const m = new Map<string, DomainCreative>();
    domCreatives.forEach((c) => m.set(c.id, c));
    return m;
  }, [domCreatives]);

  // Completeness and sections
  const completeness = useMemo(
    () => getAllocationCompleteness({ inventory: domInventory, scope: domScope, assignments: domAssignments }),
    [domInventory, domScope, domAssignments]
  );

  const sections = useMemo(
    () => buildVariantSections({ creatives: domCreatives, inventory: domInventory, scope: domScope, assignments: domAssignments, mediaLabelFromKey }),
    [domCreatives, domInventory, domScope, domAssignments]
  );

  const mapSummary = useMemo(
    () => buildMapSummary({ maps: maps.map((m) => ({ id: m.id, name: m.name })), inventory: domInventory, scope: domScope, assignments: domAssignments }),
    [maps, domInventory, domScope, domAssignments]
  );

  const variantSummary = useMemo(
    () => buildVariantSummary({ inventory: domInventory, scope: domScope, assignments: domAssignments, mediaLabelFromKey }),
    [domInventory, domScope, domAssignments]
  );

  const inventoryRows = useMemo(
    () => buildInventoryListRows({ inventory: domInventory, scope: domScope, assignments: domAssignments, creatives: domCreatives, locationNameById, mediaLabelFromKey }),
    [domInventory, domScope, domAssignments, domCreatives, locationNameById]
  );

  const inventoryDisplayIdById = useMemo(() => {
    if (isDemo) return new Map<string, string>();
    return buildInventoryDisplayIdMap(inventory as any[]);
  }, [inventory, isDemo]);

  const sectionsForDisplay = useMemo(() => {
    if (isDemo) return sections;
    return sections.map((section) => ({
      ...section,
      creatives: section.creatives.map((creative) => ({
        ...creative,
        assignedIds: creative.assignedIds.map((id) => inventoryDisplayIdById.get(id) || id),
        variantColor:
          variantCatalog?.find((variant: MediaVariant) => variant.key === creative.mediaVariantKey)?.color ||
          creative.color ||
          "#94a3b8",
      })),
    }));
  }, [inventoryDisplayIdById, isDemo, sections, variantCatalog]);

  const inventoryRowsForDisplay = useMemo(() => {
    if (isDemo) return inventoryRows;
    return inventoryRows.map((row) => ({
      ...row,
      inventoryId: inventoryDisplayIdById.get(row.inventoryId) || row.inventoryId,
    }));
  }, [inventoryDisplayIdById, inventoryRows, isDemo]);

  const mapFilterOptions = useMemo(() => {
    const ids = Array.from(new Set(inventoryRows.map((r) => r.locationId)));
    return ids.map((id) => ({ id, name: locationNameById[id] || id }));
  }, [inventoryRows, locationNameById]);

  const variantFilterOptions = useMemo(() => {
    const keys = Array.from(new Set(inventoryRows.map((r) => r.mediaVariantKey))).sort();
    return keys.map((k) => ({ key: k, label: mediaLabelFromKey(k) }));
  }, [inventoryRows]);

  function buildDemoSubmitPayload() {
    const assignmentMap = new Map(domAssignments.map((assignment) => [assignment.inventoryId, assignment.creativeId ?? null]));
    const included = new Set(domScope.includedIds);

    const legacyInventory: any[] = domInventory
      .filter((item) => item.isActive && included.has(item.id))
      .map((item) => ({
        id: inventoryDisplayIdById.get(item.id) || item.id,
        mapId: item.locationId,
        mediaVariantKey: item.mediaVariantKey,
        unitNumber: item.unitNumber || "",
        x: item.x,
        y: item.y,
        assignedCreativeId: assignmentMap.get(item.id) ?? null,
      }));

    const assignedByCreative = new Map<string, string[]>();
    for (const row of legacyInventory) {
      if (!row.assignedCreativeId) continue;
      const next = assignedByCreative.get(row.assignedCreativeId) || [];
      next.push(row.id);
      assignedByCreative.set(row.assignedCreativeId, next);
    }
    for (const values of assignedByCreative.values()) values.sort();

    const legacyCreatives: any[] = domCreatives.map((creative) => ({
      id: creative.id,
      filename: creative.filename,
      fileMeta: creative.fileMeta,
      mediaVariantKey: creative.mediaVariantKey,
      color: creative.color,
      assignedInventoryIds: assignedByCreative.get(creative.id) || [],
    }));

    return buildCreateOrderPayload({
      projectId: project.id,
      customerName: project.customerName,
      venueName: project.venueName,
      artworkDueDate: project.artworkDueDate,
      extId: project.extId,
      poNumber: project.poNumber,
      contractNumber: project.contractNumber,
      creatives: legacyCreatives,
      inventory: legacyInventory,
    });
  }

  const canSubmit =
    completeness.isComplete &&
    termsChecked &&
    (isDemo || (!!submitPreview?.validation.ok && !submitPreviewLoading));

  async function loadSubmitPreview(persistSnapshot = false) {
    if (isDemo || isSubmittedContext) return;
    try {
      setSubmitPreviewLoading(true);
      setSubmitPreviewError(null);
      const response = await previewProjectOrderSubmission(
        api,
        project.id,
        {
          note: submissionNote,
          persistSnapshot,
        },
        isShareMode
      );
      setSubmitPreview(response.preview);
      setSubmitPreviewSavedAt(
        persistSnapshot && response.preview.snapshotDocument ? response.preview.snapshotDocument.createdAt : null
      );
    } catch (error) {
      console.error("Failed to preview Lift order payload", error);
      setSubmitPreviewError(error instanceof Error ? error.message : "Could not build the Lift payload preview.");
    } finally {
      setSubmitPreviewLoading(false);
    }
  }

  useEffect(() => {
    if (!isOpen || tab !== "submit" || isSubmittedContext || isDemo) return;
    if (submitPreviewLoading || submitPreview || submitPreviewError) return;
    void loadSubmitPreview(false);
  }, [isDemo, isOpen, isSubmittedContext, submitPreview, submitPreviewError, submitPreviewLoading, tab]);

  async function performSubmitOrder() {
    try {
      let submissionResult:
      | {
          liftOrderNumber: string;
          submittedAt: string;
          submittedByName: string;
          note?: string | null;
        }
      | null = null;

      if (isDemo) {
        const { payload, validation } = buildDemoSubmitPayload();
        if (!validation.ok) {
          alert(validation.errors.join("\n"));
          return;
        }

        const res = await submitOrderToLiftStub(payload);
        if (!res.ok || !res.liftOrderNumber) {
          alert(res.error || "Submit failed.");
          return;
        }
        submissionResult = {
          liftOrderNumber: res.liftOrderNumber,
          submittedAt: new Date().toISOString(),
          submittedByName: "Demo User",
          note: submissionNote || null,
        };

        demoStore.actions.submitOrderDemo({
		      projectId: project.id,
		      payload,
		      note: submissionNote,
		    });
      } else {
        if (!submitPreview?.validation.ok) {
          await loadSubmitPreview(false);
          return;
        }

        const response = await submitProjectOrder(
          api,
          project.id,
          {
            note: submissionNote,
          },
          isShareMode
        );
        submissionResult = {
          liftOrderNumber: response.submission.liftOrderId,
          submittedAt: response.submission.submittedAt,
          submittedByName: response.submission.submittedByName,
          note: response.submission.note || null,
        };
      }

      setSubmittedOrderNumber(submissionResult.liftOrderNumber);
      onSubmitted?.({
	      liftOrderId: submissionResult.liftOrderNumber,
	      submittedAt: submissionResult.submittedAt,
	      submittedByName: submissionResult.submittedByName,
	      note: submissionResult.note,
	    });
      setSubmitSuccess(true);
	
	    setRedirectSeconds(5);
	
	    if (redirectTimerRef.current) window.clearInterval(redirectTimerRef.current);
	
	    redirectTimerRef.current = window.setInterval(() => {
	      setRedirectSeconds((cur) => {
		    if (cur === null) return null;
		    if (cur <= 1) {
		      if (redirectTimerRef.current) window.clearInterval(redirectTimerRef.current);
		      redirectTimerRef.current = null;
	
		      setTimeout(() => {
			    onClose();
			    onAfterSubmit?.();
		      }, 120);
	
		      return null;
		    }
		    return cur - 1;
	    });
    }, 1000);
    } catch (error) {
      console.error("Failed to submit project order", error);
      if (!isDemo) {
        void logProjectErrorEvent(api, project.id, {
          actionType: "submit_order_failed",
          severity: "error",
          errorCode: "submit_order_failed",
          message: error instanceof Error ? error.message : "Project order submission failed",
          surface: "review_allocation_submit",
          workspace: "assignment",
        }, isShareMode);
      }
      alert(error instanceof Error ? error.message : "Submit failed.");
    }
  }

  function handleSubmit() {
    if (!canSubmitOrder) {
      demoStore.actions.pushToast("warning", "This shared link does not allow order submission");
      return;
    }

    if (onRequestSubmitOrder) {
      onRequestSubmitOrder(() => {
        void performSubmitOrder();
      });
      return;
    }

    void performSubmitOrder();
  }

  if (!isOpen) return null;

  return (
    <Portal>
      <div className="review-backdrop" onClick={onClose}>
        <div className="review-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
          <div className="review-head">
            <div className="review-head-left">
              <div className="review-titleRow">
                <div className="review-title">
                  {isSubmittedContext ? "Allocation Review Packet" : "Review Creative Allocation"}
                </div>
                <div className={`review-modeChip ${isSubmittedContext ? "is-submitted" : "is-draft"}`}>
                  {isSubmittedContext ? "Submitted" : "Pre-Submit"}
                </div>
              </div>
              <div className="review-sub">
                {project.title} · {project.venueName}
                {project.postDate ? ` · Post ${project.postDate}` : ""}
                {project.artworkDueDate ? ` · Artwork Due ${project.artworkDueDate}` : ""}
              </div>
              <div className="review-contextNote">
                {isSubmittedContext
                  ? "Use this packet to review the final allocation, inventory coverage, and downloadable installer/reference PDF."
                  : "Use this review packet to confirm allocation coverage before submitting the order."}
              </div>
              <div className="review-headStats">
                <div className="review-headStat">
                  <span className="review-headStatLabel">Assignment</span>
                  <span className="review-headStatValue">{completeness.assigned}/{completeness.required}</span>
                </div>
                <div className="review-headStat">
                  <span className="review-headStatLabel">Maps</span>
                  <span className="review-headStatValue">{mapSummary.length}</span>
                </div>
                <div className="review-headStat">
                  <span className="review-headStatLabel">Media Types</span>
                  <span className="review-headStatValue">{variantSummary.length}</span>
                </div>
              </div>
            </div>

            <div className="review-head-right">
              <button className="btn btn-ghost btn-soft" type="button" onClick={onDownloadPdf}>
                Download PDF
              </button>
              <button className="btn btn-ghost btn-soft" type="button" onClick={onClose}>
                ✕
              </button>
            </div>
          </div>

          <div className="review-tabs">
            <button className={`review-tab ${tab === "details" ? "is-active" : ""}`} type="button" onClick={() => setTab("details")}>
              Allocation Details
            </button>

            <button className={`review-tab ${tab === "inventory" ? "is-active" : ""}`} type="button" onClick={() => setTab("inventory")}>
              Inventory List
            </button>

            <button className={`review-tab ${tab === "summary" ? "is-active" : ""}`} type="button" onClick={() => setTab("summary")}>
              Summary
            </button>

            {completeness.isComplete && !isSubmittedContext && (
              <button
                className={["review-tab", "review-tab-cta", tab === "submit" ? "is-active" : ""].join(" ")}
                type="button"
                onClick={() => setTab("submit")}
              >
                Submit Order <span className="review-tab-cta-spark" aria-hidden="true">✨</span>
              </button>
            )}

            <div className="review-tabs-spacer" />

            <div className={`review-completeChip ${completeness.isComplete ? "ok" : "warn"}`}>
              {completeness.assigned}/{completeness.required} assigned
            </div>
          </div>

          <div className="review-body">
            {tab === "details" && (
              <AllocationDetailsTab
                sections={sectionsForDisplay}
                creativeById={creativeById}
                proofsForProject={isDemo ? (demoProofLines as any[]) : []}
                onPreviewProof={({ previewSrc, openUrl, title, subtitle, assetType }) => {
                  setLb({ src: openUrl || previewSrc, fallbackSrc: previewSrc, title, subtitle, openUrl, assetType });
                }}
              />
            )}

            {tab === "inventory" && (
              <InventoryListTab
                rows={inventoryRowsForDisplay}
                creativeById={creativeById}
                mapOptions={mapFilterOptions}
                variantOptions={variantFilterOptions}
                onPreview={({ previewSrc, openUrl, filename, fileMeta, assetType }) => {
                  setLb({ src: openUrl || previewSrc, fallbackSrc: previewSrc, title: filename, subtitle: fileMeta, openUrl, assetType });
                }}
              />
            )}

            {tab === "summary" && <AllocationSummaryTab mapSummary={mapSummary} variantSummary={variantSummary} />}

            {tab === "submit" &&
              (submitSuccess ? (
                <div className="review-section">
                  <div className="review-submitCard">
                    <div className="review-submitTitle">Order submitted</div>
                    <div className="review-submitSub">
                      Your order has been submitted successfully. Returning to Project Hub in{" "}
                      <strong>{redirectSeconds ?? 5}</strong> seconds.
                    </div>
                  </div>
                  <div className="review-note">
                    <div className="review-note-title">Next step</div>
                    <div className="review-note-sub">Proofs are ready for review, and the project hub will reopen automatically.</div>
                  </div>
                </div>
              ) : !isSubmittedContext ? (
                <SubmitTab
                  project={project}
                  completeness={completeness}
                  checked={termsChecked}
                  onCheckedChange={setTermsChecked}
                  submissionNote={submissionNote}
                  onSubmissionNoteChange={setSubmissionNote}
                  isDemo={isDemo}
                  preview={submitPreview}
                  previewLoading={submitPreviewLoading}
                  previewError={submitPreviewError}
                  previewSavedAt={submitPreviewSavedAt}
                  onRefreshPreview={() => {
                    void loadSubmitPreview(false);
                  }}
                  onSavePreviewSnapshot={() => {
                    void loadSubmitPreview(true);
                  }}
                />
              ) : (
                <div className="review-section">
                  <div className="review-submitCard">
                    <div className="review-submitTitle">Order already submitted</div>
                    <div className="review-submitSub">This project is already in review. Use the allocation packet and proof workflow for the next steps.</div>
                  </div>
                </div>
              ))}
          </div>

          <div className="review-footer">
          {submitSuccess && redirectSeconds !== null && (
			  <div className="review-redirectToast" role="status" aria-live="polite">
				<div className="review-redirectToastText">
				  <strong>Order submitted successfully.</strong> Returning to Project Hub in{" "}
				  <strong>{redirectSeconds}</strong>…
				</div>
				<button className="btn btn-ghost btn-soft" type="button" onClick={cancelRedirect}>
				  Cancel
				</button>
			  </div>
			)}
          
          
            <button className="btn btn-ghost btn-soft" type="button" onClick={onClose}>
              Close
            </button>

            {isSubmittedContext && (
              <button className="btn btn-primary btn-wide" type="button" onClick={onDownloadPdf}>
                Download PDF
              </button>
            )}

            {!isSubmittedContext && (tab === "details" || tab === "inventory") && (
              <button className="btn btn-primary btn-wide" type="button" onClick={() => setTab("summary")}>
                View Summary
              </button>
            )}

            {!isSubmittedContext && tab === "summary" && (
              <button className="btn btn-primary btn-wide" type="button" disabled={!completeness.isComplete} onClick={() => setTab("submit")}>
                Continue
              </button>
            )}

            {!isSubmittedContext && tab === "submit" && !submitSuccess && (
              <button className="btn btn-primary btn-wide" type="button" disabled={!canSubmit || !canSubmitOrder} onClick={handleSubmit}>
                Submit Order
              </button>
            )}
          </div>

          <Lightbox
            isOpen={!!lb}
            src={lb?.src || ""}
            fallbackSrc={lb?.fallbackSrc}
            title={lb?.title}
            subtitle={lb?.subtitle}
            openInNewTabUrl={lb?.openUrl}
            assetType={lb?.assetType}
            onClose={() => setLb(null)}
          />
        </div>
      </div>
    </Portal>
  );
}

/* -------------------- UI tab components -------------------- */

function AllocationDetailsTab({
  sections,
  creativeById,
  proofsForProject,
  onPreviewProof,
}: {
  sections: ReturnType<typeof buildVariantSections>;
  creativeById: Map<string, DomainCreative>;
  proofsForProject: any[];
  onPreviewProof: (args: {
    previewSrc: string;
    openUrl: string;
    title: string;
    subtitle?: string;
    assetType: "image" | "document";
  }) => void;
}) {
  return (
    <div className="review-section">
      {sections.map((sec) => (
        <div key={sec.variantKey} className="review-variant">
          <div className="review-variant-head">
            <div className="review-variant-title">{sec.label}</div>
            <div className={`review-variant-count ${sec.assignedInventoryForVariant === sec.totalInventoryForVariant ? "ok" : "warn"}`}>
              {sec.assignedInventoryForVariant}/{sec.totalInventoryForVariant} assigned
            </div>
          </div>

          {sec.hasNoCreatives ? (
            <div className="review-emptyRow">No creatives uploaded for this media type.</div>
          ) : (
            <div className="review-creativeList">
              {sec.creatives.map((c) => {
                const domC = creativeById.get(c.creativeId);

                // Upload truth thumbnail + optional proof chip
                const assets = getCreativeDisplayAssets({
                  creative: {
                    id: c.creativeId,
                    thumbUrl: (domC as any)?.thumbUrl,
                    fullUrl: (domC as any)?.fullUrl,
                  },
                  proofsForProject,
                });

                const uploadThumb =
                  assets.upload.thumbUrl ||
                  buildDocumentThumbUrl({ label: c.fileMeta?.toUpperCase().includes("PDF") ? "PDF" : "FILE", accent: c.color });

                const uploadFull =
                  assets.upload.fullUrl || assets.upload.thumbUrl || uploadThumb;

                const hasProof = assets.proof.source === "proof";

                const proofLabel =
                  assets.proof.proofStatus === "approved" ? "Approved proof" : "Proof available";

                const proofSrc = assets.proof.fullUrl || assets.proof.thumbUrl || null;

                return (
                  <div key={c.creativeId} className="review-creativeRow">
                    <button
                      type="button"
                      className="review-thumbBtn"
                      title="Click to preview"
                      onClick={() =>
                        onPreviewProof({
                          previewSrc: uploadThumb,
                          openUrl: uploadFull,
                          title: c.filename,
                          subtitle: c.fileMeta,
                          assetType: c.fileMeta?.toUpperCase().includes("PDF") ? "document" : "image",
                        })
                      }
                    >
                      <img className="review-thumbImg" src={uploadThumb} alt="" loading="lazy" />
                      <span
                        className="review-thumbDot"
                        style={{
                          background: (c as any).variantColor || c.color || "#94a3b8",
                        }}
                      />
                    </button>

                    <div className="review-creativeMain">
                      <div className="review-creativeName" title={c.filename}>
                        {c.filename}
                      </div>

                      <div className="review-creativeMeta">{c.fileMeta}</div>

                      {hasProof && proofSrc && (
                        <div style={{ marginTop: 8 }}>
                          <button
                            type="button"
                            className="chip tone-info"
                            onClick={() =>
                              onPreviewProof({
                                previewSrc: assets.proof.thumbUrl || proofSrc,
                                openUrl: proofSrc,
                                title: `${c.filename} (Proof)`,
                                subtitle: proofLabel,
                                assetType: c.fileMeta?.toUpperCase().includes("PDF") ? "document" : "image",
                              })
                            }
                          >
                            {proofLabel}
                          </button>
                        </div>
                      )}

                      {c.assignedCount === 0 ? (
                        <div className="review-creativeEmpty">Not assigned to any locations</div>
                      ) : (
                        <div className="review-creativeLocs">
                          {c.assignedIds.slice(0, 6).map((id) => (
                            <span key={id} className="review-locChip">{id}</span>
                          ))}
                          {c.assignedCount > 6 && (
                            <span className="review-locMore">+ {c.assignedCount - 6} more</span>
                          )}
                        </div>
                      )}
                    </div>

                    <div className={`review-status ${c.assignedCount > 0 ? "ok" : "warn"}`}>
                      {c.assignedCount > 0 ? "Assigned" : "Missing"}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function InventoryListTab({
  rows,
  creativeById,
  mapOptions,
  variantOptions,
  onPreview,
}: {
  rows: ReturnType<typeof buildInventoryListRows>;
  creativeById: Map<string, DomainCreative>;
  mapOptions: Array<{ id: string; name: string }>;
  variantOptions: Array<{ key: string; label: string }>;
  onPreview: (args: {
    previewSrc: string;
    openUrl: string;
    fileMeta: string;
    filename: string;
    assetType: "image" | "document";
  }) => void;
}) {
  const [q, setQ] = useState("");
  const [mapId, setMapId] = useState<string>("all");
  const [variantKey, setVariantKey] = useState<string>("all");

  const norm = (s: string) => (s || "").toLowerCase().trim();

  const filtered = useMemo(() => {
    const nq = norm(q);
    return rows.filter((r) => {
      if (mapId !== "all" && r.locationId !== mapId) return false;
      if (variantKey !== "all" && r.mediaVariantKey !== variantKey) return false;
      if (!nq) return true;

      const hay = [r.inventoryId, r.mediaLabel, r.assignedFilename || "", r.locationName || r.locationId].join(" ").toLowerCase();
      return hay.includes(nq);
    });
  }, [rows, q, mapId, variantKey]);

  return (
    <div className="invtab">
      <div className="invtab-toolbar">
        <div className="invtab-search">
          <span className="invtab-searchIcon">⌕</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search inventory ID or filename…" />
        </div>

        <select className="invtab-select" value={mapId} onChange={(e) => setMapId(e.target.value)}>
          <option value="all">All Maps</option>
          {mapOptions.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>

        <select className="invtab-select" value={variantKey} onChange={(e) => setVariantKey(e.target.value)}>
          <option value="all">All Media</option>
          {variantOptions.map((v) => (
            <option key={v.key} value={v.key}>{v.label}</option>
          ))}
        </select>
      </div>

      <div className="invtab-table">
        <div className="invtab-head">
          <div>Inventory ID</div>
          <div>Media</div>
          <div>Assigned Creative</div>
          <div className="right">Status</div>
        </div>

        {filtered.length === 0 ? (
          <div className="invtab-empty">
            No inventory items match your filters. Try adjusting the map, media, or search terms to review a different slice of the allocation.
          </div>
        ) : (
          filtered.map((r) => {
            const status = !r.isActive
              ? { label: "Unavailable", cls: "tone-neutral" }
              : r.assignedCreativeId
              ? { label: "Assigned", cls: "tone-success" }
              : { label: "Unassigned", cls: "tone-warning" };

            return (
              <div className="invtab-row" key={r.inventoryId}>
                <div className="invtab-id">
                  <div className="invtab-idMain">{r.inventoryId}</div>
                  <div className="invtab-idSub">{r.locationName || r.locationId}</div>
                </div>

                <div className="invtab-media">{r.mediaLabel}</div>

                <div className="invtab-creative">
                  {r.assignedCreativeId ? (
                    <button
                      type="button"
                      className="invtab-creativeBtn"
                      onClick={() => {
                        const creative = creativeById.get(r.assignedCreativeId!);
                        const fallback = buildDocumentThumbUrl({
                          label: (r.assignedFileMeta || "").toUpperCase().includes("PDF") ? "PDF" : "FILE",
                          accent: r.assignedColor || "#94a3b8",
                        });
                        onPreview({
                          previewSrc: creative?.thumbUrl || creative?.fullUrl || fallback,
                          openUrl: creative?.fullUrl || creative?.thumbUrl || fallback,
                          fileMeta: r.assignedFileMeta || "",
                          filename: r.assignedFilename || "Creative",
                          assetType: (r.assignedFileMeta || "").toUpperCase().includes("PDF") ? "document" : "image",
                        });
                      }}
                      title="Click to preview"
                    >
                      <img
                        className="invtab-thumb"
                        src={
                          creativeById.get(r.assignedCreativeId!)?.thumbUrl ||
                          creativeById.get(r.assignedCreativeId!)?.fullUrl ||
                          buildDocumentThumbUrl({
                            label: (r.assignedFileMeta || "").toUpperCase().includes("PDF") ? "PDF" : "FILE",
                            accent: r.assignedColor || "#94a3b8",
                          })
                        }
                        alt=""
                        loading="lazy"
                      />
                      <div className="invtab-creativeText">
                        <div className="invtab-creativeName" title={r.assignedFilename}>
                          <span className="invtab-dot" style={{ background: r.assignedColor || "#94a3b8" }} />
                          {r.assignedFilename}
                        </div>
                        <div className="invtab-creativeMeta">{r.assignedFileMeta}</div>
                      </div>
                    </button>
                  ) : (
                    <div className="invtab-creativeEmpty">—</div>
                  )}
                </div>

                <div className="invtab-status right">
                  <span className={`chip ${status.cls}`}>{status.label}</span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function AllocationSummaryTab({
  mapSummary,
  variantSummary,
}: {
  mapSummary: ReturnType<typeof buildMapSummary>;
  variantSummary: ReturnType<typeof buildVariantSummary>;
}) {
  if (mapSummary.length === 0 && variantSummary.length === 0) {
    return (
      <div className="review-section">
        <div className="invtab-empty">
          No allocation summary is available yet. Once locations are included in scope, this packet will show map and media coverage totals here.
        </div>
      </div>
    );
  }

  return (
    <div className="review-section review-summaryGrid">
      <div className="review-summaryCard">
        <div className="review-summaryTitle">Maps Overview</div>
        <div className="review-table">
          {mapSummary.map((m) => (
            <div key={m.mapId} className="review-tableRow">
              <div className="review-tableCell">{m.mapName}</div>
              <div className={`review-tableCell right ${m.isComplete ? "ok" : "warn"}`}>{m.assigned}/{m.total}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="review-summaryCard">
        <div className="review-summaryTitle">Media Overview</div>
        <div className="review-table">
          {variantSummary.map((v) => (
            <div key={v.variantKey} className="review-tableRow">
              <div className="review-tableCell">{v.label}</div>
              <div className={`review-tableCell right ${v.isComplete ? "ok" : "warn"}`}>{v.assigned}/{v.total}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="review-summaryCard review-summaryCard-wide">
        <div className="review-summaryTitle">Packet Readiness</div>
        <div className="review-summaryNote">
          This packet is intended for internal review, customer confirmation, and installer/reference export. Use the downloadable PDF when you need a shareable artifact outside the live workspace.
        </div>
      </div>
    </div>
  );
}

function SubmitTab({
  project,
  completeness,
  checked,
  onCheckedChange,
  submissionNote,
  onSubmissionNoteChange,
  isDemo,
  preview,
  previewLoading,
  previewError,
  previewSavedAt,
  onRefreshPreview,
  onSavePreviewSnapshot,
}: {
  project: ProjectMeta;
  completeness: { assigned: number; required: number; remaining: number; isComplete: boolean };
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  submissionNote: string;
  onSubmissionNoteChange: (v: string) => void;
  isDemo: boolean;
  preview: ApiLiftPayloadPreview | null;
  previewLoading: boolean;
  previewError: string | null;
  previewSavedAt: string | null;
  onRefreshPreview: () => void;
  onSavePreviewSnapshot: () => void;
}) {
  const isSandboxProject = project.projectMode === "internal_sandbox";
  const orderedLines = useMemo(() => {
    if (!preview?.lines?.length) return false;
    const normalized = [...preview.lines].map((line) => ({
      mediaVariantLabel: line.mediaVariantLabel.toLowerCase(),
      filename: line.filename.toLowerCase(),
      unitNumber: line.unitNumber.toLowerCase(),
    }));
    const sorted = [...normalized].sort((a, b) => {
      const media = a.mediaVariantLabel.localeCompare(b.mediaVariantLabel);
      if (media !== 0) return media;
      const file = a.filename.localeCompare(b.filename);
      if (file !== 0) return file;
      return a.unitNumber.localeCompare(b.unitNumber);
    });
    return normalized.every(
      (line, index) =>
        line.mediaVariantLabel === sorted[index]?.mediaVariantLabel &&
        line.filename === sorted[index]?.filename &&
        line.unitNumber === sorted[index]?.unitNumber
    );
  }, [preview?.lines]);

  const unitSplitSummary = useMemo(() => {
    if (!preview?.lines?.length) {
      return { state: "neutral" as const, label: "No repeated filename + variant pairs in this preview." };
    }
    const grouped = new Map<string, Set<string>>();
    preview.lines.forEach((line) => {
      const key = `${line.mediaVariantLabel}::${line.filename}`;
      const units = grouped.get(key) || new Set<string>();
      units.add(line.unitNumber);
      grouped.set(key, units);
    });
    const splitGroups = Array.from(grouped.values()).filter((units) => units.size > 1).length;
    if (splitGroups > 0) {
      return {
        state: "ok" as const,
        label: `${splitGroups} filename group${splitGroups === 1 ? "" : "s"} split correctly by unit number.`,
      };
    }
    return {
      state: "neutral" as const,
      label: "Unit-number grouping is ready; this preview simply does not include a split case.",
    };
  }, [preview?.lines]);

  const checklistItems = useMemo(() => {
    if (!preview) return [];
    const savedSnapshot = Boolean(previewSavedAt || preview.snapshotDocument);
    const customerRoutesToDemo = preview.payload.customer_id === "1249";
    const hasGuardrailGaps = preview.validation.errors.some((error) =>
      /lift customer id|unit number|trim|safe/i.test(error)
    );
    return [
      {
        label: "Preview snapshot saved to Documents",
        detail: savedSnapshot
          ? `Saved ${new Date((preview.snapshotDocument?.createdAt || previewSavedAt) as string).toLocaleString()}`
          : "Save the current preview snapshot before the first live Lift validation.",
        state: savedSnapshot ? "ok" : "warn",
      },
      {
        label: "Sandbox routing uses Lift demo customer 1249",
        detail: customerRoutesToDemo
          ? "The preview payload resolves customer_id to the internal demo account."
          : `Current preview routes customer_id to ${preview.payload.customer_id}.`,
        state: customerRoutesToDemo ? "ok" : "error",
      },
      {
        label: "Submit-readiness validations are clear",
        detail: preview.validation.ok
          ? "No blocking Lift customer, unit number, trim, or safe-area issues were found."
          : preview.validation.errors[0] || "Preview validation still needs attention.",
        state: preview.validation.ok ? "ok" : "error",
      },
      {
        label: "Lift lines stay in deterministic media + filename order",
        detail: orderedLines
          ? "Preview lines already match the alphabetical media-group and filename ordering rule."
          : "Current preview line order does not match the expected ordering rule.",
        state: orderedLines ? "ok" : "error",
      },
      {
        label: "Unit-number uniqueness is preserved",
        detail: unitSplitSummary.label,
        state: unitSplitSummary.state,
      },
      {
        label: "Sandbox guardrails stay customer-invisible",
        detail: isSandboxProject
          ? "Shared links stay blocked and the project remains internal-only while using the source venue."
          : "This checklist is intended for internal sandbox projects.",
        state: isSandboxProject ? "ok" : "neutral",
      },
      {
        label: "Expected validation surfaces remain clean",
        detail: hasGuardrailGaps
          ? "Resolve the current preview issues before trusting the rehearsal."
          : "Health should stay in awaiting-live-validation posture and the Errors lane should remain empty for a clean rehearsal.",
        state: hasGuardrailGaps ? "warn" : "ok",
      },
    ];
  }, [isSandboxProject, orderedLines, preview, previewSavedAt, unitSplitSummary]);

  return (
    <div className="review-section">
      <div className="review-submitCard">
        <div className="review-submitTitle">Ready to submit?</div>
        <div className="review-submitSub">
          You’ve assigned <strong>{completeness.assigned}</strong> of{" "}
          <strong>{completeness.required}</strong> locations.
        </div>
      </div>

      <div className="review-note">
        <div className="review-note-title">Submission Note (optional)</div>
        <div className="review-note-sub">Add any context for your print team (special instructions, timeline notes, etc.).</div>
        <textarea
          className="review-note-textarea"
          value={submissionNote}
          onChange={(e) => onSubmissionNoteChange(e.target.value)}
          placeholder="Type a short note…"
          rows={4}
        />
      </div>

      {!isDemo && (
        <div className="review-note">
          <div className="review-note-title">Lift Payload Preview</div>
          <div className="review-note-sub">
            Inspect the exact backend-built Lift payload, line ordering, and unit-number splits before submitting. Refresh this preview after changing the submission note.
          </div>

          {isSandboxProject ? (
            <div className="review-previewAlert is-info">
              This is the official internal sandbox rehearsal lane. Use this preview to validate routing, ordering, and guardrails without writing anything to Lift.
              {project.sourceCustomerName ? ` Source venue customer: ${project.sourceCustomerName}.` : ""}
            </div>
          ) : null}

          <div className="review-previewActions">
            <button className="btn btn-ghost btn-soft" type="button" onClick={onRefreshPreview} disabled={previewLoading}>
              {previewLoading ? "Refreshing…" : "Refresh Preview"}
            </button>
            <button className="btn btn-ghost btn-soft" type="button" onClick={onSavePreviewSnapshot} disabled={previewLoading}>
              Save Preview Snapshot
            </button>
            {preview?.snapshotDocument?.fullUrl ? (
              <a
                className="btn btn-ghost btn-soft"
                href={preview.snapshotDocument.fullUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open Saved Snapshot
              </a>
            ) : null}
            {previewSavedAt ? <div className="review-previewMeta">Saved to Documents at {new Date(previewSavedAt).toLocaleString()}</div> : null}
          </div>

          {previewError ? <div className="review-previewAlert is-error">{previewError}</div> : null}

          {preview ? (
            <>
              {isSandboxProject ? (
                <div className="review-previewChecklist">
                  <div className="review-previewChecklistHead">
                    <div className="review-previewChecklistTitle">Zero-write sandbox acceptance checklist</div>
                    <div className="review-previewChecklistMeta">Lock these checks before the first live Lift validation.</div>
                  </div>
                  <div className="review-previewChecklistGrid">
                    {checklistItems.map((item) => (
                      <div key={item.label} className={`review-previewChecklistItem is-${item.state}`}>
                        <div className="review-previewChecklistLabel">{item.label}</div>
                        <div className="review-previewChecklistDetail">{item.detail}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="review-previewValidationGrid">
                <div className={`review-previewValidationCard ${preview.validation.ok ? "is-ok" : "is-error"}`}>
                  <span className="review-previewValidationLabel">Validation</span>
                  <strong>{preview.validation.ok ? "Ready to submit" : `${preview.validation.errors.length} issue${preview.validation.errors.length === 1 ? "" : "s"}`}</strong>
                </div>
                <div className="review-previewValidationCard">
                  <span className="review-previewValidationLabel">Line order</span>
                  <strong>{preview.lines.length} Lift lines</strong>
                </div>
                <div className="review-previewValidationCard">
                  <span className="review-previewValidationLabel">Assignment coverage</span>
                  <strong>{preview.completeness.assigned}/{preview.completeness.required} assigned</strong>
                </div>
              </div>

              {preview.validation.errors.length > 0 ? (
                <div className="review-previewAlert is-error">
                  {preview.validation.errors.map((error) => (
                    <div key={error}>{error}</div>
                  ))}
                </div>
              ) : null}

              {preview.validation.warnings.length > 0 ? (
                <div className="review-previewAlert is-warning">
                  {preview.validation.warnings.map((warning) => (
                    <div key={warning}>{warning}</div>
                  ))}
                </div>
              ) : null}

              <div className="review-previewLines">
                {preview.lines.map((line) => (
                  <div key={`${line.lineNumber}-${line.filename}-${line.unitNumber}`} className="review-previewLine">
                    <div className="review-previewLineTop">
                      <div className="review-previewLineNumber">Line {line.lineNumber}</div>
                      <div className="review-previewLineQty">{line.quantity} location{line.quantity === 1 ? "" : "s"}</div>
                    </div>
                    <div className="review-previewLineTitle">{line.mediaVariantLabel}</div>
                    <div className="review-previewLineMeta">
                      <span>{line.filename}</span>
                      <span>SKU {line.unitNumber}</span>
                    </div>
                    <div className="review-previewLineMeta">
                      <span>Trim {line.trimHeight}"h × {line.trimWidth}"w</span>
                      <span>Safe {line.safeHeight}"h × {line.safeWidth}"w</span>
                    </div>
                    <div className="review-previewLineLocations">{line.assignedLocations.join(", ")}</div>
                  </div>
                ))}
              </div>

              <details className="review-previewJson">
                <summary>Preview JSON</summary>
                <pre>{JSON.stringify(preview.payload, null, 2)}</pre>
              </details>
            </>
          ) : previewLoading ? (
            <div className="review-previewAlert">Building the current Lift payload preview…</div>
          ) : null}
        </div>
      )}

      <TermsOfSubmissionPanel termsText={project.termsOfSubmissionText} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

function TermsOfSubmissionPanel({
  termsText,
  checked,
  onCheckedChange,
}: {
  termsText: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <div className="review-terms">
      <div className="review-terms-title">Terms of Submission</div>
      <div className="review-terms-box">
        <div className="review-terms-scroll">{termsText}</div>
      </div>
      <label className="review-terms-check">
        <input type="checkbox" checked={checked} onChange={(e) => onCheckedChange(e.target.checked)} />
        <span>I have read and understand the Terms of Submission.</span>
      </label>
    </div>
  );
}
