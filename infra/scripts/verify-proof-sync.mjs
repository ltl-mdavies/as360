import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const compiledModulePath = path.resolve(__dirname, "../dist/lambda/project-api.js");

if (!existsSync(compiledModulePath)) {
  console.error("Missing compiled proof sync helper. Run `npm --prefix infra run build` first.");
  process.exit(1);
}

process.env.CORE_TABLE_NAME ||= "proof-sync-verifier-core";
process.env.AUDIT_TABLE_NAME ||= "proof-sync-verifier-audit";
process.env.PROJECT_ASSETS_BUCKET_NAME ||= "proof-sync-verifier-assets";

const { mergeProjectProofLinesFromLift } = await import(pathToFileURL(compiledModulePath).href);

function makeProofLine({
  id,
  lineNumber,
  mediaVariantKey,
  mediaVariantLabel,
  unitNumber,
  locations,
  clientCreativeId,
  clientFileName,
  liftOrderLineId = null,
}) {
  return {
    entityType: "ProjectProofLine",
    id,
    projectId: "project_sandbox",
    lineNumber,
    liftOrderLineId,
    liftProofingId: null,
    mediaVariantKey,
    mediaVariantLabel,
    unitNumber,
    locations,
    clientCreativeId,
    clientFileName,
    liftProofThumbUrl: null,
    liftProofFullUrl: null,
    liftProofStatus: null,
    lastLiftSyncAt: null,
    status: "waiting",
    revised: false,
    printTeamFeedback: "",
    createdAt: "2026-04-16T12:00:00.000Z",
    updatedAt: "2026-04-16T12:00:00.000Z",
    updatedByName: "Verifier",
  };
}

function runCase(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

runCase("ordered multi-line proof sync keeps Lift line order and statuses", () => {
  const existingProofs = [
    makeProofLine({
      id: "proof_1",
      lineNumber: 1,
      mediaVariantKey: "2sheet_46.2x60.2",
      mediaVariantLabel: '2-Sheet Poster • 46.2"h x 60.2"w',
      unitNumber: "2SHEET_4",
      locations: ["PS-2-001", "PS-2-002"],
      clientCreativeId: "creative_a",
      clientFileName: "A File.pdf",
    }),
    makeProofLine({
      id: "proof_2",
      lineNumber: 2,
      mediaVariantKey: "column_wrap_63.75x123",
      mediaVariantLabel: 'Column Wrap • 63.75"h x 123"w',
      unitNumber: "NYPENN_CW",
      locations: ["PS-CW-001"],
      clientCreativeId: "creative_b",
      clientFileName: "B File.pdf",
    }),
  ];

  const rawLines = [
    {
      LINE_NUMBER: 1,
      LINE_STEP_NUMBER: 7.02,
      ORDER_LINE_ID: 9001,
      UNIT_NUMBER: "2SHEET_4",
      PROOFS: [
        {
          ATTACHMENT_ID: 7001,
          PROOF_LINK: "https://lift.example/proof-thumb-a",
          HIRES_PDF_PROOF: "https://lift.example/proof-full-a",
          PROOF_APPROVAL_STATUS: "PENDING",
        },
      ],
    },
    {
      LINE_NUMBER: 2,
      LINE_STEP_NUMBER: 7.02,
      ORDER_LINE_ID: 9002,
      UNIT_NUMBER: "NYPENN_CW",
      PROOFS: [
        {
          ATTACHMENT_ID: 7002,
          PROOF_LINK: "https://lift.example/proof-thumb-b",
          HIRES_PDF_PROOF: "https://lift.example/proof-full-b",
          PROOF_APPROVAL_STATUS: "APPROVED",
        },
      ],
    },
  ];

  const merged = mergeProjectProofLinesFromLift({
    existingProofs,
    rawLines,
    actorName: "Verifier",
    syncedAt: "2026-04-16T12:30:00.000Z",
  });

  assert.equal(merged.issues.length, 0);
  assert.deepEqual(
    merged.updatedProofs.map((line) => [line.lineNumber, line.liftOrderLineId, line.status]),
    [
      [1, 9001, "pending"],
      [2, 9002, "approved"],
    ]
  );
});

runCase("same file + same variant + different unit numbers stay isolated", () => {
  const existingProofs = [
    makeProofLine({
      id: "proof_group",
      lineNumber: 1,
      mediaVariantKey: "column_wrap_63.75x123",
      mediaVariantLabel: 'Column Wrap • 63.75"h x 123"w',
      unitNumber: "NYPENN_CW",
      locations: ["CW-001", "CW-002"],
      clientCreativeId: "creative_cw",
      clientFileName: "Shared File.pdf",
    }),
    makeProofLine({
      id: "proof_unique",
      lineNumber: 2,
      mediaVariantKey: "column_wrap_63.75x123",
      mediaVariantLabel: 'Column Wrap • 63.75"h x 123"w',
      unitNumber: "NYPENN_CW_SPECIAL",
      locations: ["CW-008"],
      clientCreativeId: "creative_cw",
      clientFileName: "Shared File.pdf",
    }),
  ];

  const rawLines = [
    {
      LINE_NUMBER: 1,
      LINE_STEP_NUMBER: 7.02,
      ORDER_LINE_ID: 9101,
      UNIT_NUMBER: "NYPENN_CW",
      PROOFS: [
        {
          ATTACHMENT_ID: 7101,
          PROOF_LINK: "https://lift.example/group-thumb",
          HIRES_PDF_PROOF: "https://lift.example/group-full",
          PROOF_APPROVAL_STATUS: "PENDING",
        },
      ],
    },
    {
      LINE_NUMBER: 2,
      LINE_STEP_NUMBER: 7.02,
      ORDER_LINE_ID: 9102,
      UNIT_NUMBER: "NYPENN_CW_SPECIAL",
      PROOFS: [
        {
          ATTACHMENT_ID: 7102,
          PROOF_LINK: "https://lift.example/special-thumb",
          HIRES_PDF_PROOF: "https://lift.example/special-full",
          PROOF_APPROVAL_STATUS: "PENDING",
        },
      ],
    },
  ];

  const merged = mergeProjectProofLinesFromLift({
    existingProofs,
    rawLines,
    actorName: "Verifier",
    syncedAt: "2026-04-16T12:45:00.000Z",
  });

  assert.equal(merged.issues.length, 0);
  assert.deepEqual(
    merged.updatedProofs.map((line) => ({ lineNumber: line.lineNumber, unitNumber: line.unitNumber, locations: line.locations })),
    [
      { lineNumber: 1, unitNumber: "NYPENN_CW", locations: ["CW-001", "CW-002"] },
      { lineNumber: 2, unitNumber: "NYPENN_CW_SPECIAL", locations: ["CW-008"] },
    ]
  );
});

runCase("missing proof assets stay in waiting state and emit operator-facing issues", () => {
  const existingProofs = [
    makeProofLine({
      id: "proof_waiting",
      lineNumber: 1,
      mediaVariantKey: "rotunda_140x480",
      mediaVariantLabel: 'Rotunda Banner • 140"h x 480"w',
      unitNumber: "RBANNER_1",
      locations: ["PS-RB-01"],
      clientCreativeId: "creative_rb",
      clientFileName: "Rotunda.pdf",
    }),
  ];

  const rawLines = [
    {
      LINE_NUMBER: 1,
      LINE_STEP_NUMBER: 7.02,
      ORDER_LINE_ID: 9201,
      UNIT_NUMBER: "RBANNER_1",
      PROOFS: [
        {
          PROOF_APPROVAL_STATUS: "PENDING",
        },
      ],
    },
  ];

  const merged = mergeProjectProofLinesFromLift({
    existingProofs,
    rawLines,
    actorName: "Verifier",
    syncedAt: "2026-04-16T13:00:00.000Z",
  });

  assert.equal(merged.updatedProofs[0].status, "waiting");
  assert.equal(merged.updatedProofs[0].liftOrderLineId, 9201);
  assert.deepEqual(
    merged.issues.map((issue) => issue.errorCode).sort(),
    ["lift_proof_url_missing", "lift_proofing_id_missing"]
  );
});

runCase("real Lift ready step uses print proof URLs and preserves local unit numbers", () => {
  const existingProofs = [
    makeProofLine({
      id: "proof_real_ready",
      lineNumber: 1,
      mediaVariantKey: "2sheet_46x60",
      mediaVariantLabel: '2-Sheet Poster • 46"h x 60"w',
      unitNumber: "2SHEET_46x60_48PT",
      locations: ["PS-2-002"],
      clientCreativeId: "creative_real",
      clientFileName: "2-Sheet-46x60-v2.pdf",
    }),
  ];

  const rawLines = [
    {
      LINE_NUMBER: 1,
      LINE_STEP_NUMBER: 7.02,
      ORDER_LINE_ID: 9301,
      UNIT_NUMBER: null,
      PROOFS: [
        {
          ATTACHMENT_ID: 7301,
          PROOF_LINK: "https://lift.example/preview-proof",
          HIRES_PDF_PROOF: "https://lift.example/high-res-print-proof",
          HIRES_PDF_PROOF_O: "https://lift.example/original-upload",
          PROOF_APPROVAL_STATUS: "PENDING",
        },
      ],
    },
  ];

  const merged = mergeProjectProofLinesFromLift({
    existingProofs,
    rawLines,
    actorName: "Verifier",
    syncedAt: "2026-04-16T13:10:00.000Z",
  });

  assert.equal(merged.issues.length, 0);
  assert.equal(merged.updatedProofs[0].status, "pending");
  assert.equal(merged.updatedProofs[0].unitNumber, "2SHEET_46x60_48PT");
  assert.equal(merged.updatedProofs[0].liftProofThumbUrl, "https://lift.example/preview-proof");
  assert.equal(merged.updatedProofs[0].liftProofFullUrl, "https://lift.example/high-res-print-proof");
});

runCase("AS360ProofReport flat rows map directly into proof sync", () => {
  const existingProofs = [
    makeProofLine({
      id: "proof_as360_report",
      lineNumber: 1,
      mediaVariantKey: "2sheet_46x60",
      mediaVariantLabel: '2-Sheet Poster • 46"h x 60"w',
      unitNumber: "2SHEET_46x60_48PT",
      locations: ["PS-2-002"],
      clientCreativeId: "creative_as360",
      clientFileName: "2-Sheet-46x60-v2.pdf",
    }),
  ];

  const rawLines = [
    {
      ORDER_NUMBER: "A0219609",
      ORDER_LINE_ID: 9172310,
      LINE_NUMBER: 1,
      STEP_NUMBER: 7.02,
      ATTACHMENT_ID: 24942415,
      CREATION_DATE: "2026-04-13",
      PROOF_FILENAME: "A0219609_1_example.jpg",
      PROOF_LINK_LOW: "https://lift.example/as360-low",
      PROOF_LINE_HIGH: "https://lift.example/as360-high",
      PROOF_COMMENT: "Looks good from Lift.",
      PROOF_APPROVAL_STATUS: "PENDING",
    },
  ];

  const merged = mergeProjectProofLinesFromLift({
    existingProofs,
    rawLines,
    actorName: "Verifier",
    syncedAt: "2026-04-16T13:15:00.000Z",
  });

  assert.equal(merged.issues.length, 0);
  assert.equal(merged.updatedProofs[0].status, "pending");
  assert.equal(merged.updatedProofs[0].liftOrderLineId, 9172310);
  assert.equal(merged.updatedProofs[0].liftProofingId, 24942415);
  assert.equal(merged.updatedProofs[0].liftProofThumbUrl, "https://lift.example/as360-low");
  assert.equal(merged.updatedProofs[0].liftProofFullUrl, "https://lift.example/as360-high");
  assert.equal(merged.updatedProofs[0].printTeamFeedback, "Looks good from Lift.");
});

runCase("Lift rows with canceled line step id are treated as canceled and hidden", () => {
  const existingProofs = [
    makeProofLine({
      id: "proof_active_line",
      lineNumber: 58,
      mediaVariantKey: "prem_panel_door",
      mediaVariantLabel: "Premium Panel Door",
      unitNumber: null,
      locations: ["PHI-NRG-58"],
      clientCreativeId: "creative_active_line",
      clientFileName: "A0223449_58.pdf",
      liftOrderLineId: 9484261,
    }),
    makeProofLine({
      id: "proof_canceled_line",
      lineNumber: 59,
      mediaVariantKey: "prem_panel_door",
      mediaVariantLabel: "Premium Panel Door",
      unitNumber: null,
      locations: ["PHI-NRG-59"],
      clientCreativeId: "creative_canceled_line",
      clientFileName: "A0223449_59.pdf",
      liftOrderLineId: 9484262,
    }),
  ];

  const rawLines = [
    {
      ORDER_NUMBER: "A0223449",
      ORDER_LINE_ID: 9484261,
      LINE_NUMBER: 58,
      LINE_STEP_ID: 889,
      LINE_STEP_NUMBER: 7.02,
      ATTACHMENT_ID: 25995563,
      PROOF_FILENAME: "A0223449_58_INX_PHI_NRG_PremPanelDoor_A_34X29_LEFT_01.jpg",
      PROOF_LINK_LOW: "https://lift.example/thumbs/25995563",
      PROOF_LINK_HIGH: "https://lift.example/originals/25995563",
      PROOF_APPROVAL_STATUS: "PENDING",
    },
    {
      ORDER_NUMBER: "A0223449",
      ORDER_LINE_ID: 9484262,
      LINE_NUMBER: 59,
      LINE_STEP_ID: -1,
      LINE_STEP_NUMBER: null,
      ATTACHMENT_ID: 25995564,
      PROOF_FILENAME: "A0223449_59_INX_PHI_NRG_PremPanelDoor_A_34X29_LEFT_02.jpg",
      PROOF_LINK_LOW: "https://lift.example/thumbs/25995564",
      PROOF_LINK_HIGH: "https://lift.example/originals/25995564",
      PROOF_APPROVAL_STATUS: "PENDING",
    },
  ];

  const merged = mergeProjectProofLinesFromLift({
    existingProofs,
    rawLines,
    actorName: "Verifier",
    syncedAt: "2026-06-11T14:00:00.000Z",
  });

  assert.equal(merged.issues.length, 0);
  assert.deepEqual(merged.updatedProofs.map((line) => line.lineNumber), [58]);
  assert.deepEqual(merged.obsoleteProofs.map((line) => line.lineNumber), [59]);
  assert.equal(merged.updatedProofs[0].liftProofingId, 25995563);
});

runCase("multiple AS360ProofReport attachments on one Lift line stay separate", () => {
  const existingProofs = [
    makeProofLine({
      id: "proof_multi_attachment_seed",
      lineNumber: 1,
      mediaVariantKey: "5x8_revision_test",
      mediaVariantLabel: "5x8 Revision Test",
      unitNumber: null,
      locations: ["LINE-1-A", "LINE-1-B"],
      clientCreativeId: "creative_multi_attachment",
      clientFileName: "A0221132_1_5x8_revision_test.pdf",
      liftOrderLineId: 9301338,
    }),
  ];

  const rawLines = [
    {
      ORDER_NUMBER: "A0221132",
      ORDER_LINE_ID: 9301338,
      LINE_NUMBER: 1,
      LINE_STEP_NUMBER: 7.02,
      PROOFS: [
        {
          ATTACHMENT_ID: 25435041,
          PROOF_FILENAME: "A0221132_1_5x8_revision_test_03_alt.jpg",
          PROOF_LINK_LOW: "https://lift.example/thumbs/25435041",
          PROOF_LINK_HIGH: "https://lift.example/originals/25435041",
          PROOF_COMMENT: "Proof 3",
          PROOF_APPROVAL_STATUS: "PENDING",
        },
        {
          ATTACHMENT_ID: 25435036,
          PROOF_FILENAME: "A0221132_1_5x8_revision_test_04_alt.jpg",
          PROOF_LINK_LOW: "https://lift.example/thumbs/25435036",
          PROOF_LINK_HIGH: "https://lift.example/originals/25435036",
          PROOF_COMMENT: "Proof 4",
          PROOF_APPROVAL_STATUS: "PENDING",
        },
        {
          ATTACHMENT_ID: 25435043,
          PROOF_FILENAME: "A0221132_1_5x8_revision_test_01.jpg",
          PROOF_LINK_LOW: "https://lift.example/thumbs/25435043",
          PROOF_LINK_HIGH: "https://lift.example/originals/25435043",
          PROOF_COMMENT: "Proof 1",
          PROOF_APPROVAL_STATUS: "PENDING",
        },
        {
          ATTACHMENT_ID: 25435039,
          PROOF_FILENAME: "A0221132_1_5x8_revision_test_02_alt.jpg",
          PROOF_LINK_LOW: "https://lift.example/thumbs/25435039",
          PROOF_LINK_HIGH: "https://lift.example/originals/25435039",
          PROOF_COMMENT: "Proof 2",
          PROOF_APPROVAL_STATUS: "PENDING",
        },
      ],
    },
  ];

  const merged = mergeProjectProofLinesFromLift({
    existingProofs,
    rawLines,
    actorName: "Verifier",
    syncedAt: "2026-05-04T17:35:57.000Z",
  });

  assert.equal(merged.issues.length, 0);
  assert.equal(merged.updatedProofs.length, 4);
  assert.deepEqual(
    merged.updatedProofs.map((line) => [line.lineNumber, line.liftOrderLineId, line.liftProofingId, line.status]),
    [
      [1, 9301338, 25435036, "pending"],
      [1, 9301338, 25435039, "pending"],
      [1, 9301338, 25435041, "pending"],
      [1, 9301338, 25435043, "pending"],
    ]
  );
  assert.deepEqual(
    merged.updatedProofs.map((line) => line.printTeamFeedback),
    ["Proof 4", "Proof 2", "Proof 3", "Proof 1"]
  );
});

runCase("multiple AS360ProofReport comments on one attachment become one ordered thread", () => {
  const existingProofs = [
    makeProofLine({
      id: "proof_comment_thread",
      lineNumber: 1,
      mediaVariantKey: "5x8_revision_test",
      mediaVariantLabel: "5x8 Revision Test",
      unitNumber: null,
      locations: ["LINE-1-A"],
      clientCreativeId: "creative_comment_thread",
      clientFileName: "A0221446_1_5x8revisiontest_01.jpg",
      liftOrderLineId: 9324681,
    }),
  ];

  const rawLines = [
    {
      ORDER_NUMBER: "A0221446",
      ORDER_LINE_ID: 9324681,
      LINE_NUMBER: 1,
      LINE_STEP_NUMBER: 7.02,
      PROOFS: [
        {
          ATTACHMENT_ID: 25496942,
          PROOF_FILENAME: "A0221446_1_5x8revisiontest_01.jpg",
          PROOF_LINK_LOW: "https://lift.example/thumbs/25496942",
          PROOF_LINK_HIGH: "https://lift.example/originals/25496942",
          PROOF_COMMENT: "Marcus test comment 1",
          COMMENT_TS: "20-MAY-2026 10:45:21 AM",
          PROOF_APPROVAL_STATUS: "PENDING",
        },
        {
          ATTACHMENT_ID: 25496942,
          PROOF_FILENAME: "A0221446_1_5x8revisiontest_01.jpg",
          PROOF_LINK_LOW: "https://lift.example/thumbs/25496942",
          PROOF_LINK_HIGH: "https://lift.example/originals/25496942",
          PROOF_COMMENT: "Here is a screenshot loaded into the comments",
          COMMENT_TS: "18-MAY-2026 01:32:58 PM",
          COMMENT_ATTACHMENT: [
            {
              LINK_TO_ATTACHMENT: "https://lift.example/comments/20087%20Lift.png",
              COM_ATTACHMENT_TS: "18-MAY-2026 01:32:42 PM",
            },
          ],
          PROOF_APPROVAL_STATUS: "PENDING",
        },
        {
          ATTACHMENT_ID: 25496942,
          PROOF_FILENAME: "A0221446_1_5x8revisiontest_01.jpg",
          PROOF_LINK_LOW: "https://lift.example/thumbs/25496942",
          PROOF_LINK_HIGH: "https://lift.example/originals/25496942",
          PROOF_COMMENT: "Proof comment TEST",
          COMMENT_TS: "18-MAY-2026 01:31:43 PM",
          PROOF_APPROVAL_STATUS: "PENDING",
        },
      ],
    },
  ];

  const merged = mergeProjectProofLinesFromLift({
    existingProofs,
    rawLines,
    actorName: "Verifier",
    syncedAt: "2026-05-26T14:00:00.000Z",
  });

  assert.equal(merged.issues.length, 0);
  assert.equal(merged.updatedProofs.length, 1);
  assert.equal(merged.updatedProofs[0].liftProofingId, 25496942);
  assert.equal(merged.updatedProofs[0].proofCommentCount, 3);
  assert.equal(merged.updatedProofs[0].proofCommentAttachmentCount, 1);
  assert.deepEqual(
    merged.updatedProofs[0].proofComments.map((comment) => comment.body),
    ["Proof comment TEST", "Here is a screenshot loaded into the comments", "Marcus test comment 1"]
  );
  assert.equal(merged.updatedProofs[0].printTeamFeedback, "Marcus test comment 1");
  assert.equal(merged.updatedProofs[0].proofComments[1].attachments[0].filename, "20087 Lift.png");
});

runCase("replaced proof comments are preserved as historical versions", () => {
  const existing = makeProofLine({
    id: "proof_replaced_history",
    lineNumber: 1,
    mediaVariantKey: "5x8_revision_test",
    mediaVariantLabel: "5x8 Revision Test",
    unitNumber: null,
    locations: ["LINE-1-A"],
    clientCreativeId: "creative_replaced_history",
    clientFileName: "old-proof.jpg",
    liftOrderLineId: 9324681,
  });
  existing.liftProofingId = 1111;
  existing.liftProofThumbUrl = "https://lift.example/thumbs/1111";
  existing.liftProofFullUrl = "https://lift.example/originals/1111";
  existing.proofComments = [
    {
      id: "1111:old",
      body: "Old proof note",
      createdAt: "18-MAY-2026 01:31:43 PM",
      attachments: [],
    },
  ];
  existing.proofCommentCount = 1;
  existing.printTeamFeedback = "Old proof note";

  const merged = mergeProjectProofLinesFromLift({
    existingProofs: [existing],
    rawLines: [
      {
        ORDER_NUMBER: "A0221446",
        ORDER_LINE_ID: 9324681,
        LINE_NUMBER: 1,
        LINE_STEP_NUMBER: 7.02,
        PROOFS: [
          {
            ATTACHMENT_ID: 2222,
            PROOF_FILENAME: "new-proof.jpg",
            PROOF_LINK_LOW: "https://lift.example/thumbs/2222",
            PROOF_LINK_HIGH: "https://lift.example/originals/2222",
            PROOF_COMMENT: "New proof note",
            COMMENT_TS: "20-MAY-2026 10:45:21 AM",
            PROOF_APPROVAL_STATUS: "PENDING",
          },
        ],
      },
    ],
    actorName: "Verifier",
    syncedAt: "2026-05-26T14:10:00.000Z",
  });

  assert.equal(merged.updatedProofs.length, 1);
  assert.equal(merged.updatedProofs[0].liftProofingId, 2222);
  assert.equal(merged.updatedProofs[0].proofVersions.length, 2);
  const oldVersion = merged.updatedProofs[0].proofVersions.find((version) => version.attachmentId === 1111);
  assert.equal(oldVersion.current, false);
  assert.equal(oldVersion.comments[0].body, "Old proof note");
  assert.equal(merged.updatedProofs[0].proofVersions.find((version) => version.attachmentId === 2222).current, true);
});

runCase("proof sync prunes proof lines that are not in the current Lift order", () => {
  const existingProofs = [
    makeProofLine({
      id: "proof_current_order_line",
      lineNumber: 1,
      mediaVariantKey: "new_order_line",
      mediaVariantLabel: "New Order Line",
      unitNumber: null,
      locations: ["NEW-001"],
      clientCreativeId: "creative_new_order",
      clientFileName: "new-order.pdf",
      liftOrderLineId: 9601,
    }),
    makeProofLine({
      id: "proof_old_order_line",
      lineNumber: 86,
      mediaVariantKey: "old_order_line",
      mediaVariantLabel: "Old Order Line",
      unitNumber: null,
      locations: ["OLD-086"],
      clientCreativeId: "creative_old_order",
      clientFileName: "old-order.pdf",
      liftOrderLineId: 86086,
    }),
  ];

  const rawLines = [
    {
      LINE_NUMBER: 1,
      LINE_STEP_NUMBER: 7.02,
      ORDER_LINE_ID: 9601,
      PROOFS: [
        {
          ATTACHMENT_ID: 79601,
          PROOF_LINK_LOW: "https://lift.example/new-thumb",
          PROOF_LINK_HIGH: "https://lift.example/new-full",
          PROOF_APPROVAL_STATUS: "PENDING",
        },
      ],
    },
  ];

  const merged = mergeProjectProofLinesFromLift({
    existingProofs,
    rawLines,
    actorName: "Verifier",
    syncedAt: "2026-05-04T18:00:00.000Z",
  });

  assert.deepEqual(merged.updatedProofs.map((line) => line.id), ["proof_current_order_line"]);
  assert.deepEqual(merged.obsoleteProofs.map((line) => line.id), ["proof_old_order_line"]);
});

runCase("revised-art rollback step hides stale Lift proof and waits for regenerated proof", () => {
  const existingProofs = [
    makeProofLine({
      id: "proof_regenerating",
      lineNumber: 1,
      mediaVariantKey: "column_wrap_63.75x123",
      mediaVariantLabel: 'Column Wrap • 63.75"h x 123"w',
      unitNumber: "NYPENN_CW1",
      locations: ["CW-001"],
      clientCreativeId: "creative_revised",
      clientFileName: "ColumnWrap-Revised.pdf",
      liftOrderLineId: 9401,
    }),
  ];

  const rawLines = [
    {
      LINE_NUMBER: 1,
      LINE_STEP_NUMBER: 7.01,
      ORDER_LINE_ID: 9401,
      UNIT_NUMBER: null,
      PROOFS: [
        {
          ATTACHMENT_ID: 7401,
          PROOF_LINK: "https://lift.example/stale-preview",
          HIRES_PDF_PROOF: "https://lift.example/stale-proof",
          PROOF_APPROVAL_STATUS: "PENDING",
        },
      ],
    },
  ];

  const merged = mergeProjectProofLinesFromLift({
    existingProofs,
    rawLines,
    actorName: "Verifier",
    syncedAt: "2026-04-16T13:20:00.000Z",
  });

  assert.equal(merged.issues.length, 0);
  assert.equal(merged.updatedProofs[0].status, "waiting");
  assert.equal(merged.updatedProofs[0].liftProofThumbUrl, null);
  assert.equal(merged.updatedProofs[0].liftProofFullUrl, null);
  assert.deepEqual(merged.updatedProofs[0].locations, ["CW-001"]);
});

if (process.exitCode && process.exitCode !== 0) {
  process.exit(process.exitCode);
}

console.log("All proof sync verification fixtures passed.");
