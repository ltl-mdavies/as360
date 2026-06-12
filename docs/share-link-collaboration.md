# Share Links + Collaboration Persistence

Shared project links are intentionally modeled as forwardable access policies, not one-person invitations. A single link can be forwarded to multiple collaborators, and each edit-capable collaborator should identify with name and email before their first upload, assignment, proof decision, or transit decision.

## Backend Persistence Required

The current frontend/demo implementation is useful for validating the UX, but it is not production-ready for true multi-user collaboration until these records are persisted server-side:

- `ProjectShareLink`: project id, label, access scope, token/hash, active/revoked state, creator, created date, optional expiration.
- `ShareParticipant`: share link id, name, email, first seen, last active.
- `ProjectAuditEvent`: project id, share link id, participant/user id, action type, timestamp, and metadata.
- Server-backed creative assets and upload metadata.
- Server-backed assignment, proof approval, transit approval, and project detail writes.

Without server persistence, two external collaborators on different machines cannot reliably share the same state. Demo-store writes only prove interaction design inside one browser/session.

## Collaboration Rules

Recommended v1 rules:

- Artwork uploads are append-only and safe for multiple collaborators.
- Creative assignment writes are atomic per inventory location.
- Proof approval writes are atomic per proof line.
- Transit approval writes are project-level and audit logged.
- Each write records `updatedBy`, `updatedAt`, and source share link.
- If a record changed after the user loaded it, the UI should show a stale-data warning and ask the user to refresh or apply again.

Realtime presence can come later. Server persistence plus refresh or light polling is enough for the first production version.
