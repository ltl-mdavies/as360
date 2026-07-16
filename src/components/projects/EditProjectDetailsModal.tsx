import { useEffect, useId, useMemo, useState } from "react";
import Portal from "../common/Portal";
import type { ApiVenueInventoryPreset } from "../../api/projects";
import type { ProjectOrderLifecycleAction } from "../../logic/orderLifecycleActions";

export type ProjectDetailsDraft = {
  title: string;
  market: string;
  venueId?: string;
  venueName: string;
  artworkDueDate?: string;
  postDate?: string;
  poNumber?: string;
  endClientName?: string;
  contractNumber?: string;
  liftOrderId?: string | null;
  liftOrderOverrideNote?: string;
  orderLifecycleStatus?: OrderLifecycleStatus;
  orderLifecycleReason?: OrderLifecycleReason | "";
  orderLifecycleNote?: string;
  inventoryPresetId?: string;
  inventoryPresetName?: string;
};

export type OrderLifecycleStatus = "active" | "on_hold" | "cancelled";
export type ProjectDetailsHealthAction = ProjectOrderLifecycleAction;
export type OrderLifecycleReason =
  | "cancelled_in_lift"
  | "customer_requested"
  | "duplicate_or_replaced"
  | "date_or_scope_change"
  | "billing_or_po_issue"
  | "test_or_invalid_order"
  | "other";

type VenueOption = {
  id: string;
  name: string;
  market: string;
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  initial: ProjectDetailsDraft;
  venues: VenueOption[];
  isVenueLocked?: boolean;
  canManageLiftOrder?: boolean;
  canManageOrderDisposition?: boolean;
  initialHealthAction?: ProjectDetailsHealthAction | null;
  inventoryPresets?: ApiVenueInventoryPreset[];
  isInventoryScopeLocked?: boolean;
  onSave: (draft: ProjectDetailsDraft) => void;
};

const ORDER_LIFECYCLE_REASON_OPTIONS: Array<{ value: OrderLifecycleReason; label: string }> = [
  { value: "cancelled_in_lift", label: "Cancelled in Lift" },
  { value: "customer_requested", label: "Customer requested" },
  { value: "duplicate_or_replaced", label: "Duplicate or replaced" },
  { value: "date_or_scope_change", label: "Date or scope changed" },
  { value: "billing_or_po_issue", label: "Billing or PO issue" },
  { value: "test_or_invalid_order", label: "Test or invalid order" },
  { value: "other", label: "Other" },
];

export default function EditProjectDetailsModal({
  isOpen,
  onClose,
  initial,
  venues,
  isVenueLocked = false,
  canManageLiftOrder = false,
  canManageOrderDisposition = false,
  initialHealthAction = null,
  inventoryPresets = [],
  isInventoryScopeLocked = false,
  onSave,
}: Props) {
  const [advancedOpen, setAdvancedOpen] = useState(
    Boolean(initial.endClientName || initial.poNumber || initial.liftOrderId || (initial.orderLifecycleStatus && initial.orderLifecycleStatus !== "active"))
  );
  const [title, setTitle] = useState(initial.title);
  const [market, setMarket] = useState(initial.market);
  const [venueId, setVenueId] = useState(initial.venueId || "");
  const [venueName, setVenueName] = useState(initial.venueName);
  const [artworkDueDate, setArtworkDueDate] = useState(initial.artworkDueDate || "");
  const [postDate, setPostDate] = useState(initial.postDate || "");
  const [poNumber, setPoNumber] = useState(initial.poNumber || "");
  const [endClientName, setEndClientName] = useState(initial.endClientName || "");
  const [contractNumber, setContractNumber] = useState(initial.contractNumber || "");
  const [liftOrderId, setLiftOrderId] = useState(initial.liftOrderId || "");
  const [liftOrderOverrideNote, setLiftOrderOverrideNote] = useState("");
  const [orderLifecycleStatus, setOrderLifecycleStatus] = useState<OrderLifecycleStatus>(initial.orderLifecycleStatus || "active");
  const [orderLifecycleReason, setOrderLifecycleReason] = useState<OrderLifecycleReason | "">(initial.orderLifecycleReason || "");
  const [orderLifecycleNote, setOrderLifecycleNote] = useState(initial.orderLifecycleNote || "");
  const [inventoryPresetId, setInventoryPresetId] = useState(initial.inventoryPresetId || "full_venue");
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!isOpen) return;
    const shouldOpenAdvanced = Boolean(
      initialHealthAction ||
        initial.endClientName ||
        initial.poNumber ||
        initial.liftOrderId ||
        (initial.orderLifecycleStatus && initial.orderLifecycleStatus !== "active")
    );
    const nextLifecycleStatus =
      initialHealthAction === "hold_order"
        ? "on_hold"
        : initialHealthAction === "cancel_order"
        ? "cancelled"
        : initial.orderLifecycleStatus || "active";
    const nextLifecycleReason =
      (initialHealthAction === "hold_order" || initialHealthAction === "cancel_order") && !initial.orderLifecycleReason
        ? "cancelled_in_lift"
        : initial.orderLifecycleReason || "";

    setAdvancedOpen(shouldOpenAdvanced);
    setTitle(initial.title);
    setMarket(initial.market);
    setVenueId(initial.venueId || "");
    setVenueName(initial.venueName);
    setArtworkDueDate(initial.artworkDueDate || "");
    setPostDate(initial.postDate || "");
    setPoNumber(initial.poNumber || "");
    setEndClientName(initial.endClientName || "");
    setContractNumber(initial.contractNumber || "");
    setLiftOrderId(initial.liftOrderId || "");
    setLiftOrderOverrideNote("");
    setOrderLifecycleStatus(nextLifecycleStatus);
    setOrderLifecycleReason(nextLifecycleReason);
    setOrderLifecycleNote(initial.orderLifecycleNote || "");
    setInventoryPresetId(initial.inventoryPresetId || "full_venue");
  }, [
    isOpen,
    initial.title,
    initial.market,
    initial.venueId,
    initial.venueName,
    initial.artworkDueDate,
    initial.postDate,
    initial.poNumber,
    initial.endClientName,
    initial.contractNumber,
    initial.liftOrderId,
    initial.orderLifecycleStatus,
    initial.orderLifecycleReason,
    initial.orderLifecycleNote,
    initial.inventoryPresetId,
    initialHealthAction,
  ]);

  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const markets = useMemo(() => {
    const set = new Set<string>(venues.map((venue) => venue.market).filter(Boolean));
    if (initial.market) set.add(initial.market);
    return Array.from(set).sort();
  }, [venues, initial.market]);

  const venuesForMarket = useMemo(
    () => venues.filter((venue) => venue.market === market),
    [venues, market]
  );

  const dispositionNeedsReason = orderLifecycleStatus !== "active";
  const canSave =
    title.trim().length > 2 &&
    market.trim() &&
    (venueName.trim() || venueId) &&
    (!canManageOrderDisposition || !dispositionNeedsReason || Boolean(orderLifecycleReason));

  function handleSave() {
    if (!canSave) return;
    const selectedVenue = venues.find((venue) => venue.id === venueId);
    const nextLifecycleStatus = orderLifecycleStatus || "active";
    onSave({
      title: title.trim(),
      market: market.trim(),
      venueId: selectedVenue?.id || venueId || undefined,
      venueName: selectedVenue?.name || venueName.trim(),
      artworkDueDate: artworkDueDate || undefined,
      postDate: postDate || undefined,
      poNumber: poNumber.trim() || undefined,
      endClientName: endClientName.trim() || undefined,
      contractNumber: contractNumber.trim() || undefined,
      ...(canManageOrderDisposition
        ? {
            orderLifecycleStatus: nextLifecycleStatus,
            orderLifecycleReason: nextLifecycleStatus === "active" ? "" : orderLifecycleReason,
            orderLifecycleNote: nextLifecycleStatus === "active" ? "" : orderLifecycleNote.trim(),
          }
        : {}),
      inventoryPresetId,
      inventoryPresetName: inventoryPresets.find((preset) => preset.id === inventoryPresetId)?.name || "Full Venue",
      ...(canManageLiftOrder
        ? {
            liftOrderId: liftOrderId.trim() || null,
            liftOrderOverrideNote: liftOrderOverrideNote.trim() || undefined,
          }
        : {}),
    });
    onClose();
  }

  if (!isOpen) return null;

  return (
    <Portal>
      <div className="cp-backdrop" onMouseDown={onClose}>
        <div
          className="cp-modal"
          onMouseDown={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
        >
          <div className="cp-head">
            <div>
              <div className="cp-title" id={titleId}>Edit Project Details</div>
              <div className="cp-sub" id={descriptionId}>Update campaign metadata without changing assignment work.</div>
            </div>

            <button className="btn btn-ghost btn-soft cp-closeButton" type="button" onClick={onClose} aria-label="Close project details">
              x
            </button>
          </div>

          <div className="cp-body">
            <div className="cp-grid">
              <div className="cp-field cp-field-wide">
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
                  value={market}
                  disabled={isVenueLocked}
                  onChange={(e) => {
                    const nextMarket = e.target.value;
                    setMarket(nextMarket);
                    const firstVenue = venues.find((venue) => venue.market === nextMarket);
                    setVenueId(firstVenue?.id || "");
                    setVenueName(firstVenue?.name || "");
                  }}
                >
                  {markets.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>

              <div className="cp-field">
                <div className="cp-label">Venue *</div>
                {venuesForMarket.length > 0 ? (
                  <select
                    className="cp-select"
                    value={venueId}
                    disabled={isVenueLocked}
                    onChange={(e) => {
                      const next = venues.find((venue) => venue.id === e.target.value);
                      setVenueId(next?.id || "");
                      setVenueName(next?.name || "");
                    }}
                  >
                    <option value="">Select venue...</option>
                    {venuesForMarket.map((venue) => (
                      <option key={venue.id} value={venue.id}>
                        {venue.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="cp-input"
                    value={venueName}
                    disabled={isVenueLocked}
                    onChange={(e) => setVenueName(e.target.value)}
                    placeholder="Venue name"
                  />
                )}
              </div>

              <div className="cp-field">
                <div className="cp-label">Inventory Preset</div>
                <select
                  className="cp-select"
                  value={inventoryPresetId}
                  disabled={isInventoryScopeLocked || inventoryPresets.length === 0}
                  onChange={(e) => setInventoryPresetId(e.target.value)}
                >
                  {(inventoryPresets.length ? inventoryPresets : [{ id: "full_venue", name: "Full Venue" } as ApiVenueInventoryPreset]).map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.name}
                    </option>
                  ))}
                </select>
                {isInventoryScopeLocked ? (
                  <div className="cp-note">Inventory presets are locked after submission.</div>
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

            <button className="cp-advancedToggle" type="button" onClick={() => setAdvancedOpen((value) => !value)}>
              {advancedOpen ? "Hide advanced details" : "Show advanced details"}
            </button>

            {advancedOpen ? (
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

                  {canManageOrderDisposition ? (
                    <>
                      <div className="cp-field">
                        <div className="cp-label">Order Disposition</div>
                        <select
                          className="cp-select"
                          value={orderLifecycleStatus}
                          onChange={(e) => {
                            const next = e.target.value as OrderLifecycleStatus;
                            setOrderLifecycleStatus(next);
                            if (next === "active") {
                              setOrderLifecycleReason("");
                              setOrderLifecycleNote("");
                            }
                          }}
                        >
                          <option value="active">Active</option>
                          <option value="on_hold">On Hold</option>
                          <option value="cancelled">Cancelled</option>
                        </select>
                      </div>

                      {orderLifecycleStatus !== "active" ? (
                        <>
                          <div className="cp-field">
                            <div className="cp-label">Disposition Reason *</div>
                            <select
                              className="cp-select"
                              value={orderLifecycleReason}
                              onChange={(e) => setOrderLifecycleReason(e.target.value as OrderLifecycleReason)}
                            >
                              <option value="">Select reason...</option>
                              {ORDER_LIFECYCLE_REASON_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="cp-field cp-field-wide">
                            <div className="cp-label">Disposition Note</div>
                            <input
                              className="cp-input"
                              value={orderLifecycleNote}
                              onChange={(e) => setOrderLifecycleNote(e.target.value)}
                              placeholder="Optional note for the audit trail"
                            />
                          </div>

                          <div className="cp-note cp-field-wide">
                            Use On Hold when the Adspace order may continue later. Use Cancelled when the Adspace order
                            should intentionally stop matching a cancelled or unavailable Lift order.
                          </div>
                        </>
                      ) : null}
                    </>
                  ) : null}

                  {canManageLiftOrder ? (
                    <>
                      <div className="cp-field">
                        <div className="cp-label">Relink Lift Order Number</div>
                        <input
                          className="cp-input"
                          value={liftOrderId}
                          onChange={(e) => setLiftOrderId(e.target.value)}
                          placeholder="A0219609"
                        />
                      </div>

                      <div className="cp-field cp-field-wide">
                        <div className="cp-label">Override Note</div>
                        <input
                          className="cp-input"
                          value={liftOrderOverrideNote}
                          onChange={(e) => setLiftOrderOverrideNote(e.target.value)}
                          placeholder="Why this project now maps to a different Lift order"
                        />
                      </div>

                      <div className="cp-note cp-field-wide">
                        Internal admin control. Use this when Lift creates, duplicates, or re-imports an order and this
                        Adspace project needs Proof Approval, Documents, and operational views to follow the real Lift order.
                      </div>
                    </>
                  ) : null}
                </div>
              </div>
            ) : null}

            {isVenueLocked && (
              <div className="cp-note">
                Venue changes are locked because this project already has artwork or assignments. Changing venue safely
                should happen through a guided re-scope flow so existing files, inventory, and placements are not orphaned.
              </div>
            )}
          </div>

          <div className="cp-foot">
            <button className="btn btn-ghost btn-soft" type="button" onClick={onClose}>
              Cancel
            </button>

            <button className="btn btn-primary btn-wide" type="button" disabled={!canSave} onClick={handleSave}>
              Save Details
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
