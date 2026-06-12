// src/pages/AngieDashboard/AngieDashboardPage.tsx

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import AppShell from "../../app/AppShell";
import Panel from "../../components/common/Panel";
import DataTable from "../../components/table/DataTable";

import type { ProjectRollup } from "../../logic/mockRollups";
import {
  getAngieAssignmentSummary,
  getAngieProofsSummary,
  getAngieRowPrimaryAction,
  getProductionLabel,
  getTransitChip,
} from "../../logic/renderingRules";
import { buildAngieProjectTableColumns } from "../../logic/tableColumnDefs";

import CreateProjectModal, {
  type NewProjectDraft,
  type ProjectCustomerOption,
  type ProjectMarketOption,
  type ProjectVenueOption,
} from "../../components/projects/CreateProjectModal";
import { useApiClient } from "../../api/useApiClient";

type TabKey = "all" | "needs_attention" | "active" | "ready";
type StatusFilter = "all" | "needs_attention" | "awaiting_proof" | "ready" | "transit_blocked";
type ProjectModeFilter = "all" | "live" | "internal_sandbox";

type ActiveFilterChip = {
  id: string;
  label: string;
  onClear: () => void;
};

type ApiCustomer = {
  id: string;
  name: string;
  status?: "active" | "suspended" | "inactive";
  isActive: boolean;
  isInternalSandbox?: boolean;
};

type ApiMarket = {
  id: string;
  customerId: string;
  name: string;
  customerName?: string;
  isActive: boolean;
};

type ApiVenue = {
  id: string;
  customerId: string;
  marketId: string;
  name: string;
  customerName?: string;
  marketName?: string;
  isActive: boolean;
};

type ApiProjectSummary = {
  id: string;
  projectMode?: "live" | "internal_sandbox";
  customerId: string;
  customerName: string;
  sourceCustomerId?: string;
  sourceCustomerName?: string;
  marketId: string;
  marketName: string;
  venueId: string;
  venueName: string;
  title: string;
  poNumber?: string;
  adspaceOrderNumber?: string;
  extId: string;
  liftOrderId?: string | null;
  artworkDueDate?: string;
  postDate?: string;
  endClientName?: string;
  assignment: {
    required: number;
    assigned: number;
    complete: boolean;
  };
  proofs: {
    total: number;
    approved: number;
    pending: number;
    revised: number;
    waitingForProof: number;
  };
  transit: {
    enabled: boolean;
    status: "not_required" | "not_started" | "pending" | "approved" | "rejected" | "changes_requested";
  };
  production: {
    policy: "direct" | "hold_for_release";
    ready: boolean;
    awaitingRelease: boolean;
    released: boolean;
  };
  needsAttention: boolean;
};

function normalize(s: string) {
  return (s || "").toLowerCase().trim();
}

function useDashboardMobileLayout() {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(max-width: 1024px)").matches;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    const query = window.matchMedia("(max-width: 1024px)");
    const sync = () => setIsMobile(query.matches);

    sync();

    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", sync);
      return () => query.removeEventListener("change", sync);
    }

    query.addListener(sync);
    return () => query.removeListener(sync);
  }, []);

  return isMobile;
}

function matchesSearch(r: ProjectRollup, q: string) {
  const hay = [
    r.title,
    r.venueName,
    r.marketName,
    r.endClientName || "",
    r.adspaceOrderNumber || "",
    r.extId,
    r.poNumber,
    r.liftOrderId || "",
  ]
    .map(normalize)
    .join(" | ");

  return hay.includes(q);
}

// Tab mapping (simple + useful now; refine later)
function matchesTab(r: ProjectRollup, tab: TabKey) {
  if (tab === "all") return true;

  if (tab === "needs_attention") return r.needsAttention;

  if (tab === "ready") {
    if (r.production.policy === "hold_for_release") return !!r.production.released;
    return r.production.ready;
  }

  if (tab === "active") {
    const isReady =
      (r.production.policy === "hold_for_release" && !!r.production.released) ||
      (r.production.policy === "direct" && r.production.ready);

    return !r.needsAttention && !isReady;
  }

  return true;
}

function matchesStatusFilter(r: ProjectRollup, f: StatusFilter) {
  if (f === "all") return true;
  if (f === "needs_attention") return r.needsAttention;
  if (f === "awaiting_proof") return r.proofs.total > 0 && (r.proofs.pending > 0 || (r.proofs.waitingForProof || 0) > 0);
  if (f === "ready") return r.production.ready === true;
  if (f === "transit_blocked") return r.transit.enabled && r.transit.status !== "approved";
  return true;
}

function tabLabel(tab: TabKey) {
  if (tab === "needs_attention") return "Needs Attention";
  if (tab === "active") return "Active";
  if (tab === "ready") return "Ready";
  return "All";
}

function statusFilterLabel(filter: StatusFilter) {
  if (filter === "needs_attention") return "Needs Attention";
  if (filter === "awaiting_proof") return "Awaiting Proof";
  if (filter === "ready") return "Ready / Released";
  if (filter === "transit_blocked") return "Transit Blocked";
  return "All";
}

function modeFilterLabel(filter: ProjectModeFilter) {
  if (filter === "live") return "Live";
  if (filter === "internal_sandbox") return "Sandbox";
  return "All Modes";
}

/**
 * TEMP BRIDGE (you requested this)
 * Converts current legacy mockInventory rows from logic/mockAssignment
 * into canonical domain InventoryItem shape.
 *
 * Notes:
 * - legacy uses mapId; canonical uses locationId
 * - we mark everything active for now (venue admin will control later)
 * - unitNumber is already on your legacy items (you added it earlier)
 */
function mapProjectSummaryToRow(project: ApiProjectSummary): ProjectRollup {
  return {
    projectId: project.id,
    accountId: `acct_${project.customerId}`,
    projectMode: project.projectMode || "live",
    title: project.title,
    venueName: project.venueName,
    marketName: project.marketName,
    endClientName: project.endClientName,
    sourceCustomerName: project.sourceCustomerName,
    adspaceOrderNumber: project.adspaceOrderNumber,
    extId: project.extId,
    poNumber: project.poNumber || "—",
    liftOrderId: project.liftOrderId || null,
    dates: {
      artworkDue: project.artworkDueDate || null,
      postDate: project.postDate || null,
    },
    assignment: {
      required: project.assignment.required,
      assigned: project.assignment.assigned,
      complete: project.assignment.complete,
    },
    proofs: {
      total: project.proofs.total,
      approved: project.proofs.approved,
      pending: project.proofs.pending,
      revised: project.proofs.revised,
      waitingForProof: project.proofs.waitingForProof,
    },
    transit: {
      enabled: project.transit.enabled,
      status: project.transit.status,
    },
    production: {
      policy: project.production.policy,
      ready: project.production.ready,
      awaitingRelease: project.production.awaitingRelease,
      released: project.production.released,
    },
    needsAttention: project.needsAttention,
  };
}

export default function AngieDashboardPage() {
  const navigate = useNavigate();
  const api = useApiClient();
  const showMobileDashboardCards = useDashboardMobileLayout();

  const columns = useMemo(
    () =>
      buildAngieProjectTableColumns({
        canSubmitOrders: true,
        canApproveForProduction: true,
        showTransitColumn: true,
      }),
    []
  );

  // UI state
  const [tab, setTab] = useState<TabKey>("all");
  const [query, setQuery] = useState("");
  const [venue, setVenue] = useState("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [projectModeFilter, setProjectModeFilter] = useState<ProjectModeFilter>("all");
  const [isCreateOpen, setCreateOpen] = useState(false);
  const [customers, setCustomers] = useState<ApiCustomer[]>([]);
  const [markets, setMarkets] = useState<ApiMarket[]>([]);
  const [venues, setVenues] = useState<ApiVenue[]>([]);
  const [backendProjects, setBackendProjects] = useState<ApiProjectSummary[]>([]);
  const [projectLoading, setProjectLoading] = useState(true);
  const [bootstrapError, setBootstrapError] = useState(false);
  const [setupOptionsLoading, setSetupOptionsLoading] = useState(false);
  const [setupOptionsLoaded, setSetupOptionsLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadProjectList() {
      setProjectLoading(true);
      setBootstrapError(false);
      try {
        const projectResponse = await api.request<{ projects: ApiProjectSummary[] }>("/api/projects");
        if (cancelled) return;
        setBackendProjects(projectResponse.projects || []);
      } catch (error) {
        console.error("Failed to load project bootstrap data", error);
        if (!cancelled) setBootstrapError(true);
      } finally {
        if (!cancelled) setProjectLoading(false);
      }
    }

    void loadProjectList();
    return () => {
      cancelled = true;
    };
  }, [api]);

  async function loadProjectSetupOptions() {
    if (setupOptionsLoaded || setupOptionsLoading) return;
    setSetupOptionsLoading(true);
    try {
      const [customerResponse, venueResponse] = await Promise.all([
        api.request<{ customers: ApiCustomer[] }>("/api/customers?lite=1"),
        api.request<{ venues: ApiVenue[] }>("/api/venues?lite=1"),
      ]);

      const activeCustomers = (customerResponse.customers || []).filter(
        (customer) => (customer.status || (customer.isActive === false ? "inactive" : "active")) === "active"
      );
      const activeVenues = (venueResponse.venues || []).filter((item) => item.isActive !== false);

      setCustomers(activeCustomers);
      setVenues(activeVenues);
      setMarkets(deriveMarketsFromVenues(activeVenues));
      setSetupOptionsLoaded(true);
    } catch (error) {
      console.error("Failed to load project setup options", error);
    } finally {
      setSetupOptionsLoading(false);
    }
  }

  function handleOpenCreateProject() {
    setCreateOpen(true);
    void loadProjectSetupOptions();
  }

  const allRows = useMemo(() => {
    return backendProjects.map(mapProjectSummaryToRow);
  }, [backendProjects]);

  const customerOptions = useMemo<ProjectCustomerOption[]>(
    () =>
      customers.map((customer) => ({
        id: customer.id,
        name: customer.name,
        status: customer.status,
        isInternalSandbox: customer.isInternalSandbox,
      })),
    [customers]
  );
  const marketOptions = useMemo<ProjectMarketOption[]>(
    () =>
      markets.map((market) => ({
        id: market.id,
        customerId: market.customerId,
        name: market.name,
        customerName: market.customerName,
        isActive: market.isActive,
      })),
    [markets]
  );
  const venueOptionsForCreate = useMemo<ProjectVenueOption[]>(
    () =>
      venues.map((item) => ({
        id: item.id,
        customerId: item.customerId,
        marketId: item.marketId,
        name: item.name,
        customerName: item.customerName,
        marketName: item.marketName,
        isActive: item.isActive,
      })),
    [venues]
  );

  const hasSandboxProjects = useMemo(
    () => allRows.some((row) => row.projectMode === "internal_sandbox"),
    [allRows]
  );

  const venueOptions = useMemo(() => {
    const set = new Set<string>();
    allRows.forEach((r) => set.add(r.venueName));
    return ["all", ...Array.from(set).sort()];
  }, [allRows]);

  const filteredRows = useMemo(() => {
    const q = normalize(query);

    return allRows
      .filter((r) => (projectModeFilter === "all" ? true : (r.projectMode || "live") === projectModeFilter))
      .filter((r) => matchesTab(r, tab))
      .filter((r) => (venue === "all" ? true : r.venueName === venue))
      .filter((r) => matchesStatusFilter(r, statusFilter))
      .filter((r) => (q ? matchesSearch(r, q) : true));
  }, [allRows, projectModeFilter, query, statusFilter, tab, venue]);

  const tabCounts = useMemo(() => {
    return {
      all: allRows.length,
      needs_attention: allRows.filter((r) => matchesTab(r, "needs_attention")).length,
      active: allRows.filter((r) => matchesTab(r, "active")).length,
      ready: allRows.filter((r) => matchesTab(r, "ready")).length,
    };
  }, [allRows]);

  const portfolioSummary = useMemo(() => {
    const needsAttention = allRows.filter((r) => r.needsAttention).length;
    const awaitingProofs = allRows.filter(
      (r) => r.proofs.total > 0 && (r.proofs.pending > 0 || (r.proofs.waitingForProof || 0) > 0)
    ).length;
    const transitBlocked = allRows.filter(
      (r) => r.transit.enabled && r.transit.status !== "approved"
    ).length;
    const readyToRelease = allRows.filter(
      (r) => (r.production.policy === "hold_for_release" && !!r.production.released) || r.production.ready
    ).length;

    return [
      { label: "Needs Attention", value: needsAttention, tone: "warning", filter: "needs_attention" },
      { label: "Awaiting Proof", value: awaitingProofs, tone: "info", filter: "awaiting_proof" },
      { label: "Transit Blocked", value: transitBlocked, tone: "danger", filter: "transit_blocked" },
      { label: "Ready / Released", value: readyToRelease, tone: "success", filter: "ready" },
    ] as const;
  }, [allRows]);

  const activeFilterChips = useMemo<ActiveFilterChip[]>(() => {
    const chips: ActiveFilterChip[] = [];

    if (tab !== "all") {
      chips.push({
        id: "tab",
        label: `View: ${tabLabel(tab)}`,
        onClear: () => setTab("all"),
      });
    }

    if (projectModeFilter !== "all") {
      chips.push({
        id: "mode",
        label: `Mode: ${modeFilterLabel(projectModeFilter)}`,
        onClear: () => setProjectModeFilter("all"),
      });
    }

    if (venue !== "all") {
      chips.push({
        id: "venue",
        label: `Venue: ${venue}`,
        onClear: () => setVenue("all"),
      });
    }

    if (statusFilter !== "all") {
      chips.push({
        id: "focus",
        label: `Focus: ${statusFilterLabel(statusFilter)}`,
        onClear: () => setStatusFilter("all"),
      });
    }

    if (query.trim()) {
      chips.push({
        id: "search",
        label: `Search: ${query.trim()}`,
        onClear: () => setQuery(""),
      });
    }

    return chips;
  }, [projectModeFilter, query, statusFilter, tab, venue]);

  function clearAllFilters() {
    setTab("all");
    setProjectModeFilter("all");
    setQuery("");
    setVenue("all");
    setStatusFilter("all");
  }

  async function handleCreateProject(draft: NewProjectDraft) {
    const response = await api.request<{ project: ApiProjectSummary; scope: { includedIds: string[] } }>("/api/projects", {
      method: "POST",
      body: JSON.stringify(draft),
    });

    setBackendProjects((current) => [response.project, ...current.filter((item) => item.id !== response.project.id)]);

    const rollup = mapProjectSummaryToRow(response.project);
    navigate(`/p/${response.project.id}?mode=customer`, {
      state: {
        rollup,
        project: response.project,
        scope: response.scope,
      },
    });
  }

  return (
    <AppShell pageClassName="wide">
      <div className="hero">
        <div className="hero-top">
          <div className="hero-copy">
            <div className="hero-eyebrow">Project Dashboard</div>
            <h1 className="hero-title">Projects</h1>
            <p className="hero-subtitle">
              Scan campaign status, jump to the right workspace, and create new projects.
            </p>
          </div>

          <div className="hero-right">
            <button className="btn btn-primary btn-lg" type="button" onClick={handleOpenCreateProject}>
              <span aria-hidden="true">+</span>
              New Project
            </button>
          </div>
        </div>

        <div className="hero-summary">
          {portfolioSummary.map((item) => (
            <button
              key={item.label}
              type="button"
              className={`hero-summaryCard hero-summaryCard-${item.tone} ${
                statusFilter === item.filter ? "is-active" : ""
              }`}
              onClick={() => {
                setTab("all");
                setStatusFilter(statusFilter === item.filter ? "all" : item.filter);
              }}
            >
              <div className="hero-summaryLabel">
                <span className="hero-summaryDot" />
                {item.label}
              </div>
              <div className="hero-summaryValue">{item.value}</div>
            </button>
          ))}
        </div>
      </div>
      
		<CreateProjectModal
		  isOpen={isCreateOpen}
		  onClose={() => setCreateOpen(false)}
		  customers={customerOptions}
		  markets={marketOptions}
		  venues={venueOptionsForCreate}
		  setupLoading={setupOptionsLoading}
		  onCreate={handleCreateProject}
		/>

      <Panel className="panel-tight dashboard-panel">
        {bootstrapError ? (
          <div className="dashboard-warning" role="status" aria-live="polite">
            We hit a live data hiccup while loading the latest customers, venues, or projects. The dashboard is showing only confirmed live records and will recover on refresh.
          </div>
        ) : null}

        <div className="dashboard-command">
          <div className="dashboard-commandTop">
            <div className="tabbar">
              <button
                className={`tab ${tab === "all" ? "tab-active" : ""}`}
                onClick={() => setTab("all")}
              >
                All ({tabCounts.all})
              </button>
              <button
                className={`tab ${tab === "needs_attention" ? "tab-active" : ""}`}
                onClick={() => setTab("needs_attention")}
              >
                Needs Attention ({tabCounts.needs_attention})
              </button>
              <button
                className={`tab ${tab === "active" ? "tab-active" : ""}`}
                onClick={() => setTab("active")}
              >
                Active ({tabCounts.active})
              </button>
              <button
                className={`tab ${tab === "ready" ? "tab-active" : ""}`}
                onClick={() => setTab("ready")}
              >
                Ready ({tabCounts.ready})
              </button>
            </div>

            {hasSandboxProjects ? (
              <div className="tabbar tabbar-compact">
            <button
              className={`tab ${projectModeFilter === "all" ? "tab-active" : ""}`}
              onClick={() => setProjectModeFilter("all")}
            >
              All Modes
            </button>
            <button
              className={`tab ${projectModeFilter === "live" ? "tab-active" : ""}`}
              onClick={() => setProjectModeFilter("live")}
            >
              Live
            </button>
            <button
              className={`tab ${projectModeFilter === "internal_sandbox" ? "tab-active" : ""}`}
              onClick={() => setProjectModeFilter("internal_sandbox")}
            >
              Sandbox
            </button>
              </div>
            ) : null}

            <button
              className="iconbtn iconbtn-sm dashboard-refresh"
              title="Clear filters"
              onClick={clearAllFilters}
            >
              ↺
            </button>
          </div>

        {/* Filter row */}
          <div className="filters">
          <div className="field field-search">
            <span className="field-icon">⌕</span>
            <input
              className="field-input"
              placeholder="Search all orders…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className="field">
            <span className="field-label">Venue</span>
            <select
              className="select"
              value={venue}
              onChange={(e) => setVenue(e.target.value)}
            >
              {venueOptions.map((v) => (
                <option key={v} value={v}>
                  {v === "all" ? "All" : v}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <span className="field-label">Focus</span>
            <select
              className="select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            >
              <option value="all">All</option>
              <option value="needs_attention">Needs Attention</option>
              <option value="awaiting_proof">Awaiting Proof</option>
              <option value="ready">Ready / Released</option>
              <option value="transit_blocked">Transit Blocked</option>
            </select>
          </div>
          </div>
        </div>

        <div className="dashboard-subbar">
          <div className="dashboard-subbarLeft">
            <div className="dashboard-subbarText">
              {activeFilterChips.length === 0
                ? `Showing all ${allRows.length} projects`
                : `Filtered view: ${filteredRows.length} project${filteredRows.length === 1 ? "" : "s"}`}
            </div>

            {activeFilterChips.length > 0 ? (
              <div className="dashboard-filterChips" aria-label="Active dashboard filters">
                {activeFilterChips.map((chip) => (
                  <button
                    key={chip.id}
                    type="button"
                    className="dashboard-filterChip"
                    onClick={chip.onClear}
                    title={`Remove ${chip.label}`}
                  >
                    <span>{chip.label}</span>
                    <span aria-hidden="true" className="dashboard-filterChipX">×</span>
                  </button>
                ))}

                {activeFilterChips.length > 1 ? (
                  <button type="button" className="dashboard-clearAll" onClick={clearAllFilters}>
                    Clear all
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="dashboard-subbarHint">Updated just now</div>
        </div>

        {showMobileDashboardCards ? (
          <div className="dashboard-mobileList dashboard-mobileList-active" aria-label="Project cards">
            {projectLoading ? (
              <div className="dashboard-mobileEmpty">Loading projects...</div>
            ) : filteredRows.length === 0 ? (
              <div className="dashboard-mobileEmpty">No projects match the current filters.</div>
            ) : (
              filteredRows.map((row) => (
                <DashboardProjectCard
                  key={row.projectId}
                  row={row}
                  onNavigate={(path) => navigate(path)}
                />
              ))
            )}
          </div>
        ) : (
          <div className="table-wrap dashboard-tableWrap">
            {projectLoading ? (
              <div className="app-loadingWrap">
                <div className="app-loadingCard" role="status" aria-live="polite">
                  <div className="app-loadingOrb" aria-hidden="true">
                    <span className="app-loadingOrbRing" />
                    <span className="app-loadingOrbDot" />
                  </div>
                  <div className="app-loadingTitle">Loading projects</div>
                  <div className="app-loadingBody">Pulling your live project list.</div>
                  <div className="app-loadingRail" aria-hidden="true">
                    <span className="app-loadingRailBar app-loadingRailBar-wide" />
                    <span className="app-loadingRailBar" />
                    <span className="app-loadingRailBar app-loadingRailBar-short" />
                  </div>
                </div>
              </div>
            ) : (
              <DataTable<ProjectRollup>
                columns={columns}
                rows={filteredRows}
                getRowKey={(r) => r.projectId}
                onRowClick={(r) => navigate(`/p/${r.projectId}?mode=customer`)}
              />
            )}
          </div>
        )}

        <div className="table-footer">
          {filteredRows.length === 0
            ? `No orders match the current filters`
            : `Showing ${filteredRows.length} of ${allRows.length} orders`}
          <div className="pager">
            <button className="pager-btn">‹</button>
            <button className="pager-btn pager-active">1</button>
            <button className="pager-btn">›</button>
          </div>
        </div>
      </Panel>
    </AppShell>
  );
}

type DashboardProjectCardProps = {
  row: ProjectRollup;
  onNavigate: (path: string) => void;
};

function dashboardToneClass(tone?: string | null) {
  return `tone-${tone || "neutral"}`;
}

function getProjectActionPath(
  row: ProjectRollup,
  actionKind: ReturnType<typeof getAngieRowPrimaryAction>["kind"],
) {
  if (actionKind === "finish_assignment") return `/p/${row.projectId}/assignment?mode=customer`;
  if (actionKind === "review_proofs") return `/p/${row.projectId}/proofs?mode=customer`;
  if (actionKind === "view_transit_status") return `/p/${row.projectId}/transit?mode=customer`;
  return `/p/${row.projectId}?mode=customer`;
}

function DashboardProjectCard({ row, onNavigate }: DashboardProjectCardProps) {
  const primaryAction = getAngieRowPrimaryAction(row);
  const assignment = getAngieAssignmentSummary(row);
  const proofs = getAngieProofsSummary(row);
  const transit = getTransitChip(row);
  const production = getProductionLabel(row);
  const proofMeta = [proofs.revisedBadge, proofs.waitingBadge].filter(Boolean).join(" · ");
  const transitValue = transit?.label || "Not required";
  const transitMeta =
    row.transit.enabled
      ? row.transit.status === "approved"
        ? "Accepted"
        : row.transit.status === "rejected"
          ? "Needs revision"
          : "Review needed"
      : "No transit review";
  const projectMeta = [
    row.projectMode === "internal_sandbox" ? "Sandbox" : null,
    row.adspaceOrderNumber ? `AS360 # ${row.adspaceOrderNumber}` : row.extId,
    row.liftOrderId ? `Lift # ${row.liftOrderId}` : null,
  ].filter(Boolean).join(" · ");
  const venueMeta = [
    row.marketName,
    row.sourceCustomerName ? `Source ${row.sourceCustomerName}` : null,
  ].filter(Boolean).join(" · ");
  const hasPrimaryAction = primaryAction.kind !== "none";
  const primaryActionLabel = hasPrimaryAction ? primaryAction.label : "";
  const primaryPath = getProjectActionPath(row, primaryAction.kind);

  return (
    <article className="dashboard-projectCard">
      <div className="dashboard-projectCardTop">
        <div className="dashboard-projectIdentity">
          <button
            type="button"
            className="dashboard-projectTitleButton"
            onClick={() => onNavigate(`/p/${row.projectId}?mode=customer`)}
          >
            {row.title}
          </button>
          <div className="dashboard-projectMeta">{projectMeta}</div>
        </div>
        <span className={`dashboard-projectPill ${dashboardToneClass(production.tone)}`}>
          {production.label}
        </span>
      </div>

      <div className="dashboard-projectVenue">
        <strong>{row.venueName}</strong>
        <span>{venueMeta}</span>
      </div>

      <div className="dashboard-projectCardGrid">
        <div>
          <span>Client</span>
          <strong>{row.endClientName || "—"}</strong>
        </div>
        <div>
          <span>Dates</span>
          <strong>Art Due {row.dates.artworkDue || "—"}</strong>
          <em>Post {row.dates.postDate || "—"}</em>
        </div>
        <div className={`dashboard-projectCardKpi-${dashboardToneClass(assignment.tone)}`}>
          <span>Assignment</span>
          <strong>{assignment.label}</strong>
          <em>{assignment.sublabel || "Complete"}</em>
        </div>
        <div className={`dashboard-projectCardKpi-${dashboardToneClass(proofs.tone)}`}>
          <span>Proofs</span>
          <strong>{proofs.label}</strong>
          <em>{proofMeta || "—"}</em>
        </div>
        <div className={`dashboard-projectCardKpi-${dashboardToneClass(transit?.tone || "neutral")}`}>
          <span>Transit</span>
          <strong>{transitValue}</strong>
          <em>{transitMeta}</em>
        </div>
      </div>

      <div className="dashboard-projectActions">
        {hasPrimaryAction ? (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => onNavigate(primaryPath)}
          >
            {primaryActionLabel}
          </button>
        ) : null}
        <button
          type="button"
          className={`btn ${hasPrimaryAction ? "btn-ghost" : "btn-primary"} btn-sm`}
          onClick={() => onNavigate(`/p/${row.projectId}?mode=customer`)}
        >
          Open Hub
        </button>
      </div>
    </article>
  );
}

function deriveMarketsFromVenues(venues: ApiVenue[]): ApiMarket[] {
  const marketsById = new Map<string, ApiMarket>();
  for (const venue of venues) {
    if (!venue.marketId || marketsById.has(venue.marketId)) continue;
    marketsById.set(venue.marketId, {
      id: venue.marketId,
      customerId: venue.customerId,
      name: venue.marketName || venue.marketId,
      customerName: venue.customerName,
      isActive: true,
    });
  }
  return Array.from(marketsById.values()).sort((a, b) => {
    const customerSort = (a.customerName || a.customerId).localeCompare(b.customerName || b.customerId);
    return customerSort || a.name.localeCompare(b.name);
  });
}
