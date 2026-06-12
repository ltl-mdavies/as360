# Venue Builder Foundation

This document captures the current working direction for venue and inventory
setup based on product knowledge shared during the Adspace360 handoff phase.

It is intentionally a foundation document, not an implementation contract.
The goal is to preserve confirmed decisions, highlight open questions, and
define a safe first build sequence without locking the system too early.

## Current Intent

We are not yet building the full venue/admin system.

We do have enough information to define:

- the first-pass venue/inventory domain language
- the inventory import field model
- how media variants should be derived
- how inactive inventory should be modeled
- what Lift actually requires versus informational-only venue metadata
- the recommended order for implementation

## Recommended Language

The product appears to need three distinct concepts:

- `Venue`
  - a real-world site such as Penn Station
- `Map`
  - a reviewable visual canvas/image on which pins are placed
- `Inventory Item`
  - a unique ad unit / physical placement record

The legacy spreadsheet concept `Room name` should become `MapName` for import.

Recommendation:

- User-facing UI term: `Map`
- Import field name: `MapName`
- Internal entity name: `VenueMap` or `VenueLocation`

This keeps the upload model intuitive and matches how users already think about
pin placement in the current app.

## Confirmed Import Fields

Based on `adspace fields.csv`, the current working field set is:

- `CustomerName` required
- `VenueName` required
- `MapName` required
- `UnitNumber` optional
- `InventoryID` required
- `MediaType` required
- `TrimHeight` optional
- `TrimWidth` optional
- `SafeHeight` optional
- `SafeWidth` optional
- `Substrate` optional
- `Finishing` optional
- `LocationDetail` optional
- `Notes` optional
- `DPI` optional
- `Bleed_Top` optional
- `Bleed_Right` optional
- `Bleed_Bot` optional
- `Bleed_Left` optional
- `Active` required

## Import Identity Rules

`InventoryID` is not globally unique across all venues.

Recommendation:

- Treat display ID as `InventoryID`
- Treat true record uniqueness as a composite of:
  - `CustomerName`
  - `VenueName`
  - `InventoryID`

If the system later supports customer-owned global venue IDs, the persisted
record identity can become:

- `customerId`
- `venueId`
- `inventoryId`

## Media Grouping Rules

Confirmed rule:

- `MediaType + Dimensions`
- unique combinations become a variant

Recommendation:

- Use `MediaType + TrimHeight + TrimWidth` as the canonical variant identity
- Safe-area values should remain item-level production metadata, not variant identity

Suggested normalized variant key:

- `mediaType||trimHeight||trimWidth`

Suggested user-facing label example:

- `2-Sheet • 46.2"h × 60.2"w`

## Venue Creation Flow

Current intended manual flow:

1. Create venue
2. Create maps
3. Upload one image per map
4. Create inventory
   - sheet import
   - manual creation
5. Place inventory pins on the correct map
6. Validate completeness

### Recommended First UX Model

#### Venue

- venue name
- customer
- market
- shared document library link

#### Maps

- name
- image asset
- sort order

#### Inventory

- bulk import
- manual add/edit
- grouped by media variant and map

#### Pin Placement

- left rail grouped by active map and variant
- right canvas displays selected map
- drag inventory rows to map to place pins
- counters show:
  - total items in venue
  - total active items
  - total active items on maps
  - total unplaced active items

## Inactive Inventory: Recommended Model

There are at least two confirmed inactive behaviors and a likely third hybrid scenario.

### Confirmed customer needs

1. Hide inactive items from campaigns, but still show a visual pin on the map as unavailable
2. Hide inactive items completely
3. Potentially support both behaviors at the same time for different items

### Recommendation

Do not model this with a single boolean alone.

Use:

- `isActive: boolean`
- `mapVisibilityMode: "hidden" | "show_unavailable"`

Meaning:

- `isActive = true`
  - item can be included in new projects
  - item counts toward venue inventory totals
  - item can accept artwork assignment
- `isActive = false` and `mapVisibilityMode = "hidden"`
  - item does not count
  - item does not appear on map
  - item cannot be assigned
- `isActive = false` and `mapVisibilityMode = "show_unavailable"`
  - item does not count
  - item remains visible on map as unavailable
  - item cannot be assigned

This solves all three customer scenarios without needing customer-wide toggles
as the only control surface.

A customer-level default can still exist later:

- default inactive behavior for this customer

But the item-level visibility mode is what unlocks mixed behavior in one venue.

## Pin and Map Rules

Confirmed behaviors:

- every inventory item must belong to a map via `MapName`
- every active inventory item must also have a placed pin
- drag from rail to map should place the pin
- replacing a map image must preserve pin coordinates

### Recommendation

Store pins as normalized coordinates against the map:

- `x` from `0..1`
- `y` from `0..1`

Then replacing a map asset can preserve the coordinates as long as the new map
represents the same physical layout.

If the replacement is materially different, the system should support a
"pins need review" state rather than silently assuming correctness.

## Orphaned Pins and Validation

### Orphaned pins

Problem:

- an inventory record is deleted while its pin still exists

Recommendation:

- hard delete of inventory should also hard delete its map pin
- if there is assignment history later, consider soft-delete instead of hard-delete
- surface a confirmation warning before deletion when a pin exists

### Required validation

The system should track:

- total inventory items
- total active inventory items
- total active inventory items with map pins
- total active inventory items without map pins
- total inactive but visible pins
- total orphaned pins

Recommended validation gates:

- venue cannot be marked ready if active items exist without pins
- import should warn on duplicate `InventoryID` within the same venue
- import should warn on unknown or blank `MapName`
- import should warn when dimensions are malformed

## What Lift Actually Needs

Based on the shared Lift order JSON and product notes, Lift needs relatively
little compared with the full venue record.

### Header-level

- `ext_id`
- `po_number`
- `order_title`
- `campaign_reports`
- `order_note`

### Line-level

Grouped by:

- art file
- `UnitNumber`
- quantity of assigned inventory items

Expected line detail includes:

- `productSku`
- `productCategory` pending confirmation
- `productQty`
- `file_name`
- `trim_height`
- `trim_width`
- `safe_height`
- `safe_width`
- `assigned_locations`

### Important implication

Venue builder should not be overfit to Lift.

Most venue fields are operational or informational for Adspace:

- map organization
- substrate
- notes
- location detail
- finishing
- inactive visibility behavior
- pin placement

Lift cares mostly about:

- unit number
- quantities
- file identity
- trim/safe dimensions
- assigned inventory IDs

## Venue Documents and External Sharing

Some customers, including Intersection, store venue files and supporting
documentation in Google Drive.

Current product need:

- allow a document-library link to be stored on the venue record
- allow that link to be exposed automatically to the external client experience

Recommendation:

- treat this as venue-level reference metadata, not campaign metadata
- store it as `documentLibraryUrl` on the venue
- optionally support `documentLibraryLabel` later if customers want a branded title

### Why this matters

Venue documents behave like shared reference material for:

- project hub document access
- external client workspaces
- installer/reference packet workflows

### Suggested guardrails

- validate that the field is a URL
- support Google Drive links as a first-class case
- do not hard-restrict to Google only, since customer storage patterns may evolve
- treat a missing or malformed link as non-blocking, but visibly incomplete in admin

## Bulk Inventory Operations

Bulk editing should be considered a core admin requirement, not an enhancement.

Reason:

- inventory status changes are frequent
- manual one-by-one editing will not scale
- active/inactive and map-placement workflows depend on fast operational cleanup

### Recommended first bulk actions

- mark selected records active
- mark selected records inactive
- set inactive visibility mode
- move selected records to a different `MapName`
- update shared metadata for selected rows:
  - substrate
  - finishing
  - notes
  - location detail
- delete selected records with orphaned-pin cleanup rules

### Recommended first bulk filters

- by map
- by variant
- by active status
- by pinned / unpinned
- by search text

### Recommended UX model

- table/list view with multi-select
- sticky bulk-action bar appears when rows are selected
- preview count before applying changes
- confirmation step for destructive actions

### Important validation tie-ins

Bulk editing should update venue health counters in real time:

- active inventory total
- active inventory without pins
- inactive visible-on-map total
- orphaned pin total

This makes venue cleanup practical before project creation.

## Suggested Domain Direction

### Venue

- `id`
- `customerId`
- `name`
- `market`
- `documentLibraryUrl`
- optional defaults and policy flags later

### VenueMap

- `id`
- `venueId`
- `name`
- `imageUrl`
- `sortIndex`

### InventoryItem

- `id` as stored record id
- `inventoryId` as human-facing Adspace inventory code
- `venueId`
- `mapId`
- `unitNumber`
- `mediaType`
- `trimHeight`
- `trimWidth`
- `safeHeight`
- `safeWidth`
- `substrate`
- `finishing`
- `locationDetail`
- `notes`
- `dpi`
- bleed fields
- `isActive`
- `mapVisibilityMode`
- `x`
- `y`

### Variant

Variant may remain derived rather than stored initially:

- grouped from `mediaType + trimHeight + trimWidth`

Later enhancement:

- persisted variant color/icon choices per venue

## Recommended Build Sequence

### Phase 1: Domain and import foundation

- finalize field names
- add canonical inventory field model
- add import parser + row normalization
- add validation report

### Phase 2: Venue maps

- create/edit venue maps
- image upload
- map ordering

### Phase 3: Inventory management

- bulk import
- manual inventory CRUD
- bulk inventory editing
- active/inactive behavior model

### Phase 4: Pin placement

- drag to map
- grouped left rail
- counters and validation
- pin persistence across map replacement

### Phase 5: Project integration

- new project includes active inventory only
- unavailable-but-visible items remain excluded from campaigns
- assignment UI can optionally render unavailable reference pins later

## Open Questions

- final term for `Map` versus `Area` versus `Room`
- whether `productCategory` from Lift should be imported, derived, or ignored
- whether `DPI` and bleed fields are item-level only or sometimes variant-level defaults
- whether map icon selection should be per variant, per map, or per venue
- whether inventory deletion should be soft-delete first once audit/history matters
- whether map replacement should support an explicit "reconfirm pin alignment" workflow

## Immediate Next Recommendation

Before coding the real venue builder UI, define and approve:

1. final canonical field names
2. inactive inventory model
3. import validation rules
4. venue/map/inventory entity boundaries
5. first implementation slice

Then start with domain types and import parsing, not the full UI.
