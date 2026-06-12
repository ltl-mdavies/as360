// src/domain/selectors/projectContext.ts
import type { Project, ProjectScope, InventoryItem, Creative, Assignment, ProofLine, TransitApproval } from "../types";

/**
 * Minimal “state-like” input type so this selector can work with demoStore now,
 * and later with appStore/firestore adapters without changing caller code.
 */
export type ProjectContextSource = {
  projects: Project[];
  scopes: Record<string, ProjectScope>;
  inventory: InventoryItem[];
  creatives: Creative[];
  assignments: Assignment[];
  proofs: Record<string, ProofLine[]>;
  transit: Record<string, TransitApproval>;

  productionApprovalMode?: "immediate" | "project_release";
  transitRequired?: boolean;
  productionReleasedByProject?: Record<string, boolean>;
  liveEditUnlockedByProject?: Record<string, boolean>;

  venues?: Array<{ id: string; name: string; market?: string; imageUrl?: string }>;
};

export type ProjectContext = {
  projectId: string;

  // Header
  title: string;
  venueName?: string | null;
  venueMarket?: string | null;
  venueImageUrl?: string | null;
  artworkDueDate?: string | null;
  postDate?: string | null;
  poNumber?: string | null;
  liftOrderNumber?: string | null;

  // Policy
  transitRequired: boolean;
  productionApprovalMode: "immediate" | "project_release";
  productionReleased: boolean;
  liveEditUnlocked: boolean;

  // Core data
  scope: ProjectScope | null;
  scopedActiveInventory: InventoryItem[];    // active ∩ included
  creatives: Creative[];
  assignments: Assignment[];
  assignmentMap: Map<string, string | null>; // inventoryId -> creativeId

  // Derived counts
  allocation: {
    required: number;
    assigned: number;
    remaining: number;
    isComplete: boolean;
  };

  proofs: {
    total: number;
    approved: number;
    pending: number;
    waiting: number;
    revised: number;
  };

  transit: {
    status: "not_started" | "pending" | "approved" | "rejected";
    submittedByName?: string;
    submittedDate?: string;
    comment?: string;
  };

  // Convenience flags
  isSubmitted: boolean;
  canReleaseProduction: boolean;
};

export function buildProjectContext(args: {
  source: ProjectContextSource;
  projectId: string;
}): ProjectContext {
  const { source, projectId } = args;

  const project = source.projects.find((p) => p.id === projectId);
  const scope = source.scopes[projectId] || null;

  const included = new Set(scope?.includedIds || []);
  const scopedActiveInventory = source.inventory.filter((i) => i.isActive && included.has(i.id));

  const assignments = source.assignments.filter((a) => a.projectId === projectId);
  const assignmentMap = new Map<string, string | null>();
  for (const a of assignments) assignmentMap.set(a.inventoryId, a.creativeId ?? null);

  const creatives = source.creatives.filter((c) => c.projectId === projectId);

  // Allocation counts
  let required = 0;
  let assigned = 0;
  for (const inv of scopedActiveInventory) {
    required += 1;
    if (assignmentMap.get(inv.id)) assigned += 1;
  }
  const remaining = Math.max(0, required - assigned);

  // Proof counts
  const proofLines = source.proofs[projectId] || [];
  const totalProofs = proofLines.length;
  const approvedProofs = proofLines.filter((p) => p.status === "approved").length;
  const pendingProofs = proofLines.filter((p) => p.status === "pending").length;
  const waitingProofs = proofLines.filter((p) => p.status === "waiting").length;
  const revisedCount = proofLines.filter((p) => !!p.revised).length;

  // Transit
  const ta = source.transit[projectId];
  const taStatus = (ta?.status || "not_started") as ProjectContext["transit"]["status"];

  // Policy (defaulted for demo)
  const productionApprovalMode = source.productionApprovalMode || "project_release";
  const transitRequired = source.transitRequired ?? true;

  const productionReleased = !!(source.productionReleasedByProject?.[projectId]);
  const liveEditUnlocked = !!(source.liveEditUnlockedByProject?.[projectId]);

  const liftOrderNumber = project?.liftOrderNumber || null;
  const isSubmitted = !!liftOrderNumber;
  const venue = source.venues?.find((v) => v.id === project?.venueId);

  const canReleaseProduction =
    productionApprovalMode === "project_release" &&
    isSubmitted &&
    totalProofs > 0 &&
    approvedProofs === totalProofs &&
    (!transitRequired || taStatus === "approved") &&
    !productionReleased;

  return {
    projectId,
    title: project?.title || `Project ${projectId}`,
    venueName: venue?.name || null,
    venueMarket: venue?.market || null,
    venueImageUrl: venue?.imageUrl || null,
    artworkDueDate: project?.artworkDueDate || null,
    postDate: project?.postDate || null,
    poNumber: project?.poNumber || null,
    liftOrderNumber,

    transitRequired,
    productionApprovalMode,
    productionReleased,
    liveEditUnlocked,

    scope,
    scopedActiveInventory,
    creatives,
    assignments,
    assignmentMap,

    allocation: {
      required,
      assigned,
      remaining,
      isComplete: required > 0 ? assigned === required : true,
    },

    proofs: {
      total: totalProofs,
      approved: approvedProofs,
      pending: pendingProofs,
      waiting: waitingProofs,
      revised: revisedCount,
    },

    transit: {
      status: taStatus,
      submittedByName: (ta as any)?.submittedByName || (ta as any)?.submittedByNameName,
      submittedDate: (ta as any)?.submittedDate,
      comment: (ta as any)?.comment,
    },

    isSubmitted,
    canReleaseProduction,
  };
}
