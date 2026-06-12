// renderingRules.ts
import type { ProjectRollup } from "./mockRollups";

/**
 * Shared UI decision types
 */
export type Tone = "neutral" | "primary" | "success" | "warning" | "danger" | "info";

export type PrimaryAction =
  | { kind: "none" }
  | { kind: "open_project"; label: string }
  | { kind: "finish_assignment"; label: string }
  | { kind: "submit_order"; label: string }
  | { kind: "review_proofs"; label: string }
  | { kind: "view_transit_status"; label: string }
  | { kind: "approve_for_production"; label: string };

export type StepKey = "assignment" | "submit" | "proofs" | "transit" | "production";

export type StepState = "complete" | "current" | "upcoming";

export type StepperModel = {
  steps: Array<{
    key: StepKey;
    label: string;
    state: StepState;
    hidden?: boolean;
  }>;
};

export type PrimaryActionCardModel =
  | {
      variant: "cta";
      title: string;
      body: string;
      ctaLabel: string;
      ctaKind:
        | "continue_assignment"
        | "open_proofs"
        | "view_documents"
        | "none";
      tone: Tone;
    }
  | {
      variant: "status";
      title: string;
      body: string;
      tone: Tone;
    };

export type ProofsSummaryModel = {
  label: string; // e.g. "47/49 Approved"
  tone: Tone;
  revisedBadge?: string; // e.g. "Revised 3"
  waitingBadge?: string; // e.g. "Waiting 2"
};

export type AssignmentSummaryModel = {
  label: string; // e.g. "18/31"
  sublabel?: string; // e.g. "3 remaining"
  tone: Tone;
};

/**
 * Helpers
 */
const safeNum = (n: any, fallback = 0) => (Number.isFinite(Number(n)) ? Number(n) : fallback);

export function remainingAssignments(rollup: ProjectRollup): number {
  const required = safeNum(rollup.assignment.required);
  const assigned = safeNum(rollup.assignment.assigned);
  return Math.max(0, required - assigned);
}

export function hasLiftOrder(rollup: ProjectRollup): boolean {
  return !!(rollup.liftOrderId && String(rollup.liftOrderId).trim().length > 0);
}

export function proofsAllApproved(rollup: ProjectRollup): boolean {
  return rollup.proofs.total > 0 && rollup.proofs.pending === 0;
}

export function proofsInProgress(rollup: ProjectRollup): boolean {
  return rollup.proofs.total > 0 && (rollup.proofs.pending > 0 || (rollup.proofs.waitingForProof || 0) > 0);
}

export function transitBlocks(rollup: ProjectRollup): boolean {
  if (!rollup.transit.enabled) return false;
  return rollup.transit.status !== "approved";
}

export function awaitingRelease(rollup: ProjectRollup): boolean {
  return rollup.production.policy === "hold_for_release" && !!rollup.production.awaitingRelease;
}

/**
 * Angie (Customer) row primary action decision tree
 */
export function getAngieRowPrimaryAction(rollup: ProjectRollup, opts?: { canSubmit?: boolean; canRelease?: boolean }): PrimaryAction {
  const canSubmit = opts?.canSubmit ?? true;  // customer_manager/internal assumed true
  const canRelease = opts?.canRelease ?? true;

  // 1) assignment incomplete
  if (!rollup.assignment.complete) {
    return { kind: "finish_assignment", label: "Complete Assignment" };
  }

  // 2) no Lift order yet and submit permitted
  if (!hasLiftOrder(rollup) && canSubmit) {
    return { kind: "submit_order", label: "Open Hub to Submit" };
  }

  // 3) proofs pending or waiting
  if (proofsInProgress(rollup)) {
    return { kind: "review_proofs", label: "Open Proof Review" };
  }

  // 4) transit blocks
  if (rollup.transit.enabled && rollup.transit.status !== "approved") {
    return { kind: "view_transit_status", label: rollup.transit.status === "rejected" ? "Resolve Transit Review" : "Open Transit Review" };
  }

  // 5) hold-for-release, ready, not released
  if (awaitingRelease(rollup) && canRelease) {
    return { kind: "approve_for_production", label: "Approve for Production" };
  }

  // 6) otherwise no primary action (Open only)
  return { kind: "none" };
}

/**
 * Angie: Derived column helpers
 */
export function getAngieAssignmentSummary(rollup: ProjectRollup): AssignmentSummaryModel {
  const required = safeNum(rollup.assignment.required);
  const assigned = safeNum(rollup.assignment.assigned);
  const label = `${assigned}/${required}`;

  if (required === 0) return { label: "—", tone: "danger", sublabel: "Invalid scope" };

  if (rollup.assignment.complete) return { label, tone: "success" };

  const remaining = remainingAssignments(rollup);
  return { label, tone: "warning", sublabel: `${remaining} remaining` };
}

export function getAngieProofsSummary(rollup: ProjectRollup): ProofsSummaryModel {
  const { total, approved, pending, revised } = rollup.proofs;
  const waiting = rollup.proofs.waitingForProof || 0;

  if (total === 0) return { label: "Not started", tone: "neutral" };

  const label = `${approved}/${total} Approved`;
  const tone: Tone = pending > 0 || waiting > 0 ? "warning" : "success";

  const out: ProofsSummaryModel = { label, tone };
  if (revised > 0) out.revisedBadge = `Revised ${revised}`;
  if (waiting > 0) out.waitingBadge = `Waiting ${waiting}`;
  return out;
}

/**
 * End-client: Primary action card decision tree
 */
export function getEndClientPrimaryActionCard(
  rollup: ProjectRollup,
  opts?: { endClientCanSubmit?: boolean }
): PrimaryActionCardModel {
  const endClientCanSubmit = opts?.endClientCanSubmit ?? false;

  // 1) assignment incomplete
  if (!rollup.assignment.complete) {
    const rem = remainingAssignments(rollup);
    return {
      variant: "cta",
      title: "Assign remaining locations",
      body: `${rem} location${rem === 1 ? "" : "s"} still need artwork.`,
      ctaLabel: "Continue Assignment",
      ctaKind: "continue_assignment",
      tone: "primary",
    };
  }

  // 2) order not submitted yet
  if (!hasLiftOrder(rollup)) {
    if (endClientCanSubmit) {
      return {
        variant: "cta",
        title: "Assignment complete",
        body: "Your order is ready to be submitted.",
        ctaLabel: "Submit Order",
        ctaKind: "none", // wire to submit if you enable for end-clients later
        tone: "primary",
      };
    }
    return {
      variant: "status",
      title: "Assignment complete",
      body: "Intersection will submit your order shortly.",
      tone: "neutral",
    };
  }

  // 3) submitted, but no proofs yet OR all waiting
  const waiting = rollup.proofs.waitingForProof || 0;
  if (rollup.proofs.total === 0 || (rollup.proofs.total > 0 && waiting === rollup.proofs.total)) {
    return {
      variant: "status",
      title: "Order submitted",
      body: "Proofs will appear once processing is complete.",
      tone: "neutral",
    };
  }

  // 4) proofs pending or waiting
  if (rollup.proofs.pending > 0 || waiting > 0) {
    const parts: string[] = [];
    if (rollup.proofs.pending > 0) parts.push(`${rollup.proofs.pending} proof${rollup.proofs.pending === 1 ? "" : "s"} need approval`);
    if (waiting > 0) parts.push(`${waiting} waiting for proof`);
    return {
      variant: "cta",
      title: "Review proofs",
      body: rollup.transit.enabled
        ? `${parts.join(" · ")} Transit approval can also run now that the order is submitted.`
        : parts.join(" · "),
      ctaLabel: "Open Proof Review",
      ctaKind: "open_proofs",
      tone: "primary",
    };
  }

  // 5) transit blocks (no TA link)
  if (rollup.transit.enabled && rollup.transit.status !== "approved") {
    return {
      variant: "status",
      title: "Awaiting transit review",
      body: "Transit authority review is required before production.",
      tone: rollup.transit.status === "rejected" ? "danger" : "warning",
    };
  }

  // 6) hold-for-release awaiting
  if (awaitingRelease(rollup)) {
    return {
      variant: "status",
      title: "Proofs approved",
      body: "Awaiting production release by Intersection.",
      tone: "neutral",
    };
  }

  // 7) ready for production / moving forward
  return {
    variant: "status",
    title: "Approved for production",
    body: "Your campaign is moving forward.",
    tone: "success",
  };
}

/**
 * Stepper model for end-client project hub
 * NOTE: Transit is not a workspace card, but it can be represented as a gate if desired.
 */
export function getEndClientStepperModel(rollup: ProjectRollup): StepperModel {
  const steps: StepperModel["steps"] = [
    { key: "assignment", label: "Creative Assignment", state: "upcoming" },
    { key: "submit", label: "Submit Order", state: "upcoming" },
    { key: "proofs", label: "Proof Approval", state: "upcoming" },
    { key: "transit", label: "Transit Approval", state: "upcoming", hidden: !rollup.transit.enabled },
    { key: "production", label: "Production", state: "upcoming" },
  ];

  // Determine current stage
  if (!rollup.assignment.complete) {
    setStates(steps, "assignment");
    return { steps };
  }

  if (!hasLiftOrder(rollup)) {
    // assignment complete but not submitted
    setStates(steps, "submit");
    return { steps };
  }

  if (rollup.proofs.total === 0 || rollup.proofs.pending > 0 || (rollup.proofs.waitingForProof || 0) > 0) {
    setStates(steps, "proofs");
    return { steps };
  }

  if (rollup.transit.enabled && rollup.transit.status !== "approved") {
    setStates(steps, "transit");
    return { steps };
  }

  setStates(steps, "production");
  return { steps };
}

function setStates(steps: StepperModel["steps"], currentKey: StepKey) {
  let foundCurrent = false;

  for (const s of steps) {
    if (s.hidden) continue;

    if (!foundCurrent) {
      if (s.key === currentKey) {
        s.state = "current";
        foundCurrent = true;
      } else {
        s.state = "complete";
      }
    } else {
      s.state = "upcoming";
    }
  }

  // Ensure the current step isn't marked complete if it’s first visible
  // (Edge case: if currentKey was hidden, fallback to production)
  const visible = steps.filter(x => !x.hidden);
  if (!visible.some(x => x.state === "current")) {
    visible.forEach(x => (x.state = "complete"));
    visible[visible.length - 1].state = "current";
  }
}

/**
 * Should proof approval card be enabled on end-client hub?
 * (We keep this simple: enable once Lift order exists.)
 */
export function isProofApprovalEnabled(rollup: ProjectRollup): boolean {
  return hasLiftOrder(rollup);
}

/**
 * Whether to show a transit status banner on end-client hub.
 */
export function getTransitBanner(rollup: ProjectRollup): null | { tone: Tone; text: string } {
  if (!rollup.transit.enabled) return null;
  if (rollup.transit.status === "approved") return null;

  const tone: Tone =
    rollup.transit.status === "rejected" ? "danger" :
    rollup.transit.status === "changes_requested" ? "warning" :
    "warning";

  const text =
    rollup.transit.status === "rejected"
      ? "Transit approval rejected — updates are required before production release."
      : rollup.transit.status === "changes_requested"
      ? "Transit requested changes before approval."
      : "Transit approval pending. It can run in parallel with proof approval.";

  return { tone, text };
}


// --- Add-on helpers for Angie table rendering ---
// Paste into renderingRules.ts (below the existing helpers)

/**
 * Angie row highlight tone:
 * - Highlights only when rollup.needsAttention is true
 * - Revised alone never triggers highlight (already enforced in needsAttention)
 */
export function getAngieRowHighlightTone(rollup: ProjectRollup): Tone | null {
  if (!rollup.needsAttention) return null;

  // Prioritize "danger" states first
  if (rollup.transit.enabled && (rollup.transit.status === "rejected" || rollup.transit.status === "changes_requested")) {
    return "danger";
  }

  // Proofs pending or waiting
  if (rollup.proofs.total > 0 && (rollup.proofs.pending > 0 || (rollup.proofs.waitingForProof || 0) > 0)) {
    return "warning";
  }

  // Assignment incomplete
  if (!rollup.assignment.complete) {
    return "warning";
  }

  // Awaiting release (hold policy)
  if (rollup.production.policy === "hold_for_release" && rollup.production.awaitingRelease) {
    return "info";
  }

  return "warning";
}

/**
 * Production column label + tone
 */
export function getProductionLabel(rollup: ProjectRollup): { label: string; tone: Tone } {
  const policy = rollup.production.policy;

  if (policy === "direct") {
    if (rollup.production.ready) return { label: "Ready", tone: "success" };
    return { label: "Blocked", tone: "neutral" };
  }

  // hold_for_release
  if (!rollup.production.ready) return { label: "Blocked", tone: "neutral" };
  if (rollup.production.released) return { label: "Released", tone: "success" };
  if (rollup.production.awaitingRelease) return { label: "Awaiting Release", tone: "info" };
  return { label: "Ready", tone: "success" };
}

/**
 * Transit chip label + tone
 * Useful for Angie table column when transit is enabled.
 */
export function getTransitChip(rollup: ProjectRollup): { label: string; tone: Tone } | null {
  if (!rollup.transit.enabled) return null;

  const s = rollup.transit.status;

  if (s === "approved") return { label: "Approved", tone: "success" };
  if (s === "not_required") return { label: "Not Required", tone: "neutral" };
  if (s === "pending") return { label: "Pending", tone: "warning" };
  if (s === "changes_requested") return { label: "Changes Requested", tone: "warning" };
  if (s === "rejected") return { label: "Rejected", tone: "danger" };
  if (s === "not_started") return { label: "Not Started", tone: "neutral" };

  return { label: String(s).replaceAll("_", " "), tone: "neutral" };
}

/**
 * Small row badges (non-blocking informational tags)
 * - Revised count is informational only
 * - WaitingForProof is operationally useful
 */
export function getAngieRowBadges(rollup: ProjectRollup): Array<{ label: string; tone: Tone }> {
  const out: Array<{ label: string; tone: Tone }> = [];
  const waiting = rollup.proofs.waitingForProof || 0;
  const rem = remainingAssignments(rollup);

  // Show the operational blockers first.
  if (!rollup.assignment.complete && rollup.assignment.required > 0) {
    out.push({ label: `${rem} remaining`, tone: "warning" });
  }

  if (rollup.proofs.pending > 0) {
    out.push({ label: `Pending ${rollup.proofs.pending}`, tone: "warning" });
  }

  if (waiting > 0) {
    out.push({ label: `Waiting ${waiting}`, tone: "warning" });
  }

  if (rollup.production.policy === "hold_for_release" && rollup.production.awaitingRelease) {
    out.push({ label: "Awaiting Release", tone: "info" });
  }

  // Revised is useful, but only when the row is otherwise calm.
  if (rollup.proofs.revised > 0 && out.length < 2) {
    out.push({ label: `Revised ${rollup.proofs.revised}`, tone: "info" });
  }

  return out.slice(0, 2);
}
