// src/components/projects/CreateProjectModal.tsx
import { useEffect, useMemo, useState } from "react";
import Portal from "../common/Portal";

export type NewProjectDraft = {
  projectMode?: "live" | "internal_sandbox";
  title: string;
  customerId: string;
  customerName: string;
  marketId: string;
  marketName: string;
  venueId: string;
  venueName: string;

  artworkDueDate?: string;
  postDate?: string;
  poNumber?: string;

  endClientName?: string;
  contractNumber?: string;
};

export type ProjectCustomerOption = {
  id: string;
  name: string;
  status?: "active" | "suspended" | "inactive";
  isInternalSandbox?: boolean;
};

export type ProjectMarketOption = {
  id: string;
  customerId: string;
  name: string;
  customerName?: string;
  isActive?: boolean;
};

export type ProjectVenueOption = {
  id: string;
  customerId: string;
  marketId: string;
  name: string;
  customerName?: string;
  marketName?: string;
  isActive?: boolean;
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (draft: NewProjectDraft) => void | Promise<void>;

  customers: ProjectCustomerOption[];
  markets: ProjectMarketOption[];
  venues: ProjectVenueOption[];
  setupLoading?: boolean;
};

export default function CreateProjectModal({
  isOpen,
  onClose,
  onCreate,
  customers,
  markets,
  venues,
  setupLoading = false,
}: Props) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [projectMode, setProjectMode] = useState<"live" | "internal_sandbox">("live");

  const [title, setTitle] = useState("");
  const [customerId, setCustomerId] = useState(customers[0]?.id || "");
  const [marketId, setMarketId] = useState("");
  const [venueId, setVenueId] = useState("");

  const [artworkDueDate, setArtworkDueDate] = useState("");
  const [postDate, setPostDate] = useState("");
  const [poNumber, setPoNumber] = useState("");

  const [endClientName, setEndClientName] = useState("");
  const [contractNumber, setContractNumber] = useState("");

  const sandboxCustomer = useMemo(
    () => customers.find((customer) => customer.isInternalSandbox),
    [customers]
  );

  const liveCustomers = useMemo(
    () => customers.filter((customer) => !customer.isInternalSandbox && (customer.status || "active") === "active"),
    [customers]
  );

  const effectiveCustomerId = projectMode === "internal_sandbox" ? sandboxCustomer?.id || "" : customerId;
  const marketsForCustomer = useMemo(
    () =>
      projectMode === "internal_sandbox"
        ? markets.filter((market) => market.isActive !== false)
        : markets.filter((market) => market.customerId === effectiveCustomerId && market.isActive !== false),
    [effectiveCustomerId, markets, projectMode]
  );
  const venuesForMarket = useMemo(
    () =>
      venues.filter(
        (venue) =>
          venue.marketId === marketId &&
          venue.isActive !== false &&
          (projectMode === "internal_sandbox" || venue.customerId === effectiveCustomerId)
      ),
    [effectiveCustomerId, marketId, projectMode, venues]
  );
  const selectedCustomer =
    customers.find((customer) => customer.id === effectiveCustomerId) || sandboxCustomer || null;
  const selectedMarket = marketsForCustomer.find((market) => market.id === marketId) || null;
  const selectedVenue = venuesForMarket.find((venue) => venue.id === venueId) || null;

  useEffect(() => {
    if (!isOpen) return;
    const defaultCustomer = liveCustomers[0] || customers[0] || null;
    const nextCustomerId = defaultCustomer?.id || "";
    const nextMarkets = markets.filter((market) => market.customerId === nextCustomerId && market.isActive !== false);
    const nextMarketId = nextMarkets[0]?.id || "";
    const nextVenues = venues.filter(
      (venue) => venue.customerId === nextCustomerId && venue.marketId === nextMarketId && venue.isActive !== false
    );
    setCustomerId(nextCustomerId);
    setMarketId(nextMarketId);
    setVenueId(nextVenues[0]?.id || "");
    setProjectMode("live");
    setSubmitError("");
  }, [customers, isOpen, liveCustomers, markets, venues]);

  useEffect(() => {
    if (!isOpen) return;
    if (projectMode === "internal_sandbox") {
      const nextMarkets = markets.filter((market) => market.isActive !== false);
      const nextMarketId =
        nextMarkets.some((market) => market.id === marketId) ? marketId : nextMarkets[0]?.id || "";
      const nextVenues = venues.filter((venue) => venue.marketId === nextMarketId && venue.isActive !== false);
      const nextVenueId =
        nextVenues.some((venue) => venue.id === venueId) ? venueId : nextVenues[0]?.id || "";
      setMarketId(nextMarketId);
      setVenueId(nextVenueId);
      if (sandboxCustomer?.id) setCustomerId(sandboxCustomer.id);
      return;
    }

    const nextCustomerId = liveCustomers.some((customer) => customer.id === customerId)
      ? customerId
      : liveCustomers[0]?.id || "";
    const nextMarkets = markets.filter((market) => market.customerId === nextCustomerId && market.isActive !== false);
    const nextMarketId =
      nextMarkets.some((market) => market.id === marketId) ? marketId : nextMarkets[0]?.id || "";
    const nextVenues = venues.filter(
      (venue) => venue.customerId === nextCustomerId && venue.marketId === nextMarketId && venue.isActive !== false
    );
    const nextVenueId =
      nextVenues.some((venue) => venue.id === venueId) ? venueId : nextVenues[0]?.id || "";
    setCustomerId(nextCustomerId);
    setMarketId(nextMarketId);
    setVenueId(nextVenueId);
  }, [customerId, isOpen, liveCustomers, marketId, markets, projectMode, sandboxCustomer?.id, venueId, venues]);

  const canCreate =
    title.trim().length > 2 &&
    !!selectedCustomer &&
    !!selectedMarket &&
    !!selectedVenue &&
    !setupLoading &&
    !isSubmitting;

  function reset() {
    setTitle("");
    setCustomerId(customers[0]?.id || "");
    setMarketId("");
    setVenueId("");
    setArtworkDueDate("");
    setPostDate("");
    setPoNumber("");
    setEndClientName("");
    setContractNumber("");
    setAdvancedOpen(false);
    setSubmitError("");
    setIsSubmitting(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleCreate() {
    if (!canCreate) return;
    if (!selectedCustomer || !selectedMarket || !selectedVenue) return;

    try {
      setIsSubmitting(true);
      setSubmitError("");

      await onCreate({
        projectMode,
        title: title.trim(),
        customerId: selectedCustomer.id,
        customerName: selectedCustomer.name,
        marketId: selectedMarket.id,
        marketName: selectedMarket.name,
        venueId: selectedVenue.id,
        venueName: selectedVenue.name,
        artworkDueDate: artworkDueDate || undefined,
        postDate: postDate || undefined,
        poNumber: poNumber.trim() || undefined,
        endClientName: endClientName.trim() || undefined,
        contractNumber: contractNumber.trim() || undefined,
      });

      reset();
      onClose();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Project creation failed");
      setIsSubmitting(false);
    }
  }

  if (!isOpen) return null;

  return (
    <Portal>
      <div className="cp-backdrop" onMouseDown={handleClose}>
        <div className="cp-modal" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
          <div className="cp-head">
            <div>
              <div className="cp-title">Create New Project</div>
              <div className="cp-sub">Fast setup. You can edit details and inventory scope later.</div>
            </div>

            <button className="btn btn-ghost btn-soft" type="button" onClick={handleClose}>
              ✕
            </button>
          </div>

          <div className="cp-body">
            {setupLoading ? (
              <div className="cp-note">Loading customer, market, and venue options…</div>
            ) : null}
            <div className="cp-grid">
              <div className="cp-field">
                <div className="cp-label">Project Mode *</div>
                <div className="cp-modeToggle">
                  <button
                    className={`btn btn-ghost btn-soft cp-modeBtn ${projectMode === "live" ? "is-active" : ""}`.trim()}
                    type="button"
                    onClick={() => setProjectMode("live")}
                  >
                    Live Project
                  </button>
                  <button
                    className={`btn btn-ghost btn-soft cp-modeBtn ${projectMode === "internal_sandbox" ? "is-active" : ""}`.trim()}
                    type="button"
                    disabled={!sandboxCustomer}
                    onClick={() => setProjectMode("internal_sandbox")}
                  >
                    Internal Sandbox
                  </button>
                </div>
                {projectMode === "internal_sandbox" ? (
                  <div className="cp-note">
                    This project is internal-only, routes to Lift Demo customer 1249, and stays off customer dashboards.
                  </div>
                ) : null}
                {!sandboxCustomer ? (
                  <div className="cp-note">Sandbox mode will unlock once the internal LTL Demo customer is available.</div>
                ) : null}
              </div>

              <div className="cp-field">
                <div className="cp-label">Customer *</div>
                <select
                  className="cp-select"
                  value={effectiveCustomerId}
                  disabled={projectMode === "internal_sandbox"}
                  onChange={(e) => {
                    const nextCustomerId = e.target.value;
                    const nextMarkets = markets.filter((market) => market.customerId === nextCustomerId && market.isActive !== false);
                    const nextMarketId = nextMarkets[0]?.id || "";
                    const nextVenues = venues.filter(
                      (venue) => venue.customerId === nextCustomerId && venue.marketId === nextMarketId && venue.isActive !== false
                    );
                    setCustomerId(nextCustomerId);
                    setMarketId(nextMarketId);
                    setVenueId(nextVenues[0]?.id || "");
                  }}
                >
                  <option value="">Select customer…</option>
                  {(projectMode === "internal_sandbox" ? customers.filter((customer) => customer.id === sandboxCustomer?.id) : liveCustomers).map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="cp-field">
                <div className="cp-label">Campaign Name *</div>
                <input
                  className="cp-input"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder='e.g., "White Claw @ Penn Station 12.25.2025"'
                />
              </div>

              <div className="cp-field">
                <div className="cp-label">Market *</div>
                <select
                  className="cp-select"
                  value={marketId}
                  onChange={(e) => {
                    const nextMarketId = e.target.value;
                    const nextVenues = venues.filter(
                      (venue) =>
                        venue.marketId === nextMarketId &&
                        venue.isActive !== false &&
                        (projectMode === "internal_sandbox" || venue.customerId === effectiveCustomerId)
                    );
                    setMarketId(nextMarketId);
                    setVenueId(nextVenues[0]?.id || "");
                  }}
                >
                  <option value="">Select market…</option>
                  {marketsForCustomer.map((market) => (
                    <option key={market.id} value={market.id}>
                      {projectMode === "internal_sandbox" && market.customerName
                        ? `${market.name} · ${market.customerName}`
                        : market.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="cp-field">
                <div className="cp-label">Venue *</div>
                <select className="cp-select" value={venueId} onChange={(e) => setVenueId(e.target.value)}>
                  <option value="">Select venue…</option>
                  {venuesForMarket.map((venue) => (
                    <option key={venue.id} value={venue.id}>
                      {projectMode === "internal_sandbox" && venue.customerName
                        ? `${venue.name} · ${venue.customerName}`
                        : venue.name}
                    </option>
                  ))}
                </select>
                {effectiveCustomerId && marketId && venuesForMarket.length === 0 ? (
                  <div className="cp-note">
                    {projectMode === "internal_sandbox"
                      ? "No active venues exist for this market yet."
                      : "No active venues exist for this customer and market yet."}
                  </div>
                ) : null}
                {projectMode === "internal_sandbox" && selectedVenue?.customerName ? (
                  <div className="cp-note">Target venue customer: {selectedVenue.customerName}</div>
                ) : null}
              </div>

              <div className="cp-field">
                <div className="cp-label">Artwork Due Date</div>
                <input
                  type="date"
                  className="cp-input"
                  value={artworkDueDate}
                  onChange={(e) => setArtworkDueDate(e.target.value)}
                />
              </div>

              <div className="cp-field">
                <div className="cp-label">Post Date</div>
                <input
                  type="date"
                  className="cp-input"
                  value={postDate}
                  onChange={(e) => setPostDate(e.target.value)}
                />
              </div>

              <div className="cp-field">
                <div className="cp-label">Contract Number</div>
                <input
                  className="cp-input"
                  value={contractNumber}
                  onChange={(e) => setContractNumber(e.target.value)}
                  placeholder="Intersection/customer reference"
                />
              </div>
            </div>

            <button
              className="cp-advancedToggle"
              type="button"
              onClick={() => setAdvancedOpen((v) => !v)}
            >
              {advancedOpen ? "Hide advanced details" : "Show advanced details"}
            </button>

            {advancedOpen && (
              <div className="cp-advanced">
                <div className="cp-grid">
                  <div className="cp-field">
                    <div className="cp-label">End Client (optional)</div>
                    <input
                      className="cp-input"
                      value={endClientName}
                      onChange={(e) => setEndClientName(e.target.value)}
                      placeholder="Nike / Apple / etc"
                    />
                  </div>

                  <div className="cp-field">
                    <div className="cp-label">PO Number (billing)</div>
                    <input
                      className="cp-input"
                      value={poNumber}
                      onChange={(e) => setPoNumber(e.target.value)}
                      placeholder="Optional; AS360 # is used if blank"
                    />
                  </div>
                </div>
              </div>
            )}

            {submitError ? <div className="cp-note cp-note-error">{submitError}</div> : null}
          </div>

          <div className="cp-foot">
            <button className="btn btn-ghost btn-soft" type="button" onClick={handleClose}>
              Cancel
            </button>

            <button className="btn btn-primary btn-wide" type="button" disabled={!canCreate} onClick={handleCreate}>
              {isSubmitting ? "Creating..." : "Create Project"}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
