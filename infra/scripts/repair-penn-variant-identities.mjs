import { DeleteItemCommand, DynamoDBClient, PutItemCommand, QueryCommand, ScanCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

const TABLE_NAME = process.env.CORE_TABLE_NAME || "Adspace360FoundationStack-CoreTable97EB8292-1ZR00AD8GF54";
const VENUE_ID = process.env.VENUE_ID || "venue_penn_station";

const client = new DynamoDBClient({});
const now = new Date().toISOString();

function optionalString(value) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function trimDimensionToken(value) {
  return Number.isInteger(value) ? String(value) : String(value).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function mediaNameFromVariantKey(key) {
  const parsed = optionalString(key);
  if (!parsed) return undefined;
  return optionalString(parsed.split("||")[0]);
}

function mediaNameFromVariantLabel(label) {
  const parsed = optionalString(label);
  if (!parsed) return undefined;
  return optionalString(parsed.split(/[•·]/)[0]);
}

function buildVariantIdentity(item) {
  const mediaType =
    optionalString(item.mediaType) ||
    mediaNameFromVariantLabel(item.variantLabel) ||
    mediaNameFromVariantKey(item.mediaVariantKey) ||
    "Custom Variant";

  if (
    typeof item.trimHeight === "number" &&
    Number.isFinite(item.trimHeight) &&
    typeof item.trimWidth === "number" &&
    Number.isFinite(item.trimWidth)
  ) {
    const height = trimDimensionToken(item.trimHeight);
    const width = trimDimensionToken(item.trimWidth);
    return {
      mediaType,
      mediaVariantKey: `${mediaType}||${height}||${width}`,
      variantLabel: `${mediaType} · ${height}"h × ${width}"w`,
    };
  }

  const mediaVariantKey = optionalString(item.mediaVariantKey) || optionalString(item.variantLabel) || mediaType;
  return {
    mediaType,
    mediaVariantKey,
    variantLabel: optionalString(item.variantLabel) || mediaType,
  };
}

function slugify(value) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "variant"
  );
}

function deterministicVariantId(venueId, mediaVariantKey) {
  return `variant_${slugify(venueId.replace(/^venue_/, ""))}_${slugify(mediaVariantKey)}`.slice(0, 120);
}

function guessAbbreviation(mediaType) {
  return mediaType
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("") || "MV";
}

function buildInventoryRecord(item) {
  return {
    ...item,
    pk: `VENUE#${item.venueId}`,
    sk: `INVENTORY#${item.id}`,
    gsi1pk: `INVENTORY#${item.id}`,
    gsi1sk: `VENUE#${item.venueId}`,
    gsi2pk: `VENUE#${item.venueId}`,
    gsi2sk: `INVENTORY#${item.inventoryId}#${item.id}`,
  };
}

function buildVariantRecord(variant) {
  return {
    ...variant,
    pk: `VENUE#${variant.venueId}`,
    sk: `VARIANT#${variant.id}`,
    gsi1pk: `VARIANT#${variant.id}`,
    gsi1sk: `VENUE#${variant.venueId}`,
    gsi2pk: `VENUE#${variant.venueId}`,
    gsi2sk: `VARIANT#${variant.label}#${variant.id}`,
  };
}

function buildProjectCreativeRecord(creative) {
  return {
    ...creative,
    pk: `PROJECT#${creative.projectId}`,
    sk: `CREATIVE#${creative.createdAt}#${creative.id}`,
    gsi1pk: `CREATIVE#${creative.id}`,
    gsi1sk: `PROJECT#${creative.projectId}`,
    gsi2pk: `PROJECT#${creative.projectId}`,
    gsi2sk: `CREATIVE#${creative.createdAt}#${creative.id}`,
  };
}

function buildProjectProofLineRecord(proof) {
  return {
    ...proof,
    pk: `PROJECT#${proof.projectId}`,
    sk: `PROOF#${String(proof.lineNumber).padStart(4, "0")}#${proof.id}`,
    gsi1pk: `PROOF#${proof.id}`,
    gsi1sk: `PROJECT#${proof.projectId}`,
    gsi2pk: `PROJECT#${proof.projectId}`,
    gsi2sk: `PROOF#${String(proof.lineNumber).padStart(4, "0")}#${proof.id}`,
  };
}

async function queryVenueItems() {
  const response = await client.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: marshall({ ":pk": `VENUE#${VENUE_ID}` }),
    })
  );
  return (response.Items || []).map((item) => unmarshall(item));
}

async function queryProjectItems(projectId) {
  const response = await client.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: marshall({ ":pk": `PROJECT#${projectId}` }),
    })
  );
  return (response.Items || []).map((item) => unmarshall(item));
}

async function scanProjectsForVenue() {
  const projects = [];
  let ExclusiveStartKey;
  do {
    const response = await client.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: "entityType = :entityType AND venueId = :venueId",
        ExpressionAttributeValues: marshall({
          ":entityType": "Project",
          ":venueId": VENUE_ID,
        }),
        ExclusiveStartKey,
      })
    );
    projects.push(...(response.Items || []).map((item) => unmarshall(item)));
    ExclusiveStartKey = response.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return projects;
}

async function putRecord(record) {
  await client.send(
    new PutItemCommand({
      TableName: TABLE_NAME,
      Item: marshall(record, { removeUndefinedValues: true }),
    })
  );
}

async function deleteRecord(pk, sk) {
  await client.send(
    new DeleteItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({ pk, sk }),
    })
  );
}

function addKeyMove(map, fromKey, toKey) {
  if (!fromKey || !toKey || fromKey === toKey) return;
  const set = map.get(fromKey) || new Set();
  set.add(toKey);
  map.set(fromKey, set);
}

const venueItems = await queryVenueItems();
const inventory = venueItems.filter((item) => item.entityType === "InventoryItem");
const variants = venueItems.filter((item) => item.entityType === "MediaVariant");
const variantsByKey = new Map(variants.map((variant) => [variant.mediaVariantKey, variant]));
const oldToNewKeys = new Map();
const nextInventory = [];
let updatedInventoryCount = 0;

for (const item of inventory) {
  const identity = buildVariantIdentity(item);
  addKeyMove(oldToNewKeys, item.mediaVariantKey, identity.mediaVariantKey);

  const next = {
    ...item,
    mediaType: identity.mediaType,
    mediaVariantKey: identity.mediaVariantKey,
    variantLabel: identity.variantLabel,
    updatedAt:
      item.mediaType !== identity.mediaType ||
      item.mediaVariantKey !== identity.mediaVariantKey ||
      item.variantLabel !== identity.variantLabel
        ? now
        : item.updatedAt,
  };
  nextInventory.push(next);

  if (next.updatedAt === now) {
    updatedInventoryCount += 1;
    await putRecord(buildInventoryRecord(next));
  }
}

const desiredByKey = new Map();
for (const item of nextInventory) {
  if (!item.mediaVariantKey || desiredByKey.has(item.mediaVariantKey)) continue;
  desiredByKey.set(item.mediaVariantKey, item);
}

const variantsToPut = [];
for (const [mediaVariantKey, item] of desiredByKey.entries()) {
  const existingVariant = variantsByKey.get(mediaVariantKey);
  const oldSourceKey = [...oldToNewKeys.entries()].find(
    ([, mappedKeys]) => mappedKeys.size === 1 && mappedKeys.has(mediaVariantKey)
  )?.[0];
  const oldVariant = oldSourceKey ? variantsByKey.get(oldSourceKey) : undefined;
  const sourceVariant = existingVariant || oldVariant;
  const label = item.variantLabel || item.mediaType || mediaVariantKey;
  variantsToPut.push({
    ...(sourceVariant || {}),
    entityType: "MediaVariant",
    id: existingVariant?.id || oldVariant?.id || deterministicVariantId(VENUE_ID, mediaVariantKey),
    venueId: VENUE_ID,
    mediaVariantKey,
    label,
    mediaType: item.mediaType,
    color: existingVariant?.color || oldVariant?.color,
    abbreviation: existingVariant?.abbreviation || oldVariant?.abbreviation || guessAbbreviation(item.mediaType || mediaVariantKey),
    unitNumber: existingVariant?.unitNumber || oldVariant?.unitNumber || item.unitNumber,
    productionRouting: existingVariant?.productionRouting || oldVariant?.productionRouting,
    externalVendorId: existingVariant?.externalVendorId || oldVariant?.externalVendorId,
    updatedAt: now,
  });
}

const putVariantKeys = new Set(variantsToPut.map((variant) => `VENUE#${VENUE_ID}|VARIANT#${variant.id}`));
let putVariantCount = 0;
for (const variant of variantsToPut) {
  const existing = variantsByKey.get(variant.mediaVariantKey);
  if (
    !existing ||
    existing.label !== variant.label ||
    existing.mediaType !== variant.mediaType ||
    existing.unitNumber !== variant.unitNumber ||
    existing.productionRouting !== variant.productionRouting ||
    existing.externalVendorId !== variant.externalVendorId
  ) {
    putVariantCount += 1;
    await putRecord(buildVariantRecord(variant));
  }
}

let deletedVariantCount = 0;
for (const variant of variants) {
  if (desiredByKey.has(variant.mediaVariantKey)) continue;
  const recordKey = `VENUE#${VENUE_ID}|VARIANT#${variant.id}`;
  if (putVariantKeys.has(recordKey)) continue;
  deletedVariantCount += 1;
  await deleteRecord(`VENUE#${VENUE_ID}`, `VARIANT#${variant.id}`);
}

const singleTargetKeyMoves = new Map(
  [...oldToNewKeys.entries()]
    .filter(([, mappedKeys]) => mappedKeys.size === 1)
    .map(([oldKey, mappedKeys]) => [oldKey, [...mappedKeys][0]])
);
const currentKeysByMediaType = new Map();
for (const [mediaVariantKey, item] of desiredByKey.entries()) {
  const mediaType = item.mediaType || mediaNameFromVariantKey(mediaVariantKey);
  if (!mediaType) continue;
  const keys = currentKeysByMediaType.get(mediaType) || new Set();
  keys.add(mediaVariantKey);
  currentKeysByMediaType.set(mediaType, keys);
}

function resolveSafeProjectKeyMove(mediaVariantKey) {
  const directMove = singleTargetKeyMoves.get(mediaVariantKey);
  if (directMove) return directMove;

  const mediaType = mediaNameFromVariantKey(mediaVariantKey);
  if (!mediaType) return undefined;
  const currentKeys = currentKeysByMediaType.get(mediaType);
  if (!currentKeys || currentKeys.size !== 1) return undefined;
  const [currentKey] = [...currentKeys];
  return currentKey === mediaVariantKey ? undefined : currentKey;
}

const projects = await scanProjectsForVenue();
let updatedCreativeCount = 0;
let updatedProofLineCount = 0;
for (const project of projects) {
  const projectItems = await queryProjectItems(project.id);
  for (const item of projectItems) {
    const nextKey = resolveSafeProjectKeyMove(item.mediaVariantKey);
    if (!nextKey) continue;

    const matchingInventory = desiredByKey.get(nextKey);
    if (item.entityType === "CreativeAsset") {
      updatedCreativeCount += 1;
      await putRecord(
        buildProjectCreativeRecord({
          ...item,
          mediaVariantKey: nextKey,
          updatedAt: now,
        })
      );
    }

    if (item.entityType === "ProjectProofLine") {
      updatedProofLineCount += 1;
      await putRecord(
        buildProjectProofLineRecord({
          ...item,
          mediaVariantKey: nextKey,
          mediaVariantLabel: matchingInventory?.variantLabel || item.mediaVariantLabel,
          productLabel: matchingInventory?.variantLabel || item.productLabel,
          updatedAt: now,
        })
      );
    }
  }
}

console.log(
  JSON.stringify(
    {
      tableName: TABLE_NAME,
      venueId: VENUE_ID,
      updatedInventoryCount,
      putVariantCount,
      deletedVariantCount,
      scannedProjectCount: projects.length,
      updatedCreativeCount,
      updatedProofLineCount,
      keyMoves: Object.fromEntries([...oldToNewKeys.entries()].map(([key, values]) => [key, [...values]])),
    },
    null,
    2
  )
);
