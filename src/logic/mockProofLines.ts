// src/logic/mockProofLines.ts

export type ProofUIStatus = "waiting" | "pending" | "approved";

export type ProofLineMock = {
  lineItemId: string; // stable id (use Lift ORDER_LINE_ID later)
  lineNumber: number;
  lineStepNumber?: number | null;
  liftOrderLineId?: number | null;
  liftProofingId?: number | null;
  liftProofStatus?: string | null;
  clientCreativeId?: string;
  productionRoute?: "primary_print_vendor" | "external_vendor";
  vendorAccountId?: string | null;
  vendorName?: string | null;
  routeLabel?: string | null;
  integrationMode?: "lift" | "adspace";

  mediaVariantLabel?: string;
  mediaName: string;
  w: number;
  h: number;
  unitNumber?: string | null;
  quantity?: number | null;

  locations: string[];

  revised: boolean;
  status: ProofUIStatus;

  // Client upload
  clientFileName: string;
  clientThumbUrl?: string; // optional for now
  clientFullUrl?: string;

  // Proof (may be missing if waiting)
  proofThumbUrl?: string | null;
  proofFullUrl?: string | null;

  printTeamFeedback?: string | null;
  proofComments?: ProofCommentMock[];
  proofCommentCount?: number;
  proofCommentAttachmentCount?: number;
  latestProofCommentAt?: string | null;
  proofVersions?: ProofVersionMock[];
  vendorProofSubmittedAt?: string | null;
  vendorProofSubmittedByName?: string | null;
  vendorProofSubmittedByVendorAccountId?: string | null;
  vendorProofFilename?: string | null;
  vendorProofContentType?: string | null;
  vendorProofSizeBytes?: number | null;
  vendorProofNote?: string | null;
  updatedAt?: string | null;
};

export type ProofCommentAttachmentMock = {
  url: string;
  createdAt?: string | null;
  filename?: string | null;
};

export type ProofCommentMock = {
  id: string;
  body: string;
  createdAt?: string | null;
  attachments: ProofCommentAttachmentMock[];
};

export type ProofVersionMock = {
  attachmentId?: number | null;
  orderLineId?: number | null;
  proofFilename?: string | null;
  proofThumbUrl?: string | null;
  proofFullUrl?: string | null;
  status?: string | null;
  createdAt?: string | null;
  replacedAt?: string | null;
  current?: boolean;
  comments: ProofCommentMock[];
};

export const mockProofLines: ProofLineMock[] = [
  {
    lineItemId: "8498984",
    lineNumber: 1,
    liftOrderLineId: 8498984,
    mediaVariantLabel: "2-Sheet • 46\"h x 60\"w",
    mediaName: "2-Sheet",
    w: 46,
    h: 60,
    unitNumber: "6491561",
    locations: ["PS-2-106", "PS-2-083", "PS-2-089", "PS-2-095", "PS-2-052"],
    revised: false,
    status: "approved",
    clientFileName: "White_Claw_2Sheet_A.pdf",
    proofThumbUrl: "https://picsum.photos/seed/proof1/640/420",
    proofFullUrl: "https://picsum.photos/seed/proof1full/1600/1000",
    clientThumbUrl: "https://picsum.photos/seed/client1/640/420",
    clientFullUrl: "https://picsum.photos/seed/client1full/1600/1000",
    printTeamFeedback: null,
  },
  {
    lineItemId: "8499010",
    lineNumber: 27,
    liftOrderLineId: 8499010,
    mediaVariantLabel: "Column Wrap • 63.75\"h x 123\"w",
    mediaName: "Column Wrap",
    w: 63.75,
    h: 123,
    unitNumber: "7123002",
    locations: ["PS-CW-006", "PS-CW-001"],
    revised: true,
    status: "pending",
    clientFileName: "White_Claw_Peach_Amtrak_Wrap_0925.pdf",
    clientThumbUrl: "https://picsum.photos/seed/client2/640/420",
    clientFullUrl: "https://picsum.photos/seed/client2full/1600/1000",
    proofThumbUrl: "https://picsum.photos/seed/proof2/640/420",
    proofFullUrl: "https://picsum.photos/seed/proof2full/1600/1000",
    printTeamFeedback: "Resolution could be better on this image.",
  },
  {
    lineItemId: "8499018",
    lineNumber: 35,
    liftOrderLineId: 8499018,
    mediaVariantLabel: "Directional Clock • 24\"h x 24\"w",
    mediaName: "Directional Clock",
    w: 24,
    h: 24,
    unitNumber: "8012345",
    locations: ["PS-DC-019"],
    revised: false,
    status: "pending",
    clientFileName: "DirClock_Left_Final.pdf",
    clientThumbUrl: "https://picsum.photos/seed/client3/640/420",
    clientFullUrl: "https://picsum.photos/seed/client3full/1600/1000",
    // proof not ready yet:
    proofThumbUrl: null,
    proofFullUrl: null,
    printTeamFeedback: null,
  },
];
