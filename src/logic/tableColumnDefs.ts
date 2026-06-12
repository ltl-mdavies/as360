// tableColumnDefs.ts
import type { ProjectRollup } from "./mockRollups";
import type { Tone } from "./renderingRules";
import {
  getAngieAssignmentSummary,
  getAngieProofsSummary,
  getAngieRowPrimaryAction,
  getTransitChip,
  getProductionLabel,
} from "./renderingRules";

/**
 * Minimal render models (framework-agnostic)
 * Your UI layer can map these to actual components.
 */
export type TextCell = { type: "text"; primary: string; secondary?: string };
export type ChipCell = { type: "chip"; label: string; tone: Tone };
export type ChipsCell = { type: "chips"; chips: Array<{ label: string; tone: Tone }> };
export type ActionCell = {
  type: "actions";
  primary?: { label: string; action: string };
  secondary: Array<{ label: string; action: string }>;
};

export type CellModel = TextCell | ChipCell | ChipsCell | ActionCell;

export type ColumnDef<Row> = {
  key: string;
  header: string;
  width?: number; // px
  sortKey?: (row: Row) => string | number;
  render: (row: Row) => CellModel;
};

/**
 * Optional: role capabilities / feature toggles
 */
export type AngieTableCapabilities = {
  canSubmitOrders: boolean;       // customer_manager/internal_ops
  canApproveForProduction: boolean;
  showTransitColumn: boolean;     // if you prefer always showing it, set true and render "—" when disabled
};

/**
 * Build Angie table columns (ProjectRollup rows)
 */
export function buildAngieProjectTableColumns(
  caps: AngieTableCapabilities
): ColumnDef<ProjectRollup>[] {
  const cols: ColumnDef<ProjectRollup>[] = [];

  // Campaign / Project
  cols.push({
    key: "campaign",
    header: "Campaign",
    width: 340,
    sortKey: (r) => r.title.toLowerCase(),
    render: (r) => ({
      type: "text",
      primary: r.title,
      secondary: [
        r.projectMode === "internal_sandbox" ? "Sandbox" : null,
        `AS360 # ${r.adspaceOrderNumber || r.extId.replace(/^AS360-/i, "")}`,
        r.liftOrderId && String(r.liftOrderId).trim().length > 0 ? `Lift # ${r.liftOrderId}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    }),
  });

  // Venue
  cols.push({
    key: "venue",
    header: "Venue",
    width: 190,
    sortKey: (r) => r.venueName.toLowerCase(),
    render: (r) => ({
      type: "text",
      primary: r.venueName,
      secondary:
        r.projectMode === "internal_sandbox" && r.sourceCustomerName
          ? `${r.marketName} · Source ${r.sourceCustomerName}`
          : r.marketName,
    }),
  });

  // End Client
  cols.push({
    key: "client",
    header: "End Client",
    width: 170,
    sortKey: (r) => (r.endClientName || "").toLowerCase(),
    render: (r) => ({ type: "text", primary: r.endClientName || "—" }),
  });

  // Dates (Artwork Due / Post Date)
  cols.push({
    key: "dates",
    header: "Dates",
    width: 190,
    sortKey: (r) => r.dates.artworkDue || "",
    render: (r) => ({
      type: "text",
      primary: r.dates.artworkDue ? `Art Due ${r.dates.artworkDue}` : "Art Due —",
      secondary: r.dates.postDate ? `Post ${r.dates.postDate}` : undefined,
    }),
  });

  // Creative Assignment Progress
  cols.push({
    key: "assignment",
    header: "Assign",
    width: 130,
    sortKey: (r) => (r.assignment.required === 0 ? -1 : (r.assignment.assigned / r.assignment.required)),
    render: (r) => {
      const s = getAngieAssignmentSummary(r);
      return {
        type: "text",
        primary: s.label,
        secondary: s.sublabel,
      };
    },
  });

  // Proofs summary
  cols.push({
    key: "proofs",
    header: "Proofs",
    width: 220,
    sortKey: (r) => r.proofs.pending, // higher pending later/earlier based on table sort direction
    render: (r) => {
      const p = getAngieProofsSummary(r);
      const chips = [];
      if (p.revisedBadge) chips.push({ label: p.revisedBadge, tone: "info" as Tone });
      if (p.waitingBadge) chips.push({ label: p.waitingBadge, tone: "warning" as Tone });
      return chips.length
        ? ({ type: "text", primary: p.label, secondary: chips.map(c => c.label).join(" · ") })
        : ({ type: "text", primary: p.label });
    },
  });

  // Transit (optional column)
  if (caps.showTransitColumn) {
    cols.push({
      key: "transit",
      header: "Transit",
      width: 150,
      sortKey: (r) => r.transit.status,
      render: (r) => {
        const chip = getTransitChip(r);
        if (!r.transit.enabled) return { type: "text", primary: "—" };
        if (!chip) return { type: "text", primary: "—" };
        return { type: "chip", label: chip.label, tone: chip.tone };
      },
    });
  }

  // Production
  cols.push({
    key: "production",
    header: "Production",
    width: 160,
    sortKey: (r) => (r.production.ready ? 1 : 0),
    render: (r) => {
      const p = getProductionLabel(r);
      return { type: "chip", label: p.label, tone: p.tone };
    },
  });

  // Actions
  cols.push({
    key: "actions",
    header: "Action",
    width: 188,
    render: (r) => {
      const primary = getAngieRowPrimaryAction(r, {
        canSubmit: caps.canSubmitOrders,
        canRelease: caps.canApproveForProduction,
      });

      const primaryAction =
        primary.kind === "finish_assignment" ? { label: primary.label, action: "open_assignment" } :
        primary.kind === "submit_order" ? { label: primary.label, action: "submit_order" } :
        primary.kind === "review_proofs" ? { label: primary.label, action: "open_proofs" } :
        primary.kind === "view_transit_status" ? { label: primary.label, action: "open_transit" } :
        primary.kind === "approve_for_production" ? { label: primary.label, action: "approve_for_production" } :
        undefined;

      return {
        type: "actions",
        primary: primaryAction,
        secondary: [
          { label: "Open Hub", action: "open_project" },
          { label: "Open Assignment", action: "open_assignment" },
          { label: "Open Proof Review", action: "open_proofs" },
          { label: "Open Transit Review", action: "open_transit" },
          { label: "Open Documents", action: "open_docs" },
        ],
      };
    },
  });

  return cols;
}
