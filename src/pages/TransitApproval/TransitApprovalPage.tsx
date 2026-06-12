// src/pages/TransitApproval/TransitApprovalPage.tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams, useLocation } from "react-router-dom";
import { useApiClient } from "../../api/useApiClient";
import { fetchProjectAllocationOverride, fetchProjectProofs, fetchProjectTransit, fetchProjectWorkspace, logProjectErrorEvent, normalizeCreativeAsset, updateProjectTransit, type ApiAllocationOverrideResponse } from "../../api/projects";

import AppShell from "../../app/AppShell";
import Panel from "../../components/common/Panel";
import PageHeader from "../../components/common/PageHeader";
import Lightbox from "../../components/common/Lightbox";
import { ShareAccessDenied, useShareAccess } from "../../components/share/ShareAccess";

import { mediaLabelFromKey } from "../../logic/mockAssignment";
import { buildDocumentThumbUrl } from "../../logic/imageUrls";
import { isDemoProjectRoute } from "../../logic/projectMode";
import { buildAllocationOverrideDomain, hasActiveAllocationOverrides } from "../../logic/allocationOverride";

import { demoStore, useDemoStore } from "../../domain/store/demoStore";
import { useDemoProjectContext } from "../../domain/selectors/useDemoProjectContext";

// Canonical allocation selector
import { buildVariantSections } from "../../domain/selectors/allocationSelectors";

// NEW: proof-first display asset selector
import { pickCreativeDisplayAsset } from "../../domain/selectors/displayAsset";

// Domain types
import type {
  Creative as DomainCreative,
  InventoryItem as DomainInventoryItem,
  Assignment as DomainAssignment,
  ProjectScope,
} from "../../domain/types";

type TAStatus = "approved" | "rejected";

export default function TransitApprovalPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const api = useApiClient();

  const [searchParams] = useSearchParams();
  const isCustomerMode = searchParams.get("mode") === "customer";
  const modeSuffix = isCustomerMode ? "?mode=customer" : "";
  const shareAccess = useShareAccess(projectId);

  const isDemo = isDemoProjectRoute(projectId, (location.state as any)?.demo === true);

  useEffect(() => {
    if (isDemo) demoStore.actions.hydrateDemo();
  }, [isDemo]);

  // ----------------------------
  // Demo context (A1 hardened)
  // ----------------------------
  const demoActiveProjectId = useDemoStore((s) => s.activeProjectId);
  const ctx = useDemoProjectContext(demoActiveProjectId);

  // Demo proofs (used for displayAsset)
  const demoProofsByProject = useDemoStore((s) => s.proofs);
  const demoProofLines = useMemo(() => {
    return isDemo ? (demoProofsByProject[demoActiveProjectId] || []) : [];
  }, [isDemo, demoProofsByProject, demoActiveProjectId]);

  const [liveProject, setLiveProject] = useState<{ title: string; venueName: string } | null>(null);
  const [liveInventory, setLiveInventory] = useState<Array<{
    id: string;
    recordId?: string;
    mapId: string;
    mediaVariantKey: string;
    unitNumber?: string;
    x: number;
    y: number;
    assignedCreativeId?: string | null;
  }>>([]);
  const [liveCreatives, setLiveCreatives] = useState<DomainCreative[]>([]);
  const [liveScope, setLiveScope] = useState<ProjectScope>({ includedIds: [] });
  const [liveAssignments, setLiveAssignments] = useState<DomainAssignment[]>([]);
  const [liveProofLines, setLiveProofLines] = useState<any[]>([]);
  const [allocationOverride, setAllocationOverride] = useState<ApiAllocationOverrideResponse | null>(null);
  const [liveLoaded, setLiveLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadLiveTransitWorkspace() {
      if (!projectId || isDemo || shareAccess.isResolving) return;
      setLiveLoaded(false);
      try {
        const [workspace, proofs, transit, overrideResult] = await Promise.all([
          fetchProjectWorkspace(api, projectId, shareAccess.isShareMode),
          fetchProjectProofs(api, projectId, shareAccess.isShareMode),
          fetchProjectTransit(api, projectId, shareAccess.isShareMode),
          shareAccess.isShareMode ? Promise.resolve(null) : fetchProjectAllocationOverride(api, projectId).catch(() => null),
        ]);
        if (cancelled) return;

        setLiveProject({ title: workspace.project.title, venueName: workspace.project.venueName });
        setLiveInventory(workspace.workspace.inventory || []);
        setLiveCreatives(workspace.workspace.creatives.map(normalizeCreativeAsset) as any);
        setLiveScope({ includedIds: workspace.scope.includedIds || [] });
        setLiveAssignments(
          (workspace.workspace.inventory || []).map((item) => ({
            projectId,
            inventoryId: item.recordId || item.id,
            creativeId: item.assignedCreativeId ?? null,
            updatedAt: new Date().toISOString(),
          }))
        );
        setLiveProofLines(proofs.proofs || []);
        setAllocationOverride(overrideResult);
        setLiveLoaded(true);

        const nextStatus = transit.transit.status === "approved" || transit.transit.status === "rejected"
          ? transit.transit.status
          : "approved";
        setStatus(nextStatus);
        setName(transit.transit.submittedByName || "");
        setDate(transit.transit.submittedDate || new Date().toISOString().slice(0, 10));
        setComment(transit.transit.comment || "");
        setSubmitted(transit.transit.status === "approved" || transit.transit.status === "rejected");
        setSubmittedAt(transit.transit.submittedAt ? new Date(transit.transit.submittedAt).toLocaleString() : null);
        setTransitUpdatedAt(transit.transit.updatedAt || null);
      } catch (error) {
        if (cancelled) return;
        console.error("Failed to load transit approval workspace", error);
        setLiveLoaded(true);
      }
    }

    void loadLiveTransitWorkspace();
    return () => {
      cancelled = true;
    };
  }, [api, isDemo, projectId, shareAccess.isResolving, shareAccess.isShareMode]);

  // ----------------------------
  // Choose canonical source for allocation selectors
  // ----------------------------
  const domInventory: DomainInventoryItem[] = useMemo(() => {
    if (isDemo) return ctx.scopedActiveInventory as any; // already active + included
    if (hasActiveAllocationOverrides(allocationOverride)) {
      return buildAllocationOverrideDomain(allocationOverride as ApiAllocationOverrideResponse).inventory;
    }
    return liveInventory.map((item) => ({
      id: item.recordId || item.id,
      venueId: liveProject?.venueName || "",
      locationId: item.mapId,
      mediaVariantKey: item.mediaVariantKey,
      unitNumber: item.unitNumber || "",
      x: item.x,
      y: item.y,
      isActive: true,
    }));
  }, [allocationOverride, isDemo, ctx.scopedActiveInventory, liveInventory, liveProject?.venueName]);

  const domCreatives: DomainCreative[] = useMemo(() => {
    if (isDemo) return ctx.creatives as any;
    if (hasActiveAllocationOverrides(allocationOverride)) {
      return buildAllocationOverrideDomain(allocationOverride as ApiAllocationOverrideResponse).creatives;
    }
    return liveCreatives;
  }, [allocationOverride, isDemo, ctx.creatives, liveCreatives]);

  const domAssignments: DomainAssignment[] = useMemo(() => {
    if (isDemo) return ctx.assignments as any;
    if (hasActiveAllocationOverrides(allocationOverride)) {
      return buildAllocationOverrideDomain(allocationOverride as ApiAllocationOverrideResponse).assignments;
    }
    return liveAssignments;
  }, [allocationOverride, isDemo, ctx.assignments, liveAssignments]);

  const domScope: ProjectScope = useMemo(() => {
    if (isDemo) return (ctx.scope || { includedIds: [] }) as any;
    if (hasActiveAllocationOverrides(allocationOverride)) {
      return buildAllocationOverrideDomain(allocationOverride as ApiAllocationOverrideResponse).scope;
    }
    return liveScope;
  }, [allocationOverride, isDemo, ctx.scope, liveScope]);

  // Build Allocation sections canonically
  const sections = useMemo(() => {
    return buildVariantSections({
      creatives: domCreatives,
      inventory: domInventory,
      scope: domScope,
      assignments: domAssignments,
      mediaLabelFromKey,
    });
  }, [domCreatives, domInventory, domScope, domAssignments]);

  // ✅ NEW: Hide unassigned creatives (TA only cares about assigned)
  const displaySections = useMemo(() => {
    return sections
      .map((sec: any) => ({
        ...sec,
        creatives: (sec.creatives || []).filter((c: any) => (c.assignedCount || 0) > 0),
      }))
      .filter((sec: any) => (sec.creatives || []).length > 0);
  }, [sections]);

  // Creative lookup by id for display assets
  const creativeById = useMemo(() => {
    const m = new Map<string, any>();
    domCreatives.forEach((c: any) => m.set(c.id, c));
    return m;
  }, [domCreatives]);

  const inventoryLabelById = useMemo(() => {
    const map = new Map<string, string>();
    if (hasActiveAllocationOverrides(allocationOverride)) {
      return buildAllocationOverrideDomain(allocationOverride as ApiAllocationOverrideResponse).inventoryDisplayIdById;
    }
    liveInventory.forEach((item) => {
      map.set(item.recordId || item.id, item.id);
    });
    return map;
  }, [allocationOverride, liveInventory]);

  // ----------------------------
  // Form state
  // ----------------------------
  const [name, setName] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState<TAStatus>("approved");
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submittedAt, setSubmittedAt] = useState<string | null>(null);
  const [transitUpdatedAt, setTransitUpdatedAt] = useState<string | null>(null);

  const [lb, setLb] = useState<{
    src: string;
    title?: string;
    subtitle?: string;
    openUrl?: string;
    assetType?: "image" | "document";
  } | null>(null);

  const requiresComment = status === "rejected";
  const canResetTransit = isCustomerMode && submitted;
  const canSubmit = name.trim().length > 1 && (!requiresComment || comment.trim().length > 2);

  const pageProjectTitle = isDemo ? ctx.title : (liveProject?.title || "Project");
  const venueName = isDemo ? (ctx.venueName || "Penn Station") : (liveProject?.venueName || "Venue");
  const totalCreativeCount = displaySections.reduce((sum: number, sec: any) => sum + (sec.creatives?.length || 0), 0);
  const totalPlacementCount = displaySections.reduce(
    (sum: number, sec: any) =>
      sum + (sec.creatives || []).reduce((creativeSum: number, c: any) => creativeSum + (c.assignedCount || 0), 0),
    0
  );
  const transitDecisionLabel = submitted ? (status === "approved" ? "Approved" : "Rejected") : "Pending";
  const transitDecisionMeta = submitted ? (submittedAt || "Decision submitted") : "Awaiting authority decision";

  function submit() {
    if (!canSubmit) return;

    shareAccess.requireEdit("transit", "transit.decision", `${status === "approved" ? "approved" : "rejected"} transit approval`, () => {
      // Demo write-back for hub status
      if (isDemo && projectId) {
        demoStore.actions.upsertTransitApproval(projectId, {
          status: status === "approved" ? "approved" : "rejected",
          submittedByName: name.trim(),
          submittedDate: date,
          comment: comment.trim() || undefined,
          submittedAt: new Date().toISOString(),
        });
        setSubmitted(true);
        setSubmittedAt(new Date().toLocaleString());
        return;
      }

      if (projectId) {
        void updateProjectTransit(api, projectId, {
          status,
          submittedByName: name.trim(),
          submittedDate: date,
          comment: comment.trim() || null,
          submittedAt: new Date().toISOString(),
          expectedUpdatedAt: transitUpdatedAt,
        }, shareAccess.isShareMode).then((response) => {
          setStatus(response.transit.status === "rejected" ? "rejected" : "approved");
          setName(response.transit.submittedByName || "");
          setDate(response.transit.submittedDate || date);
          setComment(response.transit.comment || "");
          setSubmitted(true);
          setSubmittedAt(response.transit.submittedAt ? new Date(response.transit.submittedAt).toLocaleString() : new Date().toLocaleString());
          setTransitUpdatedAt(response.transit.updatedAt || null);
        });
      }
    });
  }

  function resetTransitStatus() {
    if (!projectId) return;
    shareAccess.requireEdit("transit", "transit.reset", "reset transit approval status", () => {
      if (isDemo) {
        demoStore.actions.upsertTransitApproval(projectId, {
          status: "not_started",
          submittedByName: undefined,
          submittedDate: undefined,
          comment: undefined,
          submittedAt: undefined,
        });
        setStatus("approved");
        setName("");
        setDate(new Date().toISOString().slice(0, 10));
        setComment("");
        setSubmitted(false);
        setSubmittedAt(null);
        demoStore.actions.pushToast("success", "Transit approval status reset");
        return;
      }

      void updateProjectTransit(api, projectId, {
        status: "not_started",
        submittedByName: null,
        submittedDate: null,
        comment: null,
        submittedAt: null,
        expectedUpdatedAt: transitUpdatedAt,
      }, shareAccess.isShareMode)
        .then(() => {
          setStatus("approved");
          setName("");
          setDate(new Date().toISOString().slice(0, 10));
          setComment("");
          setSubmitted(false);
          setSubmittedAt(null);
          setTransitUpdatedAt(null);
          demoStore.actions.pushToast("success", "Transit approval status reset");
        })
        .catch((error) => {
          console.error("Failed to reset transit approval", error);
          void logProjectErrorEvent(api, projectId, {
            actionType: "transit.reset",
            errorCode: "transit_reset_failed",
            message: "We couldn't reset transit approval yet.",
            severity: "error",
            surface: "transit_approval.reset",
            workspace: "transit",
          }, shareAccess.isShareMode).catch(() => undefined);
          demoStore.actions.pushToast("danger", "We couldn't reset transit approval yet.");
        });
    });
  }

  if (shareAccess.isShareMode && shareAccess.isResolving) {
    return (
      <AppShell pageClassName="wide" projectTitle={pageProjectTitle}>
        <div className="assign-empty">
          <div className="assign-empty-title">Loading Transit Approval</div>
          <div className="assign-empty-body">Checking your shared access and loading the latest artwork package.</div>
        </div>
      </AppShell>
    );
  }

  if (shareAccess.isShareMode && (!shareAccess.shareLink || shareAccess.isRevoked || !shareAccess.canView("transit"))) {
    return (
      <AppShell pageClassName="wide" projectTitle={pageProjectTitle}>
        <ShareAccessDenied
          title={shareAccess.isRevoked ? "This shared link has been revoked" : "This shared link cannot open Transit Approval"}
          body="Ask the project owner for a Transit Approval link if you need authority review access."
        />
      </AppShell>
    );
  }

  if (!isDemo && !liveLoaded) {
    return (
      <AppShell pageClassName="wide" projectTitle={pageProjectTitle}>
        <div className="assign-empty">
          <div className="assign-empty-title">Loading Transit Approval</div>
          <div className="assign-empty-body">Pulling the latest proof-backed artwork package and transit status.</div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell pageClassName="wide" projectTitle={pageProjectTitle}>
      <div className="ta-page">
        <PageHeader
          variant="workspace"
          className="page-header-compactProject ta-pageHeader"
          eyebrow="Transit Approval"
          title={pageProjectTitle}
          subtitle="Review the campaign artwork package and issue one authority decision for the project as a whole."
          backLabel={isCustomerMode ? "← Back to Hub" : undefined}
          onBack={() =>
            navigate(shareAccess.buildProjectUrl(`/p/${projectId}${modeSuffix}`), { state: isDemo ? { demo: true } : undefined })
          }
          meta={
            <>
              <span>{venueName}</span>
              <span className="page-header-dot">•</span>
              <span>Project: {projectId}</span>
              <span className="page-header-dot">•</span>
              <span>{transitDecisionLabel}</span>
            </>
          }
        />

        <div className="ta-grid">
          <Panel className="ta-allocation">
            <div className="ta-cardHead">
              <div>
                <div className="ta-cardTitle">Campaign Artwork Package</div>
                <div className="ta-cardSub">
                  All artwork submitted for this campaign is shown below. Review the package as a whole before approving or rejecting.
                </div>
              </div>
            </div>

            <div className="ta-summary">
              <div className="ta-summaryCard">
                <div className="ta-summaryLabel">Artwork Files</div>
                <div className="ta-summaryValue">{totalCreativeCount}</div>
              </div>
              <div className="ta-summaryCard">
                <div className="ta-summaryLabel">Placements Shown</div>
                <div className="ta-summaryValue">{totalPlacementCount}</div>
              </div>
              <div className={`ta-summaryCard ta-summaryCard-status ${submitted ? (status === "approved" ? "is-approved" : "is-rejected") : "is-pending"}`}>
                <div className="ta-summaryLabel">Decision</div>
                <div className="ta-summaryValue ta-summaryValue-text">{transitDecisionLabel}</div>
                <div className="ta-summaryText">{transitDecisionMeta}</div>
              </div>
              <div className="ta-summaryCard ta-summaryCard-wide">
                <div className="ta-summaryLabel">Review Guidance</div>
                <div className="ta-summaryText">
                  This page is for overall transit-authority approval. File-level production statuses are intentionally de-emphasized here.
                </div>
              </div>
            </div>

            <div className="ta-sections">
              {displaySections.map((sec: any) => (
                <div key={sec.variantKey} className="ta-variant">
                  <div className="ta-variantHead">
                    <div className="ta-variantTitle">{sec.label}</div>
                    <div className={`ta-variantCount ok`}>
                      {sec.creatives.length} artwork file{sec.creatives.length === 1 ? "" : "s"}
                    </div>
                  </div>

                  <div className="ta-creativeList">
                    {sec.creatives.map((c: any) => {
                      const domC = creativeById.get(c.creativeId);
                      const asset = pickCreativeDisplayAsset({
						  creative: { id: c.creativeId, thumbUrl: domC?.thumbUrl, fullUrl: domC?.fullUrl },
						  proofsForProject: (isDemo ? demoProofLines : liveProofLines) as any[],
						  mode: "proof", // TA should be proof-first
						});

                      const thumb =
                        asset.thumbUrl ||
                        asset.fullUrl ||
                        buildDocumentThumbUrl({
                          label: c.fileMeta?.toUpperCase().includes("PDF") ? "PDF" : "FILE",
                          accent: c.color,
                        });
                      const full = asset.fullUrl || asset.thumbUrl || thumb;

                      const assetLabel =
                        asset.source === "proof"
                          ? (asset.proofStatus === "approved" ? "Transit review proof" : "Transit review proof")
                          : "Submitted artwork";

                      return (
                        <div key={c.creativeId} className="ta-creativeRow">
                          <button
                            type="button"
                            className="ta-thumbBtn"
                            title="Click to preview"
                            onClick={() =>
                              setLb({
                                src: thumb,
                                title: c.filename,
                                subtitle: c.fileMeta,
                                openUrl: full,
                                assetType: c.fileMeta?.toUpperCase().includes("PDF") ? "document" : "image",
                              })
                            }
                          >
                            <img className="ta-thumbImg" src={thumb} alt="" loading="lazy" />
                            <span className="ta-thumbDot" style={{ background: c.color }} />
                          </button>

                          <div className="ta-creativeMain">
                            <div className="ta-creativeName" title={c.filename}>
                              {c.filename}
                            </div>
                            <div className="ta-creativeMeta">
                              {c.fileMeta} · <span style={{ color: "var(--muted)" }}>{assetLabel}</span>
                            </div>

                            <div className="ta-creativeCoverage">
                              Displayed in {c.assignedCount} placement{c.assignedCount === 1 ? "" : "s"}
                            </div>

                            <div className="ta-creativeLocs">
                              {c.assignedIds.slice(0, 10).map((id: string) => (
                                <span key={id} className="ta-locChip">
                                  {inventoryLabelById.get(id) || id}
                                </span>
                              ))}
                              {c.assignedCount > 10 && (
                                <span className="ta-locMore">+ {c.assignedCount - 10} more</span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              {displaySections.length === 0 && (
                <div className="ta-emptyRow">
                  {!isDemo && !liveLoaded ? "Loading artwork package…" : "No assigned creatives yet."}
                </div>
              )}
            </div>
          </Panel>

          <Panel className="ta-form">
            <div className="ta-cardHead">
              <div>
                <div className="ta-cardTitle">Authority Decision</div>
                <div className="ta-cardSub">
                  Record one overall decision for the full campaign artwork package. Reject requires a comment describing what must change.
                </div>
              </div>
            </div>

            {submitted ? (
              <div className="ta-confirm">
                <div className="ta-confirmBadge">Submitted</div>
                <div className="ta-confirmTitle">
                  Campaign {status === "approved" ? "approved" : "rejected"} by {name.trim()}
                </div>
                <div className="ta-confirmMeta">{submittedAt ? `Submitted: ${submittedAt}` : ""}</div>
                {comment.trim() && (
                  <div className="ta-confirmComment">
                    <div className="ta-confirmCommentLabel">Authority note</div>
                    <div className="ta-confirmCommentBody">{comment.trim()}</div>
                  </div>
                )}
                {canResetTransit && (
                  <div className="ta-actions">
                    <button className="btn btn-ghost btn-soft" type="button" onClick={resetTransitStatus}>
                      Reset Status
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="ta-formBody">
                <div className="ta-decisionNote">
                  Approve if the campaign artwork package is acceptable for transit display. Reject if the package requires revisions before approval.
                </div>

                <div className="ta-field">
                  <div className="ta-label">Reviewer Name *</div>
                  <input className="ta-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
                </div>

                <div className="ta-field">
                  <div className="ta-label">Date</div>
                  <input type="date" className="ta-input" value={date} onChange={(e) => setDate(e.target.value)} />
                </div>

                <div className="ta-field">
                  <div className="ta-label">Decision *</div>
                  <div className="ta-seg">
                    <button type="button" className={`ta-segBtn ${status === "approved" ? "is-on" : ""}`} onClick={() => setStatus("approved")}>
                      Approve Campaign
                    </button>
                    <button type="button" className={`ta-segBtn ${status === "rejected" ? "is-on" : ""}`} onClick={() => setStatus("rejected")}>
                      Reject Campaign
                    </button>
                  </div>
                </div>

                <div className="ta-field">
                  <div className="ta-label">Authority Comment {requiresComment ? "*" : "(optional)"}</div>
                  <textarea
                    className="ta-textarea"
                    rows={5}
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder={requiresComment ? "Describe what must change before the campaign can be approved…" : "Add any overall approval notes (optional)…"}
                  />
                </div>

                <div className="ta-actions">
                  <button
                    className="btn btn-ghost btn-soft"
                    type="button"
                    onClick={() => (window.history.length > 1 ? window.history.back() : navigate(shareAccess.buildProjectUrl(`/p/${projectId}${modeSuffix}`)))}
                  >
                    Cancel
                  </button>
                  <button className="btn btn-primary btn-wide" type="button" disabled={!canSubmit} onClick={submit}>
                    Submit Decision
                  </button>
                </div>

                <div className="ta-note">This decision applies to the entire campaign artwork package, not to individual lines.</div>
              </div>
            )}
          </Panel>
        </div>

        <Lightbox
          isOpen={!!lb}
          src={lb?.src || ""}
          title={lb?.title}
          subtitle={lb?.subtitle}
          openInNewTabUrl={lb?.openUrl}
          assetType={lb?.assetType}
          onClose={() => setLb(null)}
        />
        {shareAccess.identityModal()}
      </div>
    </AppShell>
  );
}
