# Admin Health Dashboard Assessment

Date: 2026-06-28

This assessment reviews the current Admin Health Dashboard and adjacent backend capabilities after the Vendor Proof Ops milestone. It is focused on turning `/admin/health` from a readiness snapshot into an operational health dashboard for connectivity assurance, error monitoring, event monitoring, access visibility, analytics, and later self-healing.

## Current State

The Admin Health Dashboard is currently a hybrid readiness and operations page.

It already pulls:

- active customers from `/api/customers?lite=1`
- active venues from `/api/venues?lite=1`
- projects from `/api/projects`
- admin settings from `/api/admin/settings`
- recent workflow issues from `/api/admin/settings?recentWorkflowErrors=N`
- a manual Lift smoke test from `/api/admin/settings?liftSmokeOrder=...`

The page derives most health posture in the browser. It shows footprint counts, release posture, readiness gates, recent workflow issues, and a read-only Lift endpoint smoke test for `AS360Orders`, `AS360ProofReport`, and the Lift order deep-link resolver.

The standalone `/api/health` Lambda is only a shallow liveness endpoint. It returns service name, `ok: true`, and current time. It does not check DynamoDB, Cognito, S3, SES, Lift, realtime, or app configuration.

## Current Capabilities Worth Keeping

### Workflow Error Stream

There is already a structured `workflow.error` audit event path. The Health Dashboard consumes recent workflow errors and the same stream feeds Project Activity and the Errors lane.

Current workflow issue examples include proof sync mismatch, missing proof URL, flush sync failure, and notification delivery failure drills. Notification dispatch failures can also write `workflow.error` warnings.

This is a strong base because it is project-scoped, actor-aware, and already operator-facing.

### Lift Readiness Smoke Test

The current read-only Lift smoke test verifies the shape and availability of:

- `AS360Orders`
- `AS360ProofReport`
- Lift order URL resolver

It captures HTTP status, response timing, row counts, line counts, required-field coverage, and a safe sample. This is the best current connectivity-assurance feature.

### Lift Order Health

Lift sync already classifies linked orders as:

- `ok`
- `cancelled`
- `missing`
- `unknown`

Health changes write `project.lift_order_health_changed` audit events. Cancelled or missing Lift orders do not automatically cancel Adspace projects, which is the right operational stance. Primary/LTL vendor actions are locked while a Lift link is cancelled or missing.

This data is not yet prominent enough on the Admin Health Dashboard.

### Vendor Route Separation

Primary/LTL vendor health is Lift-backed. External vendor health is Adspace-managed. That distinction is now encoded in vendor order `integrationHealth`.

This separation is important because a real health dashboard should not treat a missing Lift line as a failure for an external vendor line.

### Realtime Instrumentation

Presence and workspace broadcast Lambdas emit embedded CloudWatch metrics under `Adspace360/Realtime` for joins, heartbeats, auth failures, fanout, stale connections, queue failures, and post failures.

The MVP dashboard now reads the realtime SQS/DLQ CloudWatch queue age signals directly. A follow-up collector should add the custom `Adspace360/Realtime` embedded metrics and selected log excerpts.

### API Timing Headers

Project and venue API responses include `x-adspace-route-key` and `x-adspace-route-ms`. The frontend logs slow requests to the browser console.

This is useful for local diagnosis, but it is not persisted or aggregated into operational analytics.

## Current Gaps

### Health Is Not Centralized

Health data is scattered across project records, audit events, frontend-derived gates, realtime CloudWatch metrics, Lambda logs, and manual smoke tests. There is no single backend health summary endpoint.

Implemented direction: the admin-only `/api/admin/health` endpoint now returns normalized health domains with status, evidence, last checked time, and recommended action.

### Shallow Infrastructure Liveness

`/api/health` only proves that one Lambda can return JSON. It does not verify dependencies.

Missing checks:

- DynamoDB core table read/write posture
- audit table query posture
- S3 signed upload/sign-read posture
- Cognito user/profile lookup posture
- SES sender identity and delivery posture
- notification digest queue/due backlog
- realtime WebSocket/presence table posture
- Lift endpoint availability and schema drift
- CloudFront/S3 frontend deployment freshness

### Workflow Error Storage Is Scan-Based

Recent workflow issues are loaded by scanning the audit table for `eventType = workflow.error`, sorting in memory, then slicing. This is fine at pilot scale but will become slow and expensive.

Recommended direction: write workflow issues into a dedicated indexed health-events shape or add an audit GSI by event type and created time.

### No App-Level Error Telemetry

Frontend `console.error` calls are not collected. Browser API failures, rendering failures, route-level crashes, and upload failures only reach Health if a page explicitly calls `logProjectErrorEvent`.

Recommended direction: add a lightweight client telemetry endpoint for bounded, sanitized operational errors. Start with route, surface, project id, status code, API route key, elapsed time, and app version.

### Limited User Access Logs

The backend can identify actors for API writes and share participants can be identified, but there is no operational view for:

- login attempts
- failed sign-ins
- session refresh failures
- user denied by role/customer/vendor account
- inactive user access attempts
- vendor user activity by account
- share-link opens and denied share-link attempts
- participant page views before edits

Recommended direction: introduce explicit access audit events. For Cognito sign-in failures, use Cognito/CloudWatch metrics or route login through a backend auth telemetry wrapper if more detail is needed.

### No CloudWatch/API Gateway/Lambda Rollup

The dashboard does not show Lambda error rates, API 4xx/5xx counts, p95 latency, throttles, duration, or cold-start-adjacent timeout symptoms. It also does not show SQS dead-letter depth for realtime broadcast.

Recommended direction: either query CloudWatch metrics from an admin backend endpoint or write compact health rollups into DynamoDB on a schedule.

### Notifications Are Not Fully Observable

Immediate notification failures can become workflow issues. Digest failures are stored on the digest record as `lastError`, but they are not surfaced on Health as a notification health domain. SES bounces/complaints are not wired into app health.

Recommended direction: add notification health cards for immediate-send failures, digest backlog, digest last error, SES bounce/complaint events, and disabled-but-required notification posture.

### Production/Shipping Sync Is Still Unvalidated

Per the June 26 handoff, proofing is validated, but production and shipping sync are not. The Health Dashboard should explicitly display this as a watch/blocked operational domain until `AS360Orders` line status and `ShippingReport` mapping are validated.

## Recommended Health Domains

### 1. Platform/API

Show:

- API health endpoint status
- project API p95/p99 latency
- venue API p95/p99 latency
- 4xx/5xx rate by route
- Lambda error count and timeout count
- slowest routes in the last hour/day

Initial implementation can use route timing already emitted in response headers and Lambda logs. Mature implementation should query CloudWatch or use a scheduled rollup.

### 2. Data Stores And Assets

Show:

- core table reachable
- audit table reachable
- recent workflow issue index healthy
- project assets bucket signing available
- generated docs bucket available
- venue assets bucket available
- recent upload/signing failures

### 3. Lift Connectivity

Show:

- active Lift environment
- credential/config completeness
- last successful read smoke test
- `AS360Orders` status, duration, row shape
- `AS360ProofReport` status, duration, row shape
- order URL resolver status
- linked project count by Lift health: ok, unknown, missing, cancelled
- projects waiting for proof assets
- stale Lift proof sync count
- production/shipping sync validation status

This should be the first domain to make operationally rich because it carries the most pilot risk.

### 4. Proof And Workflow Operations

Show:

- pending proofs
- waiting-for-proof count
- approved count
- revision-requested count
- stale proof-line sync count
- recent proof sync errors
- proof mismatch errors
- projects blocked by production release gates

### 5. Vendor Operations

Show:

- primary/LTL order count by workflow state
- external vendor order count by workflow state
- vendor orders needing attention
- vendor proof uploads pending customer review
- external vendor lines missing manual status after approval
- primary vendor orders locked by Lift health
- vendor package generation failures

### 6. Realtime Collaboration

Show:

- active presence sessions by workspace
- presence auth failures
- broadcast queue depth
- broadcast DLQ depth
- stale connection cleanup count
- message fanout failures

### 7. Notifications

Show:

- enabled notification rules
- last immediate send failure
- digest backlog count
- digest last attempted time and last error
- SES bounce/complaint posture when wired
- workflow error alerting enabled/disabled

### 8. Access And Audit

Show:

- active platform admins, customer admins, vendor users
- inactive/suspended users
- access denied events by reason
- share participants identified today/week
- revoked or expired share-link attempts
- vendor user activity by account
- audit event volume by surface

### 9. Customer/Venue Data Quality

Show:

- active customers lacking Lift customer id
- active venues with zero inventory
- inventory missing routing/vendor defaults
- media variants with duplicate or ambiguous identities
- maps without placement data
- projects using internal sandbox customer incorrectly

## Suggested Dashboard Shape

Use an operational layout instead of a checklist-heavy page. The first screen should answer one question: does everything look good right now?

1. Top row: overall health, active incidents, last full check, environment, and refresh.
2. Domain cards: Platform, Lift, Proofs, Vendors, Realtime, Notifications, Access, Data Quality.
3. Incident queue: unresolved health events grouped by severity and owner.
4. Integration probes: manual and scheduled probes with history.
5. Recent events: audit/workflow/access stream with filters.
6. Recovery actions: guarded runbooks and operator actions shown only when relevant.

The default page should stay sparse. It should show normal systems as compact green/ready states and reserve visual weight for warnings, errors, stale checks, and blocked workflows. Dense diagnostics should live behind drilldowns, not on the main canvas.

Recommended at-a-glance structure:

- Overall status: Good, Watch, Degraded, or Blocked.
- Critical systems strip: API, AWS, Lift, Proofs, Vendors, Access, Notifications, Realtime.
- Active issues: only unresolved warnings/errors, grouped by system.
- Last check freshness: show when each domain was last verified.
- Operator actions: show only actions relevant to the selected issue.

Each system card should include only:

- state
- issue count
- last checked time
- one-line reason
- drilldown link

The drilldown view can carry richer detail: failed endpoint, affected customer/project/vendor, last successful check, raw error code, recent attempts, related audit events, and available recovery actions.

## System Grouping Model

The dashboard should group health by systems operators understand, not by implementation files.

Recommended top-level systems:

- App/API: frontend availability, API route health, latency, Lambda errors, deployment freshness.
- AWS foundation: DynamoDB, S3 buckets, CloudFront, API Gateway, Lambda, SQS/DLQ, SES, Cognito.
- Lift integration: endpoint connectivity, credentials/config, order sync, proof sync, order health, schema drift.
- Customer access: customer status, user profile state, role/customer assignment, suspended/inactive access, share-link posture.
- Customer data: customer Lift IDs, venue inventory, maps, media variants, routing defaults, project scope.
- Proof operations: proof sync, proof state, waiting assets, revisions, approvals, mismatch detection.
- Vendor operations: primary/LTL route health, external vendor work queues, package generation, proof upload/status gaps.
- Notifications: immediate sends, digest backlog, delivery failures, bounce/complaint events when wired.
- Realtime collaboration: presence, WebSocket auth, broadcast queue, fanout failures.

AWS bucket health should be explicit but compact. A green bucket card should not list every bucket. An unhealthy bucket detail should state which bucket, operation, and workflow are affected, for example: project asset upload signing failed, generated document read failed, venue map asset missing, or CloudFront asset delivery stale.

Customer-related assurance should be a first-class health domain. It should answer:

- Can this customer access the app?
- Are the right users assigned?
- Are inactive or suspended users blocked?
- Are share links valid, expired, or revoked correctly?
- Does the customer have required Lift/customer metadata?
- Are customer venues and inventory complete enough for downstream workflows?

## Recommended Implementation Path

### Phase 1: Real Health Snapshot

Add an admin-only `/api/admin/health` endpoint that consolidates existing data.

Include:

- current shallow `/api/health` result
- app settings integration posture
- project Lift health rollups
- proof waiting/stale counts
- recent workflow issues
- notification digest failures/backlog
- active users by role
- active share participant count
- vendor order attention counts

Implemented in the first MVP slice, with the follow-on observability slice adding read-only CloudWatch/SES rollups.

### Phase 2: Health Events And Indexing

Introduce a normalized `HealthEvent` or indexed audit shape.

Fields:

- `id`
- `domain`
- `severity`
- `status`
- `source`
- `projectId`
- `customerId`
- `vendorAccountId`
- `errorCode`
- `message`
- `firstSeenAt`
- `lastSeenAt`
- `resolvedAt`
- `occurrenceCount`
- `recommendedAction`
- `runbookActionId`

Use this for workflow issues, access denials, notification failures, Lift sync failures, and later infrastructure rollups.

Current v1 slice: the dashboard persists `HealthIncident` records in the core table from deterministic issue fingerprints. Each refresh updates first seen, last seen, last checked, occurrence count, severity, evidence, and operator state. Incidents auto-resolve when a later snapshot no longer detects their fingerprint.

Supported operator states are `active`, `acknowledged`, `suppressed`, and `resolved`. Supported operator actions are acknowledge, mark resolved, suppress for 24 hours, and copy incident packet.

The next implemented slice promotes issue `runbookActionId` values into a typed runbook catalog returned by `/api/admin/health`. The dashboard now shows a compact Action Center and issue-level runbook detail with safety level, operator steps, evidence hints, and related app navigation where available. This keeps the main page sparse while making every surfaced issue more actionable.

### Phase 3: Scheduled Probes

Add scheduled read-only probes that write health events or health snapshots.

Start with:

- Lift `AS360Orders`
- Lift `AS360ProofReport`
- Lift order URL resolver
- DynamoDB/audit table read checks
- notification digest backlog
- realtime queue/DLQ depth

Use a short retention window for raw checks and retain aggregate health state longer.

### Phase 4: CloudWatch And AWS Rollups

Add CloudWatch-backed rollups for:

- Lambda errors, throttles, duration, timeout symptoms
- API Gateway 4XX/5XX and latency
- WebSocket failures
- SQS queue and DLQ depth
- SES sends, bounces, complaints

Current slice: `/api/admin/health` now reads a bounded 15-minute CloudWatch/SES window directly for Lambda, API Gateway, realtime SQS/DLQ age, and SES account/delivery posture. Longer term, prefer a backend scheduled collector that writes small summaries to DynamoDB over recalculating every dashboard refresh.

### Phase 5: Operator Recovery Actions

Add guarded recovery actions only after the detection model is reliable.

Near-term examples:

- Refresh Lift order/proof sync for one project.
- Re-run read-only Lift smoke test.
- Rebuild stale proof state from current Lift report.
- Clear resolved workflow issue with reason.
- Retry failed notification digest.
- Regenerate vendor package.
- Relink Lift order after missing/cancelled detection.

Every action should require role checks, confirmation, reason capture, idempotency protection, and audit logging.

## Self-Healing Foundation

Self-healing should not start with automatic mutation. It should start with deterministic detection, safe classification, AI-assisted diagnosis, and auditable recovery.

Recommended pattern:

1. Detect: scheduled probe or workflow event identifies a failed invariant.
2. Classify: assign domain, severity, scope, and confidence.
3. Correlate: avoid duplicate incidents by fingerprint.
4. Analyze: use AI to summarize likely cause, affected workflows, related events, and confidence.
5. Recommend: attach one or more recovery actions.
6. Simulate: dry-run the recovery and show expected changes.
7. Execute: operator-approved action for v1.
8. Automate: allow automatic execution only for low-risk, idempotent repairs.

AI analysis should operate on bounded, structured health evidence rather than raw unrestricted logs. The health service should prepare a compact incident packet with system, timestamps, recent checks, related audit events, affected customer/project/vendor IDs, error codes, and allowed recovery actions. AI can then produce an operator summary and choose from approved runbooks, but should not directly invent mutations.

Near-real-time self-healing should use severity and confidence gates:

- Informational: summarize and auto-resolve when the next check passes.
- Warning: recommend action, allow one-click operator repair.
- Degraded: run safe read-only confirmation checks automatically, then recommend repair.
- Blocked: require operator approval unless the repair is explicitly low-risk and idempotent.

Good first self-healing candidates:

- retry transient Lift read failures
- refresh stale proof sync
- retry failed notification digest
- clean stale realtime presence records
- regenerate expired signed URLs on demand
- re-enqueue failed realtime broadcasts when DLQ payload is still valid

Actions that should remain manual until much later:

- resubmit/rebuild Lift orders
- relink Lift orders
- cancel or reopen Adspace orders
- mutate proof approval state
- alter vendor routing after order submission
- delete or replace project assets

## V1 Progression

The first v1 slices replace the browser-derived health page data model with a backend health snapshot, add read-only production telemetry, and persist incident state. Do not start with self-healing automation until incident detection and operator state are reliable.

Priority order:

1. Add `/api/admin/health`.
2. Surface Lift health rollups and stale proof sync counts.
3. Surface notification digest failures and recent workflow errors as first-class incidents.
4. Add access/audit summaries for users, vendors, and share participants.
5. Add scheduled read-only Lift probes with persisted last-success/last-failure history.
6. Expand CloudWatch rollups with custom realtime metrics, log excerpts, and persisted trend snapshots.
7. Add guarded recovery actions for the safest incident classes.

## MVP Operator Runbook

The MVP Health Dashboard is intentionally read-only and at-a-glance.

How to read it:

- `Good`: no active warning/error issue is detected for that system.
- `Watch`: a non-blocking issue exists; review before a pilot or production-sensitive action.
- `Degraded`: an error exists that can affect workflows or operator trust.
- `Blocked`: an issue is expected to prevent a workflow from moving safely.

First-screen workflow:

- Check the overall status.
- Review any non-green system cards first.
- Open the Active Issues section for the exact system, affected customer/project/vendor, source, and recommended action.
- Use the Lift read-only smoke test when the issue relates to Lift endpoint availability or report shape.

Mobile expectations:

- The status banner, refresh action, and system cards must remain usable from phone viewports.
- Diagnostic detail should stack vertically and wrap long messages instead of using dense tables.
- Healthy systems should stay compact so warnings and errors remain easy to find.

MVP boundaries:

- The MVP uses existing app records, settings, audit events, notification digests, presence records, and environment configuration.
- The MVP includes read-only S3 bucket reachability checks for project assets, venue assets, and generated documents.
- The MVP includes read-only realtime broadcast queue and dead-letter queue attribute checks when those queues are configured.
- The MVP includes a bounded read-only CloudWatch/SES window for Lambda errors, throttles, latency, API Gateway 5XX, SQS age, SES account posture, and SES delivery counters.
- The MVP does not yet perform object-level S3 health checks, collect frontend telemetry, or persist scheduled probe history.
- The MVP shapes bounded incident packets for future AI analysis but does not call AI.
- The MVP maps incidents to guarded runbooks and operator actions, but it does not perform self-healing mutations.
