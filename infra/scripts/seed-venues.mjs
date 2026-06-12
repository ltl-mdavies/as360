import { BatchWriteItemCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import { marshall } from "@aws-sdk/util-dynamodb";

const STACK_NAME = process.env.STACK_NAME || "Adspace360FoundationStack";
const REGION = process.env.AWS_REGION || "us-east-1";

const cloudFormation = new CloudFormationClient({ region: REGION });
const dynamodb = new DynamoDBClient({ region: REGION });

const MAP_URLS = {
  main: "https://adspace360-c.s3.amazonaws.com/venue_maps/Amtrak%20-%20NY%20Penn%20Station%20Map-ALL%20MEDIA_01.svg",
  hall: "https://adspace360-c.s3.amazonaws.com/venue_maps/Amtrak%20-%20NY%20Penn%20Station%20Map-ALL%20MEDIA_02.svg",
  platA: "https://adspace360-c.s3.amazonaws.com/venue_maps/Amtrak%20-%20NY%20Penn%20Station%20Map-ALL%20MEDIA_03.svg",
  platB: "https://adspace360-c.s3.amazonaws.com/venue_maps/Amtrak%20-%20NY%20Penn%20Station%20Map-ALL%20MEDIA_04.svg",
};

const now = "2026-04-10T12:00:00.000Z";

const customers = [
  {
    entityType: "Customer",
    id: "intersection",
    name: "Intersection",
    status: "active",
    liftCustomerId: "intersection",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  },
];

const markets = [
  {
    entityType: "Market",
    id: "market_intersection_nyc",
    customerId: "intersection",
    customerName: "Intersection",
    name: "New York City",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  },
  {
    entityType: "Market",
    id: "market_intersection_phl",
    customerId: "intersection",
    customerName: "Intersection",
    name: "Philadelphia",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  },
];

const venues = [
  {
    entityType: "Venue",
    id: "venue_penn_station",
    customerId: "intersection",
    customerName: "Intersection",
    marketId: "market_intersection_nyc",
    marketName: "New York City",
    name: "Penn Station",
    isActive: true,
    documentLibraryUrl: "https://drive.google.com/",
    createdAt: now,
    updatedAt: now,
  },
  {
    entityType: "Venue",
    id: "venue_wtc",
    customerId: "intersection",
    customerName: "Intersection",
    marketId: "market_intersection_nyc",
    marketName: "New York City",
    name: "World Trade Center",
    isActive: true,
    documentLibraryUrl: "https://drive.google.com/",
    createdAt: now,
    updatedAt: now,
  },
  {
    entityType: "Venue",
    id: "venue_30th_street",
    customerId: "intersection",
    customerName: "Intersection",
    marketId: "market_intersection_phl",
    marketName: "Philadelphia",
    name: "30th Street Station",
    isActive: true,
    documentLibraryUrl: "https://drive.google.com/",
    createdAt: now,
    updatedAt: now,
  },
];

const roomMaps = [
  {
    entityType: "RoomMap",
    id: "room_penn_track",
    venueId: "venue_penn_station",
    name: "Amtrak Track Level",
    mapAssetName: "Penn-Station-Track-Level.svg",
    mapUrl: MAP_URLS.hall,
    createdAt: now,
    updatedAt: now,
  },
  {
    entityType: "RoomMap",
    id: "room_penn_main",
    venueId: "venue_penn_station",
    name: "Amtrak Main Level",
    mapAssetName: "Penn-Station-Main-Level.svg",
    mapUrl: MAP_URLS.main,
    createdAt: now,
    updatedAt: now,
  },
  {
    entityType: "RoomMap",
    id: "room_penn_hilton",
    venueId: "venue_penn_station",
    name: "Hilton Passageway",
    mapAssetName: "Penn-Station-Hilton-Passageway.svg",
    mapUrl: MAP_URLS.platA,
    createdAt: now,
    updatedAt: now,
  },
  {
    entityType: "RoomMap",
    id: "room_penn_stairs",
    venueId: "venue_penn_station",
    name: "Track Stairs",
    mapAssetName: "Penn-Station-Track-Stairs.svg",
    mapUrl: MAP_URLS.platB,
    createdAt: now,
    updatedAt: now,
  },
  {
    entityType: "RoomMap",
    id: "room_wtc_main",
    venueId: "venue_wtc",
    name: "Main Hall",
    mapAssetName: "WTC-Main-Hall.svg",
    mapUrl: MAP_URLS.main,
    createdAt: now,
    updatedAt: now,
  },
];

const variants = [
  {
    entityType: "MediaVariant",
    id: "variant_penn_2sheet",
    venueId: "venue_penn_station",
    mediaVariantKey: "2-Sheet Poster||46||60",
    label: "2-Sheet Poster · 46\"h × 60\"w",
    mediaType: "2-Sheet Poster",
    color: "#f4c84a",
    abbreviation: "2S",
    unitNumber: "2SHEET_46x60_48PT",
    updatedAt: now,
  },
  {
    entityType: "MediaVariant",
    id: "variant_penn_column_wrap",
    venueId: "venue_penn_station",
    mediaVariantKey: "Column Wrap||63.75||123",
    label: "Column Wrap · 63.75\"h × 123\"w",
    mediaType: "Column Wrap",
    color: "#34d399",
    abbreviation: "CW",
    unitNumber: "CW_63x123",
    updatedAt: now,
  },
  {
    entityType: "MediaVariant",
    id: "variant_penn_stair_riser",
    venueId: "venue_penn_station",
    mediaVariantKey: "Stair Riser||7.5||124",
    label: "Stair Riser · 7.5\"h × 124\"w",
    mediaType: "Stair Riser",
    color: "#a78bfa",
    abbreviation: "SR",
    unitNumber: "SR_75x124",
    updatedAt: now,
  },
  {
    entityType: "MediaVariant",
    id: "variant_penn_rotunda_banner",
    venueId: "venue_penn_station",
    mediaVariantKey: "Rotunda Banner||140||480",
    label: "Rotunda Banner · 140\"h × 480\"w",
    mediaType: "Rotunda Banner",
    color: "#f97316",
    abbreviation: "RB",
    unitNumber: "RB_140x480",
    updatedAt: now,
  },
];

const inventory = [
  makeInventory({
    id: "inventory_ps_2_001",
    venueId: "venue_penn_station",
    locationId: "room_penn_track",
    inventoryId: "PS-2-001",
    mediaVariantKey: "2-Sheet Poster||46||60",
    variantLabel: "2-Sheet Poster · 46\"h × 60\"w",
    mediaType: "2-Sheet Poster",
    unitNumber: "2SHEET_46x60_48PT",
    trimHeight: 46,
    trimWidth: 60,
    safeHeight: 44,
    safeWidth: 58,
    x: 0.18,
    y: 0.24,
  }),
  makeInventory({
    id: "inventory_ps_2_002",
    venueId: "venue_penn_station",
    locationId: "room_penn_track",
    inventoryId: "PS-2-002",
    mediaVariantKey: "2-Sheet Poster||46||60",
    variantLabel: "2-Sheet Poster · 46\"h × 60\"w",
    mediaType: "2-Sheet Poster",
    unitNumber: "2SHEET_46x60_48PT",
    trimHeight: 46,
    trimWidth: 60,
    safeHeight: 44,
    safeWidth: 58,
    x: 0.32,
    y: 0.42,
  }),
  makeInventory({
    id: "inventory_ps_cw_001",
    venueId: "venue_penn_station",
    locationId: "room_penn_main",
    inventoryId: "PS-CW-001",
    mediaVariantKey: "Column Wrap||63.75||123",
    variantLabel: "Column Wrap · 63.75\"h × 123\"w",
    mediaType: "Column Wrap",
    unitNumber: "CW_63x123",
    trimHeight: 63.75,
    trimWidth: 123,
    safeHeight: 61.75,
    safeWidth: 121,
    x: 0.46,
    y: 0.35,
  }),
  makeInventory({
    id: "inventory_ps_cw_002",
    venueId: "venue_penn_station",
    locationId: "room_penn_main",
    inventoryId: "PS-CW-002",
    mediaVariantKey: "Column Wrap||63.75||123",
    variantLabel: "Column Wrap · 63.75\"h × 123\"w",
    mediaType: "Column Wrap",
    unitNumber: "CW_63x123",
    trimHeight: 63.75,
    trimWidth: 123,
    safeHeight: 61.75,
    safeWidth: 121,
    x: null,
    y: null,
  }),
  makeInventory({
    id: "inventory_ps_sr_001",
    venueId: "venue_penn_station",
    locationId: "room_penn_hilton",
    inventoryId: "PS-SR-001",
    mediaVariantKey: "Stair Riser||7.5||124",
    variantLabel: "Stair Riser · 7.5\"h × 124\"w",
    mediaType: "Stair Riser",
    unitNumber: "SR_75x124",
    trimHeight: 7.5,
    trimWidth: 124,
    safeHeight: 6.5,
    safeWidth: 122,
    x: 0.61,
    y: 0.28,
  }),
  makeInventory({
    id: "inventory_ps_rb_001",
    venueId: "venue_penn_station",
    locationId: "room_penn_stairs",
    inventoryId: "PS-RB-001",
    mediaVariantKey: "Rotunda Banner||140||480",
    variantLabel: "Rotunda Banner · 140\"h × 480\"w",
    mediaType: "Rotunda Banner",
    unitNumber: "RB_140x480",
    trimHeight: 140,
    trimWidth: 480,
    safeHeight: 136,
    safeWidth: 476,
    x: 0.82,
    y: 0.74,
  }),
];

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const coreTableName = await getOutput("CoreTableName");
  const auditTableName = await getOutput("AuditTableName");

  const records = [
    ...customers.map(buildCustomerRecord),
    ...markets.map(buildMarketRecord),
    ...venues.map(buildVenueRecord),
    ...roomMaps.map(buildMapRecord),
    ...variants.map(buildVariantRecord),
    ...inventory.map(buildInventoryRecord),
  ];

  await batchWrite(coreTableName, records);
  await batchWrite(auditTableName, [
    {
      projectId: "VENUE_ADMIN#seed",
      eventType: "seed.venues",
      scopeId: "VENUE_ADMIN#seed",
      actorName: "codex",
      createdAt: now,
      detail: {
        customerCount: customers.length,
        marketCount: markets.length,
        venueCount: venues.length,
        mapCount: roomMaps.length,
        variantCount: variants.length,
        inventoryCount: inventory.length,
      },
    },
  ]);

  console.log(
    JSON.stringify(
      {
        ok: true,
        stackName: STACK_NAME,
        coreTableName,
        auditTableName,
        counts: {
          customers: customers.length,
          markets: markets.length,
          venues: venues.length,
          roomMaps: roomMaps.length,
          variants: variants.length,
          inventory: inventory.length,
        },
      },
      null,
      2
    )
  );
}

async function getOutput(key) {
  const response = await cloudFormation.send(new DescribeStacksCommand({ StackName: STACK_NAME }));
  const stack = response.Stacks?.[0];
  const output = stack?.Outputs?.find((item) => item.OutputKey === key)?.OutputValue;
  if (!output) throw new Error(`Missing CloudFormation output: ${key}`);
  return output;
}

async function batchWrite(tableName, records) {
  const chunks = chunk(records, 25);
  for (const batch of chunks) {
    await dynamodb.send(
      new BatchWriteItemCommand({
        RequestItems: {
          [tableName]: batch.map((record) => ({
            PutRequest: {
              Item: marshall(record, { removeUndefinedValues: true }),
            },
          })),
        },
      })
    );
  }
}

function makeInventory(args) {
  return {
    entityType: "InventoryItem",
    venueId: args.venueId,
    id: args.id,
    locationId: args.locationId,
    inventoryId: args.inventoryId,
    mediaVariantKey: args.mediaVariantKey,
    variantLabel: args.variantLabel,
    mediaType: args.mediaType,
    unitNumber: args.unitNumber,
    trimHeight: args.trimHeight ?? null,
    trimWidth: args.trimWidth ?? null,
    safeHeight: args.safeHeight ?? null,
    safeWidth: args.safeWidth ?? null,
    x: args.x,
    y: args.y,
    isActive: true,
    mapVisibilityMode: "show_unavailable",
    createdAt: now,
    updatedAt: now,
  };
}

function buildCustomerRecord(customer) {
  return {
    pk: `CUSTOMER#${customer.id}`,
    sk: "PROFILE",
    gsi1pk: `CUSTOMER#${customer.id}`,
    gsi1sk: "PROFILE",
    gsi2pk: `CUSTOMER#${customer.id}`,
    gsi2sk: "PROFILE",
    ...customer,
  };
}

function buildMarketRecord(market) {
  return {
    pk: `CUSTOMER#${market.customerId}`,
    sk: `MARKET#${market.id}`,
    gsi1pk: `MARKET#${market.id}`,
    gsi1sk: "PROFILE",
    gsi2pk: `CUSTOMER#${market.customerId}`,
    gsi2sk: `MARKET#${market.name}#${market.id}`,
    ...market,
  };
}

function buildVenueRecord(venue) {
  return {
    pk: `VENUE#${venue.id}`,
    sk: "PROFILE",
    gsi1pk: `CUSTOMER#${venue.customerId}`,
    gsi1sk: `VENUE#${venue.name}#${venue.id}`,
    gsi2pk: `MARKET#${venue.marketId}`,
    gsi2sk: `VENUE#${venue.name}#${venue.id}`,
    ...venue,
  };
}

function buildMapRecord(map) {
  return {
    pk: `VENUE#${map.venueId}`,
    sk: `MAP#${map.id}`,
    gsi1pk: `MAP#${map.id}`,
    gsi1sk: `VENUE#${map.venueId}`,
    gsi2pk: `VENUE#${map.venueId}`,
    gsi2sk: `MAP#${map.name}#${map.id}`,
    ...map,
  };
}

function buildVariantRecord(variant) {
  return {
    pk: `VENUE#${variant.venueId}`,
    sk: `VARIANT#${variant.id}`,
    gsi1pk: `VARIANT#${variant.id}`,
    gsi1sk: `VENUE#${variant.venueId}`,
    gsi2pk: `VENUE#${variant.venueId}`,
    gsi2sk: `VARIANT#${variant.label}#${variant.id}`,
    ...variant,
  };
}

function buildInventoryRecord(item) {
  return {
    pk: `VENUE#${item.venueId}`,
    sk: `INVENTORY#${item.id}`,
    gsi1pk: `INVENTORY#${item.id}`,
    gsi1sk: `VENUE#${item.venueId}`,
    gsi2pk: `VENUE#${item.venueId}`,
    gsi2sk: `INVENTORY#${item.inventoryId}#${item.id}`,
    ...item,
  };
}

function chunk(items, size) {
  const batches = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}
