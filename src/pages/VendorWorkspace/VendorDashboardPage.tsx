import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Search, SlidersHorizontal, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import AppShell from "../../app/AppShell";
import PageHeader from "../../components/common/PageHeader";
import Panel from "../../components/common/Panel";
import { fetchVendorOrders, type ApiVendorOrderSummary, type ApiVendorWorkflowStage } from "../../api/projects";
import { useApiClient } from "../../api/useApiClient";
import "../../styles/vendorWorkspace.css";

type StatusFilter = "all" | ApiVendorWorkflowStage | "attention" | "production";

const workflowLabels: Record<ApiVendorWorkflowStage, string> = {
  incoming: "Incoming",
  needs_proof: "Needs Proof",
  client_review: "Client Review",
  production_ready: "Ready",
  in_production: "In Production",
  shipped: "Shipped",
  complete: "Complete",
  blocked: "Blocked",
};

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function normalize(value: string) {
  return value.toLowerCase().trim();
}

function isPrimaryRoute(order: ApiVendorOrderSummary) {
  return order.integrationHealth.route === "primary_print_vendor";
}

function matchesSearch(order: ApiVendorOrderSummary, query: string) {
  if (!query) return true;
  const haystack = [
    order.project.title,
    order.project.customerName,
    order.project.sourceCustomerName || "",
    order.project.marketName,
    order.project.venueName,
    order.project.adspaceOrderNumber,
    order.project.liftOrderId || "",
    order.project.poNumber || "",
    order.project.contractNumber || "",
    order.vendorName,
  ].map(normalize).join(" | ");
  return haystack.includes(query);
}

function workflowClass(stage: ApiVendorWorkflowStage) {
  return `vendor-status vendor-workflow-${stage}`;
}

export default function VendorDashboardPage() {
  const api = useApiClient();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<ApiVendorOrderSummary[]>([]);
  const [vendorName, setVendorName] = useState("Vendor Workspace");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetchVendorOrders(api);
        if (cancelled) return;
        setOrders(response.orders || []);
        setVendorName(response.vendor.accounts[0]?.name || "Vendor Workspace");
      } catch (loadError) {
        if (!cancelled) {
          console.error("Failed to load vendor orders", loadError);
          setError("We could not load your vendor orders.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [api]);

  const normalizedQuery = normalize(query);
  const filteredOrders = useMemo(
    () =>
      orders.filter((order) => {
        if (!matchesSearch(order, normalizedQuery)) return false;
        if (status === "all") return true;
        if (status === "attention") return order.summary.needsAttention;
        if (status === "production") return order.summary.workflow.stage === "production_ready" || order.summary.workflow.stage === "in_production";
        return order.summary.workflow.stage === status;
      }),
    [normalizedQuery, orders, status]
  );

  const counts = useMemo(
    () => ({
      all: orders.length,
      attention: orders.filter((order) => order.summary.needsAttention).length,
      incoming: orders.filter((order) => order.summary.workflow.stage === "incoming").length,
      needsProof: orders.filter((order) => order.summary.workflow.stage === "needs_proof").length,
      clientReview: orders.filter((order) => order.summary.workflow.stage === "client_review").length,
      production: orders.filter((order) => order.summary.workflow.stage === "production_ready" || order.summary.workflow.stage === "in_production").length,
      shipped: orders.filter((order) => order.summary.workflow.stage === "shipped").length,
      complete: orders.filter((order) => order.summary.workflow.stage === "complete").length,
    }),
    [orders]
  );

  return (
    <AppShell customerName={vendorName} pageClassName="vendor-workspace-page" showNavTrigger>
      <PageHeader
        variant="workspace"
        eyebrow="Vendor Workspace"
        title="Assigned Orders"
        subtitle="Production orders and routed order lines assigned to your vendor account."
        actions={
          <button className="btn btn-ghost btn-soft" type="button" onClick={() => void fetchVendorOrders(api).then((r) => setOrders(r.orders || []))}>
            Refresh
          </button>
        }
      />

      <div className="vendor-kpis vendor-kpis-workflow" aria-label="Vendor order summary">
        <button className={`vendor-kpi ${status === "all" ? "is-active" : ""}`} type="button" onClick={() => setStatus("all")}>
          <span>All</span><strong>{counts.all}</strong>
        </button>
        <button className={`vendor-kpi ${status === "incoming" ? "is-active" : ""}`} type="button" onClick={() => setStatus("incoming")}>
          <span>Incoming</span><strong>{counts.incoming}</strong>
        </button>
        <button className={`vendor-kpi ${status === "needs_proof" ? "is-active" : ""}`} type="button" onClick={() => setStatus("needs_proof")}>
          <span>Needs Proof</span><strong>{counts.needsProof}</strong>
        </button>
        <button className={`vendor-kpi ${status === "client_review" ? "is-active" : ""}`} type="button" onClick={() => setStatus("client_review")}>
          <span>Client Review</span><strong>{counts.clientReview}</strong>
        </button>
        <button className={`vendor-kpi ${status === "attention" ? "is-active" : ""}`} type="button" onClick={() => setStatus("attention")}>
          <span>Needs Attention</span><strong>{counts.attention}</strong>
        </button>
        <button className={`vendor-kpi ${status === "production" ? "is-active" : ""}`} type="button" onClick={() => setStatus("production")}>
          <span>Production</span><strong>{counts.production}</strong>
        </button>
        <button className={`vendor-kpi ${status === "shipped" ? "is-active" : ""}`} type="button" onClick={() => setStatus("shipped")}>
          <span>Shipped</span><strong>{counts.shipped}</strong>
        </button>
        <button className={`vendor-kpi ${status === "complete" ? "is-active" : ""}`} type="button" onClick={() => setStatus("complete")}>
          <span>Complete</span><strong>{counts.complete}</strong>
        </button>
      </div>

      <Panel className="vendor-panel">
        <div className="vendor-toolbar">
          <label className="vendor-search">
            <Search size={16} aria-hidden="true" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search orders, customers, venues, PO, contract..." />
            {query ? (
              <button type="button" onClick={() => setQuery("")} aria-label="Clear search">
                <X size={16} />
              </button>
            ) : null}
          </label>
          <label className="vendor-filter">
            <SlidersHorizontal size={16} aria-hidden="true" />
            <select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)}>
              <option value="all">All Statuses</option>
              <option value="incoming">Incoming</option>
              <option value="needs_proof">Needs Proof</option>
              <option value="client_review">Client Review</option>
              <option value="production">Production</option>
              <option value="production_ready">Ready for Production</option>
              <option value="attention">Needs Attention</option>
              <option value="in_production">In Production</option>
              <option value="blocked">Blocked</option>
              <option value="shipped">Shipped</option>
              <option value="complete">Complete</option>
            </select>
          </label>
        </div>

        {loading ? <div className="vendor-empty">Loading assigned orders...</div> : null}
        {error ? <div className="vendor-error">{error}</div> : null}
        {!loading && !error && !filteredOrders.length ? (
          <div className="vendor-empty">No assigned orders match the current filters.</div>
        ) : null}

        <div className="vendor-order-list">
          {filteredOrders.map((order) => (
            <button
              key={order.id}
              className="vendor-order-card"
              type="button"
              onClick={() => navigate(`/vendor/orders/${encodeURIComponent(order.id)}`)}
            >
              <span className="vendor-card-rail" aria-hidden="true" />
              <span className="vendor-card-main">
                <span className="vendor-card-top">
                  <span>
                    <strong>{order.project.title}</strong>
                    <small>{order.project.customerName} · {order.project.venueName}</small>
                  </span>
                  <span className={workflowClass(order.summary.workflow.stage)}>{order.summary.workflow.label || workflowLabels[order.summary.workflow.stage]}</span>
                </span>
                <span className="vendor-card-grid">
                  <span><small>Adspace Order</small>{order.project.adspaceOrderNumber}</span>
                  <span>
                    <small>{isPrimaryRoute(order) ? "Lift Order" : "Contract"}</small>
                    {isPrimaryRoute(order) ? order.project.liftOrderId || "—" : order.project.contractNumber || "—"}
                  </span>
                  <span><small>Lines</small>{order.summary.lineCount}</span>
                  <span><small>Locations</small>{order.summary.inventoryCount}</span>
                  <span><small>Artwork Due</small>{formatDate(order.project.artworkDueDate)}</span>
                  <span><small>Post Date</small>{formatDate(order.project.postDate)}</span>
                </span>
              </span>
              <ArrowRight size={18} aria-hidden="true" />
            </button>
          ))}
        </div>
      </Panel>
    </AppShell>
  );
}
