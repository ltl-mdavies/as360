# Adspace360 Thread Handoff: Branding, Mobile UX, Realtime Presence, PWA, and Proof Reference Sync

Date: 2026-06-17  
Workspace: `/Users/marcusdavies/Projects/adspace360`  
Branch: `main`  
Production app: `https://app.adspace360.com`

## Purpose

This handoff records the large June 2026 product polish and capability push that followed the June 12 proofing/allocation handoff.

The major theme of this workstream was turning the recovered Adspace360 baseline into a more production-grade, device-aware application:

- Venue inventory presets and inventory notes/specs
- Creative Assignment list view, mobile behavior, map modal, assignment mode, and lightbox improvements
- Proof Approval mobile/desktop workspace upgrades
- Dashboard and Project Hub mobile redesigns
- Branding, typography, app icons, PWA support, and dark-mode refinement
- Realtime workspace presence/change-sync surfaces
- Lift proof sync behavior for orders that have moved beyond proof approval

Future threads should read this document after:

- `docs/thread-handoff-proof-approval-mobile-api-2026-05-26.md`
- `docs/thread-handoff-proofing-allocation-git-2026-06-12.md`

## Current Git Hygiene Notes

The repo had accumulated a very large dirty working tree during the recent rapid iteration cycle. This handoff is intended to restore a clear record before committing the feature bundle.

Important constraints:

- Do not revert broad changes unless explicitly requested.
- This workstream intentionally spans frontend, backend, infrastructure, app assets, and docs.
- Future changes should be committed in smaller slices.

Recommended status checks:

```bash
git status --short --branch
git log --oneline --decorate -5
```

## Validation Commands

Run these before commit/deploy when touching this work:

```bash
npm run build
npm --prefix infra run verify:proof-sync
```

For infrastructure-only validation:

```bash
npm --prefix infra run build
npm --prefix infra run synth
```

For frontend production deploy:

```bash
npm run build
aws s3 sync dist s3://adspace360foundationstack-frontendappbucket1870ce6-ynsurx2iz3vq --delete
aws cloudfront create-invalidation --distribution-id EQ7MBUNOLLWGY --paths '/*'
```

Known frontend hosting:

- S3 bucket: `adspace360foundationstack-frontendappbucket1870ce6-ynsurx2iz3vq`
- CloudFront distribution: `EQ7MBUNOLLWGY`

## Venue Inventory Presets

Venue Management now supports venue-level inventory presets/templates.

Product intent:

- The full venue inventory remains the default generated preset.
- Customer admins and internal users can create curated inventory sets, such as seasonal inventory.
- New projects can start from a preset.
- Existing projects can switch inventory selection from Edit Project Details.

Implementation areas:

- Backend venue preset API and persistence
- Venue management UI
- Create Project and Edit Project Details preset selection
- Shared inventory selection modal reuse

Key files:

- `infra/lambda/venue-api.ts`
- `infra/lib/adspace360-foundation-stack.ts`
- `src/components/projects/CreateProjectModal.tsx`
- `src/components/projects/EditProjectDetailsModal.tsx`
- `src/components/projects/InventoryScopeModal.tsx`
- `src/pages/VenueBuilder/VenueImportPreviewPage.tsx`

## Inventory Notes and Specs

Venue inventory rows now support per-row notes.

Creative Assignment surfaces those notes in inventory detail/spec panels:

- Map pin modal Specs/Details section
- List View per-row details affordance
- Inventory ID
- Media
- Dimensions
- Safety dimensions
- Notes

Important UX decisions:

- Media in specs should show the media type, not the full variant label.
- Notes must come through the API payload, not be patched only in the UI.

## Creative Assignment

Creative Assignment received the largest set of workflow improvements.

### List View

List View is now a first-class workflow, especially for mobile and small screens.

Notable behavior:

- List View is enforced on small screens.
- Per-row action buttons align consistently whether a creative is assigned or not.
- Rows support Details and View Map.
- View Map opens the map in a modal and focuses the relevant inventory item.
- Bulk assign mode in List View restores the user's previous map/media filters when exited.

### Map View and Assignment Mode

Assignment Mode was polished for clarity:

- Floating assign panel uses the selected creative color, not inventory/media color.
- Panel includes selected creative thumbnail.
- Panel uses stronger hierarchy, clearer instruction copy, count chips, and left-aligned inventory IDs.
- Available and assigned-elsewhere rows remain scannable.
- Pressing Escape exits assign mode.

### Responsive and Dense Workspaces

Creative Assignment now adapts better to:

- Mobile phones
- iPad/tablet widths
- Small laptops around `1470 x 836`
- Larger desktop canvases

Important decisions:

- The utility header is the default on Creative Assignment.
- Map/list workspaces move higher on desktop to give the canvas more vertical space.
- Map artwork itself stays light even in dark mode because venue maps need readability.
- Surrounding map controls and filters can adopt dark-mode surfaces.

### Lightbox

The common lightbox now has a better sizing model:

- Fit mode should contain the full artwork inside the viewport.
- Zoom only enlarges after the user presses `+`.
- The preview no longer uses a fill/crop behavior for creative artwork.

Key files:

- `src/pages/CreativeAssignment/CreativeAssignmentPage.tsx`
- `src/styles/assignment.css`
- `src/components/common/Lightbox.tsx`
- `src/components/maps/useSharedMapWorkspace.ts`
- `src/components/maps/sharedMapWorkspace.css`

## Proof Approval

Proof Approval was adapted into the same workspace language as Creative Assignment.

### Utility Header

Proof Approval uses a compact utility header that preserves vertical workspace height.

It includes:

- Back action
- Project/page title
- Venue/order/status chips
- Refresh Proof Status
- Lift sync status

### Mobile Workflow

Mobile Proof Approval now uses a compact floating search/filter dock rather than a large sticky filter panel.

Behavior:

- Collapsed by default to preserve space.
- Search/filter controls are available on tap.
- Next Pending and Top actions support long proof lists.
- Proof ID is removed from noisy mobile cards.
- Technical proof details are moved behind an info affordance rather than front-loaded.

### Proof References After Lift Progression

Important production behavior:

- Proofs are a critical visual reference even when the Lift order has moved beyond proof approval.
- If Lift lines are at or beyond proof approval and still expose proof assets, Adspace should keep/import those proof URLs.
- Post-proof proof assets are treated as read-only references, with no approval action available.
- Revised-art rollback before proof readiness still hides stale proof URLs and waits for regenerated proofs.

Key backend implementation:

- `fetchLiftProofSyncLines` reads proof reports for Lift lines with step `>= 7.02`, not only exact `7.02`.
- `mergeProjectProofLinesFromLift` preserves proof URLs for proof-review and post-proof reference steps.
- Post-proof reference proofs are represented as `approved` in Adspace so they display as references.

Key files:

- `infra/lambda/project-api.ts`
- `infra/scripts/verify-proof-sync.mjs`
- `src/pages/ProofApproval/ProofApprovalPage.tsx`
- `src/styles/proof.css`

## Dashboard

The customer dashboard mobile experience was redesigned around compact operational project cards.

Mobile improvements:

- Slim project cards replace tall nested mini-section cards.
- KPI chips/cards replace bulky KPI blocks.
- Search/filter controls use a collapsible command dock.
- Smart card action routes to the correct next workspace.
- Long status-pill text is constrained to avoid overflow.

Desktop improvements:

- Table rows use status color rails rather than loud full fills.
- Typography and spacing were tuned to better align with mobile.
- Primary action/button styling is more brand-consistent.

Key file:

- `src/pages/AngieDashboard/AngieDashboardPage.tsx`
- `src/styles/dashboard.css`

## Project Hub

Project Hub now has a mobile-specific composition.

Mobile improvements:

- Compact project header
- Compact next-step card
- Sticky/collapsible progress dock
- Mobile workflow cards for Artwork, Assignment, Proof, Transit, Documents, Support, and Activity
- Less duplicated desktop copy
- Faster access to primary actions

Desktop polish:

- Color rails and typography align better with the mobile redesign.
- KPI blocks and workflow cards avoid text overflow.
- Activity feed dark-mode surfaces were improved.

Key files:

- `src/pages/ProjectHub/ProjectHubPage.tsx`
- `src/styles/hub.css`

## Branding, Typography, PWA, and App Shell

Branding work included:

- Updated Adspace wordmark/logo assets
- App icon, favicon, Apple touch icon, maskable PWA icons
- Web manifest and service worker registration
- Login screen redesign
- Justina font installation for brand/display treatments
- App shell/auth chip polish

PWA/mobile notes:

- App can be saved to iPhone/iPad home screen.
- Viewport behavior was adjusted to avoid mobile over-zoom.
- Icons and manifest assets are in `public/`.

Key files:

- `index.html`
- `public/site.webmanifest`
- `public/service-worker.js`
- `src/registerServiceWorker.ts`
- `src/main.tsx`
- `src/app/AppShell.tsx`
- `src/pages/Auth/LoginPage.tsx`
- `src/assets/fonts/`
- `src/styles/app.css`
- `src/styles/tokens.css`

## Dark Mode

Dark mode has been tuned as a v1 feature rather than a complete separate visual system.

Current approach:

- Manual theme selection persists globally across pages.
- Light/dark/system can be considered later, but v1 favors explicit user control.
- Dark mode uses brand-tuned near-black and deep green/blue surfaces instead of generic gray fills.
- Venue maps remain visually light for readability.
- Surrounding panels, filters, docks, and cards use dark surfaces.

Areas specifically improved:

- Dashboard
- Project Hub
- Creative Assignment
- Proof Approval
- Review Allocation
- Share Access
- Allocation Override
- Transit Approval
- Secondary workflow surfaces

Future dark-mode candidates:

- More fine-grained contrast tuning for rarely used admin/settings screens
- System preference support as an optional default
- Full accessibility contrast audit

## Realtime Workspace Presence and Silent Sync

Realtime/presence capabilities were added for shared workspaces.

Product goals:

- Users should see when another user has Creative Assignment or Proof Approval open.
- Persistence syncs should be silent and not interrupt active work.
- Small toast summaries are acceptable when another user changes shared state.
- The current user should not experience lag or blocking because of sync.

Implementation areas:

- WebSocket/API Gateway infrastructure
- Workspace broadcast Lambda
- Workspace presence Lambda
- Frontend hooks and presence cluster component
- Toast queue for external workspace change events

Key files:

- `infra/lambda/workspace-broadcast.ts`
- `infra/lambda/workspace-presence.ts`
- `infra/lambda/realtime-config.ts`
- `src/realtime/useWorkspacePresence.ts`
- `src/realtime/useCollaborationToastQueue.ts`
- `src/components/realtime/WorkspacePresenceCluster.tsx`
- `src/components/realtime/WorkspacePresenceCluster.css`

## Review Allocation, Transit Approval, Share Access, and Allocation Override

Secondary workflow surfaces were polished for consistency.

Notable improvements:

- Review Allocation dark-mode and modal surfaces improved.
- Transit Approval kept aligned with Allocation Review patterns.
- Share Access dark-mode readability improved.
- Allocation Override thumbnails now use the same contained display approach as creative allocation.
- Allocation Override dark-mode input/card surfaces were tuned.

Key files:

- `src/components/reviewAllocation/ReviewAllocationModal.tsx`
- `src/styles/reviewAllocation.css`
- `src/pages/TransitApproval/TransitApprovalPage.tsx`
- `src/styles/transitApproval.css`
- `src/pages/AllocationOverride/AllocationOverridePage.tsx`
- `src/styles/allocationOverride.css`
- `src/styles/shareAccess.css`

## Build Optimization

The recurring Vite large chunk warning was addressed with manual chunking.

Intent:

- Keep first-load and repeat-load behavior reasonable.
- Move heavy libraries into stable chunks.
- Avoid making interaction slower.

Key file:

- `vite.config.ts`

## Known Watch Items

- The app has grown quickly; future CSS work should continue consolidating page-specific rules into tokenized patterns without broad rewrites.
- Realtime sync should remain non-blocking and visually quiet.
- Any future Lift proof sync work must preserve the distinction between actionable proof approval and read-only proof reference.
- Dark mode is good for v1, but a full accessibility pass would still be useful before heavy external rollout.
- Future commits should be smaller and more frequent than this recovery bundle.

## Fresh Thread Startup Prompt

Suggested prompt:

```text
We are continuing Adspace360 development in /Users/marcusdavies/Projects/adspace360.

Please read:
- docs/thread-handoff-proof-approval-mobile-api-2026-05-26.md
- docs/thread-handoff-proofing-allocation-git-2026-06-12.md
- docs/thread-handoff-branding-mobile-realtime-proof-sync-2026-06-17.md

Before editing, run git status --short --branch.
Use npm run build and npm --prefix infra run verify:proof-sync for validation when relevant.
Be careful not to regress Creative Assignment, Proof Approval, Dashboard, Project Hub mobile layouts, dark mode, realtime presence, or post-proof Lift proof reference behavior.
```
