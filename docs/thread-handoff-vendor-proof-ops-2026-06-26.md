# Vendor Proof Ops Milestone Handoff: June 26-28, 2026

This handoff captures the Vendor Workspace and Proof Approval milestone reached on June 26, 2026, plus the June 27-28 mobile Proof Approval feedback, metadata, and header polish.

## Next Thread Starting Point

Use this document to start the next clean Codex thread. The repository and live AWS app were updated after the proofing milestone:

- Latest pushed milestone commit before June 27 mobile polish: `431963f Add vendor proof ops workspace milestone`.
- Branch: `main`, pushed to `origin/main`.
- Live frontend was synced to the production S3 bucket and CloudFront invalidation completed after the milestone.
- Proofing MVP is working for the current pilot order.
- June 27 mobile Proof Approval feedback polish was deployed in `93ca796 Refine proof feedback mobile flow`.
- June 27 mobile metadata polish hides the redundant client-upload filename card on phone layouts and insets the proof-file receipt banner so mobile proof cards read cleaner.
- June 28 mobile header polish keeps Pending, Revised, and Approved counters in a consistent two-column rhythm so no single counter feels visually promoted by accident.
- Production/shipping sync has not been validated yet and should be the next major test/development area.

Recommended first prompt for the next thread:

> We are continuing Adspace360 Vendor Workspace after the June 26 Vendor Proof Ops milestone. Please read `docs/thread-handoff-vendor-proof-ops-2026-06-26.md`, `docs/vendor-workspace.md`, `docs/lift-order-status-sync.md`, and `docs/pilot-readiness-runbook.md` before making changes. The proofing layer is validated; the next focus is production/shipping sync and cleanup items listed in the handoff.

## Summary

Vendor proofing is now working across the three core proof paths:

- Customer actions on Lift-backed primary/LTL proof lines.
- Primary/LTL revised-art handoff back to Lift and regenerated proof sync back into Adspace.
- External vendor proof upload, comment, customer review, revision, and approval.

The proofing layer is considered functionally validated for the current MVP. Production and shipping status sync are still pending validation.

Current reference pilot order:

- Project: `proj_i06zfj79`
- Adspace order: `30904511`
- Lift order: `A0224897`
- Primary/LTL vendor order route: `proj_i06zfj79__vendor_primary_print`
- External vendor order route: `proj_i06zfj79__vendor_intersection_vendor_w1gizigv`

Do not store test passwords or temporary login credentials in docs.

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
- Primary/LTL order pages now separate Job Brief, Lift Order Data, Proof Queue, Assigned Lines, Art History, and Technical Details.
- External vendor order pages use the same card pattern but omit Lift language and keep manual proof replacement/upload controls.
- Art History is a chronological file timeline showing client uploads and proof uploads with micro thumbnails, filenames, timestamps, source, and current-file tags.

### Proof Approval

- Client-facing proof review remains vendor-neutral.
- Lift-backed proof comments and external vendor proof comments use the same review/acknowledgment pattern.
- Proof received metadata displays file receipt information and clean filenames only, not vendor comments.
- Mobile Proof Approval header layout was tightened so proof sync status and the refresh action have clearer spacing; the refresh action gets its own full-width row at smaller breakpoints.
- Proof feedback now opens in a centered feedback modal/popover rather than a right-side drawer, with mobile sizing and attachment layout tuned for first-class phone use.
- The proof feedback gate now prioritizes a full-width "View Feedback" action. The acknowledgement checkbox is hidden until the user opens the feedback modal, and unchecking acknowledgement resets the viewed state.
- Before acknowledgement, the feedback gate is compact and centered instead of spanning the full action dock. After acknowledgement, the full action dock expands back to show the line note and approval/revision actions.
- Revised artwork upload stages files before submit, supports cancel/clear, and shows pending action state.
- Stale proof-line updates trigger a data refresh/retry path instead of blindly sending outdated identifiers.
- Proof file receipt banners now show proof file received timestamp and clean filename.
- Client upload metadata is displayed separately from proof metadata.
- Mobile proof cards hide the redundant client-upload metadata panel because the filename is already present in the client-upload preview card.
- Mobile proof-file receipt banners are inset within the proof card instead of sitting directly against the card edges.
- Mobile Proof Approval header counters use a consistent compact grid, with Pending and Revised paired before Approved, so the status sequence reads predictably on narrow screens.
- External vendor proof comments no longer display inside the proof file receipt banner; they route through the feedback gate.

### Lift Integration

- Create-order artwork can continue to use the existing short-link path.
- Revised proof artwork sent to Lift must use a direct `2xx` asset URL because Lift's proof-upload downloader does not support redirects.
- Direct signed CloudFront URLs were added for outbound revised-art delivery.
- Revised-art requests include `artMimeType` so downstream workflow receives the correct MIME type instead of `binary/octet-stream`.
- Lift order cancellation is tracked as integration health and does not automatically cancel the Adspace project.
- AS360Orders data now feeds primary/LTL Vendor Workspace Lift order and line reference panels.
- AS360ProofReport data feeds proof state, proof URLs, comments/attachments, and approval metadata.

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
- Customer approval, revision, and comment flows were exercised across primary/LTL and external vendor lines.
- External vendor proof upload plus vendor comment appeared to the client as a normal proof feedback workflow, not as a vendor-specific experience.
- Mobile feedback review was visually checked after the June 27 polish: the compact locked feedback gate, expanded acknowledged action dock, centered feedback modal, and mobile header refresh layout behaved as intended in the local browser.

## Known Remaining Test Gap

Production and shipping have not been validated end-to-end after the proof milestone. The next thread should avoid assuming this layer is complete until these checks pass:

- Primary/LTL order status and line status from Lift display correctly in Vendor Workspace.
- Primary/LTL production/shipping fields are read-only and sync from Lift, not manually edited in Adspace.
- `ShippingReport` fields map cleanly to order-level and/or line-level vendor display.
- External vendor production/shipping controls remain manual, vendor-scoped, and locked until proof approval/production-ready gates are satisfied.
- Customer/admin proof state is not mutated by production/shipping updates.

## Deferred Items

- Production and shipping sync from Lift into primary/LTL Vendor Workspace.
- ShippingReport endpoint mapping for order/line shipment display.
- Vendor Client Approval summary polish for Proof Notes / Latest Feedback.
- Client Proof Approval feedback-gate dock polish.
- Vendor post-proof comments, comment attachments, and proof removal.
- Primary vendor-admin Lift order relink workflow.
- Explicit Adspace order cancel/reopen controls.
- Unified user management for customer and vendor users.
- Vendor user active/inactive, expiration, and deletion controls.
- Installer vendor workspace and installer order access rules.
- Vendor notification preferences, forwarding, and message center.
- Lift order healing/resubmit/auto-scan/manual override from internal/admin tools.
- External vendor integration adapters beyond manual proof/status flow.
- Creative Assignment "assign one creative to all locations" enhancement.
- Proof Approval action dock polish when feedback acknowledgment is required.
- Vendor Client Approval summary block polish for notes and latest feedback.

## Recommended Next Slice

Validate production/shipping status sync:

- Pull order header and line status from `AS360Orders`.
- Evaluate `ShippingReport` for order-level versus line-level tracking display.
- Confirm primary/LTL Vendor Workspace displays Lift status as read-only synced data.
- Confirm external vendor production/shipping remains manual and vendor-scoped.

Suggested implementation order:

1. Confirm current AS360Orders refresh path for order header and line data.
2. Add or fix manual "Refresh Sync" behavior so it refreshes order/proof status and reports clear success/failure.
3. Map `ShippingReport` payload into normalized vendor order shipping data.
4. Display Lift production/shipping data in the primary/LTL Vendor Workspace as read-only operational status.
5. Keep external vendor production/shipping manual and hidden behind proof approval gates.
6. Run regression checks for customer Proof Approval, Project Hub, Vendor Dashboard, and package generation.

## Regression Checks For Next Thread

Before shipping the next slice:

- `npm run build`
- `npm --prefix infra run build`
- `npm --prefix infra run synth`
- `npm run lint` and record known repo-wide lint debt if still failing.
- Verify primary/LTL vendor page does not expose manual proof replacement controls.
- Verify external vendor page does not mention Lift or show Lift-specific fields.
- Verify client Proof Approval remains vendor-neutral.
- Verify external vendor proof comments still route through the feedback acknowledgment gate.
- Verify package ZIP scoping still includes only assigned vendor lines/files.
- Verify production/shipping updates do not alter proof approval state.
