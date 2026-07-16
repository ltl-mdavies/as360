// src/pages/AngieDashboard/AngieDashboardPage.tsx

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Search, SlidersHorizontal, X } from "lucide-react";
import { useNavigate } from "react-router-dom";

import AppShell from "../../app/AppShell";
import Panel from "../../components/common/Panel";
import DataTable from "../../components/table/DataTable";
import PopoverMenu from "../../components/common/PopoverMenu";
import PullToRefresh from "../../components/common/PullToRefresh";

import type { ProjectRollup } from "../../logic/mockRollups";
import {
  getAngieAssignmentSummary,
  getAngieProofsSummary,
  getAngieRowPrimaryAction,
  getProductionLabel,
  getTransitChip,
  isLiftOrderCompleted,
  isLiftProductionReference,
} from "../../logic/renderingRules";
import type { Tone } from "../../logic/renderingRules";
import { buildAngieProjectTableColumns } from "../../logic/tableColumnDefs";
import {
  PROJECT_ORDER_LIFECYCLE_ACTIONS,
  buildProjectOrderActionPath,
  isProjectOrderLifecycleAction,
} from "../../logic/orderLifecycleActions";

import CreateProjectModal, {
  type NewProjectDraft,
  type ProjectCustomerOption,
  type ProjectMarketOption,
  type ProjectVenueOption,
} from "../../components/projects/CreateProjectModal";
import { useApiClient } from "../../api/useApiClient";

type TabKey = "all" | "needs_attention" | "active" | "ready" | "complete";
type StatusFilter = "all" | "needs_attention" | "awaiting_proof" | "ready" | "transit_blocked" | "complete";
type ProjectModeFilter = "all" | "live" | "internal_sandbox";

type ActiveFilterChip = {
  id: string;
  label: string;
  onClear: () => void;
};

type PortfolioSummaryItem = {
  label: string;
  value: number;
  tone: "warning" | "info" | "danger" | "success" | "complete";
  filter: Exclude<StatusFilter, "all">;
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
  orderLifecycleStatus?: "active" | "on_hold" | "cancelled";
  orderLifecycleReason?: string | null;
  orderLifecycleNote?: string | null;
  orderLifecycleUpdatedAt?: string | null;
  orderLifecycleUpdatedByName?: string | null;
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
  liftSync?: ProjectRollup["liftSync"];
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

  if (tab === "complete") return isLiftOrderCompleted(r);

  if (tab === "ready") {
    if (isLiftOrderCompleted(r)) return false;
    if (isLiftProductionReference(r)) return true;
    if (r.production.policy === "hold_for_release") return !!r.production.released;
    return r.production.ready;
  }

  if (tab === "active") {
    if (isLiftOrderCompleted(r)) return false;
    const isReady =
      isLiftProductionReference(r) ||
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
  if (f === "ready") return !isLiftOrderCompleted(r) && (r.production.ready === true || isLiftProductionReference(r));
  if (f === "transit_blocked") return !isLiftProductionReference(r) && r.transit.enabled && r.transit.status !== "approved";
  if (f === "complete") return isLiftOrderCompleted(r);
  return true;
}

function tabLabel(tab: TabKey) {
  if (tab === "needs_attention") return "Needs Attention";
  if (tab === "active") return "Active";
  if (tab === "ready") return "Ready";
  if (tab === "complete") return "Complete";
  return "All";
}

function statusFilterLabel(filter: StatusFilter) {
  if (filter === "needs_attention") return "Needs Attention";
  if (filter === "awaiting_proof") return "Awaiting Proof";
  if (filter === "ready") return "Ready / Released";
  if (filter === "transit_blocked") return "Transit Blocked";
  if (filter === "complete") return "Complete";
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
    orderLifecycleStatus: project.orderLifecycleStatus || "active",
    orderLifecycleReason: project.orderLifecycleReason || null,
    orderLifecycleNote: project.orderLifecycleNote || null,
    orderLifecycleUpdatedAt: project.orderLifecycleUpdatedAt || null,
    orderLifecycleUpdatedByName: project.orderLifecycleUpdatedByName || null,
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
    liftSync: project.liftSync,
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
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [isCreateOpen, setCreateOpen] = useState(false);
  const [customers, setCustomers] = useState<ApiCustomer[]>([]);
  const [markets, setMarkets] = useState<ApiMarket[]>([]);
  const [venues, setVenues] = useState<ApiVenue[]>([]);
  const [backendProjects, setBackendProjects] = useState<ApiProjectSummary[]>([]);
  const [projectLoading, setProjectLoading] = useState(true);
  const [bootstrapError, setBootstrapError] = useState(false);
  const [setupOptionsLoading, setSetupOptionsLoading] = useState(false);
  const [setupOptionsLoaded, setSetupOptionsLoaded] = useState(false);

  const loadProjectList = useCallback(
    async (options: { cancelled?: () => boolean } = {}) => {
      setProjectLoading(true);
      setBootstrapError(false);
      try {
        const projectResponse = await api.request<{ projects: ApiProjectSummary[] }>("/api/projects");
        if (options.cancelled?.()) return;
        setBackendProjects(projectResponse.projects || []);
      } catch (error) {
        console.error("Failed to load project bootstrap data", error);
        if (!options.cancelled?.()) setBootstrapError(true);
      } finally {
        if (!options.cancelled?.()) setProjectLoading(false);
      }
    },
    [api]
  );

  useEffect(() => {
    let cancelled = false;
    void loadProjectList({ cancelled: () => cancelled });
    return () => {
      cancelled = true;
    };
  }, [loadProjectList]);

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
      complete: allRows.filter((r) => matchesTab(r, "complete")).length,
    };
  }, [allRows]);

  const portfolioSummary = useMemo(() => {
    const needsAttention = allRows.filter((r) => r.needsAttention).length;
    const awaitingProofs = allRows.filter(
      (r) => r.proofs.total > 0 && (r.proofs.pending > 0 || (r.proofs.waitingForProof || 0) > 0)
    ).length;
    const transitBlocked = allRows.filter(
      (r) => !isLiftProductionReference(r) && r.transit.enabled && r.transit.status !== "approved"
    ).length;
    const complete = allRows.filter((r) => isLiftOrderCompleted(r)).length;
    const readyToRelease = allRows.filter(
      (r) =>
        !isLiftOrderCompleted(r) &&
        (isLiftProductionReference(r) ||
          (r.production.policy === "hold_for_release" && !!r.production.released) ||
          r.production.ready)
    ).length;

    return [
      { label: "Needs Attention", value: needsAttention, tone: "warning", filter: "needs_attention" },
      { label: "Awaiting Proof", value: awaitingProofs, tone: "info", filter: "awaiting_proof" },
      { label: "Transit Blocked", value: transitBlocked, tone: "danger", filter: "transit_blocked" },
      { label: "Ready / Released", value: readyToRelease, tone: "success", filter: "ready" },
      { label: "Complete", value: complete, tone: "complete", filter: "complete" },
    ] satisfies PortfolioSummaryItem[];
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
      <PullToRefresh onRefresh={() => loadProjectList()} disabled={isCreateOpen}>
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

        {showMobileDashboardCards ? (
          <DashboardMobileSummary
            items={portfolioSummary}
            activeFilter={statusFilter}
            onToggle={(filter) => {
              setTab("all");
              setStatusFilter(statusFilter === filter ? "all" : filter);
            }}
          />
        ) : (
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
        )}
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

        {showMobileDashboardCards ? (
          <DashboardMobileCommandDock
            isOpen={mobileFiltersOpen}
            onToggleOpen={() => setMobileFiltersOpen((current) => !current)}
            totalCount={allRows.length}
            filteredCount={filteredRows.length}
            activeFilterChips={activeFilterChips}
            query={query}
            onQueryChange={setQuery}
            venue={venue}
            venueOptions={venueOptions}
            onVenueChange={setVenue}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            tab={tab}
            tabCounts={tabCounts}
            onTabChange={setTab}
            hasSandboxProjects={hasSandboxProjects}
            projectModeFilter={projectModeFilter}
            onProjectModeFilterChange={setProjectModeFilter}
            onClearAll={clearAllFilters}
          />
        ) : (
          <>
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
                  <button
                    className={`tab ${tab === "complete" ? "tab-active" : ""}`}
                    onClick={() => setTab("complete")}
                  >
                    Complete ({tabCounts.complete})
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
                    <option value="complete">Complete</option>
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
          </>
        )}

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
                getRowClassName={(r) => `dashboard-rowAccent ${dashboardToneClass(getDashboardProjectTone(r))}`}
                onRowClick={(r) => navigate(`/p/${r.projectId}?mode=customer`)}
              />
            )}
          </div>
        )}

        {!showMobileDashboardCards ? (
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
        ) : null}
      </Panel>
      </PullToRefresh>
    </AppShell>
  );
}

type DashboardMobileSummaryProps = {
  items: PortfolioSummaryItem[];
  activeFilter: StatusFilter;
  onToggle: (filter: PortfolioSummaryItem["filter"]) => void;
};

function DashboardMobileSummary({ items, activeFilter, onToggle }: DashboardMobileSummaryProps) {
  return (
    <div className="dashboard-mobileSummary" aria-label="Project status summary">
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          className={`dashboard-mobileSummaryCard dashboard-mobileSummaryCard-${item.tone} ${
            activeFilter === item.filter ? "is-active" : ""
          }`}
          onClick={() => onToggle(item.filter)}
        >
          <span className="dashboard-mobileSummaryLabel">{item.label}</span>
          <strong>{item.value}</strong>
        </button>
      ))}
    </div>
  );
}

type DashboardMobileCommandDockProps = {
  isOpen: boolean;
  onToggleOpen: () => void;
  totalCount: number;
  filteredCount: number;
  activeFilterChips: ActiveFilterChip[];
  query: string;
  onQueryChange: (value: string) => void;
  venue: string;
  venueOptions: string[];
  onVenueChange: (value: string) => void;
  statusFilter: StatusFilter;
  onStatusFilterChange: (value: StatusFilter) => void;
  tab: TabKey;
  tabCounts: Record<TabKey, number>;
  onTabChange: (value: TabKey) => void;
  hasSandboxProjects: boolean;
  projectModeFilter: ProjectModeFilter;
  onProjectModeFilterChange: (value: ProjectModeFilter) => void;
  onClearAll: () => void;
};

function DashboardMobileCommandDock({
  isOpen,
  onToggleOpen,
  totalCount,
  filteredCount,
  activeFilterChips,
  query,
  onQueryChange,
  venue,
  venueOptions,
  onVenueChange,
  statusFilter,
  onStatusFilterChange,
  tab,
  tabCounts,
  onTabChange,
  hasSandboxProjects,
  projectModeFilter,
  onProjectModeFilterChange,
  onClearAll,
}: DashboardMobileCommandDockProps) {
  const hasActiveFilters = activeFilterChips.length > 0;
  const activeSummary = hasActiveFilters ? activeFilterChips[0]?.label.replace(/^(View|Mode|Venue|Focus|Search):\s*/, "") : "All";

  function scrollToTop() {
    if (typeof window === "undefined") return;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className={`dashboard-mobileDock ${isOpen ? "is-open" : ""}`}>
      <div className="dashboard-mobileDockBar">
        <button
          type="button"
          className="dashboard-mobileDockSummary"
          onClick={onToggleOpen}
          aria-expanded={isOpen}
        >
          <strong>{filteredCount}</strong>
          <span>shown</span>
          <em>{activeSummary}</em>
        </button>

        <button type="button" className="dashboard-mobileDockIcon" onClick={onToggleOpen} aria-label="Search projects">
          <Search size={19} strokeWidth={2.4} />
        </button>
        <button type="button" className="dashboard-mobileDockIcon" onClick={onToggleOpen} aria-label="Filter projects">
          <SlidersHorizontal size={19} strokeWidth={2.4} />
        </button>
        {hasActiveFilters ? (
          <button type="button" className="dashboard-mobileDockAction" onClick={onClearAll}>
            <X size={15} strokeWidth={2.6} />
            Clear
          </button>
        ) : (
          <button type="button" className="dashboard-mobileDockAction" onClick={scrollToTop}>
            Top
          </button>
        )}
      </div>

      {isOpen ? (
        <div className="dashboard-mobileDockExpanded">
          <div className="dashboard-mobileTabGrid" aria-label="Project views">
            {(["all", "needs_attention", "active", "ready", "complete"] as TabKey[]).map((item) => (
              <button
                key={item}
                type="button"
                className={`dashboard-mobileTab ${tab === item ? "is-active" : ""}`}
                onClick={() => onTabChange(item)}
              >
                {tabLabel(item)} <span>{tabCounts[item]}</span>
              </button>
            ))}
          </div>

          {hasSandboxProjects ? (
            <div className="dashboard-mobileModeTabs" aria-label="Project mode">
              {(["all", "live", "internal_sandbox"] as ProjectModeFilter[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  className={`dashboard-mobileModeTab ${projectModeFilter === item ? "is-active" : ""}`}
                  onClick={() => onProjectModeFilterChange(item)}
                >
                  {modeFilterLabel(item)}
                </button>
              ))}
            </div>
          ) : null}

          <div className="dashboard-mobileFilterGrid">
            <label className="dashboard-mobileSearch">
              <Search size={16} strokeWidth={2.2} aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                placeholder="Search orders..."
              />
            </label>

            <label className="dashboard-mobileSelect">
              <span>Venue</span>
              <select value={venue} onChange={(event) => onVenueChange(event.target.value)}>
                {venueOptions.map((item) => (
                  <option key={item} value={item}>
                    {item === "all" ? "All venues" : item}
                  </option>
                ))}
              </select>
            </label>

            <label className="dashboard-mobileSelect">
              <span>Focus</span>
              <select value={statusFilter} onChange={(event) => onStatusFilterChange(event.target.value as StatusFilter)}>
                <option value="all">All focus areas</option>
                <option value="needs_attention">Needs Attention</option>
                <option value="awaiting_proof">Awaiting Proof</option>
                <option value="ready">Ready / Released</option>
                <option value="transit_blocked">Transit Blocked</option>
                <option value="complete">Complete</option>
              </select>
            </label>
          </div>

          <div className="dashboard-mobileDockFooter">
            <strong>{filteredCount}</strong> of {totalCount} shown
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
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

type DashboardProjectCardProps = {
  row: ProjectRollup;
  onNavigate: (path: string) => void;
};

function dashboardToneClass(tone?: string | null) {
  return `tone-${tone || "neutral"}`;
}

function orderLifecycleLabel(status?: string | null) {
  if (status === "on_hold") return "On Hold";
  if (status === "cancelled") return "Cancelled";
  return null;
}

function getDashboardProjectTone(row: ProjectRollup): Tone {
  if (row.orderLifecycleStatus === "cancelled") return "danger";
  if (row.orderLifecycleStatus === "on_hold") return "warning";
  if (isLiftProductionReference(row)) return "success";

  if (row.transit.enabled && row.transit.status !== "approved" && row.transit.status !== "not_required") {
    return row.transit.status === "rejected" || row.transit.status === "changes_requested" ? "danger" : "warning";
  }

  if (row.needsAttention) return "warning";

  if (row.proofs.total > 0 && (row.proofs.pending > 0 || (row.proofs.waitingForProof || 0) > 0)) {
    return "info";
  }

  if ((row.production.policy === "hold_for_release" && row.production.released) || row.production.ready) {
    return "success";
  }

  return "neutral";
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
    orderLifecycleLabel(row.orderLifecycleStatus),
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
  const hubPath = `/p/${row.projectId}?mode=customer`;
  const managePath = `/p/${row.projectId}?mode=customer&panel=details`;
  const openOrderAction = (action: string) => {
    if (!isProjectOrderLifecycleAction(action)) return;
    onNavigate(buildProjectOrderActionPath(row.projectId, action));
  };
  const smartPath = hasPrimaryAction ? primaryPath : hubPath;
  const statusItems = [
    {
      label: "Assignment",
      value: assignment.label,
      meta: assignment.sublabel || (row.assignment.complete ? "Complete" : "In progress"),
      tone: assignment.tone,
    },
    {
      label: "Proofs",
      value: proofs.label,
      meta: proofMeta || "No proof notes",
      tone: proofs.tone,
    },
    {
      label: "Transit",
      value: transitValue,
      meta: transitMeta,
      tone: transit?.tone || "neutral",
    },
    {
      label: hasPrimaryAction ? "Next" : "Production",
      value: hasPrimaryAction ? primaryActionLabel : production.label,
      meta: hasPrimaryAction ? "Recommended" : "Current state",
      tone: hasPrimaryAction ? "primary" : production.tone,
    },
  ];
  const venueLine = [row.marketName, row.endClientName].filter(Boolean).join(" · ");
  const projectTone = getDashboardProjectTone(row);

  return (
    <article className={`dashboard-projectCard ${dashboardToneClass(projectTone)}`}>
      <button type="button" className="dashboard-projectCardMain" onClick={() => onNavigate(smartPath)}>
        <span className="dashboard-projectCardAccent" aria-hidden="true" />
        <span className="dashboard-projectCardTop">
          <span className="dashboard-projectIdentity">
            <span className="dashboard-projectTitle">{row.title}</span>
            <span className="dashboard-projectMeta">{projectMeta}</span>
          </span>
          <span className="dashboard-projectArrow" aria-hidden="true">
            <ArrowRight size={19} strokeWidth={2.6} />
          </span>
        </span>

        <span className="dashboard-projectVenue">
          <strong>{row.venueName}</strong>
          <span>{venueLine || venueMeta || "Venue workspace"}</span>
        </span>

        <span className="dashboard-projectDates">
          <span><em>Art</em>{row.dates.artworkDue || "—"}</span>
          <span><em>Post</em>{row.dates.postDate || "—"}</span>
        </span>

        <span className="dashboard-projectStatusGrid">
          {statusItems.map((item) => (
            <span key={item.label} className={`dashboard-projectStatusItem ${dashboardToneClass(item.tone)}`}>
              <span className="dashboard-projectStatusDot" aria-hidden="true" />
              <span>
                <em>{item.label}</em>
                <strong>{item.value}</strong>
                <small>{item.meta}</small>
              </span>
            </span>
          ))}
        </span>
      </button>

      {hasPrimaryAction && primaryPath !== hubPath ? (
        <div className="dashboard-projectActions">
          <span className={`dashboard-projectPill ${dashboardToneClass(production.tone)}`}>
            {production.label}
          </span>
          <span className="dashboard-projectActionButtons">
            <button
              type="button"
              className="dashboard-projectHubLink"
              onClick={() => onNavigate(hubPath)}
            >
              Open Hub
            </button>
            <button
              type="button"
              className="dashboard-projectHubLink"
              onClick={() => onNavigate(managePath)}
            >
              Manage
            </button>
            <PopoverMenu
              buttonLabel="Order actions"
              buttonClassName="dashboard-projectOrderMenu"
              ariaLabel={`Order actions for ${row.title}`}
              items={PROJECT_ORDER_LIFECYCLE_ACTIONS.map((item) => ({
                label: item.label,
                action: item.action,
                description: item.description,
              }))}
              onAction={openOrderAction}
            />
          </span>
        </div>
      ) : (
        <div className="dashboard-projectActions">
          <span className={`dashboard-projectPill ${dashboardToneClass(production.tone)}`}>
            {production.label}
          </span>
          <span className="dashboard-projectActionButtons">
            <button
              type="button"
              className="dashboard-projectHubLink"
              onClick={() => onNavigate(managePath)}
            >
              Manage
            </button>
            <PopoverMenu
              buttonLabel="Order actions"
              buttonClassName="dashboard-projectOrderMenu"
              ariaLabel={`Order actions for ${row.title}`}
              items={PROJECT_ORDER_LIFECYCLE_ACTIONS.map((item) => ({
                label: item.label,
                action: item.action,
                description: item.description,
              }))}
              onAction={openOrderAction}
            />
          </span>
        </div>
      )}
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
