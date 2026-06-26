# Vendor Proof Ops Milestone Handoff: June 26, 2026

This handoff captures the Vendor Workspace and Proof Approval milestone reached on June 26, 2026.

## Summary

Vendor proofing is now working across the three core proof paths:

- Customer actions on Lift-backed primary/LTL proof lines.
- Primary/LTL revised-art handoff back to Lift and regenerated proof sync back into Adspace.
- External vendor proof upload, comment, customer review, revision, and approval.

The proofing layer is considered functionally validated for the current MVP. Production and shipping status sync are still pending validation.

## What Changed

### Vendor Workspace

- Added authenticated vendor dashboard and vendor order detail surfaces.
- Supports primary/LTL vendor accounts and external routed vendor accounts.
- Vendor users see full order context but only assigned line details and assigned files.
- Vendor actions are gated by order/proof state so incoming/pre-submit work remains read-only.
- External vendors can submit proof files and optional proof comments.
- External vendor proof comments route into the customer proof feedback acknowledgment flow.
- Primary/LTL pages show Lift order/line context and hide manual proof replacement/production controls where Lift is the source of truth.
- External vendor pages omit Lift-specific language and keep Adspace/vendor-managed controls.

### Proof Approval

- Client-facing proof review remains vendor-neutral.
- Lift-backed proof comments and external vendor proof comments use the same review/acknowledgment pattern.
- Proof received metadata displays file receipt information and clean filenames only, not vendor comments.
- Revised artwork upload stages files before submit, supports cancel/clear, and shows pending action state.
- Stale proof-line updates trigger a data refresh/retry path instead of blindly sending outdated identifiers.

### Lift Integration

- Create-order artwork can continue to use the existing short-link path.
- Revised proof artwork sent to Lift must use a direct `2xx` asset URL because Lift's proof-upload downloader does not support redirects.
- Direct signed CloudFront URLs were added for outbound revised-art delivery.
- Revised-art requests include `artMimeType` so downstream workflow receives the correct MIME type instead of `binary/octet-stream`.
- Lift order cancellation is tracked as integration health and does not automatically cancel the Adspace project.

### Venue And Allocation Support

- Inventory row vendor routing was added so specialty rows can be routed away from primary/LTL.
- Routing precedence is row override, then media variant default, then primary/LTL.
- Mixed-route allocation groups are split so external vendor rows are not bundled into Lift-backed primary vendor orders.
- Media variant identity now respects product plus dimensions so subtly different sizes do not collapse into one variant.
- Artwork Folder and Creative Assignment now carry corrected variant identities and creative colors.

## Validated Test Results

- Lift-backed order submit created a Lift order and synced proof lines.
- Lift proof approval worked in direct approval mode after proof posture and integration settings were corrected.
- Revised artwork to Lift eventually succeeded after direct signed URL and MIME type fixes.
- External vendor proof upload displayed correctly in customer Proof Approval.
- External vendor proof comment appeared through the standard feedback review gate.
- Customer revision request on an external vendor proof moved the vendor line back into the expected revised-art/proof workflow.
- External vendor revised-art and replacement proof flow completed successfully after stale-proof refresh handling.

## Deferred Items

- Production and shipping sync from Lift into primary/LTL Vendor Workspace.
- ShippingReport endpoint mapping for order/line shipment display.
- Vendor Client Approval summary polish for Proof Notes / Latest Feedback.
- Client Proof Approval feedback-gate dock polish.
- Vendor post-proof comments, comment attachments, and proof removal.
- Primary vendor-admin Lift order relink workflow.
- Explicit Adspace order cancel/reopen controls.
- Unified user management for customer and vendor users.

## Recommended Next Slice

Validate production/shipping status sync:

- Pull order header and line status from `AS360Orders`.
- Evaluate `ShippingReport` for order-level versus line-level tracking display.
- Confirm primary/LTL Vendor Workspace displays Lift status as read-only synced data.
- Confirm external vendor production/shipping remains manual and vendor-scoped.
