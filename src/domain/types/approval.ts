export type TransitApprovalStatus = "not_started" | "pending" | "approved" | "rejected";

export type TransitApproval = {
  projectId: string;
  status: TransitApprovalStatus;

  submittedByName?: string;
  submittedDate?: string;     // YYYY-MM-DD
  comment?: string;

  submittedAt?: string;       // ISO
};

export type ProofLineStatus = "waiting" | "pending" | "approved";

export type ProofLine = {
  projectId: string;
  lineItemId: string;          // Lift proofing id later
  lineNumber: number;

  mediaVariantKey: string;
  locations: string[];         // inventory IDs included in this line

  clientCreativeId: string;    // creative id (client upload)
  proofThumbUrl?: string | null;
  proofFullUrl?: string | null;

  status: ProofLineStatus;
  revised: boolean;
  printTeamFeedback?: string;
};
