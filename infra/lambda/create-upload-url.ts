import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

const s3 = new S3Client({});
const dynamo = new DynamoDBClient({});

type UploadKind =
  | "artwork"
  | "proof"
  | "projectDocument"
  | "customerBranding"
  | "map"
  | "venueImport"
  | "venueDocument"
  | "allocationReport"
  | "orderPackage"
  | "reconciliation"
  | "liftPayload";

type UploadRequest = {
  projectId?: string;
  venueId?: string;
  assetKind?: UploadKind;
  filename?: string;
  contentType?: string;
  customerId?: string;
};

const allowedKinds = new Set<UploadKind>([
  "artwork",
  "proof",
  "projectDocument",
  "customerBranding",
  "map",
  "venueImport",
  "venueDocument",
  "allocationReport",
  "orderPackage",
  "reconciliation",
  "liftPayload",
]);

const venueKinds = new Set<UploadKind>(["map", "venueImport", "venueDocument"]);
const projectKinds = new Set<UploadKind>(["artwork", "proof", "projectDocument"]);
const generatedDocKinds = new Set<UploadKind>(["allocationReport", "orderPackage", "reconciliation", "liftPayload"]);
const customerKinds = new Set<UploadKind>(["customerBranding"]);

export async function handler(event: { body?: string | null; rawPath?: string; headers?: Record<string, string | undefined> }) {
  let body: UploadRequest;
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    return json(400, { error: "Request body must be valid JSON" });
  }

  const assetKind = body.assetKind;
  const filename = body.filename?.trim();
  const contentType = body.contentType?.trim() || "application/octet-stream";

  if (!assetKind || !allowedKinds.has(assetKind)) {
    return json(400, { error: "assetKind is not supported" });
  }

  if (!filename) {
    return json(400, { error: "filename is required" });
  }

  const isShareUploadRoute = (event.rawPath || "").includes("/api/share/uploads/sign");
  if (isShareUploadRoute) {
    const shareValidation = await validateShareUpload(event, body);
    if (shareValidation) return shareValidation;
  }

  const destination = resolveDestination(assetKind, body);
  if ("error" in destination) return json(400, { error: destination.error });

  const safeName = filename.replace(/[^a-zA-Z0-9 ._-]+/g, "_").trim();
  const key = `${destination.prefix}/${randomUUID()}-${safeName}`;
  const tags = new URLSearchParams({
    assetKind,
    retentionClass: destination.retentionClass,
    ...(body.customerId ? { customerId: body.customerId } : {}),
    ...(body.projectId ? { projectId: body.projectId } : {}),
    ...(body.venueId ? { venueId: body.venueId } : {}),
  }).toString();

  const command = new PutObjectCommand({
    Bucket: destination.bucketName,
    Key: key,
    ContentType: contentType,
    Metadata: {
      "asset-kind": assetKind,
      "retention-class": destination.retentionClass,
    },
    Tagging: tags,
  });

  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 15 * 60 });

  return json(200, {
    bucket: destination.bucketName,
    key,
    assetKind,
    retentionClass: destination.retentionClass,
    uploadUrl,
    expiresInSeconds: 15 * 60,
  });
}

async function validateShareUpload(
  event: { headers?: Record<string, string | undefined> },
  body: UploadRequest
) {
  const token = (event.headers?.["x-share-token"] || event.headers?.["X-Share-Token"] || "").trim();
  if (!token) return json(401, { error: "A shared access token is required" });
  if (!body.projectId) return json(400, { error: "projectId is required for shared uploads" });

  const tableName = process.env.CORE_TABLE_NAME;
  if (!tableName) return json(500, { error: "CORE_TABLE_NAME is not configured" });

  const response = await dynamo.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: "gsi2",
      KeyConditionExpression: "gsi2pk = :gsi2pk",
      ExpressionAttributeValues: marshall({ ":gsi2pk": `SHARETOKEN#${hashShareToken(token)}` }),
      Limit: 1,
    })
  );

  const link = (response.Items || []).map((item) => unmarshall(item) as Record<string, any>)[0];
  if (!link) return json(403, { error: "This shared link is not valid" });
  if (link.projectId !== body.projectId) return json(403, { error: "This shared link does not belong to the requested project" });
  if (link.status !== "active") return json(403, { error: "This shared link has been revoked" });

  const accessType = String(link.accessType || "");
  if (accessType !== "collaboration" && accessType !== "artwork_upload") {
    return json(403, { error: "This shared link cannot upload artwork" });
  }

  return null;
}

function hashShareToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function resolveDestination(assetKind: UploadKind, body: UploadRequest) {
  if (venueKinds.has(assetKind)) {
    const bucketName = process.env.VENUE_ASSETS_BUCKET_NAME;
    if (!bucketName) return { error: "Venue assets bucket is not configured" };
    if (!body.venueId) return { error: "venueId is required for venue assets" };

    const prefix =
      assetKind === "venueImport"
        ? `raw-imports/${body.venueId}`
        : assetKind === "venueDocument"
          ? `documents/${body.venueId}`
          : `maps/${body.venueId}`;

    return {
      bucketName,
      prefix,
      retentionClass: assetKind === "venueImport" ? "venue-import-source" : "venue-setup",
    };
  }

  if (projectKinds.has(assetKind)) {
    const bucketName = process.env.PROJECT_ASSETS_BUCKET_NAME;
    if (!bucketName) return { error: "Project assets bucket is not configured" };
    if (!body.projectId) return { error: "projectId is required for project assets" };

    const prefix =
      assetKind === "projectDocument"
        ? `documents/${body.projectId}`
        : assetKind === "proof"
          ? `proofs/${body.projectId}`
          : `artwork/${body.projectId}`;

    return {
      bucketName,
      prefix,
      retentionClass: "project-working",
    };
  }

  if (customerKinds.has(assetKind)) {
    const bucketName = process.env.VENUE_ASSETS_BUCKET_NAME;
    if (!bucketName) return { error: "Venue assets bucket is not configured" };
    if (!body.customerId) return { error: "customerId is required for customer branding assets" };

    return {
      bucketName,
      prefix: `branding/customers/${body.customerId}`,
      retentionClass: "customer-branding",
    };
  }

  if (generatedDocKinds.has(assetKind)) {
    const bucketName = process.env.GENERATED_DOCS_BUCKET_NAME;
    if (!bucketName) return { error: "Generated docs bucket is not configured" };
    if (!body.projectId) return { error: "projectId is required for generated documents" };

    const prefix =
      assetKind === "liftPayload"
        ? `lift-payloads/${body.projectId}`
        : assetKind === "reconciliation"
          ? `reconciliation/${body.projectId}`
          : assetKind === "orderPackage"
            ? `order-packages/${body.projectId}`
            : `allocation-reports/${body.projectId}`;

    return {
      bucketName,
      prefix,
      retentionClass: "generated-business-record",
    };
  }

  return { error: "assetKind is not routable" };
}

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
    body: JSON.stringify(body),
  };
}
