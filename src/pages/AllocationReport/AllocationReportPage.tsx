// src/pages/AllocationReport/AllocationReportPage.tsx
import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams, useLocation } from "react-router-dom";
import { useApiClient } from "../../api/useApiClient";
import { fetchProjectAllocationOverride, fetchProjectProofs, fetchProjectWorkspace, normalizeCreativeAsset, normalizeWorkspaceInventory, type ApiAllocationOverrideResponse } from "../../api/projects";

import { mediaLabelFromKey } from "../../logic/mockAssignment";
import { buildDocumentThumbUrl } from "../../logic/imageUrls";
import { isDemoProjectRoute } from "../../logic/projectMode";
import { buildInventoryDisplayIdMap, toDomainInventoryFromLegacy } from "../../logic/inventoryIdentity";
import { buildAllocationOverrideDomain, hasActiveAllocationOverrides } from "../../logic/allocationOverride";

import { demoStore, useDemoStore } from "../../domain/store/demoStore";

// Canonical domain selector
import { buildVariantSections } from "../../domain/selectors/allocationSelectors";

// NEW: proof-first display asset selector
import { pickCreativeDisplayAsset } from "../../domain/selectors/displayAsset";

// Canonical domain types
import type {
  Creative as DomainCreative,
  InventoryItem as DomainInventoryItem,
  Assignment as DomainAssignment,
  ProjectScope,
} from "../../domain/types";

/**
 * Allocation Report Page
 * - Demo mode: store-driven (canonical domain)
 * - Non-demo: bridges legacy props to canonical domain (temporary)
 * - Print-friendly; 1 creative per page; supports ?print=1
 *
 * Key UX requirements:
 * - Hide unassigned creatives by default (matches TA page)
 *   Use ?show_unassigned=1 to include them.
 * - Always show the "latest asset":
 *   Approved proof > pending proof > uploaded creative > fallback mock preview.
 */
export default function AllocationReportPage({
  creatives,
  inventory,
  projectTitle,
  venueName,
}: {
  creatives?: any[]; // legacy CreativeAsset[] shape
  inventory?: any[]; // legacy InventoryItem[] shape
  projectTitle?: string;
  venueName?: string;
}) {
  const { projectId } = useParams();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const api = useApiClient();

  const shouldPrint = searchParams.get("print") === "1";
  const showUnassigned = searchParams.get("show_unassigned") === "1";
  const assetMode = (searchParams.get("asset") === "proof" ? "proof" : "upload") as "upload" | "proof";

  const isDemo = isDemoProjectRoute(projectId, (location.state as any)?.demo === true);
  const isShareMode = searchParams.has("share");

  const [liveProjectMeta, setLiveProjectMeta] = useState<{ title: string; venueName: string } | null>(null);
  const [liveCreatives, setLiveCreatives] = useState<any[]>([]);
  const [liveInventory, setLiveInventory] = useState<any[]>([]);
  const [liveProofLines, setLiveProofLines] = useState<any[]>([]);
  const [allocationOverride, setAllocationOverride] = useState<ApiAllocationOverrideResponse | null>(null);
  const [liveLoaded, setLiveLoaded] = useState(false);

  useEffect(() => {
    if (isDemo) demoStore.actions.hydrateDemo();
  }, [isDemo]);

  useEffect(() => {
    let cancelled = false;

    async function loadLiveReport() {
      if (!projectId || isDemo) return;
      try {
        setLiveLoaded(false);
        const [workspace, proofs, overrideResult] = await Promise.all([
          fetchProjectWorkspace(api, projectId, isShareMode),
          fetchProjectProofs(api, projectId, isShareMode),
          isShareMode ? Promise.resolve(null) : fetchProjectAllocationOverride(api, projectId).catch(() => null),
        ]);
        if (cancelled) return;
        setLiveProjectMeta({
          title: workspace.project.title,
          venueName: workspace.project.venueName,
        });
        setLiveCreatives(workspace.workspace.creatives.map(normalizeCreativeAsset));
        setLiveInventory(normalizeWorkspaceInventory(workspace.workspace.inventory));
        setLiveProofLines(proofs.proofs || []);
        setAllocationOverride(overrideResult);
      } catch (error) {
        if (cancelled) return;
        console.error("Failed to load allocation report workspace", error);
      } finally {
        if (!cancelled) setLiveLoaded(true);
      }
    }

    void loadLiveReport();
    return () => {
      cancelled = true;
    };
  }, [api, isDemo, isShareMode, projectId]);

  // ----------------------------
  // Demo store reads (stable refs only)
  // ----------------------------
  const demoActiveProjectId = useDemoStore((s) => s.activeProjectId);
  const demoProjects = useDemoStore((s) => s.projects);
  const demoVenues = useDemoStore((s) => s.venues);
  const demoInventoryAll = useDemoStore((s) => s.inventory);
  const demoCreativesAll = useDemoStore((s) => s.creatives);
  const demoAssignmentsAll = useDemoStore((s) => s.assignments);
  const demoScopes = useDemoStore((s) => s.scopes);
  const demoProofsByProject = useDemoStore((s) => s.proofs);

  const demoProject = useMemo(() => {
    return demoProjects.find((p) => p.id === demoActiveProjectId);
  }, [demoProjects, demoActiveProjectId]);

  const demoVenue = useMemo(() => demoVenues[0], [demoVenues]);

  const demoScope: ProjectScope | undefined = useMemo(() => {
    return demoScopes[demoActiveProjectId];
  }, [demoScopes, demoActiveProjectId]);

  const demoProjectCreatives: DomainCreative[] = useMemo(() => {
    return demoCreativesAll.filter((c) => c.projectId === demoActiveProjectId);
  }, [demoCreativesAll, demoActiveProjectId]);

  const demoProjectAssignments: DomainAssignment[] = useMemo(() => {
    return demoAssignmentsAll.filter((a) => a.projectId === demoActiveProjectId);
  }, [demoAssignmentsAll, demoActiveProjectId]);

  const demoProofLines = useMemo(() => {
    return demoProofsByProject[demoActiveProjectId] || [];
  }, [demoProofsByProject, demoActiveProjectId]);

  // ----------------------------
  // Non-demo bridge: legacy props -> canonical domain
  // ----------------------------
  const bridged = useMemo(() => {
    if (isDemo) return null;

    const venueId = "venue_unknown";
    const pid = projectId || "proj";
    if (hasActiveAllocationOverrides(allocationOverride)) {
      const overrideDomain = buildAllocationOverrideDomain(allocationOverride as ApiAllocationOverrideResponse);
      return {
        domInventory: overrideDomain.inventory,
        domCreatives: overrideDomain.creatives,
        domAssignments: overrideDomain.assignments,
        scope: overrideDomain.scope,
        inventoryDisplayIdById: overrideDomain.inventoryDisplayIdById,
      };
    }

    const sourceInventory = (liveInventory.length > 0 ? liveInventory : inventory || []) as any[];
    const sourceCreatives = (liveCreatives.length > 0 ? liveCreatives : creatives || []) as any[];

    const domInventory: DomainInventoryItem[] = toDomainInventoryFromLegacy(sourceInventory, venueId);

    const scope: ProjectScope = {
      includedIds: domInventory.map((i) => i.id),
    };

    const domCreatives: DomainCreative[] = sourceCreatives.map((c) => ({
      id: c.id,
      projectId: pid,
      filename: c.filename,
      fileMeta: c.fileMeta,
      mediaVariantKey: c.mediaVariantKey,
      color: c.color,
      // if legacy provides URLs, keep them; else fallback later
      thumbUrl: (c as any).thumbUrl || "",
      fullUrl: (c as any).fullUrl || "",
      createdAt: new Date().toISOString(),
    }));

    const domAssignments: DomainAssignment[] = sourceInventory.map((i) => ({
      projectId: pid,
      inventoryId: i.recordId || i.id,
      creativeId: i.assignedCreativeId ?? null,
      updatedAt: new Date().toISOString(),
    }));

    return { domInventory, domCreatives, domAssignments, scope, inventoryDisplayIdById: null };
  }, [isDemo, allocationOverride, creatives, inventory, liveCreatives, liveInventory, projectId]);

  // ----------------------------
  // Choose canonical data source
  // ----------------------------
  const domInventory: DomainInventoryItem[] = useMemo(() => {
    if (isDemo) return demoInventoryAll;
    return bridged?.domInventory || [];
  }, [isDemo, demoInventoryAll, bridged]);

  const domCreatives: DomainCreative[] = useMemo(() => {
    if (isDemo) return demoProjectCreatives;
    return bridged?.domCreatives || [];
  }, [isDemo, demoProjectCreatives, bridged]);

  const domAssignments: DomainAssignment[] = useMemo(() => {
    if (isDemo) return demoProjectAssignments;
    return bridged?.domAssignments || [];
  }, [isDemo, demoProjectAssignments, bridged]);

  const domScope: ProjectScope = useMemo(() => {
    if (isDemo) return demoScope || { includedIds: [] };
    return bridged?.scope || { includedIds: [] };
  }, [isDemo, demoScope, bridged]);

  // Titles (demo uses store; non-demo uses props)
  const effectiveProjectTitle = isDemo
    ? (demoProject?.title || projectTitle || `Project ${projectId}`)
    : (liveProjectMeta?.title || projectTitle || `Project ${projectId}`);

  const effectiveVenueName = isDemo
    ? (demoVenue?.name || venueName || "Venue")
    : (liveProjectMeta?.venueName || venueName || "Venue");

  // ----------------------------
  // Canonical allocation sections
  // ----------------------------
  const sections = useMemo(() => {
    return buildVariantSections({
      creatives: domCreatives,
      inventory: domInventory,
      scope: domScope,
      assignments: domAssignments,
      mediaLabelFromKey,
    });
  }, [domCreatives, domInventory, domScope, domAssignments]);

  // lookup creative for thumb/full (non-demo fallback)
  const creativeById = useMemo(() => {
    const m = new Map<string, any>();
    domCreatives.forEach((c: any) => m.set(c.id, c));
    return m;
  }, [domCreatives]);

  const inventoryDisplayIdById = useMemo(() => {
    if (isDemo) return new Map<string, string>();
    if (bridged?.inventoryDisplayIdById) return bridged.inventoryDisplayIdById;
    return buildInventoryDisplayIdMap((liveInventory.length > 0 ? liveInventory : inventory || []) as any[]);
  }, [bridged, inventory, isDemo, liveInventory]);

  // Flatten into per-creative pages (sorted by media label then filename)
  // Default: hide unassigned unless ?show_unassigned=1
  const pages = useMemo(() => {
    const out: Array<{
      creativeId: string;
      filename: string;
      fileMeta: string;
      label: string;
      assignedIds: string[];
      assignedCount: number;
    }> = [];

    for (const sec of sections) {
      for (const c of sec.creatives) {
        const assignedCount = c.assignedIds.length;
        if (!showUnassigned && assignedCount === 0) continue;

        out.push({
          creativeId: c.creativeId,
          filename: c.filename,
          fileMeta: c.fileMeta,
          label: sec.label,
          assignedIds: c.assignedIds,
          assignedCount,
        });
      }
    }

    out.sort((a, b) => {
      if (a.label !== b.label) return a.label.localeCompare(b.label);
      return a.filename.localeCompare(b.filename);
    });

    return out;
  }, [sections, showUnassigned]);

  // Auto-print if requested
  useEffect(() => {
    if (!shouldPrint) return;
    if (!isDemo && !liveLoaded) return;
    const t = setTimeout(() => window.print(), 250);
    return () => clearTimeout(t);
  }, [isDemo, liveLoaded, shouldPrint]);

  if (!isDemo && !liveLoaded && !creatives?.length && !inventory?.length) {
    return (
      <div className="alloc-report">
        <section className="alloc-page">
          <header className="alloc-head">
            <div className="alloc-title">Creative Allocation Report</div>
            <div className="alloc-sub">Loading the latest live project inventory and creative assignments.</div>
            <div className="alloc-kicker">Review Packet Export</div>
          </header>
        </section>
      </div>
    );
  }

  return (
    <div className="alloc-report">
      {pages.length === 0 && (
        <section className="alloc-page">
          <header className="alloc-head">
            <div className="alloc-title">Creative Allocation Report</div>
            <div className="alloc-sub">
              {effectiveProjectTitle} · {effectiveVenueName}
            </div>
            <div className="alloc-kicker">Review Packet Export</div>
          </header>

          <div className="alloc-card">
            <div className="alloc-meta">
              <div className="alloc-filename">No assigned creatives yet</div>
              <div className="alloc-filemeta">
                This report will populate once artwork has been assigned to included inventory locations.
              </div>
              <div className="alloc-empty" style={{ marginTop: 12 }}>
                No assigned locations are available for export.
              </div>
            </div>
          </div>

          <footer className="alloc-foot">
            Generated from Adspace360 · {new Date().toLocaleString()}
          </footer>
        </section>
      )}

      {pages.map((c) => {
        // Proof-first display for demo; otherwise fallback to creative URLs/mock
        const domC = creativeById.get(c.creativeId);

		const asset = isDemo
		  ? pickCreativeDisplayAsset({
			  creative: {
				id: c.creativeId,
				thumbUrl: (domC as any)?.thumbUrl,
				fullUrl: (domC as any)?.fullUrl,
			  },
			  proofsForProject: demoProofLines as any[],
			  mode: assetMode,
			})
		  : pickCreativeDisplayAsset({
          creative: {
            id: c.creativeId,
            thumbUrl: (domC as any)?.thumbUrl,
            fullUrl: (domC as any)?.fullUrl,
          },
          proofsForProject: liveProofLines as any[],
          mode: assetMode === "proof" ? "proof" : "best",
        });

        const previewSrc =
          asset.thumbUrl ||
          asset.fullUrl ||
          buildDocumentThumbUrl({
            label: c.fileMeta?.toUpperCase().includes("PDF") ? "PDF" : "FILE",
            accent: (domC as any)?.color || "#94a3b8",
          });

        const previewFull =
          asset.fullUrl ||
          asset.thumbUrl ||
          previewSrc;

		const assetLabel =
		  asset.source === "proof"
			? (asset.proofStatus === "approved" ? "Approved proof" : "Proof")
			: "Uploaded file";

        return (
          <section className="alloc-page" key={c.creativeId}>
            <header className="alloc-head">
              <div className="alloc-title">Creative Allocation Report</div>
              <div className="alloc-sub">
                {effectiveProjectTitle} · {effectiveVenueName}
              </div>
              <div className="alloc-kicker">Review Packet Export</div>
            </header>

            <div className="alloc-card">
              <div className="alloc-preview">
                <img src={previewSrc} alt="" />
              </div>

              <div className="alloc-meta">
                <div className="alloc-filename" title={c.filename}>
                  {c.filename}
                </div>

                <div className="alloc-filemeta">
                  {c.fileMeta} · <span style={{ color: "var(--muted)" }}>{assetLabel}</span>
                </div>

                <div className="alloc-variant">{c.label}</div>

                <div className="alloc-statRow">
                  <div className="alloc-stat">
                    <span className="alloc-statLabel">Locations</span>
                    <span className="alloc-statValue">{c.assignedIds.length}</span>
                  </div>
                  <div className="alloc-stat">
                    <span className="alloc-statLabel">Source</span>
                    <span className="alloc-statValue">{assetLabel}</span>
                  </div>
                </div>

                <div className="alloc-assignHead">
                  Assigned Locations ({c.assignedIds.length})
                </div>

                {c.assignedIds.length === 0 ? (
                  <div className="alloc-empty">No locations assigned.</div>
                ) : (
                  <div className="alloc-locs">
                    {c.assignedIds.map((id) => (
                      <div className="alloc-loc" key={id}>
                        {inventoryDisplayIdById.get(id) || id}
                      </div>
                    ))}
                  </div>
                )}

                {/* Optional: open full asset in new tab (useful in non-print mode) */}
                {!shouldPrint && (
                  <div style={{ marginTop: 12 }}>
                    <a
                      href={previewFull}
                      target="_blank"
                      rel="noreferrer"
                      style={{ fontSize: 12, fontWeight: 800, color: "var(--muted)" }}
                    >
                      Open full preview
                    </a>
                  </div>
                )}
              </div>
            </div>

            <footer className="alloc-foot">
              Generated from Adspace360 · {new Date().toLocaleString()}
            </footer>
          </section>
        );
      })}
    </div>
  );
}
