# Venue API Contract

This is the first backend contract slice for Venue Management.

## Authentication

All venue source-of-truth routes are admin/customer-admin routes and should use
Cognito authentication.

External share links do not get direct access to these routes in v1.

## Routes

### Customers

- `GET /api/customers`

Returns the customer accounts visible to the authenticated user.

### Markets

- `GET /api/customers/:customerId/markets`
- `POST /api/markets`
- `PATCH /api/markets/:marketId`

Market names are customer-scoped. Different customers may have the same market
name.

### Venues

- `GET /api/venues?customerId=...`
- `GET /api/venues/:venueId`
- `POST /api/venues`
- `PATCH /api/venues/:venueId`

Venue names are customer-scoped. Different customers may have the same venue
name.

### Room Maps

- `POST /api/venues/:venueId/maps`
- `PATCH /api/venues/:venueId/maps/:mapId`

Map assets are uploaded to S3 first, then the returned object key is stored on
the room map record.

### Inventory

- `POST /api/venues/:venueId/inventory/import`
- `PATCH /api/inventory/:inventoryItemId`
- `PATCH /api/inventory/:inventoryItemId/placement`

Inventory display IDs are unique inside a venue, not globally.

Placement updates store normalized map coordinates:

- `x`: `0..1`
- `y`: `0..1`

Zoom and pan never modify persisted coordinates.

## Status Rules

- inactive markets override venues inside that market
- inactive venues cannot be used for new project scope
- inactive inventory cannot be assigned in new projects
- inactive inventory may still appear on maps if `mapVisibilityMode` is `show_unavailable`

## Audit Events

Record audit events for:

- market created/updated/activated/deactivated
- venue created/updated/activated/deactivated
- room map created/updated/replaced
- inventory imported
- inventory row updated
- placement coordinate updated

