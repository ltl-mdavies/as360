# Vendor Workspace

Date: 2026-06-22

Vendor Workspace is the authenticated production-vendor layer in Adspace360. It gives production vendors a scoped place to see assigned order work, download assigned artwork/package files, submit vendor proofs, and update production/shipping status when their route is not integration-backed.

## Audience

Vendor users are not customer admins. They should not receive customer dashboard, project setup, creative assignment, allocation review, venue setup, or admin settings access.

Supported vendor types in the current model:

- Primary print vendor: Larger Than Life / LTL, backed by Lift order and proof sync.
- External print vendors: customer/vendor registry vendors routed from media variant setup.
- Installer vendors: planned later, likely only after print/shipping milestones.

## Access Model

Vendor users authenticate normally and use `/vendor/orders` and `/vendor/orders/:vendorOrderId`.

Backend vendor APIs are under `/api/vendor/*` and require:

- `vendor_admin` or `vendor_user` role.
- At least one assigned `vendorAccountId`.
- Membership in the requested vendor account.

Vendor users should not gain customer admin access through `customerIds`; backend auth intentionally clears customer access for vendor roles.

Share links are separate. Vendor Workspace V1 does not use share links.

## Vendor Account Model

Canonical vendor accounts are represented separately from customer vendor registry rows.

- `vendor_primary_print` represents the configured primary print vendor.
- External vendor accounts are derived from `CustomerVendor` registry rows.
- Existing customer/vendor registry and venue routing setup remains the admin-facing configuration surface.

## Vendor Order And Line Behavior

Vendor orders are derived from project data rather than entered independently.

Line routing:

- Primary vendor receives lines not routed to an active external vendor.
- External vendors receive only lines routed to their linked vendor account.
- Vendors never see other vendors as participants, even when they share the same Adspace order.

Vendor users can see full order header/context, but only assigned line details, assigned files, and assigned actions.

## Workflow Gates

Vendor write actions are gated by Adspace workflow state.

Incoming order:

- Visible to vendor as incoming/read-only.
- No proof upload, package generation, production status, or shipping updates.
- Used so vendors can anticipate work without interfering with client artwork assignment.

Proofing:

- Unlocks when the order has been submitted to print and the line is proof-actionable.
- Vendor submits a proof back into Adspace for client/admin approval.
- Vendor does not approve proofs.

Production:

- Unlocks after client/admin proof approval or a synced production-ready state.
- Primary/LTL production status can be synced from Lift.
- External vendors manually update production status, vendor reference/PO, carrier, tracking, shipped date, and internal notes.

Shipping:

- Current V1 supports vendor-entered carrier, tracking, and shipped date.
- Market default and venue override shipping destinations are exposed on the Vendor Order page.

## Lift Versus External Vendor Routes

Lift references are route-specific.

Primary/LTL route:

- Lift order number is relevant.
- Lift line/proof IDs are relevant.
- Integration health can show Lift sync status.

External vendor route:

- Lines are not submitted to Lift.
- Lift line/proof IDs should not be used as the main reference.
- Vendor-facing references should use AS360 order number, PO, contract number, and Adspace proof/line references.
- External vendor health is Adspace-managed, not Lift-sync-backed.

## Proof Approval Visibility

End clients do not need to know which vendor produced the proof. Proof Approval should stay organized around Adspace proof line numbers and proof files.

Client-facing/default proof review language should be vendor-neutral:

- Use Adspace proof line numbers as the universal line reference.
- Show Lift IDs only as technical/internal details when present.
- Mask vendor names as "Print provider" in customer proof review contexts.

Production/internal views can expose route and vendor detail where appropriate.

## Packages

Vendor package generation is scoped to assigned lines.

Vendor packages include:

- Assigned artwork files only.
- Scoped CSV/JSON allocation manifests.
- Vendor order/account metadata.

Package generation is locked until the order is submitted to print.

## Current Deferred Items

- Persist explicit proof/production route on proof lines instead of deriving from Lift IDs or vendor order context.
- Admin/internal grouping of proof lines by Lift-backed versus Adspace-managed vendor routes.
- Installer vendor workspace and post-print handoff.
- Vendor notification preferences and forwarding.
- Vendor-to-client/end-client message center.
- Lift healing/resubmission from Vendor Workspace.
- External vendor integration adapters beyond manual status.

## Validation Checklist

- Vendor user cannot access `/api/projects`, customer dashboard, admin settings, or unassigned vendor orders.
- Primary/LTL vendor sees primary-routed lines only.
- External vendor sees only routed external lines.
- Incoming order is visible but read-only.
- External vendor UI does not show irrelevant Lift order/line references.
- Vendor package ZIP only includes assigned artwork and scoped manifest rows.
- Vendor proof upload creates a pending proof visible to client/admin review without exposing vendor identity to end client.
- Production/shipping updates persist to vendor line status and activity without mutating customer assignment/proof state.
