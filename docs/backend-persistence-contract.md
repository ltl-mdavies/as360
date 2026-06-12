# Backend Persistence Contract

This document captures the minimum backend shape needed to move Adspace360
from frontend/demo behavior to production collaboration.

## Identity Rules

- Use IDs as the source of truth.
- Display names may duplicate across customers.
- Inventory display IDs are scoped to a venue.
- Project assignments reference inventory record IDs, not display labels.
- Share participants may be lightweight external identities, not full users.

## Core Relationships

```text
Customer
  -> Market
    -> Venue
      -> RoomMap
      -> InventoryItem

Project
  -> Venue
  -> ProjectScope
  -> CreativeAsset
  -> Assignment
  -> OrderSubmission
  -> ProofLine
  -> TransitApproval
  -> ProjectShareLink
    -> ShareParticipant
    -> ProjectAuditEvent
```

## Required Entities

### Customer

Represents the media owner/customer account, such as Intersection or Outfront.

Required:

- id
- name
- status

### Market

Customer-scoped market. Names can repeat across customers.

Required:

- id
- customerId
- name
- isActive

### Venue

Customer-scoped venue. A venue belongs to one customer and one market.

Required:

- id
- customerId
- marketId
- name
- isActive
- documentLibraryUrl

### RoomMap

Map/canvas asset for a venue area.

Required:

- id
- venueId
- name
- assetUrl
- assetName
- sortOrder
- isActive

### InventoryItem

Physical ad placement record.

Required:

- id
- venueId
- roomMapId
- inventoryDisplayId
- mediaVariantId
- unitNumber
- trimHeight
- trimWidth
- safeHeight
- safeWidth
- isActive
- mapVisibilityMode
- x
- y

Coordinate rule:

- `x` and `y` are normalized `0..1` room-map coordinates.
- Zoom and pan never change stored coordinates.

### Project

Campaign/project workspace.

Required:

- id
- customerId
- venueId
- title
- poNumber
- artworkDueDate
- postDate
- status
- liftOrderNumber

### ProjectScope

Inventory included in a project.

Required:

- projectId
- includedInventoryItemIds

### CreativeAsset

Artwork uploaded to a project.

Required:

- id
- projectId
- mediaVariantId
- filename
- fileUrl
- thumbnailUrl
- uploadedByActorId
- uploadedAt

### Assignment

Connects one creative asset to one inventory item for a project.

Required:

- projectId
- inventoryItemId
- creativeAssetId
- updatedByActorId
- updatedAt

### ProofLine

Printer proof row for review.

Required:

- id
- projectId
- creativeAssetId
- inventoryItemIds
- proofAssetUrl
- status
- reviewerActorId
- reviewedAt
- revisionNote

### TransitApproval

External transit authority decision.

Required:

- projectId
- status
- submittedByName
- submittedAt
- submittedDate
- comment

Reset rule:

- resetting rejected Transit Approval returns status to `not_started`
- previous rejection remains preserved in audit events

### ProjectShareLink

Forwardable access policy.

Required:

- id
- projectId
- label
- accessType
- tokenHash
- status
- createdByUserId
- createdAt
- expiresAt

V1 access types:

- end_client_collaboration
- artwork_upload
- transit_approval
- view_only

### ShareParticipant

Lightweight identity for external collaborators using a forwarded link.

Required:

- id
- shareLinkId
- displayName
- email
- firstSeenAt
- lastActiveAt

### ProjectAuditEvent

Append-only activity history.

Required:

- id
- projectId
- actorType
- actorId
- shareLinkId
- actionType
- metadata
- createdAt

## Required Write Paths

Venue source of truth:

- create/update market
- activate/deactivate market
- create/update venue
- activate/deactivate venue
- create/update room map
- create/update inventory item
- import inventory
- update normalized pin coordinates

Project workflow:

- create project
- update project details
- update project scope
- upload creative asset
- assign/unassign creative
- submit order
- release production

Approval workflow:

- create/update proof line
- approve/revise proof line
- accept/reject transit approval
- reset transit approval

Share workflow:

- create share link
- revoke share link
- regenerate share link
- identify share participant
- record audit event

## Concurrency Rules

Use simple v1 stale-write protection:

- each editable record has `updatedAt`
- writes include the last known `updatedAt`
- if the server record changed, reject with a stale-data response
- UI asks the user to refresh or reapply the change

Recommended atomicity:

- artwork uploads are append-only
- assignments are atomic per inventory item
- proof decisions are atomic per proof line
- transit decisions are atomic per project
- venue pin updates are atomic per inventory item

## Launch Constraint

The current demo store is not production persistence. It validates workflow and
interaction design only. Multi-user external collaboration requires this
server-backed persistence layer before launch.

