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

Recommended next access model:

- Repeat production vendors should use canonical vendor accounts and authenticated vendor users.
- One-off or low-frequency specialty vendors can be considered for a project-scoped vendor share link, similar to end-client proof links, with permissions limited to that vendor's assigned project/lines.
- Project-scoped vendor links should still write vendor-scoped audit activity and must not expose other vendors, customer admin tools, or unassigned line files.

## Vendor Account Model

Canonical vendor accounts are represented separately from customer vendor registry rows.

- `vendor_primary_print` represents the configured primary print vendor.
- External vendor accounts are derived from `CustomerVendor` registry rows.
- Existing customer/vendor registry and venue routing setup remains the admin-facing configuration surface.

## Vendor Order And Line Behavior

Vendor orders are derived from project data rather than entered independently.

Line routing:

- Inventory rows can optionally override production routing for specialty items.
- Routing precedence is row override, then media variant default, then primary/LTL.
- Primary vendor receives lines not routed to an active external vendor.
- External vendors receive only lines routed to their linked vendor account.
- Mixed-route allocation groups are split into separate vendor lines so a third-party row is not bundled into the LTL vendor order.
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

- Unlocks according to the configured production approval policy.
- In `hold_for_release` mode, proof approval moves the vendor line to `Client Approved`, but production and shipping updates remain locked until Adspace/client admin releases production.
- In `direct` mode, proof approval can immediately move the vendor line to `Ready for Production`.
- Primary/LTL production status can be synced from Lift.
- External vendors manually update production status, vendor reference/PO, carrier, tracking, shipped date, and internal notes.

Shipping:

- Current V1 supports vendor-entered carrier, tracking, and shipped date.
- Market default and venue override shipping destinations are exposed on the Vendor Order page.

## Lift Versus External Vendor Routes

Lift references are route-specific.

Proof lines persist explicit route metadata:

- `productionRoute`: `primary_print_vendor` or `external_vendor`.
- `integrationMode`: `lift` or `adspace`.
- `vendorAccountId`, `vendorName`, and `routeLabel` for production/internal organization.

These fields are written when orders are submitted and preserved through Lift proof sync. Lift sync does not prune Adspace-managed external proof lines simply because Lift does not return them.

Primary/LTL route:

- Lift order number is relevant.
- Lift line/proof IDs are relevant.
- Integration health can show Lift sync status.

External vendor route:

- Lines are not submitted to Lift.
- Lift line/proof IDs should not be used as the main reference.
- Vendor-facing references should use AS360 order number, PO, contract number, and Adspace proof/line references.
- External vendor health is Adspace-managed, not Lift-sync-backed.

## Lift Cancellation And Relink Policy

Lift order cancellation is tracked as integration health, not as an automatic Adspace order cancellation.

Observed behavior during the first live sandbox submit:

- Lift order `A0224879` was cancelled in Lift.
- The AS360Orders flush report returned `rowset: null` for the cancelled Lift order instead of a normal order row with a visible cancelled status.

Adspace must therefore handle both cases:

- Explicit Lift status values such as `Cancelled` / `Canceled` / `Voided`.
- A previously linked Lift order disappearing from the flush report.

Current policy:

- Mark the linked Lift order as `cancelled` or `missing` health.
- Surface the project as needing internal/operator attention.
- Do not automatically cancel the Adspace project.
- Do not delete proof lines, assignments, documents, packages, or external vendor rows.
- Lock primary/LTL vendor actions while the current Lift link is cancelled or missing.
- Leave Adspace-managed external vendor lines governed by their own proof/production state unless the entire Adspace order is explicitly cancelled.

Future explicit operator actions:

- Relink Lift Order: use Lift Order Override to point the Adspace job at a replacement Lift order while preserving audit history.
- Rebuild/Resubmit Lift Order: guarded internal action that creates a replacement Lift order from current Lift-backed lines only.
- Cancel Adspace Order: explicit audited action that cancels the Adspace project and all routes.
- Reopen/Uncancel Adspace Order: explicit audited recovery action when allowed by downstream state.

## Proof Approval Visibility

End clients do not need to know which vendor produced the proof. Proof Approval should stay organized around Adspace proof line numbers and proof files.

Client-facing/default proof review language should be vendor-neutral:

- Use Adspace proof line numbers as the universal line reference.
- Show Lift IDs only as technical/internal details when present.
- Mask vendor names as "Print provider" in customer proof review contexts.

Production/internal views can expose route and vendor detail where appropriate.

Internal/admin proof views now use persisted route metadata for route-aware grouping and filtering:

- Lift-backed primary print lines can be filtered separately from Adspace-managed vendor lines.
- Internal route badges are shown only to proof editors/operators.
- Customer/end-client proof references remain organized around Adspace proof lines and do not expose vendor names.

## Proof Feedback Experience

Proof comments and attachments from Lift-backed lines and external vendor proof submissions follow one customer-facing feedback pattern.

Current behavior:

- Proof file receipt banners show proof-file metadata only: received timestamp and clean filename.
- Vendor proof comments do not display in the receipt banner; they route to the proof feedback thread.
- Feedback threads open in a centered modal/popover on desktop and mobile.
- The customer must open the feedback before the acknowledgement checkbox is shown.
- Unchecking acknowledgement resets the viewed state and hides approval/revision actions again.
- Before acknowledgement, the feedback gate is compact and centered. After acknowledgement, the full action dock appears with line note and proof action buttons.
- On mobile Proof Approval cards, the duplicate client-upload filename panel is hidden because the preview card already carries that filename.
- Mobile proof-file receipt metadata is inset within the card so the timestamp and filename read as supporting metadata rather than an edge-to-edge alert.
- Mobile Proof Approval header counters use a consistent compact grid so Pending, Revised, and Approved have equal visual weight instead of mixing half-width and full-width statuses.

This keeps the proofing experience vendor-neutral while still ensuring comments and attachments are reviewed before approval or revision actions.

## Packages

Vendor package generation is scoped to assigned lines.

Vendor packages include:

- Assigned artwork files only.
- Scoped CSV/JSON allocation manifests.
- Vendor order/account metadata.

Package generation is locked until the order is submitted to print.

## Current Proof Ops Behavior

Vendor dashboards are organized around vendor work queues:

- Incoming
- Needs Proof
- Client Review
- Client Approved
- Ready for Production
- In Production
- Shipped / Complete
- Blocked

Vendor Order proof states distinguish artwork pending, needs proof, vendor proof submitted, client review, revision requested, client approved, and production ready. `Client Approved` means the proof has been accepted but production may still be waiting for an explicit release. `Ready for Production` means the vendor is authorized to start production. Vendor proof submission writes route-aware activity metadata for internal review and scoped vendor activity.

## June 26 Proof Ops Milestone

The first complete proofing pass has been validated across customer, primary/LTL vendor, and external vendor paths.

Validated behavior:

- Customer proof approval works for Lift-backed primary vendor lines.
- Customer proof revision works for Lift-backed primary vendor lines, including revised-art delivery to Lift and regenerated proof sync back into Adspace.
- External vendor proof upload works for Adspace-managed vendor lines.
- External vendor proof comments are routed into the same customer proof feedback/acknowledgment pattern used for Lift proof comments.
- Customer Proof Approval remains vendor-neutral: vendor proof metadata is presented as print-provider proof activity, not as named vendor exposure.
- Vendor Workspace line cards show current client artwork, current proof, proof source, proof/client approval state, art history, technical details, and route-aware references.
- Primary/LTL Vendor Workspace hides manual proof replacement and manual production/shipping controls where Lift is the source of truth.
- External Vendor Workspace keeps manual proof upload and manual production/shipping controls available after the correct workflow gates.

Known untested area after this milestone:

- Production and shipping status sync from Lift into the primary/LTL Vendor Workspace has not yet been fully validated.

## Current Deferred Items

- Installer vendor workspace and post-print handoff.
- Vendor notification preferences and forwarding.
- Vendor-to-client/end-client message center.
- Lift healing/resubmission from Vendor Workspace.
- LTL/primary vendor-admin Lift relink: consider a guarded `Relink Lift Order` panel for primary vendor admins only, shown when the current Lift link is cancelled/missing or flagged for review. It should validate the replacement Lift order, require a reason, preserve audit history, clear/rebuild only Lift-backed sync state, and leave external vendor lines untouched.
- Explicit Adspace order cancellation controls: add internal/admin `Cancel Adspace Order` and `Reopen/Uncancel Adspace Order` actions with confirmation, reason capture, audit trail, route-aware effects, and clear separation from Lift-order cancellation health.
- External vendor integration adapters beyond manual status.
- Vendor proof comment/thread enhancements: allow post-proof vendor comments, optional comment attachments, proof removal before replacement, richer proof-thread visibility in Vendor Workspace, and customer-safe handling of vendor proof notes without exposing vendor identity.
- Vendor Client Approval summary polish: tighten the Proof Notes / Latest Feedback presentation so it reads as one clear proof-feedback surface, avoids duplicated cards, and keeps long proof comments from making the line card feel visually uneven.
- Client Proof Approval feedback-gate layout polish: when proof comments require acknowledgment and approval/revision controls are hidden, rebalance the action dock so the feedback gate does not become an oversized full-width control with content packed into one side.
- Unified user management: replace the tactical vendor-user form with a client/app user table that supports customer users, vendor users, vendor account assignment, active/inactive controls, access expiration, invite/reset flows, and delete/deactivate behavior.
- Creative assignment "assign to all" helper: add a creative-level action that can assign one creative to all currently unassigned locations in the same variant, never overwrites by default, and reserves replacement behavior for a clearly confirmed admin/client action.
- Lift-backed direct approval hardening: when a proof line is Lift-backed and the customer is in direct approval mode, block approval if Lift proof sync is disabled or the Lift proof identifiers are missing. The UI/API should show a clear configuration message instead of allowing a local-only approval that a later Lift sync can overwrite.

## Validation Checklist

- Vendor user cannot access `/api/projects`, customer dashboard, admin settings, or unassigned vendor orders.
- Primary/LTL vendor sees primary-routed lines only.
- External vendor sees only routed external lines.
- Incoming order is visible but read-only.
- In `hold_for_release` mode, proof-approved-but-not-released lines show `Client Approved` and keep production/shipping locked.
- Released or direct-approved lines show `Ready for Production` and unlock production/shipping updates.
- External vendor UI does not show irrelevant Lift order/line references.
- Vendor package ZIP only includes assigned artwork and scoped manifest rows.
- Vendor proof upload creates a pending proof visible to client/admin review without exposing vendor identity to end client.
- Production/shipping updates persist to vendor line status and activity without mutating customer assignment/proof state.
- Admin/internal Proof Approval can filter Lift-backed versus Adspace-managed proof lines.
- Vendor dashboard buckets match incoming/proof/review/production/shipping work queues.
- Cancelled or missing Lift orders appear as internal attention states without auto-cancelling Adspace or disrupting external vendor lines.
