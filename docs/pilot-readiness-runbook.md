# Pilot Readiness Runbook

This runbook is the working checklist for moving Adspace360 from sandbox validation into the first controlled customer pilot. It intentionally keeps the pilot narrow: one real customer, one real venue, one real project, and one observed order/proof cycle.

## 1. Stabilization Gate

Before any pilot activity:

- Dashboard, Project Hub, Artwork Folder, Creative Assignment, Proof Approval, Documents, and Transit Approval must load reliably.
- Project Dashboard must not show fallback/mock order sets.
- Creative Assignment should feel instant for assign/remove actions, with saves continuing in the background.
- Health Dashboard should show no unresolved non-drill workflow errors.
- Any recurring 500 from Hub, Proof Approval, Documents, or workspace routes blocks pilot expansion.

## 2. Sandbox Lift Gate

Use an internal sandbox project before touching a real customer order.

- Project mode must be `internal_sandbox`.
- Project must remain visible only to platform admins.
- Share links must remain blocked.
- Source venue/customer context must be visible.
- Submit must route to Lift demo customer `1249`.
- Lift order number must persist and appear in Dashboard and Hub.
- Request/response snapshots should be visible in Documents.
- Order deep link should resolve when the endpoint is available.

## 3. Proof Sync Gate

After a sandbox submit:

- Flush sync should return line records in Lift line order.
- Proof lines must preserve line number, Lift order line id, filename, media variant label, unit number, and assigned locations.
- Same file + same variant + different unit number must stay split into separate proof lines.
- Missing proof URLs should show as a waiting/regenerating state, not as a silent failure.
- Any proof mismatch must appear in the Errors lane and Health Dashboard recent issues.

## 4. Vendor Proof Ops Gate

Before treating the vendor workspace as pilot-ready:

- Primary/LTL vendor can see only Lift-backed assigned lines.
- External vendor can see only externally routed assigned lines.
- Primary/LTL vendor line cards show Lift order/line references, proof state, current artwork, current proof, art history, and technical details.
- External vendor line cards omit Lift-specific language and support vendor proof upload.
- Vendor proof comments appear to the customer through the normal proof feedback acknowledgment flow.
- Customer-facing Proof Approval does not expose named vendors.
- Revised artwork sent back to Lift uses a direct signed asset URL and explicit MIME type.
- Revised artwork submitted for external vendor lines updates the Adspace proof state without attempting to call Lift.
- Production/shipping controls remain locked until proof approval or production-ready state.

## 5. Customer Setup Gate

Before creating the first real pilot project:

- Customer is created or imported from Lift.
- Customer has the correct Lift customer id.
- Customer status is `active`.
- Customer logo/branding is present if white-labeling is required.
- Customer admin users are assigned only to the correct customer.
- Internal sandbox customer remains separate from the real customer.

## 6. Notification Gate

Before enabling customer-facing pilot notifications:

- Preview/test-send each configured workflow event from Admin Setup.
- Confirm recipients for each rule.
- Confirm instant vs digest behavior.
- Confirm sender is `noreply@adspace360.com`.
- Confirm failed notification delivery creates a structured workflow issue.

## 7. Shared Access Gate

Before sending external links:

- Shared link branding matches the customer.
- Link scope matches the intended workspace.
- Edit-capable links require participant identity.
- Sandbox projects cannot create shared links.
- Uploads, assignments, proof decisions, and transit decisions are auditable.

## 8. First Pilot Path

Run the first real pilot as one controlled path:

- one customer
- one venue
- one project
- one order submit
- one proof sync
- one proof approval or revision cycle if Lift proof data is available
- one external vendor proof upload if the project contains an externally routed line
- one shared-access collaboration check
- one notification test matrix

Do not expand into multiple customers or broad production validation until this path is clean.

## 9. Still Pending Before Broad Production

- Validate Lift production/order status sync into primary/LTL Vendor Workspace.
- Validate Lift shipping sync, including whether ShippingReport data is best displayed at order level, line level, or both.
- Decide and implement explicit Adspace order cancellation/reopen controls.
- Finish deferred polish for vendor proof-note summaries and proof feedback action dock layout.
