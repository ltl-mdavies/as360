import {
  DeleteItemCommand,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
} from "@aws-sdk/client-dynamodb";
import { ApiGatewayManagementApiClient, GoneException, PostToConnectionCommand } from "@aws-sdk/client-apigatewaymanagementapi";
import { CognitoIdentityProviderClient, GetUserCommand } from "@aws-sdk/client-cognito-identity-provider";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { createHash } from "node:crypto";

type WorkspaceKind = "assignment" | "proofs";
type ShareAccessType = "collaboration" | "artwork_upload" | "transit_approval" | "view_only";

type WebSocketEvent = {
  requestContext: {
    routeKey: "$connect" | "$disconnect" | "$default" | string;
    connectionId: string;
  };
  body?: string | null;
};

type PresenceRecord = {
  pk: string;
  sk: string;
  gsi1pk: string;
  gsi1sk: string;
  channelKey: string;
  connectionId: string;
  sessionId: string;
  projectId: string;
  workspace: WorkspaceKind;
  actorId: string;
  actorName: string;
  actorType: "user" | "share_participant";
  initials: string;
  color: string;
  joinedAt: string;
  lastSeenAt: string;
  expiresAt: number;
};

type ProjectItem = {
  entityType: "Project";
  id: string;
  customerId: string;
  projectMode?: "live" | "internal_sandbox";
};

type UserProfileItem = {
  entityType: "UserProfile";
  id: string;
  cognitoSub: string;
  email: string;
  displayName: string;
  role: "platform_admin" | "customer_admin";
  customerIds: string[];
  isActive: boolean;
};

type ProjectShareLinkItem = {
  entityType: "ProjectShareLink";
  id: string;
  projectId: string;
  label: string;
  accessType: ShareAccessType;
  status: "active" | "revoked";
  expiresAt?: string | null;
};

type ShareParticipantItem = {
  entityType: "ShareParticipant";
  id: string;
  shareLinkId: string;
  displayName: string;
  email: string;
};

const dynamo = new DynamoDBClient({});
const cognito = new CognitoIdentityProviderClient({});
const CORE_TABLE_NAME = requiredEnv("CORE_TABLE_NAME");
const PRESENCE_TABLE_NAME = requiredEnv("PRESENCE_TABLE_NAME");
const WEBSOCKET_MANAGEMENT_ENDPOINT = requiredEnv("WEBSOCKET_MANAGEMENT_ENDPOINT").replace(/^wss:/, "https:");
const management = new ApiGatewayManagementApiClient({ endpoint: WEBSOCKET_MANAGEMENT_ENDPOINT });
const MIN_HEARTBEAT_INTERVAL_MS = 10_000;

export async function handler(event: WebSocketEvent) {
  try {
    if (event.requestContext.routeKey === "$connect") return response(200);
    if (event.requestContext.routeKey === "$disconnect") {
      await handleDisconnect(event.requestContext.connectionId);
      return response(200);
    }
    await handleMessage(event);
    return response(200);
  } catch (error) {
    emitRealtimeMetric("PresenceMessageFailure", 1, {}, { errorMessage: errorMessage(error) });
    console.warn("Workspace presence message failed", error);
    return response(200);
  }
}

async function handleMessage(event: WebSocketEvent) {
  const body = parseBody(event.body);
  if (body.type === "join") {
    const projectId = optionalString(body.projectId);
    const workspace = optionalWorkspace(body.workspace);
    const sessionId = optionalString(body.sessionId) || event.requestContext.connectionId;
    if (!projectId || !workspace) return;

    let auth: Awaited<ReturnType<typeof authenticatePresence>>;
    try {
      auth = await authenticatePresence(body, projectId, workspace);
    } catch (error) {
      emitRealtimeMetric("PresenceAuthFailure", 1, { Workspace: workspace }, { errorMessage: errorMessage(error) });
      throw error;
    }
    const now = new Date().toISOString();
    const record: PresenceRecord = {
      pk: `CONN#${event.requestContext.connectionId}`,
      sk: "SESSION",
      gsi1pk: channelKey(projectId, workspace),
      gsi1sk: `ACTIVE#${now}#${event.requestContext.connectionId}`,
      channelKey: channelKey(projectId, workspace),
      connectionId: event.requestContext.connectionId,
      sessionId,
      projectId,
      workspace,
      actorId: auth.actorId,
      actorName: auth.actorName,
      actorType: auth.actorType,
      initials: initialsFor(auth.actorName),
      color: colorFor(auth.actorId || auth.actorName),
      joinedAt: now,
      lastSeenAt: now,
      expiresAt: Math.floor(Date.now() / 1000) + 120,
    };
    await putPresence(record);
    emitRealtimeMetric("PresenceJoin", 1, { Workspace: workspace, ActorType: auth.actorType });
    await broadcastSnapshot(projectId, workspace);
    return;
  }

  if (body.type === "heartbeat") {
    const record = await getPresence(event.requestContext.connectionId);
    if (!record) return;
    const nowMs = Date.now();
    const lastSeenMs = Date.parse(record.lastSeenAt);
    if (Number.isFinite(lastSeenMs) && nowMs - lastSeenMs < MIN_HEARTBEAT_INTERVAL_MS) {
      emitRealtimeMetric("PresenceHeartbeatThrottled", 1, { Workspace: record.workspace });
      return;
    }
    record.lastSeenAt = new Date(nowMs).toISOString();
    record.gsi1sk = `ACTIVE#${record.lastSeenAt}#${record.connectionId}`;
    record.expiresAt = Math.floor(nowMs / 1000) + 120;
    await putPresence(record);
    emitRealtimeMetric("PresenceHeartbeat", 1, { Workspace: record.workspace });
  }
}

async function handleDisconnect(connectionId: string) {
  const record = await getPresence(connectionId);
  await dynamo.send(new DeleteItemCommand({
    TableName: PRESENCE_TABLE_NAME,
    Key: marshall({ pk: `CONN#${connectionId}`, sk: "SESSION" }),
  }));
  if (record) {
    emitRealtimeMetric("PresenceDisconnect", 1, { Workspace: record.workspace });
    await broadcastSnapshot(record.projectId, record.workspace);
  }
}

async function authenticatePresence(body: Record<string, unknown>, projectId: string, workspace: WorkspaceKind) {
  const accessToken = optionalString(body.accessToken);
  const shareToken = optionalString(body.shareToken);
  if (accessToken) {
    const user = await cognito.send(new GetUserCommand({ AccessToken: accessToken }));
    const sub = user.UserAttributes?.find((attribute) => attribute.Name === "sub")?.Value || user.Username || "";
    const email = user.UserAttributes?.find((attribute) => attribute.Name === "email")?.Value || "";
    const profile = (sub ? await findUserProfileBySub(sub) : null) || (email ? await findUserProfileByEmail(email) : null);
    if (!profile?.isActive) throw new Error("User is not active");
    const project = await findProjectById(projectId);
    if (!project) throw new Error("Project not found");
    const canAccess = project.projectMode === "internal_sandbox"
      ? profile.role === "platform_admin"
      : profile.role === "platform_admin" || (profile.customerIds || []).includes(project.customerId);
    if (!canAccess) throw new Error("User cannot access project");
    return {
      actorId: profile.id,
      actorName: profile.displayName || profile.email,
      actorType: "user" as const,
    };
  }

  if (shareToken) {
    const shareLink = await findShareLinkByToken(shareToken);
    if (!shareLink || shareLink.projectId !== projectId) throw new Error("Invalid share link");
    if (shareLink.status !== "active") throw new Error("Share link revoked");
    if (shareLink.expiresAt && new Date(shareLink.expiresAt).getTime() < Date.now()) throw new Error("Share link expired");
    if (!canViewShareWorkspace(shareLink.accessType, workspace)) throw new Error("Share link cannot view workspace");
    const participantId = optionalString(body.shareParticipantId);
    const participant = participantId ? await findShareParticipantById(shareLink.id, participantId) : null;
    return {
      actorId: participant?.id || shareLink.id,
      actorName: participant?.displayName || (shareLink.accessType === "view_only" ? "Shared viewer" : "Shared collaborator"),
      actorType: "share_participant" as const,
    };
  }

  throw new Error("Presence auth missing");
}

async function broadcastSnapshot(projectId: string, workspace: WorkspaceKind) {
  const records = await listPresence(projectId, workspace);
  const participantsBySession = new Map<string, PresenceRecord>();
  for (const record of records) {
    const existing = participantsBySession.get(record.sessionId);
    if (!existing || existing.lastSeenAt < record.lastSeenAt) participantsBySession.set(record.sessionId, record);
  }
  const participants = Array.from(participantsBySession.values()).map((record) => ({
    sessionId: record.sessionId,
    actorId: record.actorId,
    actorName: record.actorName,
    actorType: record.actorType,
    initials: record.initials,
    color: record.color,
    joinedAt: record.joinedAt,
    lastSeenAt: record.lastSeenAt,
  }));
  const payload = JSON.stringify({
    type: "presence.snapshot",
    projectId,
    workspace,
    participants,
  });
  emitRealtimeMetric("PresenceSnapshotFanout", records.length, { Workspace: workspace });
  await Promise.allSettled(records.map((record) => postToConnection(record.connectionId, payload)));
}

async function postToConnection(connectionId: string, payload: string) {
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
      emitRealtimeMetric("PresenceStaleConnectionDeleted", 1);
    }
  }
}

async function putPresence(record: PresenceRecord) {
  await dynamo.send(new PutItemCommand({
    TableName: PRESENCE_TABLE_NAME,
    Item: marshall(record, { removeUndefinedValues: true }),
  }));
}

async function getPresence(connectionId: string) {
  const response = await dynamo.send(new GetItemCommand({
    TableName: PRESENCE_TABLE_NAME,
    Key: marshall({ pk: `CONN#${connectionId}`, sk: "SESSION" }),
  }));
  return response.Item ? unmarshall(response.Item) as PresenceRecord : null;
}

async function listPresence(projectId: string, workspace: WorkspaceKind) {
  const now = Math.floor(Date.now() / 1000);
  const response = await dynamo.send(new QueryCommand({
    TableName: PRESENCE_TABLE_NAME,
    IndexName: "byChannel",
    KeyConditionExpression: "gsi1pk = :gsi1pk",
    FilterExpression: "expiresAt > :now",
    ExpressionAttributeValues: marshall({
      ":gsi1pk": channelKey(projectId, workspace),
      ":now": now,
    }),
    Limit: 100,
  }));
  if (response.LastEvaluatedKey) emitRealtimeMetric("PresenceFanoutCapped", 1, { Workspace: workspace });
  return (response.Items || []).map((item) => unmarshall(item) as PresenceRecord);
}

async function findProjectById(projectId: string) {
  const items = await queryCoreByPk(`PROJECT#${projectId}`);
  return items.find((item): item is ProjectItem => item.entityType === "Project") || null;
}

async function findUserProfileBySub(cognitoSub: string) {
  const items = await queryCoreByPk(`USER#${cognitoSub}`);
  return items.find((item): item is UserProfileItem => item.entityType === "UserProfile") || null;
}

async function findUserProfileByEmail(email: string) {
  const items = await queryCoreGsi1(`USER_EMAIL#${email.toLowerCase()}`);
  return items.find((item): item is UserProfileItem => item.entityType === "UserProfile") || null;
}

async function findShareLinkByToken(token: string) {
  const items = await queryCoreGsi2(`SHARETOKEN#${createHash("sha256").update(token).digest("hex")}`);
  return items.find((item): item is ProjectShareLinkItem => item.entityType === "ProjectShareLink") || null;
}

async function findShareParticipantById(shareLinkId: string, participantId: string) {
  const items = await queryCoreByPk(`SHARELINK#${shareLinkId}`, "PARTICIPANT#");
  return items.find((item): item is ShareParticipantItem => item.entityType === "ShareParticipant" && item.id === participantId) || null;
}

async function queryCoreByPk(pk: string, skPrefix?: string) {
  const response = await dynamo.send(new QueryCommand({
    TableName: CORE_TABLE_NAME,
    KeyConditionExpression: skPrefix ? "pk = :pk AND begins_with(sk, :skPrefix)" : "pk = :pk",
    ExpressionAttributeValues: marshall(skPrefix ? { ":pk": pk, ":skPrefix": skPrefix } : { ":pk": pk }),
  }));
  return (response.Items || []).map((item) => unmarshall(item) as Record<string, any>);
}

async function queryCoreGsi1(gsi1pk: string) {
  const response = await dynamo.send(new QueryCommand({
    TableName: CORE_TABLE_NAME,
    IndexName: "gsi1",
    KeyConditionExpression: "gsi1pk = :gsi1pk",
    ExpressionAttributeValues: marshall({ ":gsi1pk": gsi1pk }),
  }));
  return (response.Items || []).map((item) => unmarshall(item) as Record<string, any>);
}

async function queryCoreGsi2(gsi2pk: string) {
  const response = await dynamo.send(new QueryCommand({
    TableName: CORE_TABLE_NAME,
    IndexName: "gsi2",
    KeyConditionExpression: "gsi2pk = :gsi2pk",
    ExpressionAttributeValues: marshall({ ":gsi2pk": gsi2pk }),
  }));
  return (response.Items || []).map((item) => unmarshall(item) as Record<string, any>);
}

function canViewShareWorkspace(accessType: ShareAccessType, workspace: WorkspaceKind) {
  if (accessType === "collaboration" || accessType === "view_only") return workspace === "assignment" || workspace === "proofs";
  return false;
}

function channelKey(projectId: string, workspace: WorkspaceKind) {
  return `CHANNEL#${projectId}#${workspace}`;
}

function parseBody(body?: string | null): Record<string, unknown> {
  if (!body) return {};
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function optionalWorkspace(value: unknown): WorkspaceKind | "" {
  return value === "assignment" || value === "proofs" ? value : "";
}

function initialsFor(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "AD";
  return words.slice(0, 2).map((word) => word[0]?.toUpperCase()).join("");
}

function colorFor(seed: string) {
  const colors = ["#2bbf73", "#3f6ed8", "#dc5598", "#f97316", "#7c3aed", "#0ea5e9", "#14b8a6"];
  const hash = createHash("sha256").update(seed).digest();
  return colors[hash[0] % colors.length];
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function response(statusCode: number) {
  return { statusCode };
}
