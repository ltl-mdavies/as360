import {
  BatchWriteItemCommand,
  DeleteItemCommand,
  DynamoDBClient,
  PutItemCommand,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE" | "OPTIONS";
type CustomerStatus = "active" | "suspended" | "inactive";

type ApiEvent = {
  rawPath?: string;
  routeKey?: string;
  body?: string | null;
  isBase64Encoded?: boolean;
  headers?: Record<string, string | undefined>;
  requestContext?: {
    http?: {
      method?: string;
      path?: string;
    };
    authorizer?: {
      jwt?: {
        claims?: Record<string, string | undefined>;
      };
    };
  };
  pathParameters?: Record<string, string | undefined>;
  queryStringParameters?: Record<string, string | undefined>;
};

type CustomerItem = {
  entityType: "Customer";
  id: string;
  name: string;
  status?: CustomerStatus;
  isActive: boolean;
  isInternalSandbox?: boolean;
  liftCustomerId?: string;
  logoBucketName?: string;
  logoObjectKey?: string;
  logoContentType?: string;
  createdAt: string;
  updatedAt: string;
};

type MarketItem = {
  entityType: "Market";
  id: string;
  customerId: string;
  customerName: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

type VenueItem = {
  entityType: "Venue";
  id: string;
  customerId: string;
  customerName: string;
  marketId: string;
  marketName: string;
  name: string;
  isActive: boolean;
  documentSourceMode?: "adspace" | "external" | "hybrid";
  documentLibraryUrl: string;
  createdAt: string;
  updatedAt: string;
};

type RoomMapItem = {
  entityType: "RoomMap";
  id: string;
  venueId: string;
  name: string;
  sortOrder?: number;
  mapAssetName?: string;
  mapUrl?: string;
  createdAt: string;
  updatedAt: string;
};

type MediaVariantItem = {
  entityType: "MediaVariant";
  id: string;
  venueId: string;
  mediaVariantKey: string;
  label: string;
  mediaType?: string;
  color?: string;
  abbreviation?: string;
  unitNumber?: string;
  productionRouting?: "primary" | "external";
  externalVendorId?: string;
  updatedAt: string;
};

type CustomerVendorItem = {
  entityType: "CustomerVendor";
  id: string;
  customerId: string;
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  notes?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  updatedByName: string;
};

type InventoryItem = {
  entityType: "InventoryItem";
  id: string;
  venueId: string;
  locationId: string;
  inventoryId: string;
  mapName?: string;
  mediaVariantKey: string;
  variantLabel: string;
  mediaType?: string;
  unitNumber?: string;
  x?: number | null;
  y?: number | null;
  isActive: boolean;
  mapVisibilityMode?: "hidden" | "show_unavailable";
  trimHeight?: number | null;
  trimWidth?: number | null;
  safeHeight?: number | null;
  safeWidth?: number | null;
  substrate?: string;
  finishing?: string;
  locationDetail?: string;
  notes?: string;
  dpi?: number | null;
  bleedTop?: number | null;
  bleedRight?: number | null;
  bleedBottom?: number | null;
  bleedLeft?: number | null;
  createdAt: string;
  updatedAt: string;
};

type VenueInventoryPresetItem = {
  entityType: "VenueInventoryPreset";
  id: string;
  venueId: string;
  name: string;
  description?: string;
  includedIds: string[];
  knownInventoryIds: string[];
  status: "active" | "archived";
  createdAt: string;
  createdByName: string;
  updatedAt: string;
  updatedByName: string;
  archivedAt?: string | null;
  archivedByName?: string | null;
};

type UserRole = "platform_admin" | "customer_admin";

type UserProfileItem = {
  entityType: "UserProfile";
  id: string;
  cognitoSub: string;
  email: string;
  displayName: string;
  role: UserRole;
  customerIds: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

type AuthContext = {
  profile: UserProfileItem;
  actorName: string;
  isPlatformAdmin: boolean;
  customerIds: Set<string>;
};

type LocalCacheEntry<T> = {
  value: T;
  expiresAt: number;
};

type AuditEvent = {
  eventType: string;
  scopeId: string;
  actorName: string;
  createdAt: string;
  detail: Record<string, unknown>;
};

type ProjectSummaryItem = {
  entityType: "Project";
  id: string;
  customerId: string;
  customerName: string;
  updatedAt: string;
  [key: string]: unknown;
};

type InventoryImportPayload = {
  items?: Array<{
    id?: string;
    inventoryId?: string;
    locationId?: string;
    mapName?: string;
    mediaVariantKey?: string;
    variantLabel?: string;
    mediaType?: string;
    unitNumber?: string;
    x?: number | null;
    y?: number | null;
    isActive?: boolean;
    mapVisibilityMode?: "hidden" | "show_unavailable";
    trimHeight?: number | null;
    trimWidth?: number | null;
    safeHeight?: number | null;
    safeWidth?: number | null;
    substrate?: string;
    finishing?: string;
    locationDetail?: string;
    notes?: string;
    dpi?: number | null;
    bleedTop?: number | null;
    bleedRight?: number | null;
    bleedBottom?: number | null;
    bleedLeft?: number | null;
    color?: string;
    abbreviation?: string;
  }>;
  replaceExisting?: boolean;
};

const client = new DynamoDBClient({});
const s3 = new S3Client({});
const CORE_TABLE_NAME = requiredEnv("CORE_TABLE_NAME");
const AUDIT_TABLE_NAME = requiredEnv("AUDIT_TABLE_NAME");
const VENUE_ASSETS_BUCKET_NAME = process.env.VENUE_ASSETS_BUCKET_NAME || "";
const INTERNAL_SANDBOX_CUSTOMER_ID = "ltl_demo";
const INTERNAL_SANDBOX_CUSTOMER_NAME = "LTL Demo";
const INTERNAL_SANDBOX_LIFT_CUSTOMER_ID = "1249";
const SHORT_CACHE_TTL_MS = 30_000;
const USER_CACHE_TTL_MS = 60_000;

const userProfileBySubCache = new Map<string, LocalCacheEntry<UserProfileItem | null>>();
const userProfileByEmailCache = new Map<string, LocalCacheEntry<UserProfileItem | null>>();
const entityScanCache = new Map<string, LocalCacheEntry<Array<Record<string, any>>>>();
const customerByIdCache = new Map<string, LocalCacheEntry<CustomerItem | null>>();
const customerByNameCache = new Map<string, LocalCacheEntry<CustomerItem | null>>();
const customerListResponseCache = new Map<string, LocalCacheEntry<unknown[]>>();
const venueDetailResponseCache = new Map<string, LocalCacheEntry<Record<string, unknown>>>();

let responsePerfContext: { routeKey: string; startedAt: number } | null = null;

export async function handler(event: ApiEvent) {
  const method = (event.requestContext?.http?.method || event.routeKey?.split(" ")[0] || "UNKNOWN") as HttpMethod | "UNKNOWN";
  const routeKey = event.routeKey || `${method} ${event.rawPath || event.requestContext?.http?.path || ""}`;
  responsePerfContext = { routeKey, startedAt: Date.now() };

  try {
    if (method === "OPTIONS") return noContent();
    const auth = await requireAuthContext(event);

    switch (routeKey) {
      case "GET /api/customers":
        return ok({ customers: await listCustomers(auth, isLiteRequest(event)) });
      case "POST /api/customers":
        return created({ customer: await createCustomer(getBody(event), auth) });
      case "GET /api/customers/{customerId}/markets":
        return ok({ markets: await listMarketsForCustomer(requirePath(event, "customerId"), auth) });
      case "PATCH /api/customers/{customerId}":
        return ok({ customer: await updateCustomer(requirePath(event, "customerId"), getBody(event), auth) });
      case "GET /api/venues":
        return ok({ venues: await listVenues(event.queryStringParameters?.customerId, auth, isLiteRequest(event)) });
      case "GET /api/venues/{venueId}":
        return ok(await getVenueDetail(requirePath(event, "venueId"), auth));
      case "POST /api/markets":
        return created({ market: await createMarket(getBody(event), auth) });
      case "PATCH /api/markets/{marketId}":
        return ok({ market: await updateMarket(requirePath(event, "marketId"), getBody(event), auth) });
      case "POST /api/venues":
        return created({ venue: await createVenue(getBody(event), auth) });
      case "PATCH /api/venues/{venueId}":
        return ok({ venue: await updateVenue(requirePath(event, "venueId"), getBody(event), auth) });
      case "POST /api/venues/{venueId}/inventory-presets":
        return created({
          preset: await createVenueInventoryPreset(requirePath(event, "venueId"), getBody(event), auth),
        });
      case "PATCH /api/venues/{venueId}/inventory-presets/{presetId}":
        return ok({
          preset: await updateVenueInventoryPreset(
            requirePath(event, "venueId"),
            requirePath(event, "presetId"),
            getBody(event),
            auth
          ),
        });
      case "DELETE /api/venues/{venueId}/inventory-presets/{presetId}":
        return ok({
          preset: await archiveVenueInventoryPreset(
            requirePath(event, "venueId"),
            requirePath(event, "presetId"),
            auth
          ),
        });
      case "POST /api/venues/{venueId}/maps":
        return created({ map: await createMap(requirePath(event, "venueId"), getBody(event), auth) });
      case "PATCH /api/venues/{venueId}/maps/{mapId}":
        return ok({
          map: await updateMap(requirePath(event, "venueId"), requirePath(event, "mapId"), getBody(event), auth),
        });
      case "PATCH /api/venues/{venueId}/variants/{variantId}":
        return ok({
          variant: await updateVariant(requirePath(event, "venueId"), requirePath(event, "variantId"), getBody(event), auth),
        });
      case "DELETE /api/venues/{venueId}/maps/{mapId}":
        return ok({
          ok: await deleteMap(requirePath(event, "venueId"), requirePath(event, "mapId"), auth),
        });
      case "POST /api/venues/{venueId}/inventory/import":
        return ok(await importInventory(requirePath(event, "venueId"), getBody<InventoryImportPayload>(event), auth));
      case "PATCH /api/inventory/{inventoryItemId}":
        return ok({
          inventoryItem: await updateInventory(requirePath(event, "inventoryItemId"), getBody(event), auth),
        });
      case "DELETE /api/inventory/{inventoryItemId}":
        return ok({
          ok: await deleteInventory(requirePath(event, "inventoryItemId"), auth),
        });
      case "PATCH /api/inventory/{inventoryItemId}/placement":
        return ok({
          inventoryItem: await updateInventoryPlacement(requirePath(event, "inventoryItemId"), getBody(event), auth),
        });
      default:
        return json(404, {
          error: "Route not found",
          routeKey,
          pathParameters: event.pathParameters || {},
          queryStringParameters: event.queryStringParameters || {},
        });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected venue API error";
    const statusCode =
      error instanceof HttpError
        ? error.statusCode
        : message.toLowerCase().includes("not found")
          ? 404
          : message.toLowerCase().includes("required") || message.toLowerCase().includes("invalid")
            ? 400
            : 500;

    return json(statusCode, {
      error: message,
      routeKey,
    });
  } finally {
    if (responsePerfContext) {
      logPerf("route", responsePerfContext.startedAt, { routeKey: responsePerfContext.routeKey });
    }
    responsePerfContext = null;
  }
}

async function listCustomers(auth: AuthContext, lite = false) {
  const cacheKey = `customers:${lite ? "lite" : "full"}:${authScopeCacheKey(auth)}`;
  const cached = readLocalCache(customerListResponseCache.get(cacheKey));
  if (cached.hit) return cached.value;

  await ensureInternalSandboxCustomer("System");
  const customerRecords = await scanByEntityType("Customer");
  const visibleCustomers = customerRecords
    .filter((item): item is CustomerItem => item.entityType === "Customer")
    .filter((customer) => hasCustomerAccess(auth, customer.id))
    .filter((customer) => auth.isPlatformAdmin || customerStatus(customer) !== "inactive")
    .sort((a, b) => a.name.localeCompare(b.name));

  if (lite) {
    const response = visibleCustomers.map((customer) => ({
      id: customer.id,
      name: customer.name,
      status: customerStatus(customer),
      isActive: customerStatus(customer) === "active",
      isInternalSandbox: customer.isInternalSandbox === true,
      liftCustomerId: customer.liftCustomerId,
    }));
    customerListResponseCache.set(cacheKey, makeLocalCacheEntry(response, SHORT_CACHE_TTL_MS));
    return response;
  }

  const [customers, markets, venues, projects] = await Promise.all([
    Promise.resolve(visibleCustomers),
    scanByEntityType("Market"),
    scanByEntityType("Venue"),
    scanByEntityType("Project"),
  ]);

  const marketCountByCustomerId = new Map<string, number>();
  const venueCountByCustomerId = new Map<string, number>();
  const projectCountByCustomerId = new Map<string, number>();

  for (const market of markets.filter((item): item is MarketItem => item.entityType === "Market")) {
    marketCountByCustomerId.set(market.customerId, (marketCountByCustomerId.get(market.customerId) || 0) + 1);
  }

  for (const venue of venues.filter((item): item is VenueItem => item.entityType === "Venue")) {
    venueCountByCustomerId.set(venue.customerId, (venueCountByCustomerId.get(venue.customerId) || 0) + 1);
  }

  for (const project of projects.filter((item): item is ProjectSummaryItem => item.entityType === "Project")) {
    projectCountByCustomerId.set(project.customerId, (projectCountByCustomerId.get(project.customerId) || 0) + 1);
  }

  const response = await Promise.all(
    customers
      .filter((item): item is CustomerItem => item.entityType === "Customer")
      .filter((customer) => hasCustomerAccess(auth, customer.id))
      .filter((customer) => auth.isPlatformAdmin || customerStatus(customer) !== "inactive")
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(async (customer) => ({
        ...customer,
        status: customerStatus(customer),
        isActive: customerStatus(customer) === "active",
        logoUrl: await signCustomerLogoUrl(customer),
        marketCount: marketCountByCustomerId.get(customer.id) || 0,
        venueCount: venueCountByCustomerId.get(customer.id) || 0,
        projectCount: projectCountByCustomerId.get(customer.id) || 0,
      }))
  );
  customerListResponseCache.set(cacheKey, makeLocalCacheEntry(response, SHORT_CACHE_TTL_MS));
  return response;
}

async function createCustomer(payload: Record<string, unknown>, auth: AuthContext) {
  assertPlatformAdmin(auth);

  const id = requiredString(payload, "id").trim();
  const name = requiredString(payload, "name").trim();
  if (!/^[a-z0-9_:-]+$/i.test(id)) {
    throw new HttpError(400, "Customer id may only contain letters, numbers, underscores, colons, and dashes");
  }

  const existingById = await findCustomerById(id);
  if (existingById) {
    throw new HttpError(409, `Customer ${id} already exists`);
  }

  const existingByName = await findCustomerByName(name);
  if (existingByName) {
    throw new HttpError(409, `Customer ${name} already exists`);
  }

  const now = isoNow();
  const status = optionalCustomerStatus(payload.status) ?? (optionalBoolean(payload.isActive) === false ? "inactive" : "active");
  const customer: CustomerItem = {
    entityType: "Customer",
    id,
    name,
    status,
    isActive: status === "active",
    isInternalSandbox: optionalBoolean(payload.isInternalSandbox) ?? false,
    liftCustomerId: optionalString(payload.liftCustomerId) || undefined,
    logoBucketName: optionalString(payload.logoBucketName) || undefined,
    logoObjectKey: optionalString(payload.logoObjectKey) || undefined,
    logoContentType: optionalString(payload.logoContentType) || undefined,
    createdAt: now,
    updatedAt: now,
  };

  await putCore(buildCustomerRecord(customer));
  await writeAudit(`ADMIN_SETTINGS#CUSTOMER#${customer.id}`, "customer.created", auth.actorName, {
    customerId: customer.id,
    name: customer.name,
    liftCustomerId: customer.liftCustomerId || null,
    logoObjectKey: customer.logoObjectKey || null,
    status: customerStatus(customer),
    isActive: customer.isActive,
    isInternalSandbox: customer.isInternalSandbox === true,
  });

  return {
    ...customer,
    status: customerStatus(customer),
    isActive: customerStatus(customer) === "active",
    logoUrl: await signCustomerLogoUrl(customer),
    marketCount: 0,
    venueCount: 0,
    projectCount: 0,
  };
}

async function updateCustomer(customerId: string, payload: Record<string, unknown>, auth: AuthContext) {
  assertPlatformAdmin(auth);
  const existing = await findCustomerById(customerId);
  if (!existing) throw new HttpError(404, `Customer ${customerId} not found`);

  const nextName = hasOwn(payload, "name") ? requiredString(payload, "name").trim() : existing.name;
  if (normalizeText(nextName) !== normalizeText(existing.name)) {
    const collision = await findCustomerByName(nextName);
    if (collision && collision.id !== customerId) {
      throw new HttpError(409, `Customer ${nextName} already exists`);
    }
  }

  const nextStatus = hasOwn(payload, "status")
    ? requiredCustomerStatus(payload, "status")
    : hasOwn(payload, "isActive")
      ? optionalBoolean(payload.isActive) === false
        ? "inactive"
        : "active"
      : customerStatus(existing);

  const next: CustomerItem = {
    ...existing,
    name: nextName,
    status: nextStatus,
    isActive: nextStatus === "active",
    isInternalSandbox:
      hasOwn(payload, "isInternalSandbox") ? optionalBoolean(payload.isInternalSandbox) ?? false : existing.isInternalSandbox,
    liftCustomerId: hasOwn(payload, "liftCustomerId") ? optionalString(payload.liftCustomerId) || undefined : existing.liftCustomerId,
    logoBucketName:
      hasOwn(payload, "logoBucketName")
        ? optionalString(payload.logoBucketName) || undefined
        : existing.logoBucketName,
    logoObjectKey:
      hasOwn(payload, "logoObjectKey")
        ? optionalString(payload.logoObjectKey) || undefined
        : existing.logoObjectKey,
    logoContentType:
      hasOwn(payload, "logoContentType")
        ? optionalString(payload.logoContentType) || undefined
        : existing.logoContentType,
    updatedAt: isoNow(),
  };

  await putCore(buildCustomerRecord(next));

  if (next.name !== existing.name) {
    await syncCustomerNameReferences(customerId, next.name);
  }

  await writeAudit(`ADMIN_SETTINGS#CUSTOMER#${customerId}`, "customer.updated", auth.actorName, {
    customerId,
    previousName: existing.name,
    nextName: next.name,
    status: customerStatus(next),
    isActive: next.isActive,
    liftCustomerId: next.liftCustomerId || null,
    logoObjectKey: next.logoObjectKey || null,
    isInternalSandbox: next.isInternalSandbox === true,
  });

  const [markets, venues, projects] = await Promise.all([
    listMarketsForCustomer(customerId, auth),
    listVenues(customerId, auth),
    listProjectsForCustomer(customerId),
  ]);

  return {
    ...next,
    status: customerStatus(next),
    isActive: customerStatus(next) === "active",
    logoUrl: await signCustomerLogoUrl(next),
    marketCount: markets.length,
    venueCount: venues.length,
    projectCount: projects.length,
  };
}

async function listMarketsForCustomer(customerId: string, auth: AuthContext) {
  assertCustomerAccess(auth, customerId);
  const customer = await findCustomerById(customerId);
  if (!customer) throw new HttpError(404, `Customer ${customerId} not found`);
  assertCustomerReadable(auth, customer);
  const items = await queryByPk(`CUSTOMER#${customerId}`, "MARKET#");
  const venues = await listVenues(customerId, auth);
  const venueCountByMarketId = new Map<string, number>();

  for (const venue of venues) {
    venueCountByMarketId.set(venue.marketId, (venueCountByMarketId.get(venue.marketId) || 0) + 1);
  }

  return items
    .filter((item): item is MarketItem => item.entityType === "Market")
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((market) => ({
      ...market,
      venueCount: venueCountByMarketId.get(market.id) || 0,
    }));
}

async function listVenues(customerId: string | undefined, auth: AuthContext, lite = false) {
  if (customerId) {
    assertCustomerAccess(auth, customerId);
    const customer = await findCustomerById(customerId);
    if (!customer) throw new HttpError(404, `Customer ${customerId} not found`);
    assertCustomerReadable(auth, customer);
  }

  const items = customerId
    ? await queryByGsi1(`CUSTOMER#${customerId}`, "VENUE#")
    : auth.isPlatformAdmin
      ? await scanByEntityType("Venue")
      : (
          await Promise.all(Array.from(auth.customerIds).map((id) => queryByGsi1(`CUSTOMER#${id}`, "VENUE#")))
        ).flat();

  const rawVenues = items
    .filter((item): item is VenueItem => item.entityType === "Venue")
    .filter((venue) => hasCustomerAccess(auth, venue.customerId))
    .sort((a, b) => a.name.localeCompare(b.name));

  const venues = auth.isPlatformAdmin
    ? rawVenues
    : (
        await Promise.all(
          rawVenues.map(async (venue) => ({
            venue,
            customer: await findCustomerById(venue.customerId),
          }))
        )
      )
        .filter(({ customer }) => !customer || customerStatus(customer) !== "inactive")
        .map(({ venue }) => venue);

  if (lite) {
    return venues.map((venue) => ({
      id: venue.id,
      customerId: venue.customerId,
      customerName: venue.customerName,
      marketId: venue.marketId,
      marketName: venue.marketName,
      name: venue.name,
      isActive: venue.isActive,
      documentSourceMode: normalizeDocumentSourceMode(venue.documentSourceMode, venue.documentLibraryUrl),
      documentLibraryUrl: venue.documentLibraryUrl,
      createdAt: venue.createdAt,
      updatedAt: venue.updatedAt,
      roomCount: 0,
      inventoryCount: 0,
      unpinnedCount: 0,
    }));
  }

  const summaries = await Promise.all(
    venues.map(async (venue) => {
      const detailItems = await queryByPk(`VENUE#${venue.id}`);
      const maps = detailItems.filter((item): item is RoomMapItem => item.entityType === "RoomMap");
      const inventory = detailItems.filter((item): item is InventoryItem => item.entityType === "InventoryItem");
      return {
        venueId: venue.id,
        rooms: maps.length,
        inventory: inventory.length,
        unpinned: inventory.filter((item) => item.x == null || item.y == null).length,
      };
    })
  );

  const summariesByVenueId = new Map(summaries.map((summary) => [summary.venueId, summary]));

  return venues.map((venue) => {
    const summary = summariesByVenueId.get(venue.id);
    return {
      ...venue,
      roomCount: summary?.rooms || 0,
      inventoryCount: summary?.inventory || 0,
      unpinnedCount: summary?.unpinned || 0,
    };
  });
}

async function getVenueDetail(venueId: string, auth: AuthContext) {
  const startedAt = Date.now();
  const cacheKey = `venue-detail:${venueId}:${authScopeCacheKey(auth)}`;
  const cached = readLocalCache(venueDetailResponseCache.get(cacheKey));
  if (cached.hit) {
    logPerf("getVenueDetail.cacheHit", startedAt, { venueId });
    return cached.value;
  }

  const items = await queryByPk(`VENUE#${venueId}`);
  const venue = items.find((item): item is VenueItem => item.entityType === "Venue");
  if (!venue) throw new HttpError(404, `Venue ${venueId} not found`);
  assertCustomerAccess(auth, venue.customerId);
  const customer = await findCustomerById(venue.customerId);
  if (!customer) throw new HttpError(404, `Customer ${venue.customerId} not found`);
  assertCustomerReadable(auth, customer);

  const maps = items
    .filter((item): item is RoomMapItem => item.entityType === "RoomMap")
    .sort((a, b) => (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name));
  const variants = items
    .filter((item): item is MediaVariantItem => item.entityType === "MediaVariant")
    .sort((a, b) => a.label.localeCompare(b.label));
  const inventory = items
    .filter((item): item is InventoryItem => item.entityType === "InventoryItem")
    .sort((a, b) => a.inventoryId.localeCompare(b.inventoryId));
  const presets = items
    .filter((item): item is VenueInventoryPresetItem => item.entityType === "VenueInventoryPreset")
    .filter((preset) => preset.status !== "archived")
    .sort((a, b) => a.name.localeCompare(b.name));

  const inventoryByLocation = new Map<string, InventoryItem[]>();
  for (const item of inventory) {
    const current = inventoryByLocation.get(item.locationId) || [];
    current.push(item);
    inventoryByLocation.set(item.locationId, current);
  }

  const mapSummaries = maps.map((map) => {
    const mapInventory = inventoryByLocation.get(map.id) || [];
    const unpinnedCount = mapInventory.filter((item) => item.x == null || item.y == null).length;
    return {
      ...map,
      inventoryCount: mapInventory.length,
      unpinnedCount,
    };
  });

  const response = {
    venue,
    maps: mapSummaries,
    variants,
    inventory,
    presets: buildVenuePresetResponses(venueId, inventory, presets),
    summary: {
      rooms: mapSummaries.length,
      inventory: inventory.length,
      unpinned: inventory.filter((item) => item.x == null || item.y == null).length,
      importProfiles: 0,
    },
  };
  venueDetailResponseCache.set(cacheKey, makeLocalCacheEntry(response, SHORT_CACHE_TTL_MS));
  logPerf("getVenueDetail", startedAt, {
    venueId,
    mapCount: maps.length,
    variantCount: variants.length,
    inventoryCount: inventory.length,
  });
  return response;
}

async function createMarket(payload: Record<string, unknown>, auth: AuthContext) {
  const customerName = requiredString(payload, "customerName");
  const customer = await resolveExistingCustomer({
    customerId: optionalString(payload.customerId),
    customerName,
  });
  assertCustomerAccess(auth, customer.id);
  assertCustomerMutable(auth, customer, "create markets");

  const marketName = requiredString(payload, "name");
  const existingMarkets = await listMarketsForCustomer(customer.id, auth);
  if (existingMarkets.some((market) => normalizeText(market.name) === normalizeText(marketName))) {
    throw new HttpError(409, `Market "${marketName}" already exists for ${customer.name}`);
  }

  const now = isoNow();
  const market: MarketItem = {
    entityType: "Market",
    id: optionalString(payload.id) || makeId("market", customer.id, marketName),
    customerId: customer.id,
    customerName: customer.name,
    name: marketName,
    isActive: optionalBoolean(payload.isActive) ?? true,
    createdAt: now,
    updatedAt: now,
  };

  await putCore(buildMarketRecord(market));
  await writeAudit(`VENUE_ADMIN#${customer.id}`, "market.created", auth.actorName, {
    marketId: market.id,
    name: market.name,
    customerId: customer.id,
  });

  return { ...market, venueCount: 0 };
}

async function updateMarket(marketId: string, payload: Record<string, unknown>, auth: AuthContext) {
  const existing = await findMarketById(marketId);
  if (!existing) throw new HttpError(404, `Market ${marketId} not found`);
  assertCustomerAccess(auth, existing.customerId);
  const customer = await findCustomerById(existing.customerId);
  if (!customer) throw new HttpError(404, `Customer ${existing.customerId} not found`);
  assertCustomerMutable(auth, customer, "update markets");

  const next: MarketItem = {
    ...existing,
    name: optionalString(payload.name) || existing.name,
    isActive: optionalBoolean(payload.isActive) ?? existing.isActive,
    updatedAt: isoNow(),
  };

  await putCore(buildMarketRecord(next));
  await writeAudit(`VENUE_ADMIN#${existing.customerId}`, "market.updated", auth.actorName, {
    marketId,
    changes: payload,
  });

  const venues = await listVenues(existing.customerId, auth);
  const venueCount = venues.filter((venue) => venue.marketId === marketId).length;
  return { ...next, venueCount };
}

async function createVenue(payload: Record<string, unknown>, auth: AuthContext) {
  const customerName = requiredString(payload, "customerName");
  const customer = await resolveExistingCustomer({
    customerId: optionalString(payload.customerId),
    customerName,
  });
  assertCustomerAccess(auth, customer.id);
  assertCustomerMutable(auth, customer, "create venues");

  const marketId = requiredString(payload, "marketId");
  const market = await findMarketById(marketId);
  if (!market || market.customerId !== customer.id) {
    throw new HttpError(400, `Market ${marketId} is not available for ${customer.name}`);
  }

  const venueName = requiredString(payload, "name");
  const existingVenues = await listVenues(customer.id, auth);
  const duplicate = existingVenues.find(
    (venue) => venue.marketId === market.id && normalizeText(venue.name) === normalizeText(venueName)
  );
  if (duplicate) throw new HttpError(409, `Venue "${venueName}" already exists in ${market.name}`);

  const now = isoNow();
  const venue: VenueItem = {
    entityType: "Venue",
    id: optionalString(payload.id) || makeId("venue", customer.id, market.id, venueName),
    customerId: customer.id,
    customerName: customer.name,
    marketId: market.id,
    marketName: market.name,
    name: venueName,
    isActive: optionalBoolean(payload.isActive) ?? true,
    documentSourceMode: normalizeDocumentSourceMode(optionalString(payload.documentSourceMode), optionalString(payload.documentLibraryUrl)),
    documentLibraryUrl: optionalString(payload.documentLibraryUrl) || "",
    createdAt: now,
    updatedAt: now,
  };

  await putCore(buildVenueRecord(venue));
  await writeAudit(`VENUE_ADMIN#${venue.id}`, "venue.created", auth.actorName, {
    venueId: venue.id,
    customerId: venue.customerId,
    marketId: venue.marketId,
  });

  return venue;
}

async function updateVenue(venueId: string, payload: Record<string, unknown>, auth: AuthContext) {
  const existing = await findVenueById(venueId);
  if (!existing) throw new HttpError(404, `Venue ${venueId} not found`);
  assertCustomerAccess(auth, existing.customerId);

  let market = existing.marketId ? await findMarketById(existing.marketId) : null;
  const nextMarketId = optionalString(payload.marketId);
  if (nextMarketId && nextMarketId !== existing.marketId) {
    const resolved = await findMarketById(nextMarketId);
    if (!resolved) throw new HttpError(400, `Market ${nextMarketId} not found`);
    market = resolved;
  }

  const customer = await findCustomerById(market?.customerId || existing.customerId);
  if (!customer) throw new HttpError(404, `Customer ${(market?.customerId || existing.customerId)} not found`);
  assertCustomerMutable(auth, customer, "update venues");

  const next: VenueItem = {
    ...existing,
    name: optionalString(payload.name) || existing.name,
    customerId: market?.customerId || existing.customerId,
    customerName: market?.customerName || existing.customerName,
    marketId: market?.id || existing.marketId,
    marketName: market?.name || existing.marketName,
    documentSourceMode: normalizeDocumentSourceMode(
      optionalString(payload.documentSourceMode) ?? existing.documentSourceMode,
      hasOwn(payload, "documentLibraryUrl") ? optionalString(payload.documentLibraryUrl) : existing.documentLibraryUrl
    ),
    documentLibraryUrl: hasOwn(payload, "documentLibraryUrl") ? optionalString(payload.documentLibraryUrl) || "" : existing.documentLibraryUrl,
    isActive: optionalBoolean(payload.isActive) ?? existing.isActive,
    updatedAt: isoNow(),
  };

  await putCore(buildVenueRecord(next));
  venueDetailResponseCache.delete(`venue-detail:${venueId}:${authScopeCacheKey(auth)}`);
  await writeAudit(`VENUE_ADMIN#${venueId}`, "venue.updated", auth.actorName, {
    venueId,
    changes: payload,
  });

  return next;
}

function normalizeDocumentSourceMode(value: unknown, documentLibraryUrl?: string | null): "adspace" | "external" | "hybrid" {
  const normalized = (optionalString(value) || "").toLowerCase();
  if (normalized === "external" || normalized === "hybrid" || normalized === "adspace") {
    return normalized;
  }
  return optionalString(documentLibraryUrl) ? "hybrid" : "adspace";
}

async function createVenueInventoryPreset(venueId: string, payload: Record<string, unknown>, auth: AuthContext) {
  const venue = await findVenueById(venueId);
  if (!venue) throw new HttpError(404, `Venue ${venueId} not found`);
  assertCustomerAccess(auth, venue.customerId);
  const customer = await findCustomerById(venue.customerId);
  if (!customer) throw new HttpError(404, `Customer ${venue.customerId} not found`);
  assertCustomerMutable(auth, customer, "manage venue inventory presets");

  const name = requiredString(payload, "name");
  if (normalizeText(name) === "full venue") {
    throw new HttpError(400, "Full Venue is the default preset and cannot be recreated.");
  }

  const venueItems = await queryByPk(`VENUE#${venueId}`);
  const inventory = venueItems.filter((item): item is InventoryItem => item.entityType === "InventoryItem");
  const duplicate = venueItems
    .filter((item): item is VenueInventoryPresetItem => item.entityType === "VenueInventoryPreset")
    .filter((preset) => preset.status !== "archived")
    .some((preset) => normalizeText(preset.name) === normalizeText(name));
  if (duplicate) throw new HttpError(409, `Preset "${name}" already exists for this venue.`);

  const activeInventoryIds = inventory.filter((item) => item.isActive).map((item) => item.id).sort();
  const includedIds = validatePresetIncludedIds(payload.includedIds, inventory);
  if (!includedIds.length) throw new HttpError(400, "A preset must include at least one active inventory item.");

  const now = isoNow();
  const preset: VenueInventoryPresetItem = {
    entityType: "VenueInventoryPreset",
    id: optionalString(payload.id) || makeId("preset", venueId, name),
    venueId,
    name,
    description: optionalString(payload.description),
    includedIds,
    knownInventoryIds: activeInventoryIds,
    status: "active",
    createdAt: now,
    createdByName: auth.actorName,
    updatedAt: now,
    updatedByName: auth.actorName,
  };

  await putCore(buildVenueInventoryPresetRecord(preset));
  venueDetailResponseCache.delete(`venue-detail:${venueId}:${authScopeCacheKey(auth)}`);
  await writeAudit(`VENUE_ADMIN#${venueId}`, "inventory_preset.created", auth.actorName, {
    venueId,
    presetId: preset.id,
    name: preset.name,
    includedCount: includedIds.length,
  });

  return buildVenuePresetResponse(preset, inventory);
}

async function updateVenueInventoryPreset(venueId: string, presetId: string, payload: Record<string, unknown>, auth: AuthContext) {
  if (presetId === "full_venue") throw new HttpError(400, "Full Venue is read-only.");
  const venue = await findVenueById(venueId);
  if (!venue) throw new HttpError(404, `Venue ${venueId} not found`);
  assertCustomerAccess(auth, venue.customerId);
  const customer = await findCustomerById(venue.customerId);
  if (!customer) throw new HttpError(404, `Customer ${venue.customerId} not found`);
  assertCustomerMutable(auth, customer, "manage venue inventory presets");

  const venueItems = await queryByPk(`VENUE#${venueId}`);
  const existing = venueItems.find(
    (item): item is VenueInventoryPresetItem =>
      item.entityType === "VenueInventoryPreset" && item.id === presetId && item.status !== "archived"
  );
  if (!existing) throw new HttpError(404, `Preset ${presetId} not found for venue ${venueId}`);

  const inventory = venueItems.filter((item): item is InventoryItem => item.entityType === "InventoryItem");
  const nextName = hasOwn(payload, "name") ? requiredString(payload, "name") : existing.name;
  const duplicate = venueItems
    .filter((item): item is VenueInventoryPresetItem => item.entityType === "VenueInventoryPreset")
    .filter((preset) => preset.status !== "archived" && preset.id !== existing.id)
    .some((preset) => normalizeText(preset.name) === normalizeText(nextName));
  if (duplicate) throw new HttpError(409, `Preset "${nextName}" already exists for this venue.`);

  const nextIncludedIds = hasOwn(payload, "includedIds")
    ? validatePresetIncludedIds(payload.includedIds, inventory)
    : existing.includedIds;
  if (!nextIncludedIds.length) throw new HttpError(400, "A preset must include at least one active inventory item.");

  const next: VenueInventoryPresetItem = {
    ...existing,
    name: nextName,
    description: hasOwn(payload, "description") ? optionalString(payload.description) : existing.description,
    includedIds: nextIncludedIds,
    knownInventoryIds: inventory.filter((item) => item.isActive).map((item) => item.id).sort(),
    updatedAt: isoNow(),
    updatedByName: auth.actorName,
  };

  await putCore(buildVenueInventoryPresetRecord(next));
  venueDetailResponseCache.delete(`venue-detail:${venueId}:${authScopeCacheKey(auth)}`);
  await writeAudit(`VENUE_ADMIN#${venueId}`, "inventory_preset.updated", auth.actorName, {
    venueId,
    presetId,
    name: next.name,
    includedCount: nextIncludedIds.length,
  });

  return buildVenuePresetResponse(next, inventory);
}

async function archiveVenueInventoryPreset(venueId: string, presetId: string, auth: AuthContext) {
  if (presetId === "full_venue") throw new HttpError(400, "Full Venue is read-only.");
  const venue = await findVenueById(venueId);
  if (!venue) throw new HttpError(404, `Venue ${venueId} not found`);
  assertCustomerAccess(auth, venue.customerId);
  const customer = await findCustomerById(venue.customerId);
  if (!customer) throw new HttpError(404, `Customer ${venue.customerId} not found`);
  assertCustomerMutable(auth, customer, "manage venue inventory presets");

  const venueItems = await queryByPk(`VENUE#${venueId}`);
  const existing = venueItems.find(
    (item): item is VenueInventoryPresetItem =>
      item.entityType === "VenueInventoryPreset" && item.id === presetId && item.status !== "archived"
  );
  if (!existing) throw new HttpError(404, `Preset ${presetId} not found for venue ${venueId}`);

  const now = isoNow();
  const next: VenueInventoryPresetItem = {
    ...existing,
    status: "archived",
    archivedAt: now,
    archivedByName: auth.actorName,
    updatedAt: now,
    updatedByName: auth.actorName,
  };

  await putCore(buildVenueInventoryPresetRecord(next));
  venueDetailResponseCache.delete(`venue-detail:${venueId}:${authScopeCacheKey(auth)}`);
  await writeAudit(`VENUE_ADMIN#${venueId}`, "inventory_preset.archived", auth.actorName, {
    venueId,
    presetId,
    name: existing.name,
  });

  return buildVenuePresetResponse(next, venueItems.filter((item): item is InventoryItem => item.entityType === "InventoryItem"));
}

function validatePresetIncludedIds(value: unknown, inventory: InventoryItem[]) {
  if (!Array.isArray(value)) throw new HttpError(400, "includedIds is required");
  const currentActiveIds = new Set(inventory.filter((item) => item.isActive).map((item) => item.id));
  const displayIdToRecordId = new Map(inventory.map((item) => [item.inventoryId, item.id]));
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => displayIdToRecordId.get(item) || item)
        .filter((id) => currentActiveIds.has(id))
    )
  ).sort();
}

function buildVenuePresetResponses(venueId: string, inventory: InventoryItem[], presets: VenueInventoryPresetItem[]) {
  const activeIds = inventory.filter((item) => item.isActive).map((item) => item.id).sort();
  const now = isoNow();
  return [
    buildVenuePresetResponse(
      {
        entityType: "VenueInventoryPreset",
        id: "full_venue",
        venueId,
        name: "Full Venue",
        description: "All active inventory for this venue.",
        includedIds: activeIds,
        knownInventoryIds: activeIds,
        status: "active",
        createdAt: now,
        createdByName: "System",
        updatedAt: now,
        updatedByName: "System",
      },
      inventory,
      true
    ),
    ...presets.map((preset) => buildVenuePresetResponse(preset, inventory)),
  ];
}

function buildVenuePresetResponse(preset: VenueInventoryPresetItem, inventory: InventoryItem[], isDefault = false) {
  const currentActiveIds = new Set(inventory.filter((item) => item.isActive).map((item) => item.id));
  const includedSet = new Set(preset.includedIds);
  const knownSet = new Set(preset.knownInventoryIds || []);
  const effectiveIncludedIds = preset.includedIds.filter((id) => currentActiveIds.has(id)).sort();
  const unavailableIncludedIds = preset.includedIds.filter((id) => !currentActiveIds.has(id)).sort();
  const newActiveInventoryIds = Array.from(currentActiveIds).filter((id) => !knownSet.has(id)).sort();
  const excludedActiveCount = Array.from(currentActiveIds).filter((id) => !includedSet.has(id)).length;

  return {
    id: preset.id,
    venueId: preset.venueId,
    name: preset.name,
    description: preset.description || "",
    includedIds: effectiveIncludedIds,
    rawIncludedIds: preset.includedIds,
    status: preset.status,
    isDefault,
    readOnly: isDefault,
    createdAt: preset.createdAt,
    createdByName: preset.createdByName,
    updatedAt: preset.updatedAt,
    updatedByName: preset.updatedByName,
    validation: {
      activeInventoryCount: currentActiveIds.size,
      includedActiveCount: effectiveIncludedIds.length,
      excludedActiveCount,
      unavailableIncludedCount: unavailableIncludedIds.length,
      unavailableIncludedIds,
      newActiveCount: isDefault ? 0 : newActiveInventoryIds.length,
      newActiveInventoryIds: isDefault ? [] : newActiveInventoryIds,
    },
  };
}

async function createMap(venueId: string, payload: Record<string, unknown>, auth: AuthContext) {
  const venue = await findVenueById(venueId);
  if (!venue) throw new HttpError(404, `Venue ${venueId} not found`);
  assertCustomerAccess(auth, venue.customerId);
  const customer = await findCustomerById(venue.customerId);
  if (!customer) throw new HttpError(404, `Customer ${venue.customerId} not found`);
  assertCustomerMutable(auth, customer, "manage venue maps");

  const venueItems = await queryByPk(`VENUE#${venueId}`);
  const existingMaps = venueItems.filter((item): item is RoomMapItem => item.entityType === "RoomMap");
  const now = isoNow();
  const map: RoomMapItem = {
    entityType: "RoomMap",
    id: optionalString(payload.id) || makeId("map", venueId, requiredString(payload, "name")),
    venueId,
    name: requiredString(payload, "name"),
    sortOrder: numberOrUndefined(payload.sortOrder, existingMaps.length) ?? existingMaps.length,
    mapAssetName: optionalString(payload.mapAssetName),
    mapUrl: optionalString(payload.mapUrl),
    createdAt: now,
    updatedAt: now,
  };

  await putCore(buildMapRecord(map));
  await writeAudit(`VENUE_ADMIN#${venueId}`, "map.created", auth.actorName, {
    venueId,
    mapId: map.id,
    name: map.name,
  });

  return map;
}

async function updateMap(venueId: string, mapId: string, payload: Record<string, unknown>, auth: AuthContext) {
  const existing = await findMapById(venueId, mapId);
  if (!existing) throw new HttpError(404, `Map ${mapId} not found for venue ${venueId}`);
  const venue = await findVenueById(venueId);
  if (!venue) throw new HttpError(404, `Venue ${venueId} not found`);
  assertCustomerAccess(auth, venue.customerId);
  const customer = await findCustomerById(venue.customerId);
  if (!customer) throw new HttpError(404, `Customer ${venue.customerId} not found`);
  assertCustomerMutable(auth, customer, "manage venue maps");

  const next: RoomMapItem = {
    ...existing,
    name: optionalString(payload.name) || existing.name,
    sortOrder: numberOrUndefined(payload.sortOrder, existing.sortOrder) ?? existing.sortOrder,
    mapAssetName: optionalString(payload.mapAssetName) ?? existing.mapAssetName,
    mapUrl: optionalString(payload.mapUrl) ?? existing.mapUrl,
    updatedAt: isoNow(),
  };

  await putCore(buildMapRecord(next));
  await writeAudit(`VENUE_ADMIN#${venueId}`, "map.updated", auth.actorName, {
    venueId,
    mapId,
    changes: payload,
  });

  return next;
}

async function deleteMap(venueId: string, mapId: string, auth: AuthContext) {
  const existing = await findMapById(venueId, mapId);
  if (!existing) throw new HttpError(404, `Map ${mapId} not found for venue ${venueId}`);
  const venue = await findVenueById(venueId);
  if (!venue) throw new HttpError(404, `Venue ${venueId} not found`);
  assertCustomerAccess(auth, venue.customerId);
  const customer = await findCustomerById(venue.customerId);
  if (!customer) throw new HttpError(404, `Customer ${venue.customerId} not found`);
  assertCustomerMutable(auth, customer, "manage venue maps");

  await client.send(
    new DeleteItemCommand({
      TableName: CORE_TABLE_NAME,
      Key: marshall({ pk: `VENUE#${venueId}`, sk: `MAP#${mapId}` }),
    })
  );

  await writeAudit(`VENUE_ADMIN#${venueId}`, "map.deleted", auth.actorName, {
    venueId,
    mapId,
  });

  return true;
}

async function updateVariant(venueId: string, variantId: string, payload: Record<string, unknown>, auth: AuthContext) {
  const existing = await findVariantById(venueId, variantId);
  if (!existing) throw new HttpError(404, `Variant ${variantId} not found for venue ${venueId}`);
  const venue = await findVenueById(venueId);
  if (!venue) throw new HttpError(404, `Venue ${venueId} not found`);
  assertCustomerAccess(auth, venue.customerId);
  const customer = await findCustomerById(venue.customerId);
  if (!customer) throw new HttpError(404, `Customer ${venue.customerId} not found`);
  assertCustomerMutable(auth, customer, "manage media variants");

  const nextRouting = optionalVariantRouting(payload.productionRouting) ?? existing.productionRouting ?? "primary";
  const nextExternalVendorId =
    hasOwn(payload, "externalVendorId")
      ? optionalString(payload.externalVendorId) || undefined
      : existing.externalVendorId;

  if (nextRouting === "external") {
    if (!nextExternalVendorId) {
      throw new HttpError(400, "An external vendor is required when production routing is set to external");
    }
    const vendor = await findCustomerVendor(venue.customerId, nextExternalVendorId);
    if (!vendor || !vendor.isActive) {
      throw new HttpError(400, `External vendor ${nextExternalVendorId} is not available for this customer`);
    }
  }

  const next: MediaVariantItem = {
    ...existing,
    label: optionalString(payload.label) || existing.label,
    mediaType: optionalString(payload.mediaType) ?? existing.mediaType,
    color: optionalString(payload.color) ?? existing.color,
    abbreviation: hasOwn(payload, "abbreviation") ? optionalString(payload.abbreviation) : existing.abbreviation,
    unitNumber: hasOwn(payload, "unitNumber") ? optionalString(payload.unitNumber) : existing.unitNumber,
    productionRouting: nextRouting,
    externalVendorId: nextRouting === "external" ? nextExternalVendorId : undefined,
    updatedAt: isoNow(),
  };

  await putCore(buildVariantRecord(next));
  await writeAudit(`VENUE_ADMIN#${venueId}`, "variant.updated", auth.actorName, {
    venueId,
    variantId,
    changes: payload,
  });

  return next;
}

async function importInventory(venueId: string, payload: InventoryImportPayload, auth: AuthContext) {
  const venue = await findVenueById(venueId);
  if (!venue) throw new HttpError(404, `Venue ${venueId} not found`);
  assertCustomerAccess(auth, venue.customerId);
  const customer = await findCustomerById(venue.customerId);
  if (!customer) throw new HttpError(404, `Customer ${venue.customerId} not found`);
  assertCustomerMutable(auth, customer, "import inventory");

  const items = payload.items || [];
  if (!items.length) throw new HttpError(400, "items is required");

  const venueItems = await queryByPk(`VENUE#${venueId}`);
  const maps = venueItems.filter((item): item is RoomMapItem => item.entityType === "RoomMap");
  const mapById = new Map(maps.map((map) => [map.id, map]));
  const mapByName = new Map(maps.map((map) => [normalizeText(map.name), map]));

  const existingInventory = venueItems.filter((item): item is InventoryItem => item.entityType === "InventoryItem");
  const existingVariants = venueItems.filter((item): item is MediaVariantItem => item.entityType === "MediaVariant");

  if (payload.replaceExisting) {
    await deleteMany([
      ...existingInventory.map((item) => ({ pk: `VENUE#${venueId}`, sk: `INVENTORY#${item.id}` })),
      ...existingVariants.map((item) => ({ pk: `VENUE#${venueId}`, sk: `VARIANT#${item.id}` })),
    ]);
  }

  const now = isoNow();
  const inventoryRecords: InventoryItem[] = [];
  const variantsByKey = new Map<string, MediaVariantItem>();

  for (const [index, raw] of items.entries()) {
    const resolvedMap =
      (raw.locationId ? mapById.get(raw.locationId) : undefined) ||
      (raw.mapName ? mapByName.get(normalizeText(raw.mapName)) : undefined);

    if (!resolvedMap) {
      throw new HttpError(400, `Inventory row ${index + 1} references an unknown map`);
    }

    const mediaVariantKey = raw.mediaVariantKey || raw.variantLabel || raw.mediaType || "custom_variant";
    const variantLabel = raw.variantLabel || raw.mediaType || mediaVariantKey;
    const inventoryId = raw.inventoryId || raw.id || `INV-${Date.now()}-${index + 1}`;
    const itemId = raw.id || makeId("inventory", venueId, inventoryId);

    const nextItem: InventoryItem = {
      entityType: "InventoryItem",
      id: itemId,
      venueId,
      locationId: resolvedMap.id,
      inventoryId,
      mapName: resolvedMap.name,
      mediaVariantKey,
      variantLabel,
      mediaType: raw.mediaType,
      unitNumber: raw.unitNumber,
      x: typeof raw.x === "number" ? raw.x : null,
      y: typeof raw.y === "number" ? raw.y : null,
      isActive: raw.isActive ?? true,
      mapVisibilityMode: raw.mapVisibilityMode || "hidden",
      trimHeight: numberOrNull(raw.trimHeight),
      trimWidth: numberOrNull(raw.trimWidth),
      safeHeight: numberOrNull(raw.safeHeight),
      safeWidth: numberOrNull(raw.safeWidth),
      substrate: raw.substrate,
      finishing: raw.finishing,
      locationDetail: raw.locationDetail,
      notes: raw.notes,
      dpi: numberOrNull(raw.dpi),
      bleedTop: numberOrNull(raw.bleedTop),
      bleedRight: numberOrNull(raw.bleedRight),
      bleedBottom: numberOrNull(raw.bleedBottom),
      bleedLeft: numberOrNull(raw.bleedLeft),
      createdAt: now,
      updatedAt: now,
    };
    inventoryRecords.push(nextItem);

    if (!variantsByKey.has(mediaVariantKey)) {
      variantsByKey.set(mediaVariantKey, {
        entityType: "MediaVariant",
        id: makeId("variant", venueId, mediaVariantKey),
        venueId,
        mediaVariantKey,
        label: variantLabel,
        mediaType: raw.mediaType,
        color: raw.color,
        abbreviation: raw.abbreviation,
        unitNumber: raw.unitNumber,
        productionRouting: "primary",
        externalVendorId: undefined,
        updatedAt: now,
      });
    }
  }

  await putMany([
    ...inventoryRecords.map((item) => buildInventoryRecord(item)),
    ...Array.from(variantsByKey.values()).map((item) => buildVariantRecord(item)),
  ]);

  await writeAudit(`VENUE_ADMIN#${venueId}`, "inventory.imported", auth.actorName, {
    venueId,
    importedCount: inventoryRecords.length,
    replaceExisting: Boolean(payload.replaceExisting),
  });

  return {
    importedCount: inventoryRecords.length,
    variantCount: variantsByKey.size,
    replaceExisting: Boolean(payload.replaceExisting),
  };
}

async function updateInventory(inventoryItemId: string, payload: Record<string, unknown>, auth: AuthContext) {
  const existing = await findInventoryById(inventoryItemId);
  if (!existing) throw new HttpError(404, `Inventory item ${inventoryItemId} not found`);
  const venue = await findVenueById(existing.venueId);
  if (!venue) throw new HttpError(404, `Venue ${existing.venueId} not found`);
  assertCustomerAccess(auth, venue.customerId);
  const customer = await findCustomerById(venue.customerId);
  if (!customer) throw new HttpError(404, `Customer ${venue.customerId} not found`);
  assertCustomerMutable(auth, customer, "update inventory");
  const venueItems = await queryByPk(`VENUE#${existing.venueId}`);

  const nextMapId = optionalString(payload.locationId);
  let nextMapName = existing.mapName;

  if (nextMapId && nextMapId !== existing.locationId) {
    const map = await findMapById(existing.venueId, nextMapId);
    if (!map) throw new HttpError(400, `Map ${nextMapId} not found`);
    nextMapName = map.name;
  }

  const next: InventoryItem = {
    ...existing,
    inventoryId: optionalString(payload.inventoryId) || existing.inventoryId,
    locationId: nextMapId || existing.locationId,
    mapName: nextMapName,
    unitNumber: hasOwn(payload, "unitNumber") ? optionalString(payload.unitNumber) || undefined : existing.unitNumber,
    mediaVariantKey: optionalString(payload.mediaVariantKey) || existing.mediaVariantKey,
    variantLabel: optionalString(payload.variantLabel) || existing.variantLabel,
    mediaType: optionalString(payload.mediaType) ?? existing.mediaType,
    x: numberOrUndefined(payload.x, existing.x),
    y: numberOrUndefined(payload.y, existing.y),
    isActive: optionalBoolean(payload.isActive) ?? existing.isActive,
    mapVisibilityMode:
      optionalString(payload.mapVisibilityMode) === "show_unavailable"
        ? "show_unavailable"
        : optionalString(payload.mapVisibilityMode) === "hidden"
          ? "hidden"
          : existing.mapVisibilityMode,
    trimHeight: numberOrUndefined(payload.trimHeight, existing.trimHeight),
    trimWidth: numberOrUndefined(payload.trimWidth, existing.trimWidth),
    safeHeight: numberOrUndefined(payload.safeHeight, existing.safeHeight),
    safeWidth: numberOrUndefined(payload.safeWidth, existing.safeWidth),
    substrate: optionalString(payload.substrate) ?? existing.substrate,
    finishing: optionalString(payload.finishing) ?? existing.finishing,
    locationDetail: optionalString(payload.locationDetail) ?? existing.locationDetail,
    notes: optionalString(payload.notes) ?? existing.notes,
    dpi: numberOrUndefined(payload.dpi, existing.dpi),
    bleedTop: numberOrUndefined(payload.bleedTop, existing.bleedTop),
    bleedRight: numberOrUndefined(payload.bleedRight, existing.bleedRight),
    bleedBottom: numberOrUndefined(payload.bleedBottom, existing.bleedBottom),
    bleedLeft: numberOrUndefined(payload.bleedLeft, existing.bleedLeft),
    updatedAt: isoNow(),
  };

  await putCore(buildInventoryRecord(next));
  const nextInventory = venueItems
    .filter((item): item is InventoryItem => item.entityType === "InventoryItem")
    .filter((item) => item.id !== existing.id);
  nextInventory.push(next);
  await reconcileVenueVariantsForInventorySet(existing.venueId, nextInventory, venueItems);
  await writeAudit(`VENUE_ADMIN#${existing.venueId}`, "inventory.updated", auth.actorName, {
    inventoryItemId,
    changes: payload,
  });

  return next;
}

async function updateInventoryPlacement(inventoryItemId: string, payload: Record<string, unknown>, auth: AuthContext) {
  const x = requiredNumber(payload.x, "x");
  const y = requiredNumber(payload.y, "y");
  if (x < 0 || x > 1 || y < 0 || y > 1) {
    throw new HttpError(400, "x and y must be normalized coordinates between 0 and 1");
  }

  return updateInventory(
    inventoryItemId,
    {
      x,
      y,
    },
    auth
  );
}

async function deleteInventory(inventoryItemId: string, auth: AuthContext) {
  const existing = await findInventoryById(inventoryItemId);
  if (!existing) throw new HttpError(404, `Inventory item ${inventoryItemId} not found`);
  const venue = await findVenueById(existing.venueId);
  if (!venue) throw new HttpError(404, `Venue ${existing.venueId} not found`);
  assertCustomerAccess(auth, venue.customerId);
  const customer = await findCustomerById(venue.customerId);
  if (!customer) throw new HttpError(404, `Customer ${venue.customerId} not found`);
  assertCustomerMutable(auth, customer, "delete inventory");
  const venueItems = await queryByPk(`VENUE#${existing.venueId}`);

  await client.send(
    new DeleteItemCommand({
      TableName: CORE_TABLE_NAME,
      Key: marshall({ pk: `VENUE#${existing.venueId}`, sk: `INVENTORY#${inventoryItemId}` }),
    })
  );
  const nextInventory = venueItems
    .filter((item): item is InventoryItem => item.entityType === "InventoryItem")
    .filter((item) => item.id !== existing.id);
  await reconcileVenueVariantsForInventorySet(existing.venueId, nextInventory, venueItems);

  await writeAudit(`VENUE_ADMIN#${existing.venueId}`, "inventory.deleted", auth.actorName, {
    inventoryItemId,
    venueId: existing.venueId,
    locationId: existing.locationId,
  });

  return true;
}

async function reconcileVenueVariantsForInventorySet(
  venueId: string,
  inventoryItems: InventoryItem[],
  venueItems?: Record<string, unknown>[]
) {
  const sourceItems = venueItems || (await queryByPk(`VENUE#${venueId}`));
  const existingVariants = sourceItems.filter((item): item is MediaVariantItem => item.entityType === "MediaVariant");
  const existingVariantsByKey = new Map(existingVariants.map((variant) => [variant.mediaVariantKey, variant]));
  const desiredVariants = new Map<string, InventoryItem>();

  inventoryItems.forEach((item) => {
    if (!item.mediaVariantKey) return;
    if (!desiredVariants.has(item.mediaVariantKey)) {
      desiredVariants.set(item.mediaVariantKey, item);
    }
  });

  const variantsToPut: MediaVariantItem[] = [];
  const variantKeysToDelete: Array<{ pk: string; sk: string }> = [];
  const now = isoNow();

  desiredVariants.forEach((inventoryItem, mediaVariantKey) => {
    const existingVariant = existingVariantsByKey.get(mediaVariantKey);
    const nextLabel = inventoryItem.variantLabel || inventoryItem.mediaType || mediaVariantKey;
    if (!existingVariant) {
      variantsToPut.push({
        entityType: "MediaVariant",
        id: makeId("variant", venueId, mediaVariantKey),
        venueId,
        mediaVariantKey,
        label: nextLabel,
        mediaType: inventoryItem.mediaType,
        updatedAt: now,
      });
      return;
    }

    if (existingVariant.label !== nextLabel || (inventoryItem.mediaType ?? "") !== (existingVariant.mediaType ?? "")) {
      variantsToPut.push({
        ...existingVariant,
        label: nextLabel,
        mediaType: inventoryItem.mediaType,
        updatedAt: now,
      });
    }
  });

  existingVariants.forEach((variant) => {
    if (!desiredVariants.has(variant.mediaVariantKey)) {
      variantKeysToDelete.push({ pk: `VENUE#${venueId}`, sk: `VARIANT#${variant.id}` });
    }
  });

  await putMany(variantsToPut.map((variant) => buildVariantRecord(variant)));
  await deleteMany(variantKeysToDelete);
}

async function resolveExistingCustomer(args: { customerId?: string; customerName?: string }) {
  const byId = args.customerId ? await findCustomerById(args.customerId) : null;
  if (byId) return byId;

  const byName = args.customerName ? await findCustomerByName(args.customerName) : null;
  if (byName) return byName;

  throw new HttpError(400, `Customer ${args.customerName || args.customerId || ""} was not found`);
}

async function findCustomerById(customerId: string) {
  const cached = readLocalCache(customerByIdCache.get(customerId));
  if (cached.hit) return cached.value;
  const items = await queryByPk(`CUSTOMER#${customerId}`);
  const customer = items.find((item): item is CustomerItem => item.entityType === "Customer") || null;
  cacheCustomer(customerId, customer);
  return customer;
}

async function findCustomerByName(customerName: string) {
  const normalizedName = normalizeText(customerName);
  const cached = readLocalCache(customerByNameCache.get(normalizedName));
  if (cached.hit) return cached.value;
  const customers = await scanByEntityType("Customer");
  const customer =
    customers.find(
      (item): item is CustomerItem => item.entityType === "Customer" && normalizeText(item.name) === normalizeText(customerName)
    ) || null;
  customerByNameCache.set(normalizedName, makeLocalCacheEntry(customer, SHORT_CACHE_TTL_MS));
  if (customer) cacheCustomer(customer.id, customer);
  return customer;
}

async function ensureInternalSandboxCustomer(actorName: string) {
  const existing =
    (await findCustomerById(INTERNAL_SANDBOX_CUSTOMER_ID)) ||
    (await findCustomerByName(INTERNAL_SANDBOX_CUSTOMER_NAME));
  const now = isoNow();
  if (existing) {
    const next: CustomerItem = {
      ...existing,
      id: INTERNAL_SANDBOX_CUSTOMER_ID,
      name: INTERNAL_SANDBOX_CUSTOMER_NAME,
      status: customerStatus(existing),
      isActive: customerStatus(existing) === "active",
      isInternalSandbox: true,
      liftCustomerId: existing.liftCustomerId || INTERNAL_SANDBOX_LIFT_CUSTOMER_ID,
      updatedAt: existing.updatedAt || now,
    };
    if (
      next.id !== existing.id ||
      next.name !== existing.name ||
      next.isInternalSandbox !== existing.isInternalSandbox ||
      next.liftCustomerId !== existing.liftCustomerId
    ) {
      await putCore(buildCustomerRecord(next));
    }
    cacheCustomer(next.id, next);
    return next;
  }

  const customer: CustomerItem = {
    entityType: "Customer",
    id: INTERNAL_SANDBOX_CUSTOMER_ID,
    name: INTERNAL_SANDBOX_CUSTOMER_NAME,
    status: "active",
    isActive: true,
    isInternalSandbox: true,
    liftCustomerId: INTERNAL_SANDBOX_LIFT_CUSTOMER_ID,
    createdAt: now,
    updatedAt: now,
  };

  await putCore(buildCustomerRecord(customer));
  await writeAudit(`ADMIN_SETTINGS#CUSTOMER#${customer.id}`, "customer.created", actorName, {
    customerId: customer.id,
    name: customer.name,
    liftCustomerId: customer.liftCustomerId,
    status: "active",
    isActive: true,
    isInternalSandbox: true,
  });
  cacheCustomer(customer.id, customer);
  return customer;
}

async function findUserProfileBySub(cognitoSub: string) {
  const cached = readLocalCache(userProfileBySubCache.get(cognitoSub));
  if (cached.hit) return cached.value;
  const items = await queryByPk(`USER#${cognitoSub}`);
  const profile = items.find((item): item is UserProfileItem => item.entityType === "UserProfile") || null;
  cacheUserProfile(cognitoSub, profile?.email || null, profile);
  return profile;
}

async function findUserProfileByEmail(email: string) {
  const normalizedEmail = email.toLowerCase();
  const cached = readLocalCache(userProfileByEmailCache.get(normalizedEmail));
  if (cached.hit) return cached.value;
  const items = await queryByGsi1(`USER_EMAIL#${email.toLowerCase()}`);
  const profile = items.find((item): item is UserProfileItem => item.entityType === "UserProfile") || null;
  cacheUserProfile(profile?.cognitoSub || null, normalizedEmail, profile);
  return profile;
}

async function requireAuthContext(event: ApiEvent): Promise<AuthContext> {
  const claims = event.requestContext?.authorizer?.jwt?.claims || {};
  const cognitoSub = claims.sub;
  const email = claims.email || claims.username || claims["cognito:username"];
  if (!cognitoSub && !email) throw new HttpError(401, "Authenticated identity is missing JWT claims");

  const profile =
    (cognitoSub ? await findUserProfileBySub(cognitoSub) : null) ||
    (email ? await findUserProfileByEmail(email) : null);

  if (!profile) {
    throw new HttpError(403, `No UserProfile found for ${email || cognitoSub}`);
  }
  if (!profile.isActive) {
    throw new HttpError(403, `UserProfile for ${profile.email} is inactive`);
  }

  return {
    profile,
    actorName: profile.displayName || profile.email,
    isPlatformAdmin: profile.role === "platform_admin",
    customerIds: new Set(profile.customerIds || []),
  };
}

function hasCustomerAccess(auth: AuthContext, customerId: string) {
  return auth.isPlatformAdmin || auth.customerIds.has(customerId);
}

function assertCustomerAccess(auth: AuthContext, customerId: string) {
  if (hasCustomerAccess(auth, customerId)) return;
  throw new HttpError(403, `You do not have access to customer ${customerId}`);
}

function assertPlatformAdmin(auth: AuthContext) {
  if (auth.isPlatformAdmin) return;
  throw new HttpError(403, "Platform admin access is required");
}

function customerStatus(customer: Pick<CustomerItem, "status" | "isActive" | "name">) {
  if (customer.status === "active" || customer.status === "suspended" || customer.status === "inactive") {
    return customer.status;
  }
  return customer.isActive === false ? "inactive" : "active";
}

function assertCustomerReadable(auth: AuthContext, customer: CustomerItem) {
  if (auth.isPlatformAdmin) return;
  if (customerStatus(customer) === "inactive") {
    throw new HttpError(403, `${customer.name} is inactive and unavailable in the workspace.`);
  }
}

function assertCustomerMutable(auth: AuthContext, customer: CustomerItem, action: string) {
  if (auth.isPlatformAdmin) return;
  const status = customerStatus(customer);
  if (status === "active") return;
  if (status === "suspended") {
    throw new HttpError(403, `${customer.name} is suspended, so customer users cannot ${action}.`);
  }
  throw new HttpError(403, `${customer.name} is inactive and cannot ${action}.`);
}

async function findMarketById(marketId: string) {
  const items = await queryByGsi1(`MARKET#${marketId}`);
  return items.find((item): item is MarketItem => item.entityType === "Market") || null;
}

async function findVenueById(venueId: string) {
  const items = await queryByPk(`VENUE#${venueId}`);
  return items.find((item): item is VenueItem => item.entityType === "Venue") || null;
}

async function findMapById(venueId: string, mapId: string) {
  const items = await queryByPk(`VENUE#${venueId}`, `MAP#${mapId}`);
  return items.find((item): item is RoomMapItem => item.entityType === "RoomMap") || null;
}

async function findVariantById(venueId: string, variantId: string) {
  const items = await queryByPk(`VENUE#${venueId}`, `VARIANT#${variantId}`);
  return items.find((item): item is MediaVariantItem => item.entityType === "MediaVariant") || null;
}

async function findCustomerVendor(customerId: string, vendorId: string) {
  const items = await queryByPk(`CUSTOMER#${customerId}`, `VENDOR#${vendorId}`);
  return items.find((item): item is CustomerVendorItem => item.entityType === "CustomerVendor") || null;
}

async function findInventoryById(inventoryItemId: string) {
  const items = await queryByGsi1(`INVENTORY#${inventoryItemId}`);
  return items.find((item): item is InventoryItem => item.entityType === "InventoryItem") || null;
}

async function listProjectsForCustomer(customerId: string) {
  return (await scanByEntityType("Project")).filter(
    (item): item is ProjectSummaryItem => item.entityType === "Project" && item.customerId === customerId
  );
}

async function syncCustomerNameReferences(customerId: string, customerName: string) {
  const [markets, venues, projects] = await Promise.all([
    queryByPk(`CUSTOMER#${customerId}`, "MARKET#"),
    queryByGsi1(`CUSTOMER#${customerId}`, "VENUE#"),
    listProjectsForCustomer(customerId),
  ]);

  const nextRecords: Array<Record<string, unknown>> = [];

  for (const market of markets.filter((item): item is MarketItem & { pk?: string; sk?: string } => item.entityType === "Market")) {
    nextRecords.push({
      ...market,
      customerName,
    });
  }

  for (const venue of venues.filter((item): item is VenueItem & { pk?: string; sk?: string } => item.entityType === "Venue")) {
    nextRecords.push({
      ...venue,
      customerName,
    });
  }

  for (const project of projects.filter((item): item is ProjectSummaryItem => item.entityType === "Project")) {
    nextRecords.push({
      ...project,
      customerName,
    });
  }

  await putMany(nextRecords);
}

async function queryByPk(pk: string, skPrefix?: string) {
  const startedAt = Date.now();
  const response = await client.send(
    new QueryCommand({
      TableName: CORE_TABLE_NAME,
      KeyConditionExpression: skPrefix ? "pk = :pk AND begins_with(sk, :skPrefix)" : "pk = :pk",
      ExpressionAttributeValues: marshall(
        skPrefix
          ? { ":pk": pk, ":skPrefix": skPrefix }
          : { ":pk": pk }
      ),
    })
  );

  const items = (response.Items || []).map((item) => unmarshall(item) as Record<string, any>);
  logPerf("queryByPk", startedAt, { pk, skPrefix: skPrefix || null, count: items.length });
  return items;
}

async function queryByGsi1(gsi1pk: string, gsi1skPrefix?: string) {
  const startedAt = Date.now();
  const response = await client.send(
    new QueryCommand({
      TableName: CORE_TABLE_NAME,
      IndexName: "gsi1",
      KeyConditionExpression: gsi1skPrefix ? "gsi1pk = :gsi1pk AND begins_with(gsi1sk, :gsi1skPrefix)" : "gsi1pk = :gsi1pk",
      ExpressionAttributeValues: marshall(
        gsi1skPrefix
          ? { ":gsi1pk": gsi1pk, ":gsi1skPrefix": gsi1skPrefix }
          : { ":gsi1pk": gsi1pk }
      ),
    })
  );

  const items = (response.Items || []).map((item) => unmarshall(item) as Record<string, any>);
  logPerf("queryByGsi1", startedAt, { gsi1pk, gsi1skPrefix: gsi1skPrefix || null, count: items.length });
  return items;
}

async function scanByEntityType(entityType: string) {
  const cached = readLocalCache(entityScanCache.get(entityType));
  if (cached.hit) return cached.value;
  const startedAt = Date.now();
  const response = await client.send(
    new ScanCommand({
      TableName: CORE_TABLE_NAME,
      FilterExpression: "#entityType = :entityType",
      ExpressionAttributeNames: { "#entityType": "entityType" },
      ExpressionAttributeValues: marshall({ ":entityType": entityType }),
    })
  );

  const items = (response.Items || []).map((item) => unmarshall(item) as Record<string, any>);
  entityScanCache.set(entityType, makeLocalCacheEntry(items, SHORT_CACHE_TTL_MS));
  logPerf("scanByEntityType", startedAt, { entityType, count: items.length });
  return items;
}

async function putCore(item: Record<string, unknown>) {
  invalidateEntityCachesForWrite(item.entityType);
  await client.send(
    new PutItemCommand({
      TableName: CORE_TABLE_NAME,
      Item: marshall(item, { removeUndefinedValues: true }),
    })
  );
}

async function putMany(items: Array<Record<string, unknown>>) {
  if (!items.length) return;
  for (const item of items) {
    invalidateEntityCachesForWrite(item.entityType);
  }
  for (let index = 0; index < items.length; index += 25) {
    const chunk = items.slice(index, index + 25);
    await client.send(
      new BatchWriteItemCommand({
        RequestItems: {
          [CORE_TABLE_NAME]: chunk.map((item) => ({
            PutRequest: {
              Item: marshall(item, { removeUndefinedValues: true }),
            },
          })),
        },
      })
    );
  }
}

async function deleteMany(keys: Array<{ pk: string; sk: string }>) {
  if (!keys.length) return;
  invalidateEntityCaches();
  for (let index = 0; index < keys.length; index += 25) {
    const chunk = keys.slice(index, index + 25);
    await client.send(
      new BatchWriteItemCommand({
        RequestItems: {
          [CORE_TABLE_NAME]: chunk.map((item) => ({
            DeleteRequest: {
              Key: marshall(item),
            },
          })),
        },
      })
    );
  }
}

async function writeAudit(scopeId: string, eventType: string, actorNameValue: string, detail: Record<string, unknown>) {
  const createdAt = isoNow();
  const auditEvent: AuditEvent = {
    eventType,
    scopeId,
    actorName: actorNameValue,
    createdAt,
    detail,
  };

  await client.send(
    new PutItemCommand({
      TableName: AUDIT_TABLE_NAME,
      Item: marshall(
        {
          projectId: scopeId,
          ...auditEvent,
        },
        { removeUndefinedValues: true }
      ),
    })
  );
}

function buildCustomerRecord(customer: CustomerItem) {
  return {
    pk: `CUSTOMER#${customer.id}`,
    sk: "PROFILE",
    gsi1pk: `CUSTOMER#${customer.id}`,
    gsi1sk: "PROFILE",
    gsi2pk: `CUSTOMER#${customer.id}`,
    gsi2sk: "PROFILE",
    ...customer,
    status: customerStatus(customer),
    isActive: customerStatus(customer) === "active",
  };
}

function buildMarketRecord(market: MarketItem) {
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

function buildVenueRecord(venue: VenueItem) {
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

function buildMapRecord(map: RoomMapItem) {
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

function buildVenueInventoryPresetRecord(preset: VenueInventoryPresetItem) {
  return {
    pk: `VENUE#${preset.venueId}`,
    sk: `PRESET#${preset.id}`,
    gsi1pk: `VENUE_PRESET#${preset.id}`,
    gsi1sk: `VENUE#${preset.venueId}`,
    gsi2pk: `VENUE#${preset.venueId}`,
    gsi2sk: `PRESET#${preset.name}#${preset.id}`,
    ...preset,
  };
}

async function signCustomerLogoUrl(customer: CustomerItem | null | undefined) {
  if (!customer?.logoObjectKey || !VENUE_ASSETS_BUCKET_NAME) return null;
  const command = new GetObjectCommand({
    Bucket: customer.logoBucketName || VENUE_ASSETS_BUCKET_NAME,
    Key: customer.logoObjectKey,
  });
  return getSignedUrl(s3, command, { expiresIn: 60 * 60 });
}

function buildVariantRecord(variant: MediaVariantItem) {
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

function buildInventoryRecord(item: InventoryItem) {
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

function getBody<T extends Record<string, unknown> = Record<string, unknown>>(event: ApiEvent): T {
  if (!event.body) return {} as T;
  const decoded = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
  const parsed = JSON.parse(decoded || "{}");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {} as T;
  return parsed as T;
}

function requirePath(event: ApiEvent, key: string) {
  const value = event.pathParameters?.[key];
  if (!value) throw new HttpError(400, `${key} is required`);
  return value;
}

function hasOwn(payload: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(payload, key);
}

function requiredString(payload: Record<string, unknown>, key: string) {
  const value = optionalString(payload[key]);
  if (!value) throw new HttpError(400, `${key} is required`);
  return value;
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalBoolean(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function optionalCustomerStatus(value: unknown): CustomerStatus | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "active" || normalized === "suspended" || normalized === "inactive") {
    return normalized;
  }
  return undefined;
}

function requiredCustomerStatus(payload: Record<string, unknown>, field: string): CustomerStatus {
  const value = optionalCustomerStatus(payload[field]);
  if (value) return value;
  throw new HttpError(400, `${field} must be active, suspended, or inactive`);
}

function optionalVariantRouting(value: unknown): MediaVariantItem["productionRouting"] | undefined {
  const parsed = optionalString(value);
  if (!parsed) return undefined;
  if (parsed === "primary" || parsed === "external") return parsed;
  throw new HttpError(400, `Invalid production routing ${parsed}`);
}

function requiredNumber(value: unknown, key: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new HttpError(400, `${key} must be a number`);
  return value;
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function numberOrUndefined(value: unknown, fallback: number | null | undefined) {
  if (value === null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return fallback;
}

function normalizeText(value: string) {
  return value.trim().toLowerCase();
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "item";
}

function makeId(prefix: string, ...parts: string[]) {
  const base = parts.map((part) => slugify(part)).filter(Boolean).join("_");
  return `${prefix}_${base}_${Math.random().toString(36).slice(2, 8)}`;
}

function actorName(event: ApiEvent) {
  const claims = event.requestContext?.authorizer?.jwt?.claims || {};
  return (
    claims.name ||
    claims.email ||
    event.headers?.["x-adspace-actor-name"] ||
    event.headers?.["X-Adspace-Actor-Name"] ||
    "system"
  );
}

function isoNow() {
  return new Date().toISOString();
}

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...timingHeaders(),
    },
    body: JSON.stringify(body),
  };
}

function ok(body: unknown) {
  return json(200, body);
}

function created(body: unknown) {
  return json(201, body);
}

function noContent() {
  return {
    statusCode: 204,
    headers: {
      "cache-control": "no-store",
      ...timingHeaders(),
    },
    body: "",
  };
}

function isLiteRequest(event: ApiEvent) {
  const value = event.queryStringParameters?.lite || event.queryStringParameters?.summary;
  return value === "1" || value === "true" || value === "lite";
}

function timingHeaders() {
  if (!responsePerfContext) {
    return {};
  }
  return {
    "x-adspace-route-key": responsePerfContext.routeKey,
    "x-adspace-route-ms": String(Date.now() - responsePerfContext.startedAt),
    "access-control-expose-headers": "x-adspace-route-key,x-adspace-route-ms",
  };
}

function logPerf(label: string, startedAt: number, detail: Record<string, unknown> = {}) {
  const elapsedMs = Date.now() - startedAt;
  if (elapsedMs >= 200) {
    console.log("[perf]", JSON.stringify({ label, elapsedMs, ...detail }));
  }
}

function makeLocalCacheEntry<T>(value: T, ttlMs: number): LocalCacheEntry<T> {
  return {
    value,
    expiresAt: Date.now() + ttlMs,
  };
}

function readLocalCache<T>(entry: LocalCacheEntry<T> | undefined) {
  if (!entry || entry.expiresAt <= Date.now()) {
    return { hit: false as const };
  }
  return { hit: true as const, value: entry.value };
}

function cacheUserProfile(cognitoSub: string | null, email: string | null, profile: UserProfileItem | null) {
  const entry = makeLocalCacheEntry(profile, USER_CACHE_TTL_MS);
  if (cognitoSub) {
    userProfileBySubCache.set(cognitoSub, entry);
  }
  if (email) {
    userProfileByEmailCache.set(email.toLowerCase(), entry);
  }
}

function cacheCustomer(customerId: string, customer: CustomerItem | null) {
  customerByIdCache.set(customerId, makeLocalCacheEntry(customer, SHORT_CACHE_TTL_MS));
  if (customer?.name) {
    customerByNameCache.set(normalizeText(customer.name), makeLocalCacheEntry(customer, SHORT_CACHE_TTL_MS));
  }
}

function invalidateEntityCachesForWrite(entityType: unknown) {
  customerListResponseCache.clear();
  venueDetailResponseCache.clear();
  if (typeof entityType === "string") {
    entityScanCache.delete(entityType);
  }
  if (entityType === "Customer") {
    customerByIdCache.clear();
    customerByNameCache.clear();
  }
  if (entityType === "Market" || entityType === "Venue" || entityType === "Project") {
    entityScanCache.delete("Customer");
  }
}

function invalidateEntityCaches() {
  entityScanCache.clear();
  customerByIdCache.clear();
  customerByNameCache.clear();
  customerListResponseCache.clear();
  venueDetailResponseCache.clear();
}

function authScopeCacheKey(auth: AuthContext) {
  return auth.isPlatformAdmin ? "platform" : Array.from(auth.customerIds).sort().join(",");
}

function requiredEnv(key: string) {
  const value = process.env[key];
  if (!value) throw new Error(`${key} environment variable is required`);
  return value;
}

class HttpError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}
