// src/domain/selectors/rollupSelectors.ts
import type {
  Assignment,
  InventoryItem,
  Project,
  ProjectScope,
  TransitApproval,
  ProofLine,
} from "../types";
import { getAllocationCompleteness } from "./allocationSelectors";

export type ProjectRollup = {
  projectId: string;

  title: string;
  venueName: string;
  market?: string;

  poNumber?: string;
  orderNumber?: string; // Lift order number later
  artworkDueDate?: string;
  postDate?: string;

  assignment: {
    required: number; // scoped active total
    assigned: number;
    remaining: number;
    isComplete: boolean;
  };

  proofs: {
    total: number;
    approved: number;
    pending: number;
    waiting: number;
    revised: number; // “revised flag” lines
  };

  transit: {
    status: TransitApproval["status"];
  };

  production: {
    state: "blocked" | "ready" | "awaiting_release" | "released";
  };
};

export function buildProjectRollup(args: {
  project: Project;
  venueName: string;
  market?: string;

  inventory: InventoryItem[];
  scope: ProjectScope;
  assignments: Assignment[];

  transit?: TransitApproval | null;
  proofLines?: ProofLine[] | null;

  // policy toggle later: hold approvals until customer releases
  masterSwitchMode?: boolean;
}): ProjectRollup {
  const { project, venueName, market, inventory, scope, assignments } = args;

  const alloc = getAllocationCompleteness({ inventory, scope, assignments });

  const proofLines = args.proofLines || [];
  const proofsTotal = proofLines.length;
  const proofsApproved = proofLines.filter((p) => p.status === "approved").length;
  const proofsPending = proofLines.filter((p) => p.status === "pending").length;
  const proofsWaiting = proofLines.filter((p) => p.status === "waiting").length;
  const proofsRevised = proofLines.filter((p) => !!p.revised).length;

  // Transit status default
  const transitStatus = args.transit?.status ?? "not_started";

  // Production state logic (simple + safe for now)
  // - blocked until assignments complete AND (if required) proofs approved AND transit approved (if enabled)
  // Later we will make this dependent on customer toggles + venue requirements.
  let productionState: ProjectRollup["production"]["state"] = "blocked";
  const allProofsApproved = proofsTotal === 0 ? false : proofsApproved === proofsTotal;
  const taApproved = transitStatus === "approved";

  // For now assume: production ready if allocation complete AND proofs approved AND TA approved (if TA exists)
  const taRelevant = args.transit != null; // if transit record exists, treat it as required for now
  const taOk = taRelevant ? taApproved : true;

  if (alloc.isComplete && allProofsApproved && taOk) {
    productionState = args.masterSwitchMode ? "awaiting_release" : "ready";
  }

  return {
    projectId: project.id,
    title: project.title,
    venueName,
    market,

    poNumber: project.poNumber,
    orderNumber: project.liftOrderNumber,
    artworkDueDate: project.artworkDueDate,
    postDate: project.postDate,

    assignment: {
      required: alloc.required,
      assigned: alloc.assigned,
      remaining: alloc.remaining,
      isComplete: alloc.isComplete,
    },

    proofs: {
      total: proofsTotal,
      approved: proofsApproved,
      pending: proofsPending,
      waiting: proofsWaiting,
      revised: proofsRevised,
    },

    transit: {
      status: transitStatus,
    },

    production: {
      state: productionState,
    },
  };
}

/**
 * Convenience: build rollups for Angie dashboard (fast scanning)
 * You pass:
 * - list of projects
 * - venue lookup
 * - scope lookup
 * - assignments lookup
 * - transit/proof lookups (optional)
 */
export function buildRollupsForDashboard(args: {
  projects: Project[];
  venueNameById: Record<string, string>;
  marketByVenueId?: Record<string, string>;

  inventoryByVenueId: Record<string, InventoryItem[]>;
  scopeByProjectId: Record<string, ProjectScope>;
  assignmentsByProjectId: Record<string, Assignment[]>;

  transitByProjectId?: Record<string, TransitApproval | null>;
  proofsByProjectId?: Record<string, ProofLine[] | null>;

  masterSwitchModeByCustomerId?: Record<string, boolean>;
}): ProjectRollup[] {
  const out: ProjectRollup[] = [];

  for (const p of args.projects) {
    const inventory = args.inventoryByVenueId[p.venueId] || [];
    const scope = args.scopeByProjectId[p.id];
    const assignments = args.assignmentsByProjectId[p.id] || [];

    const venueName = args.venueNameById[p.venueId] || "Venue";
    const market = args.marketByVenueId?.[p.venueId];

    const transit = args.transitByProjectId?.[p.id] ?? null;
    const proofLines = args.proofsByProjectId?.[p.id] ?? null;

    const masterSwitchMode = args.masterSwitchModeByCustomerId?.[p.customerId] ?? false;

    out.push(
      buildProjectRollup({
        project: p,
        venueName,
        market,
        inventory,
        scope,
        assignments,
        transit,
        proofLines,
        masterSwitchMode,
      })
    );
  }

  // Sort by artwork due date soonest (or title)
  out.sort((a, b) => {
    const ad = a.artworkDueDate || "";
    const bd = b.artworkDueDate || "";
    if (ad !== bd) return ad.localeCompare(bd);
    return a.title.localeCompare(b.title);
  });

  return out;
}
