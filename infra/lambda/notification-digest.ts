import { DeleteItemCommand, DynamoDBClient, QueryCommand, ScanCommand, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { renderDigestMessage, sendNotificationEmail, type NotificationDigestEntry } from "./notification-email.js";

type NotificationDigestItem = {
  entityType: "NotificationDigest";
  id: string;
  customerId: string;
  customerName: string;
  ruleId: string;
  ruleLabel: string;
  recipients: string;
  entries: NotificationDigestEntry[];
  nextSendAt: string;
  createdAt: string;
  updatedAt: string;
  lastAttemptAt?: string;
  lastError?: string;
};

const client = new DynamoDBClient({});
const CORE_TABLE_NAME = process.env.CORE_TABLE_NAME!;
const NOTIFICATIONS_FROM_EMAIL = process.env.NOTIFICATIONS_FROM_EMAIL || "noreply@adspace360.com";
const APP_BASE_URL = process.env.APP_BASE_URL || "https://app.adspace360.com";

export async function handler() {
  const dueDigests = await listDueDigests();
  if (dueDigests.length === 0) {
    return { ok: true, processed: 0 };
  }

  let processed = 0;
  for (const digest of dueDigests) {
    try {
      const rendered = renderDigestMessage({
        customerName: digest.customerName,
        ruleLabel: digest.ruleLabel,
        entries: digest.entries || [],
        ctaLabel: "Open Adspace360",
        ctaUrl: APP_BASE_URL,
      });
      await sendNotificationEmail({
        sender: NOTIFICATIONS_FROM_EMAIL,
        recipients: digest.recipients.split(",").map((entry) => entry.trim()).filter(Boolean),
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      });
      await client.send(
        new DeleteItemCommand({
          TableName: CORE_TABLE_NAME,
          Key: marshall({ pk: `CUSTOMER#${digest.customerId}`, sk: `NOTIFICATION_DIGEST#${digest.ruleId}` }),
        })
      );
      processed += 1;
    } catch (error) {
      console.error("Failed to send notification digest", {
        digestId: digest.id,
        customerId: digest.customerId,
        error,
      });
      await client.send(
        new UpdateItemCommand({
          TableName: CORE_TABLE_NAME,
          Key: marshall({ pk: `CUSTOMER#${digest.customerId}`, sk: `NOTIFICATION_DIGEST#${digest.ruleId}` }),
          UpdateExpression: "SET lastAttemptAt = :lastAttemptAt, lastError = :lastError, updatedAt = :updatedAt",
          ExpressionAttributeValues: marshall({
            ":lastAttemptAt": new Date().toISOString(),
            ":lastError": error instanceof Error ? error.message : "Unknown digest send error",
            ":updatedAt": new Date().toISOString(),
          }),
        })
      );
    }
  }

  return { ok: true, processed };
}

async function listDueDigests() {
  const response = await client.send(
    new ScanCommand({
      TableName: CORE_TABLE_NAME,
      FilterExpression: "#entityType = :entityType",
      ExpressionAttributeNames: { "#entityType": "entityType" },
      ExpressionAttributeValues: marshall({ ":entityType": "NotificationDigest" }),
    })
  );

  const now = Date.now();
  return (response.Items || [])
    .map((item) => unmarshall(item) as NotificationDigestItem)
    .filter((item) => Date.parse(item.nextSendAt) <= now && item.entries?.length);
}
