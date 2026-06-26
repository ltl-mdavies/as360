# Lift Order Status Sync

Adspace treats Lift as the source of truth once an order has been submitted and Lift starts reporting proof/order-line steps. Proof Approval still keeps the proof packet visible as a reference after Lift moves the order forward.

## Synced reports

Current production-facing Lift sync uses two different data shapes:

- `AS360Orders` provides order header, order status, order step, line number, order line id, line step, product name, material, print size, quantity, and other production reference data.
- `AS360ProofReport` provides proof attachment/proof line state, proof URLs, proof approval metadata, proof comments/attachments, and detailed report attachments.

Vendor Workspace uses the route metadata on each Adspace proof line to decide which fields are relevant:

- Primary/LTL lines can show Lift order, Lift line number, Lift product name, Lift line step, proof sync state, and later production/shipping state from Lift.
- External vendor lines should not show Lift order/line references. They use AS360 order, PO, contract, Adspace line references, and vendor-managed proof/status data.

## Step interpretation

- `7.01 PDF Proof` and `7.02 Approve Art` are proof-review states.
- `7.05 Approved` means artwork has cleared proof review in Lift.
- `10 Rip Art` and later means the order is in production.
- `18 Completed` means the order has completed in Lift.

## Adspace behavior

- If Lift reports every synced line at `10` or later, Adspace marks the project as `In Production`.
- If Lift reports every synced line at `18` or later, Adspace marks the project as `Complete`.
- Once a Lift order is in production or complete, Hub and Dashboard stop prompting local Transit Approval or Production Release actions. The project remains available as a production reference.
- Complete is a derived Adspace state from Lift line/order status, not a separate manual Adspace approval action in v1.
- Proof Approval continues to show synced proof files after production starts, but proof actions are locked unless Lift moves the line back into a proof-review step.
- If Lift moves a line backward into proof review, Adspace should allow normal proof decisions again after the next proof sync.
- Lift order cancellation is treated as an integration health issue, not as an automatic Adspace cancellation. A cancelled or missing Lift order should require operator attention and should not delete or mutate external vendor lines.

## Proof file delivery

Initial order submit and revised-art submit use different Lift ingestion paths and should be treated separately.

Create-order artwork:

- Short-link delivery works for the create-order path.
- Each Lift-backed line should receive a stable artwork URL with a filename-like suffix.

Revised proof artwork:

- Lift's proof-upload downloader does not support HTTP redirects.
- Revised proof art must be sent as a direct `2xx` asset URL, not a redirecting short link.
- Current implementation uses signed CloudFront URLs backed by the project assets bucket for revised proof art sent to Lift.
- The request should include an explicit `artMimeType` such as `application/pdf` so downstream DWF/preflight systems do not receive a default `binary/octet-stream` file.
- File availability must be confirmed before calling Lift. If the proof line changes while the page is open, refresh proof data and retry with the current proof identifiers rather than sending stale IDs.

Observed failure modes:

- `NoSuchKey` on the Lift S3 URL can mean Lift created metadata but failed before fetching or copying the external asset.
- `ORA-20000 ... PREFLIGHT_XML` can happen when the file exists in Lift storage but downstream workflow cannot process it, including when the MIME type is wrong.

## Display surfaces

- Dashboard: in-production projects appear in the Ready / Released bucket; completed Lift orders appear in the Complete bucket. Neither state counts as Transit Blocked. Ready / Released uses the green ready-state accent, while Complete uses a distinct final-state accent so the two states do not collapse visually.
- Project Hub: in-production jobs point to `Open Proof Reference`; completed jobs show the final Complete step and use reference/archive messaging.
- Proof Approval: approved proof packets remain visible for reference, with messaging focused on proof approval, current production state, or Lift completion.
- Vendor Workspace: primary/LTL order pages should show a compact Lift Order Data section sourced from `AS360Orders` and line-level Lift details sourced from the matching Lift order line. External vendor pages should omit Lift-specific language.

## Open notes

- Transit Approval remains an Adspace workflow state. When Lift has already advanced to production, Lift status takes precedence for client-facing next-step messaging.
- Allocation Override changes still affect Adspace proofing, allocation, and transit outputs only; Lift allocation write-back is not currently supported.
- Production and shipping status display in Vendor Workspace should be validated against Lift order/line status and the ShippingReport endpoint before it is considered pilot-ready.
