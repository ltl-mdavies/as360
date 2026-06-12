import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";

const dynamo = new DynamoDBClient({});

export async function handler(event: { pathParameters?: Record<string, string | undefined> }) {
  const tableName = process.env.SHORT_LINKS_TABLE_NAME;
  const appBaseUrl = process.env.APP_BASE_URL || "https://app.adspace360.com";
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

  if (targetUrl?.startsWith(appBaseUrl)) {
    return redirect(targetUrl);
  }

  return redirect(`${appBaseUrl}/link-unavailable`);
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

