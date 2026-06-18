# Lift Order Status Sync

Adspace treats Lift as the source of truth once an order has been submitted and Lift starts reporting proof/order-line steps. Proof Approval still keeps the proof packet visible as a reference after Lift moves the order forward.

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

## Display surfaces

- Dashboard: in-production projects appear in the Ready / Released bucket; completed Lift orders appear in the Complete bucket. Neither state counts as Transit Blocked.
- Project Hub: in-production jobs point to `Open Proof Reference`; completed jobs show the final Complete step and use reference/archive messaging.
- Proof Approval: approved proof packets remain visible for reference, with messaging focused on proof approval, current production state, or Lift completion.

## Open notes

- Transit Approval remains an Adspace workflow state. When Lift has already advanced to production, Lift status takes precedence for client-facing next-step messaging.
- Allocation Override changes still affect Adspace proofing, allocation, and transit outputs only; Lift allocation write-back is not currently supported.
