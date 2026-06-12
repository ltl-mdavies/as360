// src/components/orderChanges/OrderChangeReviewModal.tsx
import { useMemo, useState } from "react";
import Portal from "../common/Portal";
import type { CreateOrderPayload } from "../../logic/orderBuilder";
import type { LiftOrderLine, } from "../../logic/lift/parseFlushOrder";
import type { SnapshotLineKeyByLineNumber, LiftOrderLinesDiff } from "../../logic/lift/diffLiftOrderLines";
import { diffLiftOrderLines } from "../../logic/lift/diffLiftOrderLines";

export default function OrderChangeReviewModal({
  isOpen,
  onClose,
  desired,
  current,
  snapshotLineKeyByLineNumber,
  deleteMode,
  onApply,
}: {
  isOpen: boolean;
  onClose: () => void;

  desired: CreateOrderPayload;
  current: LiftOrderLine[];
  snapshotLineKeyByLineNumber: SnapshotLineKeyByLineNumber;
  deleteMode: "qty_zero" | "cancel_field";

  onApply: (diff: LiftOrderLinesDiff) => void;
}) {
  const diff = useMemo(
    () => diffLiftOrderLines({ desired, current, snapshotLineKeyByLineNumber, deleteMode }),
    [desired, current, snapshotLineKeyByLineNumber, deleteMode]
  );

  const [expanded, setExpanded] = useState<{ adds: boolean; updates: boolean; deletes: boolean }>({
    adds: true,
    updates: true,
    deletes: true,
  });

  if (!isOpen) return null;

  return (
    <Portal>
      <div className="review-backdrop" onMouseDown={onClose}>
        <div className="review-modal" onMouseDown={(e) => e.stopPropagation()}>
          <div className="review-head">
            <div>
              <div className="review-title">Review Order Changes</div>
              <div className="review-sub">
                Preview how your updated creative assignments would modify the existing Lift order.
              </div>
            </div>
            <button className="btn btn-ghost btn-soft" type="button" onClick={onClose}>
              ✕
            </button>
          </div>

          <div className="review-body">
            <div className="chip-row" style={{ padding: "12px 14px" }}>
              <span className="chip tone-info">Adds: {diff.summary.addCount}</span>
              <span className="chip tone-warning">Updates: {diff.summary.updateCount}</span>
              <span className="chip tone-neutral">Removes: {diff.summary.deleteCount}</span>
            </div>

            {/* Updates */}
            <Section
              title={`Updates (${diff.updates.length})`}
              open={expanded.updates}
              onToggle={() => setExpanded((p) => ({ ...p, updates: !p.updates }))}
            >
              {diff.updates.length === 0 ? (
                <Empty text="No line updates needed." />
              ) : (
                diff.updates.map((u) => (
                  <Row
                    key={`u_${u.lineNumber}`}
                    left={`Line ${u.lineNumber}`}
                    right={`Qty: ${u.before.qty} → ${typeof u.set.qty === "number" ? u.set.qty : u.before.qty}`}
                    tone={u.reason === "cancel" ? "tone-neutral" : "tone-warning"}
                  />
                ))
              )}
            </Section>

            {/* Adds */}
            <Section
              title={`Adds (${diff.adds.length})`}
              open={expanded.adds}
              onToggle={() => setExpanded((p) => ({ ...p, adds: !p.adds }))}
            >
              {diff.adds.length === 0 ? (
                <Empty text="No new lines need to be added." />
              ) : (
                diff.adds.map((a, idx) => (
                  <Row
                    key={`a_${idx}`}
                    left={`${a.desired.unitNumber} · ${a.desired.filename}`}
                    right={`Qty: ${a.desired.quantity}`}
                    tone="tone-info"
                  />
                ))
              )}
            </Section>

            {/* Deletes (raw view) */}
            <Section
              title={`Removes (${diff.deletes.length})`}
              open={expanded.deletes}
              onToggle={() => setExpanded((p) => ({ ...p, deletes: !p.deletes }))}
            >
              {diff.deletes.length === 0 ? (
                <Empty text="No lines need to be removed." />
              ) : (
                diff.deletes.map((d) => (
                  <Row
                    key={`d_${d.lineNumber}`}
                    left={`Line ${d.lineNumber}`}
                    right={`Qty: ${d.before.qty}`}
                    tone="tone-neutral"
                  />
                ))
              )}
            </Section>
          </div>

          <div className="review-footer">
            <button className="btn btn-ghost btn-soft" type="button" onClick={onClose}>
              Close
            </button>
            <button
              className="btn btn-primary btn-wide"
              type="button"
              onClick={() => onApply(diff)}
              title="Demo mode: simulates applying changes"
            >
              Apply Changes (Demo)
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}

function Section({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: any;
}) {
  return (
    <div style={{ padding: "0 14px 12px" }}>
      <button
        type="button"
        className="btn btn-ghost btn-soft"
        style={{ width: "100%", justifyContent: "space-between" }}
        onClick={onToggle}
      >
        <span style={{ fontWeight: 900 }}>{title}</span>
        <span>{open ? "Hide" : "Show"}</span>
      </button>

      {open && <div style={{ marginTop: 10 }}>{children}</div>}
    </div>
  );
}

function Row({ left, right, tone }: { left: string; right: string; tone: string }) {
  return (
    <div className="invtab-row" style={{ gridTemplateColumns: "1fr 1fr", alignItems: "center" }}>
      <div style={{ fontWeight: 900, fontSize: 12 }}>{left}</div>
      <div style={{ textAlign: "right" }}>
        <span className={`chip ${tone}`}>{right}</span>
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="invtab-empty">{text}</div>;
}