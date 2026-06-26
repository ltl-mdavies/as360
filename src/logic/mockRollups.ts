// src/logic/mockRollups.ts

export type ProofPolicy = "direct" | "hold_for_release";

export type TransitStatus =
  | "not_required"
  | "not_started"
  | "pending"
  | "approved"
  | "rejected"
  | "changes_requested";

export type ProjectRollup = {
  projectId: string;
  accountId: string;
  projectMode?: "live" | "internal_sandbox";
  title: string;
  venueName: string;
  marketName: string;
  endClientName?: string;
  sourceCustomerName?: string;

  adspaceOrderNumber?: string;
  extId: string;
  poNumber: string;
  liftOrderId?: string | null;

  dates: {
    artworkDue?: string | null; // ISO date string (YYYY-MM-DD)
    postDate?: string | null;   // ISO date string (YYYY-MM-DD)
  };

  assignment: {
    required: number;
    assigned: number;
    complete: boolean;
  };

  proofs: {
    total: number;
    approved: number;
    pending: number;
    revised: number;
    waitingForProof?: number;
  };

  transit: {
    enabled: boolean;
    status: TransitStatus;
  };

  production: {
    policy: ProofPolicy;
    ready: boolean;
    awaitingRelease?: boolean;
    released?: boolean;
  };

  liftSync?: {
    phase:
      | "not_submitted"
      | "waiting_for_proof"
      | "proof_review"
      | "proof_approved"
      | "in_production"
      | "completed"
      | "cancelled"
      | "missing"
      | "unknown";
    label: string;
    minLineStepNumber?: number | null;
    maxLineStepNumber?: number | null;
    proofActionable: boolean;
    productionReference: boolean;
    completed: boolean;
    orderStatusRaw?: string | null;
    orderStatusNormalized?: "active" | "cancelled" | "missing" | "unknown" | null;
    healthStatus?: "ok" | "cancelled" | "missing" | "sync_failed" | "unknown" | null;
    healthMessage?: string | null;
    lastOrderSyncAt?: string | null;
  };

  needsAttention: boolean;
};

export const mockRollups: ProjectRollup[] = [
  {
    projectId: "proj_001",
    accountId: "acct_intersection",
    title: "White Claw @ Penn Station 12.25.2025",
    venueName: "Penn Station",
    marketName: "New York City",
    endClientName: "White Claw",
    adspaceOrderNumber: "00000321",
    extId: "AS360-00000321",
    poNumber: "00000321",
    liftOrderId: null,
    dates: { artworkDue: "2025-12-10", postDate: "2025-12-25" },
    assignment: { required: 31, assigned: 28, complete: false },
    proofs: { total: 0, approved: 0, pending: 0, revised: 0, waitingForProof: 0 },
    transit: { enabled: false, status: "not_required" },
    production: { policy: "direct", ready: false, awaitingRelease: false, released: false },
    needsAttention: true,
  },
  {
    projectId: "proj_002",
    accountId: "acct_intersection",
    title: "Vitamin Water @ WTC 01.15.2026",
    venueName: "World Trade Center",
    marketName: "New York City",
    endClientName: "Vitamin Water",
    adspaceOrderNumber: "00000322",
    extId: "AS360-00000322",
    poNumber: "00000322",
    liftOrderId: null,
    dates: { artworkDue: "2026-01-05", postDate: "2026-01-15" },
    assignment: { required: 18, assigned: 18, complete: true },
    proofs: { total: 0, approved: 0, pending: 0, revised: 0, waitingForProof: 0 },
    transit: { enabled: false, status: "not_required" },
    production: { policy: "direct", ready: false, awaitingRelease: false, released: false },
    needsAttention: false,
  },
  {
    projectId: "proj_003",
    accountId: "acct_intersection",
    title: "Bayer Health Care @ NY Penn 01.05.2026",
    venueName: "Penn Station",
    marketName: "New York City",
    endClientName: "Bayer",
    adspaceOrderNumber: "00000299",
    extId: "AS360-00000299",
    poNumber: "00000297",
    liftOrderId: "A0210069",
    dates: { artworkDue: "2025-12-26", postDate: "2025-12-29" },
    assignment: { required: 49, assigned: 49, complete: true },
    proofs: { total: 49, approved: 38, pending: 11, revised: 2, waitingForProof: 4 },
    transit: { enabled: true, status: "pending" },
    production: { policy: "direct", ready: false, awaitingRelease: false, released: false },
    needsAttention: true,
  },
  {
    projectId: "proj_004",
    accountId: "acct_intersection",
    title: "Nike @ 30th Street Station 02.02.2026",
    venueName: "30th Street Station",
    marketName: "Philadelphia",
    endClientName: "Nike",
    adspaceOrderNumber: "00000340",
    extId: "AS360-00000340",
    poNumber: "00000340",
    liftOrderId: "A0210201",
    dates: { artworkDue: "2026-01-20", postDate: "2026-02-02" },
    assignment: { required: 22, assigned: 22, complete: true },
    proofs: { total: 22, approved: 22, pending: 0, revised: 6, waitingForProof: 0 },
    transit: { enabled: false, status: "not_required" },
    production: { policy: "direct", ready: true, awaitingRelease: false, released: false },
    needsAttention: false,
  },
  {
    projectId: "proj_005",
    accountId: "acct_intersection",
    title: "Apple @ Penn Station 02.14.2026",
    venueName: "Penn Station",
    marketName: "New York City",
    endClientName: "Apple",
    adspaceOrderNumber: "00000355",
    extId: "AS360-00000355",
    poNumber: "00000355",
    liftOrderId: "A0210300",
    dates: { artworkDue: "2026-02-01", postDate: "2026-02-14" },
    assignment: { required: 31, assigned: 31, complete: true },
    proofs: { total: 31, approved: 31, pending: 0, revised: 4, waitingForProof: 0 },
    transit: { enabled: true, status: "approved" },
    production: { policy: "hold_for_release", ready: true, awaitingRelease: true, released: false },
    needsAttention: true,
  },
  {
    projectId: "proj_006",
    accountId: "acct_intersection",
    title: "Coca-Cola @ WTC 03.01.2026",
    venueName: "World Trade Center",
    marketName: "New York City",
    endClientName: "Coca-Cola",
    adspaceOrderNumber: "00000370",
    extId: "AS360-00000370",
    poNumber: "00000370",
    liftOrderId: "A0210404",
    dates: { artworkDue: "2026-02-10", postDate: "2026-03-01" },
    assignment: { required: 14, assigned: 14, complete: true },
    proofs: { total: 14, approved: 14, pending: 0, revised: 1, waitingForProof: 0 },
    transit: { enabled: true, status: "rejected" },
    production: { policy: "direct", ready: false, awaitingRelease: false, released: false },
    needsAttention: true,
  },
];

// Helpers
export const getRollupById = (projectId: string) =>
  mockRollups.find((r) => r.projectId === projectId);

export const mockAngieTableRows = mockRollups;

export const mockEndClientProject = mockRollups[2];
