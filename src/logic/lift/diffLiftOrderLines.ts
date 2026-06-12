// src/logic/lift/diffLiftOrderLines.ts
import type { CreateOrderPayload, CreateOrderLine } from "../orderBuilder";
import type { LiftOrderLine } from "./parseFlushOrder";

export type LiftOrderLinesDiff = {
  updates: Array<{
    lineNumber: number;
    before: LiftOrderLine;
    after: LiftOrderLine;
    set: { qty?: number; cancel?: boolean };
    reason: "qty_change" | "cancel";
    desired?: CreateOrderLine;
  }>;

  adds: Array<{
    desired: CreateOrderLine;
    reason: "new_line";
  }>;

  deletes: Array<{
    lineNumber: number;
    before: LiftOrderLine;
    reason: "no_longer_needed";
  }>;

  summary: {
    addCount: number;
    updateCount: number;
    deleteCount: number;
    qtyDeltaTotal: number;
  };
};

// For demo-first: we match using a snapshot mapping lineNumber -> (unitNumber||creativeId)
// so line identity stays stable even if Lift doesn't expose unitNumber.
export type SnapshotLineKey = { unitNumber: string; creativeId: string };
export type SnapshotLineKeyByLineNumber = Record<number, SnapshotLineKey>;

function keyFromDesiredLine(l: CreateOrderLine) {
  return `${l.unitNumber}||${l.creativeId}`;
}
function keyFromSnapshot(k: SnapshotLineKey) {
  return `${k.unitNumber}||${k.creativeId}`;
}

export function diffLiftOrderLines(args: {
  desired: CreateOrderPayload;
  current: LiftOrderLine[];

  // snapshot from time-of-submit: lineNumber -> (unitNumber, creativeId)
  snapshotLineKeyByLineNumber: SnapshotLineKeyByLineNumber;

  deleteMode: "qty_zero" | "cancel_field";
}): LiftOrderLinesDiff {
  const desiredByKey = new Map<string, CreateOrderLine>();
  for (const d of args.desired.lines) desiredByKey.set(keyFromDesiredLine(d), d);

  const currentByKey = new Map<string, LiftOrderLine>();
  const currentLineNumbersByKey = new Map<string, number>();

  for (const cur of args.current) {
    const snap = args.snapshotLineKeyByLineNumber[cur.lineNumber];
    if (!snap) continue; // line not mapped in snapshot (ignore for demo)
    const key = keyFromSnapshot(snap);
    currentByKey.set(key, cur);
    currentLineNumbersByKey.set(key, cur.lineNumber);
  }

  const updates: LiftOrderLinesDiff["updates"] = [];
  const adds: LiftOrderLinesDiff["adds"] = [];
  const deletes: LiftOrderLinesDiff["deletes"] = [];

  // updates + adds
  for (const desiredLine of args.desired.lines) {
    const key = keyFromDesiredLine(desiredLine);
    const cur = currentByKey.get(key);

    if (!cur) {
      adds.push({ desired: desiredLine, reason: "new_line" });
      continue;
    }

    if (cur.qty !== desiredLine.quantity) {
      updates.push({
        lineNumber: cur.lineNumber,
        before: cur,
        after: { ...cur, qty: desiredLine.quantity },
        set: { qty: desiredLine.quantity },
        reason: "qty_change",
        desired: desiredLine,
      });
    }
  }

  // deletes (lines present in current snapshot but not in desired anymore)
  for (const [key, cur] of currentByKey.entries()) {
    if (!desiredByKey.has(key)) {
      deletes.push({
        lineNumber: cur.lineNumber,
        before: cur,
        reason: "no_longer_needed",
      });
    }
  }

  // apply deleteMode → treat deletes as updates if needed
  if (args.deleteMode === "qty_zero") {
    for (const d of deletes) {
      updates.push({
        lineNumber: d.lineNumber,
        before: d.before,
        after: { ...d.before, qty: 0 },
        set: { qty: 0 },
        reason: "cancel",
      });
    }
  } else {
    for (const d of deletes) {
      updates.push({
        lineNumber: d.lineNumber,
        before: d.before,
        after: { ...d.before, qty: d.before.qty },
        set: { cancel: true },
        reason: "cancel",
      });
    }
  }

  const qtyDeltaTotal =
    updates.reduce((sum, u) => {
      if (typeof u.set.qty !== "number") return sum;
      return sum + (u.set.qty - u.before.qty);
    }, 0);

  return {
    updates: updates.sort((a, b) => a.lineNumber - b.lineNumber),
    adds,
    deletes, // keep raw deletes too (for UI), even if deleteMode becomes update
    summary: {
      addCount: adds.length,
      updateCount: updates.length,
      deleteCount: deletes.length,
      qtyDeltaTotal,
    },
  };
}