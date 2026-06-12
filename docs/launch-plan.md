# Adspace360 Launch Plan

This roadmap turns the current frontend prototype into production-shaped work.
The intent is to keep the team moving through vertical slices instead of
getting lost in open-ended UI iteration.

## Product Spine

The v1 launch should protect one complete operational flow:

1. Venue Management
2. Project Dashboard
3. Project Hub
4. Artwork Folder
5. Creative Assignment
6. Review Allocation and order submission
7. Proof Approval
8. Transit Approval
9. Allocation Report / PDF
10. Share Access and participant audit trail

Everything outside that spine should be treated as supporting infrastructure
until the core workflow is dependable.

## Current Advancement Focus

The app has moved beyond broad prototype polish. Dashboard and Project Hub now
act as the visual baseline for v1, sandbox order submission has validated the
core Lift payload path, and the next phase is operational trust.

Current priority order:

1. Stabilize loading, errors, and performance on the core workflow screens.
2. Validate one sandbox Lift post-submit loop: order id, deep link, flush sync,
   proof line ids, proofing ids, proof URLs, and generated Documents snapshots.
3. Harden Proof Approval around Lift line identity, unit number uniqueness, and
   waiting/regenerating proof states.
4. Finish customer setup, notification test-send, and shared-access auditability
   for one real customer pilot.
5. Continue external vendor routing only after the primary Lift/proof path is
   stable.

Use `docs/pilot-readiness-runbook.md` as the operational checklist before the
first controlled customer pilot.

## Current Screen Status

| Screen | Status | Next Decision |
| --- | --- | --- |
| Project Dashboard | Production-close UI | Wire to real project/query backend. |
| Project Hub | Production-close UI | Treat as workflow command center; finish backend-backed step stats. |
| Artwork Folder | Production-close UI | Persist uploads and variant tagging server-side. |
| Creative Assignment | Production-close UI | Persist assignments, uploads, and audit events. |
| Review Allocation | Strong prototype | Convert summary/order submission to backend write path. |
| Proof Approval | Strong prototype | Persist proof assets, proof decisions, and revision state. |
| Transit Approval | Strong prototype | Persist TA decisions, rejection notes, reset events, and reviewer identity. |
| Venue Dashboard | Needs polish, close | Make markets/venues/inventory backend-backed source of truth. |
| Venue Detail / Setup | Needs polish, close | Persist rooms/maps, active state, map assets, and inventory edits. |
| Venue Map Placement | Production-close map engine | Persist normalized coordinates on inventory records. |
| Select Inventory | Needs shared-map convergence | Move fully onto shared map workspace family. |
| Documents | Prototype placeholder | Define minimum project document repository. |
| Settings/Admin | Prototype placeholder | Define auth, roles, customer/user management, and audit access. |

## Milestone 1: UI Contract Freeze

Goal: stop broad UX drift and convert critical screens into implementation
contracts.

- Keep the layout modes locked:
  - `workspace` for map/canvas tools
  - `wide` for operational dashboards and admin tools
  - `contained` only for reading-heavy views
- Use the screen readiness checklist before starting backend work on a screen.
- Continue polish only in bounded passes tied to a milestone.
- Do not reopen global layout decisions unless they block usability or backend modeling.

Milestone output:

- final v1 screen list
- screen readiness status
- accepted user roles and permissions per workflow
- backend writes identified per screen

## Milestone 2: Backend Data Model Foundation

Goal: define the real persistence shape before wiring screens.

Core entities:

- Customer
- User
- Market
- Venue
- RoomMap
- InventoryItem
- MediaVariant
- Project
- ProjectScope
- CreativeAsset
- Assignment
- OrderSubmission
- ProofLine
- TransitApproval
- ProjectShareLink
- ShareParticipant
- ProjectAuditEvent
- DocumentAsset

Source-of-truth rules:

- IDs, not display names, define uniqueness.
- Inventory display IDs are scoped to a venue.
- Normalized pin coordinates live on inventory records.
- Share links are forwardable access policies.
- Edit-capable shared links require participant identity before writes.

Milestone output:

- database schema draft
- write-path contracts
- storage/upload strategy
- permission model
- audit event model

## Milestone 3: Venue + Inventory Productionization

Goal: make Venue Management the source of truth for inventory and map placement.

Build this first because projects depend on venue inventory.

- Persist `Customer -> Market -> Venue -> RoomMap -> InventoryItem`.
- Persist market and venue active/inactive state.
- Persist media variants and inventory row metadata.
- Persist room maps and map asset URLs.
- Persist normalized `x/y` placement coordinates on inventory items.
- Keep map replacement safe by preserving normalized coordinates and surfacing a review state when needed.

Acceptance criteria:

- duplicate market names can exist across customers
- duplicate venue names can exist across customers
- inventory IDs can repeat across venues but not within a venue
- pin placement survives reload and downstream project use

## Milestone 4: Project Workflow Backend Slice

Goal: create one real project and carry it through artwork upload, assignment,
allocation review, and order submission.

Build as one vertical slice:

- create project from customer, venue, dates, PO, and campaign name
- generate project scope from active venue inventory
- upload artwork by media variant
- assign artwork to inventory
- review allocation
- submit order
- generate allocation report from backend state

Acceptance criteria:

- artwork persists across machines
- assignments persist across machines
- order submission changes editability according to workflow rules
- allocation report is generated from persisted data

## Milestone 5: Proof + Transit Approval Slice

Goal: productionize the post-submission approval workflow.

Proof Approval:

- persist proof lines and proof assets
- record approve/revise decisions
- roll proof status into Project Hub
- audit every proof action

Transit Approval:

- support scoped TA share links
- collect TA reviewer identity
- persist accept/reject decisions
- show rejection note to customer/admin
- allow customer/admin reset after revisions
- preserve historical audit events when reset occurs

Acceptance criteria:

- end-client/shared views never see Transit Approval unless explicitly scoped
- rejected TA can be reset without deleting history
- Project Hub reflects proof and transit state accurately

## Milestone 6: Share Access + Collaboration Hardening

Goal: make forwardable external collaboration safe enough for v1.

Implement:

- named scoped links
- active/revoked state
- participant identity before edit-capable actions
- audit events for uploads, assignments, proof decisions, TA decisions, order submission, and project edits
- stale-write handling for assignment/proof/transit edits

Recommended v1 link types:

- End Client Collaboration
- Artwork Upload Only
- Transit Approval
- View Only

Do not build realtime presence for v1. Server persistence plus audit events,
refresh, and stale-write warnings are enough.

## Milestone 7: Pilot Readiness

Goal: prepare for a controlled real-world launch.

Required before pilot:

- authentication and roles
- server-backed uploads
- permission checks on every write
- visible admin audit trail
- loading, empty, and error states on critical screens
- production-like seeded data
- end-to-end happy path test
- backup/export strategy
- basic observability for uploads, assignments, proofs, TA, and order submission

Pilot scope:

- one customer
- one venue
- one campaign
- one artwork-only collaborator
- one end-client collaborator
- one TA reviewer

Pilot success:

- customer admin creates and manages a project
- art collaborator uploads artwork only
- end client assigns/reviews/submits
- proofs are approved
- TA accepts or rejects
- admin can see who did what
- production output can be generated confidently

## Working Cadence

Use vertical slices, not screen-by-screen perfection.

For each slice:

1. Confirm the UI is production-close.
2. Define backend contract.
3. Wire persistence.
4. Add permission and audit behavior.
5. Test with realistic data.
6. Do final polish only after behavior is stable.

Recommended immediate order:

1. Venue source of truth
2. Project creation, scope, and artwork upload
3. Creative Assignment, Review Allocation, and order submission
4. Proof Approval and Transit Approval
5. Share Access and audit hardening
