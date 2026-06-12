# Screen Readiness Checklist

Use this checklist before declaring a screen ready for backend wiring or pilot
testing.

## Readiness Gates

Each critical screen should answer these questions:

- What real data does the screen read?
- What backend writes does the screen perform?
- What user roles can view it?
- What user roles can edit it?
- What shared-link scopes can access it?
- What actions need audit events?
- What happens when data is empty?
- What happens when data is loading?
- What happens when a write fails?
- What happens when another user changed the data first?
- What parts of the screen are locked after order submission?
- What downstream workflow depends on this screen?

## V1 Critical Screens

| Screen | Reads | Writes | Audit Events |
| --- | --- | --- | --- |
| Venue Management | customers, markets, venues, maps, inventory | market, venue, room/map, inventory, pin coordinates | venue updates, inventory changes, imports, placement changes |
| Project Dashboard | projects, statuses, customer scope | create project | project created |
| Project Hub | project rollup, workflow state | project details, TA reset, production release | project edits, reset, release |
| Artwork Folder | project, variants, creative assets | uploads by variant | artwork uploaded |
| Creative Assignment | project scope, inventory, creatives, assignments | assignment per inventory item | creative assigned/unassigned |
| Review Allocation | assignments, creatives, inventory, project metadata | order submission | order submitted |
| Proof Approval | proof lines, proof assets | approve/revise proof lines | proof approved/revised |
| Transit Approval | transit approval state, project summary | approve/reject/reset TA | TA accepted/rejected/reset |
| Allocation Report | submitted allocation and project metadata | none for v1 | report downloaded if desired |
| Share Access | links, participants, activity | create/revoke/regenerate links, identify participants | link created/revoked/regenerated, participant identified |

## Production-Close Definition

A screen is production-close when:

- its primary task is clear without explanation
- it uses real entity language
- major empty/loading/error states are designed
- editability and permissions are clear
- backend writes are known
- audit-worthy actions are identified
- it is responsive enough for expected desktop/tablet use
- visual polish can continue without changing the data model

## Prototype Definition

A screen is still prototype-level when:

- it relies on ambiguous mock-only data
- it has placeholder actions
- permission behavior is undefined
- backend write shape is unclear
- the UI layout may still change the underlying model

