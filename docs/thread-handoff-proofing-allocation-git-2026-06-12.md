# Adspace360 Thread Handoff: Proofing, Allocation Override, AWS, and Git Recovery

Date: 2026-06-12  
Workspace: `/Users/marcusdavies/Projects/adspace360`  
GitHub repo: `git@github.com:ltl-mdavies/as360.git`

## Purpose

Use this document to start a clean Codex thread after the long Proof Approval, Artwork Allocation Override, responsive UI, AWS deploy, and Git recovery workstream.

The next thread should begin by reading:

- `docs/thread-handoff-proof-approval-mobile-api-2026-05-26.md`
- `docs/thread-handoff-proofing-allocation-git-2026-06-12.md`
- `docs/thread-handoff-branding-mobile-realtime-proof-sync-2026-06-17.md`

## Current Git State

The local workspace had lost its `.git` metadata. Git has now been recovered and pushed to GitHub.

Current state:

- Branch: `main`
- Remote: `origin git@github.com:ltl-mdavies/as360.git`
- Current pushed commit: `9c45eaa Recover Adspace360 working baseline`
- Local user config:
  - `user.name=Marcus Davies`
  - `user.email=mdavies@ltlco.com`
- SSH auth is configured with GitHub account `ltl-mdavies`.
- Local branch tracks `origin/main`.

Useful checks:

```bash
git status --short --branch
git remote -v
git log --oneline --decorate -5
```

Important note: this is a recovered baseline commit, not a historical migration. There was no prior local Git history available in `/Users/marcusdavies/Projects/adspace360`, nearby project folders, the April zip archive, or obvious Dropbox Adspace folders.

## Core Commands

Frontend:

```bash
npm run dev
npm run build
npm run preview
```

Infrastructure:

```bash
cd infra
npm run build
npm run synth
npm run deploy
npm run verify:proof-sync
```

## AWS Deployment

Known production frontend deployment target:

- App: `https://app.adspace360.com`
- Frontend bucket: `adspace360foundationstack-frontendappbucket1870ce6-ynsurx2iz3vq`
- CloudFront distribution: `EQ7MBUNOLLWGY`

Frontend deploy pattern:

```bash
npm run build
aws s3 sync dist s3://adspace360foundationstack-frontendappbucket1870ce6-ynsurx2iz3vq --delete
aws cloudfront create-invalidation --distribution-id EQ7MBUNOLLWGY --paths '/*'
aws cloudfront get-invalidation --distribution-id EQ7MBUNOLLWGY --id <INVALIDATION_ID>
```

The most recent frontend-only AWS deploy before Git recovery completed successfully. The live app has the recent Proof Approval CSS cleanup and allocation/proofing UI changes.

## Key Files

Frontend routes and pages:

- `src/app/routes.tsx`
- `src/pages/ProjectHub/ProjectHubPage.tsx`
- `src/pages/ProofApproval/ProofApprovalPage.tsx`
- `src/pages/AllocationOverride/AllocationOverridePage.tsx`
- `src/pages/AllocationReport/AllocationReportPage.tsx`
- `src/pages/TransitApproval/TransitApprovalPage.tsx`

Styles:

- `src/styles/proof.css`
- `src/styles/allocationOverride.css`
- `src/styles/hub.css`
- `src/styles/transitApproval.css`
- `src/styles/allocationReport.css`

API and backend:

- `src/api/projects.ts`
- `infra/lambda/project-api.ts`
- `infra/scripts/verify-proof-sync.mjs`

Shared logic:

- `src/logic/allocationOverride.ts`
- `src/logic/mockProofLines.ts`
- `src/domain/selectors/displayAsset.ts`
- `src/domain/selectors/allocationSelectors.ts`

## Major Work Completed Since May Handoff

### Proof Feedback Threads

The Proof Approval screen now supports structured proof feedback based on Lift's updated `AS360ProofReport` response.

Important model decisions:

- `ATTACHMENT_ID` owns a proof feedback thread.
- `ORDER_LINE_ID` remains the current Lift line grouping/context.
- Multiple active proofs can exist on one Lift order line.
- Historical/replaced proof comments are preserved in Adspace when Lift stops returning an old attachment.
- Sibling proof comments on the same order line are not merged into the selected proof thread.

Added proof fields include:

- `proofComments`
- `proofCommentCount`
- `proofCommentAttachmentCount`
- `latestProofCommentAt`
- `proofVersions`
- backwards-compatible `printTeamFeedback`

UX implemented:

- Proof feedback drawer launched from the selected proof.
- Current proof thread expanded by default.
- Historical/replaced proof versions shown in collapsed sections.
- Comment attachments render as thumbnails and can open in a lightbox.
- Current proof comments require acknowledgement before approve/revision.
- Historical and sibling comments are visible but non-blocking.
- No visible composer yet; future Lift comment-only endpoint can be added later.

### Proof Approval Layout and Polish

Recent Proof Approval UI improvements:

- Proof queue cards use proof thumbnail fallback when original client upload artwork is unavailable.
- If only the proof image exists, the proof viewer centers the proof and hides the empty client upload placeholder.
- The "Original client upload unavailable..." note was softened visually.
- Proof queue cards were cleaned up:
  - removed noisy ID chip from the inbox card
  - product and dimensions separated into scannable rows
  - filename text lightened/reduced
  - proof thumbnails use contained display so portrait artwork is visible
- Proof image hover behavior and intermediate breakpoints were tuned.
- The proof queue was modestly widened on larger desktop screens.
- The workflow instruction stays visible below 1280px using compact copy:
  - `Review proof, resolve feedback if any, then approve or upload a revision.`
- CSS for proof layout was consolidated to reduce duplicate layered rules.

### Quantity and Assignment Mismatch

Proof Approval now pulls and displays `QUANTITY` from the `AS360Orders` endpoint.

Behavior:

- Qty appears in inbox cards and proof detail header.
- Qty is compared with assigned location count.
- If qty does not match assigned locations, the qty/assigned indicator uses warning treatment.
- Current override-order scenario can show `QTY 8 · 0 assigned`, etc.

Important nuance:

- For Adspace campaigns, assigned locations matter.
- For a future standalone proofing module outside Adspace, the assigned-location mismatch may need to be hidden or simplified.

### Lift Sync Status

Proof Approval now displays lightweight sync status after refresh/background sync.

Examples:

- `Lift proof sync last checked Jun 11, 3:58 PM.`
- refreshed/queued/paused/failed states are supported.

The goal is to make current Lift order/proof status visible without blocking the page with 10-30 second Lift proof API calls.

### Canceled Lift Lines

Lift canceled lines are hidden from Proof Approval.

Best cancellation signal:

- `AS360Orders` line has `LINE_STEP_ID: -1`.

Secondary observed proof signal:

- Proof report line had `LINE_STEP_NUMBER: null`.

Current implementation should prefer `LINE_STEP_ID === -1` from Orders data when available.

### Background Refresh Strategy

The agreed product direction:

- Keep the UI snappy.
- Do silent/background refresh for active proof-stage orders.
- Do not continuously call Lift forever.
- Stop or pause automated refresh when an order moves beyond app-interactive stages.
- Add time-based stale gates for test/stalled orders, such as pausing auto-refresh after ~14 days with no changes.
- Manual refresh should remain available.

If this area is revisited, verify the exact backend schedule/trigger implementation before expanding it.

## Artwork Allocation Override Tool

An internal/admin-only repair workspace has been added.

Route:

- `/p/:projectId/allocation-override`

Purpose:

- Let internal users repair the Adspace allocation projection for submitted/Lift-linked campaigns without changing Lift yet.
- Store an override layer.
- Preserve source proofs, creatives, comments, and Lift data.

Core behaviors:

- Load source proof/allocation context.
- Load venue inventory.
- Create override rows from source rows on first save.
- Add manual Adspace-only rows.
- Edit product, dimensions, quantity, media variant, internal note.
- Assign inventory locations.
- Replace display artwork for the override row only.
- Soft-remove rows from downstream outputs.
- Show read-only "Lift sync not supported yet" placeholder.

Downstream intent:

- Proof Approval should prefer override display asset and override location projection when present.
- Allocation Report should use override rows for installer/customer allocation output.
- Transit Approval should use the same override projection.
- Existing behavior should remain unchanged when no override exists.

Recent UI fixes:

- Allocation Override page content supports scrolling instead of overflowing the viewport.
- Hub shows Allocation Override as a button next to Open Lift Order, not a full panel.
- Transit Approval panel visibility was restored for customer admin/internal users.
- Edit Project Details button visibility was restored for the same permission behavior as before.
- Inventory assignment rows now format media/dimensions without `||`.
- Height/width display was corrected to match the rest of the app.
- Allocation row thumbnails now contain portrait/tall images inside square placeholders, consistent with Proof Approval.

## Project Hub Notes

Be careful not to regress hub permission gates.

Current expected behavior:

- End-client customer/share view should not see internal/admin panels.
- Customer admin and internal/platform admin should see Transit Approval when applicable.
- Edit Project Details should remain available according to its prior admin/customer-admin permissions.
- Allocation Override should be visible only to appropriate internal/platform admin context.

## Known Product Questions / Next Items

### 1. Allocation Override Deepening

Likely next area of work.

Questions to clarify:

- Should override rows support restoring a soft-hidden row from the UI?
- Should manual override rows require at least one assigned inventory location before they appear downstream?
- Should replacing artwork also allow selecting an existing creative asset, not only uploading a new file?
- How should audit history be surfaced to admins?
- Should override rows be exportable as a CSV/JSON diagnostic?
- Should the tool warn when assigned inventory count does not match row quantity?

### 2. Inventory Assignment Repair

The larger business need:

- Admin-only tool to fix artwork-to-location assignments after Lift submit.
- Useful for Lift order overrides, failed submits, late-stage artwork changes, inventory changes, or installer allocation correction.
- Must keep customer proofing and downloadable Creative Allocation accurate even when source Adspace assignment data is incomplete.

### 3. Proofing as Standalone Module

There is interest in using Proof Approval as a proofing app outside of Adspace campaigns.

Design implications:

- Keep `ATTACHMENT_ID` as proof identity.
- Keep `ORDER_LINE_ID` as Lift grouping/context.
- Do not couple proofing too tightly to Adspace inventory.
- Qty remains essential.
- Assigned-location mismatch warnings may need a display toggle or proofing-mode abstraction.

### 4. CSS Follow-up

`src/styles/proof.css` was consolidated, but the app still has large page-specific CSS files.

Future cleanup should be incremental:

- Avoid broad restyles.
- Prefer page-by-page consolidation.
- Validate breakpoints visually after each pass.
- Watch for duplicate rules in `proof.css`, `allocationOverride.css`, and `hub.css`.

### 5. Git Hygiene

Now that Git is recovered:

- Commit frequently.
- Push after meaningful completed units.
- Avoid large "everything" commits from here forward.
- Generated folders are ignored; keep them that way.
- The GitHub repo started from the recovered baseline, so there is no earlier history to diff against.

## Validation Commands

Use before commits/deploys:

```bash
npm run build
git status --short --branch
```

For backend proof sync changes:

```bash
cd infra
npm run verify:proof-sync
npm run build
```

For frontend deploy:

```bash
npm run build
aws s3 sync dist s3://adspace360foundationstack-frontendappbucket1870ce6-ynsurx2iz3vq --delete
aws cloudfront create-invalidation --distribution-id EQ7MBUNOLLWGY --paths '/*'
```

## Fresh Thread Startup Prompt

Suggested prompt for the next thread:

```text
We are continuing Adspace360 development in /Users/marcusdavies/Projects/adspace360.

Please read:
- docs/thread-handoff-proof-approval-mobile-api-2026-05-26.md
- docs/thread-handoff-proofing-allocation-git-2026-06-12.md
- docs/thread-handoff-branding-mobile-realtime-proof-sync-2026-06-17.md

Git is now recovered and pushed to git@github.com:ltl-mdavies/as360.git on main.

Before making changes, run git status --short --branch and npm run build if needed.
The likely next focus is the Artwork Allocation Override tool and downstream allocation/proof/transit projection behavior.
```
