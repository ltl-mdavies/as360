import { useEffect, useMemo, useState } from "react";
import Portal from "../common/Portal";

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
};

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
  onSave: (draft: ProjectDetailsDraft) => void;
};

export default function EditProjectDetailsModal({
  isOpen,
  onClose,
  initial,
  venues,
  isVenueLocked = false,
  canManageLiftOrder = false,
  onSave,
}: Props) {
  const [advancedOpen, setAdvancedOpen] = useState(Boolean(initial.endClientName || initial.poNumber || initial.liftOrderId));
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

  useEffect(() => {
    if (!isOpen) return;
    setAdvancedOpen(Boolean(initial.endClientName || initial.poNumber || initial.liftOrderId));
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
  ]);

  const markets = useMemo(() => {
    const set = new Set<string>(venues.map((venue) => venue.market).filter(Boolean));
    if (initial.market) set.add(initial.market);
    return Array.from(set).sort();
  }, [venues, initial.market]);

  const venuesForMarket = useMemo(
    () => venues.filter((venue) => venue.market === market),
    [venues, market]
  );

  const canSave = title.trim().length > 2 && market.trim() && (venueName.trim() || venueId);

  function handleSave() {
    if (!canSave) return;
    const selectedVenue = venues.find((venue) => venue.id === venueId);
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
        <div className="cp-modal" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
          <div className="cp-head">
            <div>
              <div className="cp-title">Edit Project Details</div>
              <div className="cp-sub">Update campaign metadata without changing assignment work.</div>
            </div>

            <button className="btn btn-ghost btn-soft" type="button" onClick={onClose}>
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
