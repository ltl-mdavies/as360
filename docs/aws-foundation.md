# AWS Foundation

Adspace360 will use AWS-native infrastructure for the first production backend.

## Domains

- `app.adspace360.com`: canonical product application
- `go.adspace360.com`: short links and share-link redirects

## Foundation Stack

The CDK scaffold lives in `infra/`.

It creates:

- private S3 bucket for the React/Vite app build
- CloudFront distribution for `app.adspace360.com`
- SPA fallback for direct app routes
- private S3 buckets split by asset lifecycle
- API Gateway HTTP API for `/api/*`
- Cognito user pool and app client for internal/customer admins
- DynamoDB core, audit, and short-link tables
- signed upload URL Lambda
- health-check Lambda
- venue API route scaffold
- short-link redirect API for `go.adspace360.com`

## Deployment Defaults

Deploy the foundation stack in `us-east-1`.

GoDaddy remains the authoritative DNS provider for `adspace360.com`.

Create or import ACM certificates in AWS, then pass the certificate ARNs to CDK:

```bash
npm --prefix infra run synth -- -c appCertificateArn=arn:aws:acm:us-east-1:...:certificate/... 
```

The app certificate should cover:

- `app.adspace360.com`
- `go.adspace360.com`

After deployment, CDK outputs the CNAME targets that should be added in GoDaddy.

If no certificate ARN is provided, CDK still synthesizes the foundation stack
without custom domains so infrastructure work can continue locally.

## S3 Storage Strategy

S3 stores binary assets and generated files only. DynamoDB remains the source of
truth for customers, markets, venues, projects, assignments, approvals, and file
metadata.

The foundation uses lifecycle-focused buckets:

- frontend app bucket: static React/Vite build behind CloudFront
- venue assets bucket: maps, venue documents, and raw venue inventory imports
- project assets bucket: artwork uploads, proofs, and active project working files
- generated docs bucket: allocation reports, order packages, reconciliation
  exports, and Lift request/response snapshots
- logs bucket: operational logs when enabled

Retention defaults:

- raw venue imports expire after 90 days
- venue maps transition to infrequent access after 1 year
- project working files move to intelligent tiering after 30 days
- generated business documents move to infrequent access after 1 year
- logs expire after 90 days

Retention that depends on business state, such as “180 days after project
completion,” should be handled by a scheduled cleanup Lambda that reads DynamoDB
project status and applies archive/delete behavior. S3 lifecycle rules alone
cannot know when a project is complete.

## First Backend Slice

Venue source-of-truth comes first because the rest of the app depends on it.

The first API slice should persist:

- customers
- markets
- venues
- room maps
- media variants
- inventory items
- normalized placement coordinates
- active/inactive state

## Share Redirect Model

`go.adspace360.com/:code` resolves through the short-link redirect API.

Short-link records should store:

- `code`
- `status`
- `targetPath` or app-scoped `targetUrl`
- optional `expiresAt`

Valid active links redirect to `app.adspace360.com`.
Revoked, missing, malformed, or expired links redirect to `/link-unavailable`.

## Upload Model

Uploads are direct-to-S3:

1. frontend requests a signed upload URL from `/api/uploads/sign`
2. API chooses the bucket from `assetKind`
3. API returns bucket, key, signed URL, retention class, and expiration
4. frontend uploads directly to the private bucket
5. API records asset metadata in the app data model

Asset routing:

- `map`, `venueImport`, and `venueDocument` go to the venue assets bucket
- `artwork`, `proof`, and `projectDocument` go to the project assets bucket
- `allocationReport`, `orderPackage`, `reconciliation`, and `liftPayload` go to
  the generated docs bucket

The scaffold creates the signed URL endpoint. The metadata-write step belongs
to the relevant workflow slice.

## Lift Integration

Lift should not be the first backend slice.

Order/proof integration should happen after venue, project, artwork, scope, and
assignment persistence are stable.

When ready:

- map the existing order builder output to Lift's JSON contract
- submit orders from Lambda
- persist request/response payloads for audit/debugging
- surface integration failures in Hub/Admin views
