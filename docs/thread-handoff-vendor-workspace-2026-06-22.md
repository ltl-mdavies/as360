# Adspace360 Vendor Workspace Handoff: June 22, 2026

Date: 2026-06-22  
Workspace: `/Users/marcusdavies/Projects/adspace360`  
Branch: `main`  
Production app: `https://app.adspace360.com`

## Summary

This handoff captures the Vendor Workspace build cycle. The live app now has an authenticated vendor workspace for LTL/primary print and external routed production vendors.

Vendor Workspace V1 includes:

- Vendor roles and vendor account membership.
- Vendor dashboard at `/vendor/orders`.
- Vendor order page at `/vendor/orders/:vendorOrderId`.
- Assigned-line scoping.
- Vendor workflow gates.
- Scoped package generation.
- Vendor proof upload into Proof Approval.
- Bulk selected-line production/shipping updates.
- Market/venue shipping destination display.
- Route-aware Lift versus external vendor labels.

Read this with:

- `docs/vendor-workspace.md`
- `docs/thread-handoff-june-20-2026.md`
- `docs/lift-order-status-sync.md`

## Important Product Decisions

Vendor users are not customer admins.

Vendors can see incoming work, but cannot act until the workflow reaches their lane. This prevents vendors from interfering with client artwork upload, creative assignment, or allocation review.

Print vendor phases:

- Incoming/read-only before print submission.
- Proof upload after order submission and proof actionability.
- Production/shipping after client/admin proof approval or synced production-ready state.

Vendors do not approve proofs. They submit proofs for client/admin approval.

LTL/primary print is Lift-backed. External vendors are Adspace-managed unless a future integration adapter is added.

End-client proof review should not expose vendor relationships. Proof Approval uses Adspace proof line references and masks vendor attribution as "Print provider".

## Current Live Deployments

The latest vendor-related frontend/backend updates were deployed during this thread.

Validation run during the work:

```bash
npm run build
npm --prefix infra run build
npm --prefix infra run synth
```

Known live infra:

- API endpoint: `https://f08446049i.execute-api.us-east-1.amazonaws.com`
- Frontend bucket: `adspace360foundationstack-frontendappbucket1870ce6-ynsurx2iz3vq`
- CloudFront distribution: `EQ7MBUNOLLWGY`
- User pool: `us-east-1_31uNf5WFv`
- User pool client: `140km9l9t6vdavqg16skl4j51v`

## Git State At Handoff Creation

Before this handoff was added, the worktree contained substantial vendor-related changes and no vendor commits had been created yet.

Important: the branch is `main`. The previous June 20 handoff noted `main` was already ahead of origin by local commits. Confirm current remote state before pushing.

Recommended checkpoint sequence:

```bash
git status --short --branch
git diff --stat
npm run build
npm --prefix infra run build
npm --prefix infra run synth
```

Then commit in sensible groups.

## Key Files

Backend:

- `infra/lambda/project-api.ts`
- `infra/lambda/venue-api.ts`
- `infra/lib/adspace360-foundation-stack.ts`
- `infra/scripts/bootstrap-user.mjs`

Frontend/API:

- `src/api/projects.ts`
- `src/api/useApiClient.ts`
- `src/auth/AuthProvider.tsx`
- `src/app/AppShell.tsx`
- `src/app/routes.tsx`
- `src/pages/Auth/LoginPage.tsx`

Vendor UI:

- `src/pages/VendorWorkspace/VendorDashboardPage.tsx`
- `src/pages/VendorWorkspace/VendorOrderPage.tsx`
- `src/styles/vendorWorkspace.css`

Related surfaces:

- `src/pages/ProofApproval/ProofApprovalPage.tsx`
- `src/pages/VenueBuilder/VenueImportPreviewPage.tsx`
- `src/pages/ProjectHub/ProjectHubPage.tsx`
- `src/styles/proof.css`
- `src/styles/venueBuilder.css`

## Known Watch Items

Existing cosmetic/watch items from prior handoffs still matter:

- Dashboard long status pills can overflow if labels grow.
- Review Allocation has duplicate `Download PDF` access points by design; revisit only if it feels redundant.
- Proof Approval remains dense on tablet/small laptop and should be checked after any copy changes.
- Dark mode should not darken actual venue maps, proof images, or artwork previews.
- Large bundle warnings remain due to PDF.js and page chunks; build passes.
- Repo-wide lint has existing debt and may fail independently of vendor work.

Vendor-specific watch items:

- Confirm external routed vendor orders show `Adspace Line`, not `Lift Line`.
- Confirm primary/LTL orders still show Lift references.
- Confirm incoming vendor orders are read-only.
- Confirm vendor proof upload can be tested with a real proof file later.
- Confirm external vendor lines are not accidentally included in Lift order payloads.

## Pending Deeper Slice

Persist explicit proof/production route on proof lines.

Goal:

- A proof line should know whether it is Lift-backed or Adspace-managed.
- Admin/internal views can group Lift-backed versus external vendor lines without inferring from missing Lift IDs.
- End-client Proof Approval remains neutral and organized.

Suggested fields:

- `productionRoute`: `primary_print_vendor | external_vendor`
- `vendorAccountId`
- `vendorName`
- `routeLabel`
- `integrationMode`: `lift | adspace`

Likely backend touch points:

- `ProjectProofLineItem`
- `buildLiftCreateOrderPayload`
- proof-line seeding after submit
- `toProjectProofLineResponse`
- proof sync merge preservation
- allocation override proof response hydration

Likely frontend touch points:

- `ApiProjectProofLineResponse`
- `ProofLineMock`
- Proof Approval technical details
- Admin/internal proof group display if added

## Suggested Next Prompt

Continue the Vendor Workspace deeper slice. First confirm the current Git status and latest vendor commits. Then persist proof/production route metadata per proof line so admin/internal views can explicitly distinguish Lift-backed lines from Adspace-managed external vendor lines while keeping end-client Proof Approval neutral.
