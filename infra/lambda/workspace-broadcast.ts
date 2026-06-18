import {
  DeleteItemCommand,
  DynamoDBClient,
  QueryCommand,
} from "@aws-sdk/client-dynamodb";
import { ApiGatewayManagementApiClient, GoneException, PostToConnectionCommand } from "@aws-sdk/client-apigatewaymanagementapi";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

type WorkspaceKind = "assignment" | "proofs";

type SqsEvent = {
  Records: Array<{
    messageId: string;
    body: string;
  }>;
};

type WorkspaceChangeMessage = {
  projectId: string;
  workspace: WorkspaceKind;
  eventType: string;
  summary: string;
  actorId: string;
  actorName: string;
  actorType: "user" | "share_participant";
  originSessionId?: string | null;
  occurredAt: string;
  detail?: Record<string, unknown>;
};

type PresenceRecord = {
  connectionId: string;
};

const dynamo = new DynamoDBClient({});
const PRESENCE_TABLE_NAME = requiredEnv("PRESENCE_TABLE_NAME");
const WEBSOCKET_MANAGEMENT_ENDPOINT = requiredEnv("WEBSOCKET_MANAGEMENT_ENDPOINT").replace(/^wss:/, "https:");
const management = new ApiGatewayManagementApiClient({ endpoint: WEBSOCKET_MANAGEMENT_ENDPOINT });

export async function handler(event: SqsEvent) {
  const batchItemFailures: Array<{ itemIdentifier: string }> = [];

  await Promise.all(event.Records.map(async (record) => {
    try {
      await handleRecord(record.body);
    } catch (error) {
      batchItemFailures.push({ itemIdentifier: record.messageId });
      emitRealtimeMetric("WorkspaceBroadcastRecordFailure", 1, {}, { errorMessage: errorMessage(error) });
      console.warn("Workspace broadcast record failed", error);
    }
  }));

  return { batchItemFailures };
}

async function handleRecord(body: string) {
  const change = parseChange(body);
  if (!change) return;

  const records = await listPresenceConnections(change.projectId, change.workspace);
  const payload = JSON.stringify({
    type: "workspace.change",
    ...change,
    originSessionId: change.originSessionId || null,
    detail: change.detail || {},
  });

  emitRealtimeMetric("WorkspaceBroadcastProcessed", 1, { Workspace: change.workspace, EventType: change.eventType });
  emitRealtimeMetric("WorkspaceBroadcastFanout", records.length, { Workspace: change.workspace });
  await Promise.allSettled(records.map((record) => postToConnection(record.connectionId, payload, change.workspace)));
}

async function listPresenceConnections(projectId: string, workspace: WorkspaceKind) {
  const response = await dynamo.send(new QueryCommand({
    TableName: PRESENCE_TABLE_NAME,
    IndexName: "byChannel",
    KeyConditionExpression: "gsi1pk = :gsi1pk",
    FilterExpression: "expiresAt > :now",
    ExpressionAttributeValues: marshall({
      ":gsi1pk": `CHANNEL#${projectId}#${workspace}`,
      ":now": Math.floor(Date.now() / 1000),
    }),
    Limit: 100,
  }));
  if (response.LastEvaluatedKey) emitRealtimeMetric("WorkspaceBroadcastFanoutCapped", 1, { Workspace: workspace });
  return (response.Items || []).map((item) => unmarshall(item) as PresenceRecord);
}

async function postToConnection(connectionId: string, payload: string, workspace: WorkspaceKind) {
  try {
    await management.send(new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: Buffer.from(payload),
    }));
  } catch (error) {
    if (error instanceof GoneException || (error as any)?.$metadata?.httpStatusCode === 410) {
      await dynamo.send(new DeleteItemCommand({
        TableName: PRESENCE_TABLE_NAME,
        Key: marshall({ pk: `CONN#${connectionId}`, sk: "SESSION" }),
      }));
      emitRealtimeMetric("WorkspaceBroadcastStaleConnection", 1, { Workspace: workspace });
      return;
    }
    emitRealtimeMetric("WorkspaceBroadcastPostFailure", 1, { Workspace: workspace }, { errorMessage: errorMessage(error) });
    throw error;
  }
}

function parseChange(body: string): WorkspaceChangeMessage | null {
  const parsed = JSON.parse(body) as Partial<WorkspaceChangeMessage>;
  if (!parsed.projectId || (parsed.workspace !== "assignment" && parsed.workspace !== "proofs")) return null;
  if (!parsed.eventType || !parsed.summary || !parsed.actorId || !parsed.actorName || !parsed.actorType || !parsed.occurredAt) return null;
  return {
    projectId: parsed.projectId,
    workspace: parsed.workspace,
    eventType: parsed.eventType,
    summary: parsed.summary,
    actorId: parsed.actorId,
    actorName: parsed.actorName,
    actorType: parsed.actorType,
    originSessionId: parsed.originSessionId || null,
    occurredAt: parsed.occurredAt,
    detail: parsed.detail || {},
  };
}

function emitRealtimeMetric(
  metricName: string,
  value = 1,
  dimensions: Record<string, string> = {},
  properties: Record<string, unknown> = {}
) {
  const dimensionKeys = Object.keys(dimensions);
  console.log(JSON.stringify({
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [
        {
          Namespace: "Adspace360/Realtime",
          Dimensions: [dimensionKeys],
          Metrics: [{ Name: metricName, Unit: "Count" }],
        },
      ],
    },
    ...dimensions,
    ...properties,
    [metricName]: value,
  }));
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
