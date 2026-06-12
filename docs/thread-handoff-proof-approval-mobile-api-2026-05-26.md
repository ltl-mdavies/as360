# Adspace360 Thread Handoff: Proof Approval, Mobile UX, and Lift API

Date: 2026-05-26  
Workspace: `/Users/marcusdavies/Projects/adspace360`

## Purpose

Use this document to start a clean Codex thread without losing the implementation context from the long mobile UX and proof approval workstream. The next work is expected to focus on Proof Approval screen updates and Lift / proof API behavior.

## Current App Shape

Adspace360 is a React 19 / Vite / TypeScript app with AWS-backed project APIs.

Core commands:

```bash
npm run build
npm run dev
npm run preview
```

Production frontend deploy used during this workstream:

```bash
npm run build
aws s3 sync dist s3://adspace360foundationstack-frontendappbucket1870ce6-ynsurx2iz3vq --delete
aws cloudfront create-invalidation --distribution-id EQ7MBUNOLLWGY --paths '/*'
aws cloudfront get-invalidation --distribution-id EQ7MBUNOLLWGY --id <INVALIDATION_ID>
```

Last known frontend publish from this thread completed successfully with CloudFront invalidation `IE3EBOPMPINCGSWXAI25BZSRCU`.

## Important Files

Frontend pages:

- `src/pages/AngieDashboard/AngieDashboardPage.tsx`
- `src/pages/ProjectHub/ProjectHubPage.tsx`
- `src/pages/CreativeAssignment/CreativeAssignmentPage.tsx`
- `src/pages/ProofApproval/ProofApprovalPage.tsx`
- `src/pages/TransitApproval/TransitApprovalPage.tsx`
- `src/pages/ArtworkFolder/ArtworkFolderPage.tsx`

Page styles:

- `src/styles/dashboard.css`
- `src/styles/hub.css`
- `src/styles/assignment.css`
- `src/styles/proof.css`
- `src/styles/transitApproval.css`
- `src/styles/artworkFolder.css`
- `src/styles/app.css`

API and backend:

- `src/api/projects.ts`
- `infra/lambda/project-api.ts`
- `infra/scripts/verify-proof-sync.mjs`

Shared UI:

- `src/components/common/PageHeader.tsx`
- `src/components/projects/EditProjectDetailsModal.tsx`

## Major Completed Milestones

### Mobile and responsive UX

The app now has first-class mobile treatments across Dashboard, Hub, Creative Assignment, Proof Approval, Artwork Folder, and Transit Approval.

Completed mobile concepts:

- Dashboard project cards with KPI blocks and accent bars.
- Hub mobile header, KPI cards, full-width actions, and simplified current-step display.
- Creative Assignment mobile is list-view-first and scrollable, with the creatives rail hidden on mobile.
- Proof Approval mobile uses an Instagram-like stacked feed of proof cards.
- Transit Approval has a mobile-friendly review workflow for artwork and approval decisions.
- Back buttons and page headers were made more consistent across Hub, Creative Assignment, and Proof Approval.
- Search inputs were progressively normalized so focus styling belongs on the outer search container, not an inner input outline.

### Proof Approval UX

Proof Approval was heavily updated:

- Desktop proof canvas polished.
- Tablet range uses the card/feed proof anatomy in the main canvas while keeping the left inbox.
- Mobile view is a stacked proof feed.
- The left proof inbox cards are less dense and show useful line/proof identity.
- Explicit "View high-res proof" buttons were removed.
- Clicking or tapping the proof image opens the high-res proof URL.
- Clicking or tapping the client upload thumbnail opens the full client upload URL.
- The action footer gates approval/revision behind print-team feedback acknowledgement when feedback exists.
- Action footer responsiveness was tuned for desktop, tablet, and mobile widths.

### Multiple proofs on one Lift line

Critical behavior discovered and implemented:

- A Lift order line can return multiple proof attachments.
- In `AS360ProofReport`, `ORDER_LINE_ID` and `LINE_NUMBER` may be identical across multiple rows.
- `ATTACHMENT_ID` is the unique proof identity and must be used for proof approval/rejection.
- The UI should display each proof as its own proof card/task.
- Line labels use a pattern like `Line 1 - 1 of 4` plus an ID badge such as `ID 25435036`.
- The interface should still show the same Lift line number for each card.
- Decision updates must PATCH the correct local `lineItemId`, which is linked to the correct Lift `ATTACHMENT_ID`.

Example order used during validation:

- Lift order: `A0221132`
- Shared order line id: `9301338`
- Shared line number: `1`
- Unique proof attachment ids:
  - `25435041`
  - `25435036`
  - `25435043`
  - `25435039`

The backend comment in `infra/lambda/project-api.ts` is important:

```ts
// Lift's proof approval API uses ATTACHMENT_ID as the proofing id.
```

### Stale proof cleanup

Important bug fixed:

- If a Project Details Lift order is changed from one Lift order to another, Proof Approval must not keep proof rows from the previous Lift order.
- Proof sync now prunes proof lines that are not present in the current Lift order response.
- This matters because a project was changed from a prior order with 86 rows to order `A0221132` with 4 relevant proof tasks.

## Proof API Contract and Current Flow

Frontend proof response type lives in `src/api/projects.ts`:

```ts
export type ApiProjectProofLineResponse = {
  lineItemId: string;
  lineNumber: number;
  liftOrderLineId?: number | null;
  liftProofingId?: number | null;
  mediaVariantKey: string;
  mediaVariantLabel?: string;
  mediaName: string;
  w: number;
  h: number;
  unitNumber?: string | null;
  assignedLocations?: string[];
  locations: string[];
  clientCreativeId: string;
  clientFileName: string;
  clientThumbUrl?: string | null;
  clientFullUrl?: string | null;
  proofThumbUrl?: string | null;
  proofFullUrl?: string | null;
  status: "waiting" | "pending" | "approved";
  revised: boolean;
  printTeamFeedback?: string | null;
  updatedAt?: string;
  updatedByName?: string | null;
};
```

Frontend calls:

- `fetchProjectProofs(api, projectId, shareMode, forceRefresh)`
  - GET `/api/projects/{projectId}/proofs`
  - Force refresh uses `/proofs?refresh=1`
- `updateProjectProofLine(api, projectId, lineItemId, payload, shareMode)`
  - PATCH `/api/projects/{projectId}/proofs/{lineItemId}`

Backend proof routes in `infra/lambda/project-api.ts`:

- `GET /api/projects/{projectId}/proofs`
- `PATCH /api/projects/{projectId}/proofs/{lineItemId}`
- Share equivalents under `/api/share/projects/{projectId}/proofs`

Proof sync path:

- `listProjectProofsResponse`
- `syncProjectProofLinesFromLift`
- `fetchLiftProofSyncLines`
- `fetchLiftProofReport`
- `mergeLiftOrderLinesWithProofRows`
- `mergeProjectProofLinesFromLift`

Proof decision path:

- `updateProjectProofLine`
- `sendLiftProofDecision`
- Lift proof endpoint template uses company id and proofing id:
  - `%0` = Lift company id
  - `%1` = Lift `ATTACHMENT_ID` / proofing id

## Important Backend Details

Proof records are stored as `ProjectProofLineItem` in `infra/lambda/project-api.ts`.

Important fields:

- `id`: local proof line id used as frontend `lineItemId`
- `lineNumber`: Lift `LINE_NUMBER`
- `liftOrderLineId`: Lift `ORDER_LINE_ID`
- `liftProofingId`: Lift `ATTACHMENT_ID`
- `liftProofThumbUrl`: low-res proof URL
- `liftProofFullUrl`: high-res proof URL
- `liftProofStatus`: raw Lift status
- `status`: app status, `waiting | pending | approved`
- `printTeamFeedback`: from `PROOF_COMMENT` / related fields

High-res proof source priority in current backend:

- `HIRES_PDF_PROOF`
- `PROOF_LINK_HIGH`
- `PROOF_LINE_HIGH`

Low-res proof source priority:

- `PROOF_LINK`
- `PROOF_LINK_LOW`

Frontend adapter in `ProofApprovalPage.tsx` currently maps:

```ts
proofThumbUrl: line.proofThumbUrl || line.proofFullUrl || null,
proofFullUrl: line.proofFullUrl || line.proofThumbUrl || null,
```

For the UX requirement "click proof thumbnail opens high-res proof", confirm that `proofFullUrl` from the backend is truly high-res and not falling back to low-res unexpectedly.

## Verification Fixtures

The proof sync helper is covered by `infra/scripts/verify-proof-sync.mjs`.

It includes fixtures for:

- Ordered multi-line proof sync.
- Same file + same variant + different unit numbers.
- Missing proof assets staying in `waiting`.
- Real Lift ready step using print proof URLs.
- Flat `AS360ProofReport` rows.
- Multiple `AS360ProofReport` attachments on one Lift line staying separate.
- Pruning proof lines not present in the current Lift order.
- Revised-art rollback step hiding stale Lift proof and waiting for regenerated proof.

Run path:

```bash
npm --prefix infra run build
node infra/scripts/verify-proof-sync.mjs
```

If the next thread changes proof sync, this script should be updated or extended first, then run.

## UI Implementation Notes

### Proof Approval

Primary file: `src/pages/ProofApproval/ProofApprovalPage.tsx`  
Primary CSS: `src/styles/proof.css`

Useful component/function areas:

- `toLiveProofLine`: API response adapter.
- `statusLabel`: UI status labels.
- `getProofFileName`: derives visible proof filename from high/low proof URLs.
- `buildProofHistory`: file history modal content.
- Mobile proof feed CSS begins near the "Mobile proof feed" section in `proof.css`.
- Tablet and desktop proof canvas CSS lives later in `proof.css`.

Proof image click behavior:

- Client upload viewer opens `selected.clientFullUrl`.
- Proof viewer opens `selected.proofFullUrl`.
- Buttons were intentionally removed from the canvas/feed to keep the screen cleaner.

### Dashboard

Primary file: `src/pages/AngieDashboard/AngieDashboardPage.tsx`  
Primary CSS: `src/styles/dashboard.css`

Recent fixes:

- `finish_assignment` quick action routes to `/p/{projectId}/assignment?mode=customer`.
- Project cards use KPI blocks for Assignment, Proofs, and Transit.
- KPI blocks now share a left accent color bar.
- Dashboard search was patched with a late `.dashboard-panel .filters > .field.field-search` override through `1280px`.

### Creative Assignment

Primary file: `src/pages/CreativeAssignment/CreativeAssignmentPage.tsx`  
Primary CSS: `src/styles/assignment.css`

Recent behavior:

- Desktop prioritizes vertical workspace height.
- Mobile hides the creatives rail and focuses on List View assignment rows.
- Submitted/review-only state hides duplicate header actions and uses the submitted banner for actions.
- Search focus styling uses outer container rings.

### Hub

Primary file: `src/pages/ProjectHub/ProjectHubPage.tsx`  
Primary CSS: `src/styles/hub.css`

Recent behavior:

- Mobile header and KPI blocks polished.
- Mobile stepper simplified to avoid horizontal scroll.
- Edit Project Details modal was made scrollable on mobile.
- Project title flash from placeholder-like `ProjectXXXX` was investigated and fixed.

### Transit Approval

Primary file: `src/pages/TransitApproval/TransitApprovalPage.tsx`  
Primary CSS: `src/styles/transitApproval.css`

Recent behavior:

- Mobile-friendly Transit Approval page added.
- Consistent with the rest of the mobile pages.
- Allows reviewing artwork/proof-backed assets and submitting approval status.

## Design Standards Established

Keep these consistent:

- Mobile headers should feel aligned across Dashboard, Hub, Creative Assignment, Proof Approval, and Transit Approval.
- Back buttons should use consistent size and placement across pages.
- KPI cards use rounded cards with a colored left accent that extends into the radius.
- Search controls should focus the outer container only. Avoid inner glowing input rectangles.
- Use dense but readable operational UI, not marketing-style sections.
- Mobile primary workflows should be stacked, touch-friendly, and scrollable.
- Desktop workspaces should prioritize vertical working area, especially Creative Assignment map/list workspace.

## Known Caveats / Watch Items

1. Proof Approval and API work should preserve `ATTACHMENT_ID` as the unique Lift proof decision target.
2. Do not collapse multiple proof rows with the same `LINE_NUMBER` / `ORDER_LINE_ID`.
3. Do not reintroduce old proof rows when a project's linked Lift order changes.
4. If backend proof source priority changes, retest that clicking the proof image opens high-res proof, not low-res.
5. If search styling changes, verify Dashboard, Proof Approval, and Creative Assignment together because they share class names but have page-specific wrappers.
6. If adding proof statuses beyond `waiting | pending | approved`, update frontend types, UI status labels, rollups, Dashboard KPI logic, and backend sync mapping together.

## Suggested Next Thread Opening Prompt

Use something like this:

> We are continuing Adspace360 development in `/Users/marcusdavies/Projects/adspace360`. Please read `docs/thread-handoff-proof-approval-mobile-api-2026-05-26.md` first. The next work focuses on Proof Approval screen updates and Lift proof API behavior. Key constraint: multiple AS360ProofReport rows can share `ORDER_LINE_ID` and `LINE_NUMBER`; `ATTACHMENT_ID` is unique and must be used for proof decisions. Preserve mobile UX polish and run proof sync fixtures if backend proof logic changes.

## Recommended First Steps for Next Thread

1. Read this handoff.
2. Inspect current proof page and API files:
   - `src/pages/ProofApproval/ProofApprovalPage.tsx`
   - `src/styles/proof.css`
   - `src/api/projects.ts`
   - `infra/lambda/project-api.ts`
   - `infra/scripts/verify-proof-sync.mjs`
3. Ask for the specific new proof/API update details.
4. If backend proof sync changes:
   - Add or adjust a fixture in `infra/scripts/verify-proof-sync.mjs`.
   - Run `npm --prefix infra run build`.
   - Run `node infra/scripts/verify-proof-sync.mjs`.
5. Always run `npm run build` before publishing frontend changes.

