# Adspace360 Thread Handoff: June 20, 2026

Date: 2026-06-20  
Workspace: `/Users/marcusdavies/Projects/adspace360`  
Branch at handoff: `main`  
Remote: `git@github.com:ltl-mdavies/as360.git`  
Production app: `https://app.adspace360.com`

## Purpose

This document is the current continuation handoff for the next Adspace360 build thread. It builds on the prior June handoffs and captures the current application state after a major run of UX, workflow, Lift-sync, dark-mode, mobile, dashboard, Hub, Proof Approval, Creative Assignment, Allocation Review, and production-reference work.

Read this document first, then use the prior handoffs for deeper history:

- `docs/thread-handoff-proof-approval-mobile-api-2026-05-26.md`
- `docs/thread-handoff-proofing-allocation-git-2026-06-12.md`
- `docs/thread-handoff-branding-mobile-realtime-proof-sync-2026-06-17.md`
- `docs/lift-order-status-sync.md`
- `docs/adspace360-product-capabilities.md`

## Immediate State

### Git

At the time this handoff was written:

```bash
git status --short --branch
```

reported:

```text
## main...origin/main [ahead 4]
```

The working tree was clean before this handoff doc was added. The local branch is ahead of `origin/main` by four commits:

```text
f0af30a Add allocation PDF action to hub banner
a0a0d24 Polish hub stepper dark mode join
24d0909 Add allocation details search
27baa64 Enlarge review allocation modal
```

After this handoff doc is committed, `main` will be ahead by five unless it is pushed.

Recommended first action for the next thread:

```bash
git status --short --branch
git log --oneline -8
```

If the user wants the latest local work on GitHub:

```bash
git push origin main
```

Do not assume these four latest commits are on GitHub until verified.

### Latest Validation

The latest frontend production build passed after the most recent application code change:

```bash
npm run build
```

That build was run after commit `f0af30a`.

The build still emits large chunk output because the app uses PDF.js and larger page bundles. Vite no longer blocks the build. Prior optimization split vendor chunks, but PDF worker/assets remain large by nature.

## Deployment Notes

Frontend production deploy is static Vite build to S3 behind CloudFront.

Known production hosting:

- S3 bucket: `adspace360foundationstack-frontendappbucket1870ce6-ynsurx2iz3vq`
- CloudFront distribution: `EQ7MBUNOLLWGY`
- Canonical app: `https://app.adspace360.com`

Deploy command pattern:

```bash
npm run build
aws s3 sync dist s3://adspace360foundationstack-frontendappbucket1870ce6-ynsurx2iz3vq --delete
aws cloudfront create-invalidation --distribution-id EQ7MBUNOLLWGY --paths '/*'
```

Infrastructure deploy/validation commands used in this repo:

```bash
npm --prefix infra run build
npm --prefix infra run synth
npm --prefix infra run verify:proof-sync
```

Important: do not deploy infrastructure casually. Most recent work has been frontend-only except prior Lift sync logic changes in `infra/lambda/project-api.ts`.

## Current Product Direction

The app has shifted from a recovered prototype into a polished operational workspace. The design language is now:

- premium light-mode operational UI
- intentional, branded dark mode
- compact utility headers on dense workspaces
- mobile-specific compositions rather than squeezed desktop views
- green system-line motif for Adspace identity and success/progress
- status colors for workflow state, not decorative fills
- maps and proof/artwork assets remain visually inspectable
- noisy technical details are hidden behind info/details affordances where possible

The user strongly values:

- production-grade visual polish
- high usability on mobile, iPad, small laptop, and desktop
- clear workflow status
- avoiding CSS override piles when structural component changes are cleaner
- keeping Git and docs in sync
- small commits at sensible sync points

## Core App Areas

### Dashboard

Primary file:

- `src/pages/AngieDashboard/AngieDashboardPage.tsx`

Styles:

- `src/styles/dashboard.css`

Recent state:

- Mobile dashboard was substantially rebuilt with compact cards, smart actions, KPI chips, and a collapsible command/search/filter dock.
- Desktop dashboard was polished to align with mobile without replacing the table.
- Dashboard status buckets now include a distinct `Complete` state for Lift-complete orders.
- Desktop KPI strip should render as one row, with distinct colors for `Ready / Released` and `Complete`.
- Status rails/bars do most of the visual work; broad color fills were intentionally reduced.

Key behavior:

- Project cards/rows should use smart routing to the next best workspace.
- Lift in-production projects should not show stale Transit Approval or Production Release as the next step.
- Lift complete projects should bucket separately as `Complete`.

Watch points:

- Long status pills inside mobile cards can overflow if new copy is introduced. Prefer shorter labels or flex-safe wrapping.
- Dashboard should remain readable in dark mode; table rows should not use high-opacity gray fills.

### Project Hub

Primary file:

- `src/pages/ProjectHub/ProjectHubPage.tsx`

Styles:

- `src/styles/hub.css`

Recent state:

- Mobile Hub was rebuilt around compact project header, next-step card, progress dock, and workflow cards.
- Desktop Hub received polish: color rails, improved typography/spacing, and dark-mode refinements.
- Hub now honors Lift production/reference states:
  - Lift in production: banner shows `Order in production`.
  - Lift complete: banner shows `Order completed` / Complete workflow state.
  - Stale Transit Approval prompts are suppressed when Lift says the job is already beyond that stage.
- Hub production-reference banner now has two actions:
  - `Open Proof Reference`
  - `Download Allocation PDF`
- `Download Allocation PDF` uses the same `/allocation-report?print=1` path as Allocation Review.
- The Proof Approval/Transit Approval join node in the stepper has dark-mode styling.

Latest commit touching Hub:

- `f0af30a Add allocation PDF action to hub banner`
- `a0a0d24 Polish hub stepper dark mode join`

Watch points:

- If adding new Hub banners, use the existing primary banner model rather than ad hoc JSX.
- Keep production-reference messaging concise. The user prefers language like “Proofs are approved and the order is now in production.”
- Do not expose stale local actions when Lift is already the source of truth.

### Creative Assignment

Primary file:

- `src/pages/CreativeAssignment/CreativeAssignmentPage.tsx`

Styles:

- `src/styles/assignment.css`

Shared map files:

- `src/components/maps/useSharedMapWorkspace.ts`
- `src/components/maps/sharedMapWorkspace.css`

Recent state:

- Utility header is default on Creative Assignment desktop.
- Mobile/small screens force List View for better usability.
- List View is first-class:
  - aligned actions
  - Details per row
  - View Map modal per row
  - assignment mode checkboxes
  - search/filter dock on mobile
- Exiting Assign Mode restores the user's previous map/media filters.
- Map modal pin positioning was fixed for mobile View Map.
- Mobile list-card color bars now use inventory/media pin color correctly.
- Assign Mode panel was redesigned:
  - selected creative color drives panel accent/tint
  - selected creative thumbnail appears in the panel
  - clear hierarchy and instruction copy
  - left-aligned inventory IDs
  - available and assigned-elsewhere sections
- Submitted/read-only Creative Assignment uses review-only messaging and keeps map/list review surfaces available.
- In dark mode, the map artwork itself intentionally remains light for legibility, while surrounding controls can be dark.
- Creative rail Assign Creative button in dark mode has a subtle tint.

Watch points:

- Do not let the map itself invert/darken in dark mode. Venue maps must remain inspectable.
- Assignment Mode accent must use creative/art-file color, not inventory/media color.
- When modifying mobile list cards, ensure color rails reach card rounded corners.

### Common Lightbox

Primary file:

- `src/components/common/Lightbox.tsx`

Styles:

- `src/styles/app.css` and page-specific rules where relevant

Recent state:

- Fit mode should display the full artwork inside the visible viewport.
- The image should not crop/fill by default.
- Zoom controls (`-`, `Fit`, `+`) are available.
- Zoom only enlarges after the user presses `+`.
- The same lightbox behavior should be used across:
  - Creative Assignment thumbnails
  - Proof Approval proof images where lightbox is available
  - Allocation Review visuals where applicable
  - Transit Approval visuals where applicable

Watch points:

- If a creative preview briefly shows then breaks, inspect image fallback and signed/public URL behavior.
- For full-fit behavior, the image/container sizing model is more important than only setting `object-fit: contain`.

### Review Allocation / Allocation Review Packet

Primary component:

- `src/components/reviewAllocation/ReviewAllocationModal.tsx`

Selectors:

- `src/components/reviewAllocation/allocationSelectors.ts`

Styles:

- `src/styles/reviewAllocation.css`

Report page:

- `src/pages/AllocationReport/AllocationReportPage.tsx`
- `src/styles/allocationReport.css`

Recent state:

- Modal was enlarged to better align with other large visual modals like Artwork Folder.
- Allocation Details tab now supports search by creative filename, media/variant, section label, and inventory ID.
- Search/filter lives in the modal content toolbar and shows a count.
- Header and footer both show `Download PDF` buttons in some modal states.

Product decision:

- The two modal `Download PDF` buttons are not two different functions. They are duplicate access points to the same export.
- This is acceptable for a large visual/scrolling modal:
  - header button is immediate
  - footer/sticky button is reachable after review
- If the UI feels too redundant later, remove one access point, but do not create a separate PDF behavior.

Hub now also includes `Download Allocation PDF` for production-reference jobs, using the same report route.

Watch points:

- Review Allocation should work in dark mode and light mode.
- The modal overlays dense pages; ensure contrast is strong enough over dark-mode backdrops.
- Allocation Review has tabs:
  - Allocation Details
  - Inventory List
  - Summary

### Proof Approval

Primary file:

- `src/pages/ProofApproval/ProofApprovalPage.tsx`

Styles:

- `src/styles/proof.css`

Recent state:

- Utility header aligned with Creative Assignment.
- Desktop density pass improved small laptop usability.
- Mobile uses a compact floating search/filter dock rather than a large sticky filter block.
- Mobile cards suppress noisy Proof ID details.
- Technical proof details live behind an info affordance.
- Decision dock was narrowed/centered and should only show printer feedback when actual feedback exists.
- System message `Proof decision recorded.` should not force the dock wider; avoid making a sentence create layout width.
- Lift-controlled approvals:
  - If Lift line/order is already approved or beyond art approval, Adspace cannot undo from the UI.
  - If Lift moves the line backward into proof-review steps, Adspace should allow decisions again after sync.
- Proof packets remain visible after Lift production progression as visual references.

Lift proof/order messaging:

- Keep messaging concise for customer-facing pages.
- Preferred completed/production proof message: proofs approved and order in production/complete.
- Avoid unnecessary Transit Approval language when Lift already proves the job moved forward outside Adspace.

Watch points:

- There are nuanced scenarios around Adspace production release vs direct Lift/manual approvals.
- Lift remains source of truth once it reports line/order status.
- If a line is approved in Lift or the order is beyond art approval, Adspace should not show Undo Approval as actionable.

### Lift Order Status Sync

Primary doc:

- `docs/lift-order-status-sync.md`

Rendering rules:

- `src/logic/renderingRules.ts`

Backend sync:

- `infra/lambda/project-api.ts`

API client:

- `src/api/projects.ts`

Recent state:

- `7.01 PDF Proof` and `7.02 Approve Art`: proof-review states.
- `7.05 Approved`: artwork cleared proof review in Lift.
- `10 Rip Art` and later: in production.
- `18 Completed`: complete.
- If every synced line is `10` or later:
  - Adspace derives `In Production`.
  - Hub/Dashboard/Proof Approval treat job as production reference.
  - stale Transit/Production prompts are suppressed.
- If every synced line is `18` or later:
  - Adspace derives `Complete`.
  - Dashboard shows Complete bucket.
  - Hub stepper reaches Complete.

Important product decision:

- Complete is a derived Adspace state from Lift line/order status in v1, not a separate manual Adspace completion action.

Open questions/future work:

- Whether to store a durable, explicit `completedAt`/`completedSource` when Lift first reports complete.
- Whether Dashboard should support archive/hide completed jobs.
- Whether user-facing labels should say `In Production`, `Production Reference`, or `Complete` per audience.

### Transit Approval

Primary file:

- `src/pages/TransitApproval/TransitApprovalPage.tsx`

Styles:

- `src/styles/transitApproval.css`

Recent state:

- Transit Approval is reasonably aligned visually with Allocation Review.
- It should not become the next required step when Lift has already moved the order into production/complete.
- It remains a separate Adspace workflow where applicable.

Watch points:

- Transit is not always part of the customer process.
- Avoid over-mentioning Transit in proof-complete messaging unless it is actually blocking the project.

### Allocation Override

Primary file:

- `src/pages/AllocationOverride/AllocationOverridePage.tsx`

Logic:

- `src/logic/allocationOverride.ts`

Styles:

- `src/styles/allocationOverride.css`

Recent state:

- Dark mode received a targeted pass.
- Left rail thumbnails were adjusted to display using the same visual fit behavior as Creative Assignment.
- Allocation Override changes affect Adspace proofing, allocation, and transit outputs only.
- Lift allocation write-back is not currently supported.

Watch points:

- This is internal/admin tooling. It should be clear and functional, but it may be less customer-polished than Hub/CA/PA.
- The warning `Lift sync not supported yet` is intentional.

### Share Access

Primary component:

- `src/components/share/ShareAccess.tsx`

Styles:

- `src/styles/shareAccess.css`

Recent state:

- Share Access modal received dark-mode/readability polish.
- Share links are used for scoped collaborator/customer/end-client flows.

Watch points:

- Do not expose sensitive admin controls to scoped share links.
- If changing share permissions, inspect `useShareAccess` behavior and route guards.

### Realtime Presence and Sync

Files:

- `src/realtime/useWorkspacePresence.ts`
- `src/realtime/useCollaborationToastQueue.ts`
- `src/components/realtime/WorkspacePresenceCluster.tsx`
- `src/components/realtime/WorkspacePresenceCluster.css`

Recent state:

- Presence/visual confirmation for collaborative workspaces was added.
- Multi-user sync should be silent:
  - remote updates should not hang/lag the current user's screen
  - minimal toasts can summarize changes
  - changes should merge into the current page without distracting the user

Watch points:

- Avoid frequent noisy toasts.
- Prefer action summaries and low-interruption visual feedback.

### Venue Management / Inventory Presets / Notes

Primary files:

- `src/pages/VenueBuilder/VenueImportPreviewPage.tsx`
- `src/components/projects/CreateProjectModal.tsx`
- `src/components/projects/EditProjectDetailsModal.tsx`
- `src/components/projects/InventoryScopeModal.tsx`
- `infra/lambda/venue-api.ts`
- `infra/lib/adspace360-foundation-stack.ts`

Recent state:

- Venue inventory presets/templates were added.
- Full venue inventory is the auto/default preset.
- Customer admins/internal users can create curated presets.
- Projects can be created from presets.
- Existing projects can switch presets in Edit Project Details.
- Inventory rows support notes.
- Notes/specs surface in Creative Assignment map pin and list details.

Watch points:

- Notes must travel through the real API payload, not just local UI state.
- Specs should show media type separately from variant dimensions.

## Branding and Design System State

Branding docs/assets:

- `docs/adspace360-product-capabilities.md`
- `src/assets/adspace_logo_v1.svg`
- `src/assets/adspace_logo_v1_dark.svg`
- `src/assets/fonts/VTFJustinaHUM-Regular.otf`
- `src/assets/fonts/VTFJustinaHUM-SemiBold.otf`
- `src/assets/fonts/VTFJustinaHUM-Bold.otf`
- `src/styles/tokens.css`
- `src/styles/app.css`

Recent state:

- Justina font is installed.
- Inter remains the operational UI font.
- Login, app header, favicon/app icon/PWA metadata were updated.
- App header auth chip was polished; internal/admin initials use brand green.
- Dark mode is manually toggled and persists across pages.
- The app does not automatically follow system dark/light mode by default. This was intentional:
  - user control is preferred for this operational tool
  - avoid surprise theme flips in production workflows
  - system default could be considered later only for first visit/no preference

Dark mode current direction:

- Not a pure inversion.
- Use brand-tuned dark surfaces.
- Keep maps/proofs/artwork inspectable.
- Avoid generic gray slabs.
- Preserve enough contrast in all modals.

Watch points:

- Any new page/modal needs dark-mode QA.
- Search inputs, selects, pills, tabs, modal headers, and footer bars are common miss areas.

## Routes and Major Pages

Common routes visible in recent work:

- `/login`
- `/customer/projects`
- `/p/:projectId?mode=customer`
- `/p/:projectId/assignment?mode=customer`
- `/p/:projectId/proofs?mode=customer`
- `/p/:projectId/transit`
- `/p/:projectId/allocation-report?print=1`
- `/p/:projectId/documents`

Demo/internal IDs frequently used during work:

- `proj_ei8ff4t7`: Test v4 / Creative Assignment work
- `proj_rqlwsu1u`: First Submit Sandbox / Proof Approval and Lift sync work
- `demo_001`: demo project route/report fallback

Do not hard-code these IDs into new product logic.

## Commands and Local Workflow

Start frontend dev server:

```bash
npm run dev -- --host 127.0.0.1 --port 5173
```

Build:

```bash
npm run build
```

Preview build:

```bash
npm run preview
```

Git check:

```bash
git status --short --branch
git log --oneline -8
```

Production deploy:

```bash
npm run build
aws s3 sync dist s3://adspace360foundationstack-frontendappbucket1870ce6-ynsurx2iz3vq --delete
aws cloudfront create-invalidation --distribution-id EQ7MBUNOLLWGY --paths '/*'
```

AWS/Lambda checks that have been used:

```bash
aws cloudformation describe-stacks
aws cloudformation describe-stack-resources
aws lambda list-functions
aws logs tail
aws lambda invoke
```

## Documentation State

Important current docs:

- `docs/adspace360-product-capabilities.md`
  - marketing/sales/executive feature reference
  - last updated for capabilities and Lift-complete status
- `docs/lift-order-status-sync.md`
  - source of truth for Lift production/complete interpretation
- `docs/aws-foundation.md`
  - infrastructure and hosting model
- `docs/backend-persistence-contract.md`
  - persistence contract/reference
- `docs/share-link-collaboration.md`
  - collaboration/share access design
- `docs/venue-api-contract.md`
  - venue API reference
- `docs/thread-handoff-branding-mobile-realtime-proof-sync-2026-06-17.md`
  - previous large handoff

Recommended habit going forward:

- Commit docs alongside meaningful behavior changes.
- Update `docs/adspace360-product-capabilities.md` when a feature becomes customer/marketing significant.
- Update `docs/lift-order-status-sync.md` whenever Lift step interpretation or status precedence changes.
- Add a short handoff note when a thread produces broad cross-app changes.

## Known Open Items / Next Opportunities

These are not blockers, but they are likely next-thread candidates.

### 1. Push Local Commits

Local `main` is ahead of `origin/main`. Push if the next thread needs GitHub/prod branch parity.

### 2. Confirm Production Deployment State

Because recent work has sometimes been deployed before/after commits, verify whether these latest four local commits are live:

- Enlarged Allocation Review modal
- Allocation Details search
- Hub stepper dark-mode join
- Hub production banner `Download Allocation PDF`

If not live, deploy frontend.

### 3. Allocation Review Button Redundancy

Current decision: duplicate modal buttons are acceptable access points to the same PDF. If visual redundancy bothers the user later, remove one button, but keep a single export implementation.

### 4. Lift Sync Edge Cases

Need ongoing vigilance around:

- Lift line moved backward into proof review
- partial production progression
- mixed line statuses
- proof asset still available after production
- manually advanced Lift orders that bypassed Adspace production release

### 5. Completed Project UX

Now that Complete exists:

- add archive/hide completed projects?
- add Completed filter on Dashboard?
- decide whether completed jobs should stay in default dashboard list
- add completed timestamp/source to Hub/Dashboard if backend stores it

### 6. Bundle Optimization

Build output is acceptable, but large chunks remain. Further optimization could include:

- lazy-load PDF.js only on proof/report/lightbox surfaces
- lazy-load heavy admin/venue pages
- keep vendor chunk strategy stable

Do this only if performance data justifies it.

### 7. Automated Visual QA

Given the app's visual complexity, useful future work:

- Playwright smoke screenshots for Dashboard, Hub, CA, PA in light/dark
- iPhone width checks for CA/PA/Hub/Dashboard
- small-laptop viewport checks around `1470 x 836`

## Recent Commit Context

Recent commits before this handoff:

```text
f0af30a Add allocation PDF action to hub banner
a0a0d24 Polish hub stepper dark mode join
24d0909 Add allocation details search
27baa64 Enlarge review allocation modal
cc2482a Document Lift complete dashboard status
85e2f23 Polish dashboard KPI states
62af87e Add Lift complete status across app
aeba3a0 Align Lift production sync statuses
ea63127 Refine Lift-controlled proof approvals
c4ab088 Simplify complete proof approval messaging
ce139bb Clarify proof reference messaging after Lift production
f391cd5 Keep post-proof reference proofs visible
cd87fc8 Add product capabilities overview
174d570 Stabilize June product polish bundle
d7869de Add June 2026 development handoff
9c45eaa Recover Adspace360 working baseline
```

The latest four commits are local-only unless pushed after this handoff.

## Development Principles for Next Thread

Follow these preferences:

- Prefer component-level structural improvements over CSS-only patch stacks.
- Keep desktop behavior stable when doing mobile-specific redesigns.
- Use existing helpers/selectors before inventing new workflow logic.
- Use Lift status as source of truth after order submission.
- Avoid stale next-step prompts when external Lift state has moved ahead.
- Keep customer-facing copy concise.
- Preserve map/proof/artwork inspectability.
- Treat mobile as its own product surface, not a squeezed desktop.
- Use small commits and update docs at sync points.
- Ask before destructive Git operations.

## Suggested First Prompt for Next Thread

If starting a new Codex thread, paste this:

```text
Please read /Users/marcusdavies/Projects/adspace360/docs/thread-handoff-june-20-2026.md and continue from that state. First check git status, confirm whether local main is ahead of origin, and do not revert any existing changes. Use the existing Adspace360 design/workflow direction from the handoff.
```

