import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";

const dynamo = new DynamoDBClient({});

export async function handler(event: { pathParameters?: Record<string, string | undefined> }) {
  const tableName = process.env.SHORT_LINKS_TABLE_NAME;
  const appBaseUrl = process.env.APP_BASE_URL || "https://app.adspace360.com";
  const projectAssetsBucketName = process.env.PROJECT_ASSETS_BUCKET_NAME || "";
  const code = event.pathParameters?.code?.trim();

  if (!tableName || !code) return redirect(`${appBaseUrl}/link-unavailable`);

  const result = await dynamo.send(
    new GetItemCommand({
      TableName: tableName,
      Key: { code: { S: code } },
      ConsistentRead: true,
    })
  );

  const item = result.Item;
  if (!item) return redirect(`${appBaseUrl}/link-unavailable`);

  const status = item.status?.S || "revoked";
  const expiresAt = item.expiresAt?.N ? Number(item.expiresAt.N) : undefined;
  const isExpired = !!expiresAt && Math.floor(Date.now() / 1000) > expiresAt;

  if (status !== "active" || isExpired) {
    return redirect(`${appBaseUrl}/link-unavailable`);
  }

  const targetPath = item.targetPath?.S;
  const targetUrl = item.targetUrl?.S;

  if (targetPath?.startsWith("/")) {
    return redirect(`${appBaseUrl}${targetPath}`);
  }

  if (targetUrl && (targetUrl.startsWith(appBaseUrl) || isAllowedAssetUrl(targetUrl, projectAssetsBucketName))) {
    return redirect(targetUrl);
  }

  return redirect(`${appBaseUrl}/link-unavailable`);
}

function isAllowedAssetUrl(targetUrl: string | undefined, projectAssetsBucketName: string) {
  if (!targetUrl || !projectAssetsBucketName) return false;
  try {
    const url = new URL(targetUrl);
    if (url.protocol !== "https:") return false;
    const allowedHosts = new Set([
      `${projectAssetsBucketName}.s3.${process.env.AWS_REGION || "us-east-1"}.amazonaws.com`,
      `${projectAssetsBucketName}.s3.amazonaws.com`,
    ]);
    return allowedHosts.has(url.host) && url.pathname.startsWith("/artwork/");
  } catch {
    return false;
  }
}

function redirect(location: string) {
  return {
    statusCode: 302,
    headers: {
      location,
      "cache-control": "no-store",
    },
    body: "",
  };
}
