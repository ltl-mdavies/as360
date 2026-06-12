import {
  DeleteItemCommand,
  DynamoDBClient,
  PutItemCommand,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/client-dynamodb";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";
import { createHash, createHmac, randomBytes } from "node:crypto";
import JSZip from "jszip";
import {
  renderDigestMessage,
  renderNotificationMessage,
  sendNotificationEmail,
  type NotificationDigestEntry as NotificationDigestEntryPayload,
} from "./notification-email.js";

type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE" | "OPTIONS";
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

type UserRole = "platform_admin" | "customer_admin";
type ShareAccessType = "collaboration" | "artwork_upload" | "transit_approval" | "view_only";
type ShareLinkStatus = "active" | "revoked";
type ShareWorkspace = "hub" | "artwork" | "assignment" | "proofs" | "transit";

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
  createdAt?: string;
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
  updatedAt: string;
};

type ProjectCreativeAssetItem = {
  entityType: "CreativeAsset";
  id: string;
  projectId: string;
  filename: string;
  fileMeta: string;
  mediaVariantKey: string;
  color: string;
  bucketName: string;
  objectKey: string;
  thumbObjectKey?: string;
  contentType?: string;
  thumbContentType?: string;
  sizeBytes?: number;
  uploadedByName: string;
  createdAt: string;
  updatedAt: string;
};

type ProjectDocumentCategory = "project_document" | "lift_payload" | "allocation_report" | "order_package" | "reconciliation";

type ProjectDocumentItem = {
  entityType: "ProjectDocument";
  id: string;
  projectId: string;
  category: ProjectDocumentCategory;
  assetKind: "projectDocument" | "liftPayload" | "allocationReport" | "orderPackage" | "reconciliation";
  bucketName: string;
  objectKey: string;
  thumbObjectKey?: string;
  filename: string;
  contentType?: string;
  thumbContentType?: string;
  sizeBytes?: number;
  source: "uploaded" | "generated";
  uploadedByName: string;
  createdAt: string;
  updatedAt: string;
};

type ProjectItem = {
  entityType: "Project";
  id: string;
  projectMode?: "live" | "internal_sandbox";
  customerId: string;
  customerName: string;
  sourceCustomerId?: string;
  sourceCustomerName?: string;
  marketId: string;
  marketName: string;
  venueId: string;
  venueName: string;
  title: string;
  poNumber?: string;
  adspaceOrderNumber?: string;
  extId: string;
  liftOrderId?: string | null;
  liftOrderLookupSource?: "create_order" | "fallback_lookup" | "manual_override" | null;
  liftOrderOverriddenAt?: string | null;
  liftOrderOverriddenByName?: string | null;
  liftOrderOverrideNote?: string | null;
  lastLiftProofSyncAt?: string | null;
  lastLiftProofChangeAt?: string | null;
  orderSubmittedAt?: string | null;
  orderSubmittedByName?: string | null;
  orderSubmissionNote?: string | null;
  productionReleasedAt?: string | null;
  productionReleasedByName?: string | null;
  productionReleaseNote?: string | null;
  artworkDueDate?: string;
  postDate?: string;
  endClientName?: string;
  contractNumber?: string;
  createdAt: string;
  updatedAt: string;
};

type ProjectScopeItem = {
  entityType: "ProjectScope";
  id: string;
  projectId: string;
  includedIds: string[];
  createdAt: string;
  updatedAt: string;
};

type ProjectAssignmentItem = {
  entityType: "ProjectAssignment";
  id: string;
  projectId: string;
  inventoryId: string;
  creativeId: string | null;
  updatedAt: string;
  updatedByName: string;
};

type AllocationOverrideSourceType = "proof" | "creative" | "manual";
type AllocationOverrideLiftSyncStatus = "not_supported" | "pending" | "synced" | "failed";

type ProjectAllocationOverrideRowItem = {
  entityType: "ProjectAllocationOverrideRow";
  id: string;
  projectId: string;
  sourceType: AllocationOverrideSourceType;
  sourceProofLineId?: string | null;
  sourceCreativeId?: string | null;
  sourceLineNumber?: number | null;
  sourceLiftOrderLineId?: number | null;
  sourceLiftProofingId?: number | null;
  productLabel: string;
  dimensionsLabel: string;
  quantity: number;
  mediaVariantKey: string;
  assignedInventoryIds: string[];
  hidden: boolean;
  hiddenAt?: string | null;
  hiddenByName?: string | null;
  overrideAsset?: {
    bucketName: string;
    objectKey: string;
    thumbObjectKey?: string | null;
    filename: string;
    contentType?: string | null;
    thumbContentType?: string | null;
    sizeBytes?: number | null;
  } | null;
  liftSyncStatus: AllocationOverrideLiftSyncStatus;
  adminNote?: string | null;
  createdAt: string;
  createdByName: string;
  updatedAt: string;
  updatedByName: string;
};

type ProjectShareLinkItem = {
  entityType: "ProjectShareLink";
  id: string;
  projectId: string;
  label: string;
  accessType: ShareAccessType;
  status: ShareLinkStatus;
  tokenHash: string;
  shortCode: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string | null;
};

type AppSettingsItem = {
  entityType: "AppSettings";
  id: "global";
  shareDefaults: {
    collaboration: { enabled: boolean; defaultExpiresInDays: number | null };
    artworkUpload: { enabled: boolean; defaultExpiresInDays: number | null };
    transitApproval: { enabled: boolean; defaultExpiresInDays: number | null };
    viewOnly: { enabled: boolean; defaultExpiresInDays: number | null };
    requireParticipantIdentity: boolean;
  };
  notifications: {
    proofApproved: boolean;
    transitDecision: boolean;
    productionReleased: boolean;
    workflowErrors: boolean;
    emailRecipients: string;
  };
  workflowPolicies: {
    productionApprovalMode: "hold_for_release";
    transitRunsInParallel: boolean;
    lockProofUndoAfterRelease: boolean;
  };
  dataDefaults: {
    projectScopeDefault: "all_active_visible";
    inactiveInventoryVisibilityDefault: "hidden" | "show_unavailable";
    respectVenueMapSortOrder: boolean;
  };
  files: {
    previewPdfInLightbox: boolean;
    replaceFilePreservesAssignments: boolean;
    projectDocumentRetentionDays: number;
    generatedDocumentRetentionDays: number;
  };
  integrations: {
    liftOrderIntegrationEnabled: boolean;
    liftProofSyncEnabled: boolean;
    retryOnTransientLiftFailure: boolean;
    primaryPrintVendor: {
      enabled: boolean;
      vendorName: string;
      platformLabel: string;
      activeEnvironment: LiftEnvironmentKey;
      environments: Record<LiftEnvironmentKey, LiftEnvironmentConfig>;
      companyId: string;
      createOrderUsername: string;
      createOrderPassword: string;
      proofClientId: string;
      proofClientSecret: string;
      defaultHeaders: string;
      payloadNotes: string;
    };
  };
  updatedAt: string;
  updatedByName: string;
};

type LiftEnvironmentKey = "prod" | "qa1";

type LiftEnvironmentConfig = {
  baseUrl: string;
  orderEndpointUrl: string;
  fallbackOrderLookupUrl: string;
  orderUrlResolverUrl: string;
  customerContactListUrl: string;
  proofEndpointUrlTemplate: string;
  flushSyncUrl: string;
  proofUrlResolverUrl: string;
};

type NotificationEventType =
  | "artwork_uploaded"
  | "creatives_assigned"
  | "all_inventory_assigned"
  | "order_submitted"
  | "proofs_ready"
  | "revised_art_uploaded"
  | "all_proofs_approved"
  | "transit_accepted"
  | "transit_rejected"
  | "production_release_ready"
  | "workflow_errors";

type NotificationRule = {
  id: string;
  label: string;
  eventTypes: NotificationEventType[];
  recipients: string;
  deliveryMode: "instant" | "digest";
  isActive: boolean;
};

type NotificationDigestItem = {
  entityType: "NotificationDigest";
  id: string;
  customerId: string;
  customerName: string;
  ruleId: string;
  ruleLabel: string;
  recipients: string;
  entries: NotificationDigestEntryPayload[];
  nextSendAt: string;
  createdAt: string;
  updatedAt: string;
  lastAttemptAt?: string;
  lastError?: string;
};

type ProjectNotificationDispatchItem = {
  entityType: "ProjectNotificationDispatch";
  id: string;
  projectId: string;
  eventType: NotificationEventType;
  createdAt: string;
  updatedAt: string;
};

type CustomerSettingsItem = {
  entityType: "CustomerSettings";
  id: string;
  customerId: string;
  notifications: {
    proofApproved: boolean;
    transitDecision: boolean;
    productionReleased: boolean;
    workflowErrors: boolean;
    emailRecipients: string;
    rules: NotificationRule[];
  };
  transitApproval: {
    defaultMode: "enabled_all_orders" | "manual_per_project";
    allowProjectOverride: boolean;
  };
  collaboration: {
    collaborationLinksEnabled: boolean;
    artworkUploadLinksEnabled: boolean;
    transitApprovalLinksEnabled: boolean;
    viewOnlyLinksEnabled: boolean;
    requireParticipantIdentity: boolean;
  };
  updatedAt: string;
  updatedByName: string;
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

type LiftCustomerContact = {
  customerId: string;
  customerName: string;
  customerNumber: string;
  customerType: string;
  customerStatus: string;
  salesRep: string;
  defaultInvoiceEmailAddress: string;
  createdDate: string;
};

type ShareParticipantItem = {
  entityType: "ShareParticipant";
  id: string;
  projectId: string;
  shareLinkId: string;
  displayName: string;
  email: string;
  emailLower: string;
  firstSeenAt: string;
  lastSeenAt: string;
};

type ProofLineStatus = "waiting" | "pending" | "approved";
type TransitApprovalStatus = "not_started" | "pending" | "approved" | "rejected";

type ProjectProofLineItem = {
  entityType: "ProjectProofLine";
  id: string;
  projectId: string;
  lineNumber: number;
  liftOrderLineId?: number | null;
  // Lift's proof approval API uses ATTACHMENT_ID as the proofing id.
  liftProofingId?: number | null;
  mediaVariantKey: string;
  mediaVariantLabel?: string;
  unitNumber?: string | null;
  quantity?: number | null;
  locations: string[];
  clientCreativeId: string;
  clientFileName: string;
  proofThumbObjectKey?: string;
  proofObjectKey?: string;
  liftProofThumbUrl?: string | null;
  liftProofFullUrl?: string | null;
  liftProofStatus?: string | null;
  lastLiftSyncAt?: string | null;
  status: ProofLineStatus;
  revised: boolean;
  printTeamFeedback?: string;
  proofComments?: ProjectProofComment[];
  proofCommentCount?: number;
  proofCommentAttachmentCount?: number;
  latestProofCommentAt?: string | null;
  proofVersions?: ProjectProofVersion[];
  createdAt: string;
  updatedAt: string;
  updatedByName?: string;
};

type ProjectProofCommentAttachment = {
  url: string;
  createdAt?: string | null;
  filename?: string | null;
};

type ProjectProofComment = {
  id: string;
  body: string;
  createdAt?: string | null;
  attachments: ProjectProofCommentAttachment[];
};

type ProjectProofVersion = {
  attachmentId?: number | null;
  orderLineId?: number | null;
  proofFilename?: string | null;
  proofThumbUrl?: string | null;
  proofFullUrl?: string | null;
  status?: string | null;
  createdAt?: string | null;
  replacedAt?: string | null;
  current?: boolean;
  comments: ProjectProofComment[];
};

type ProofSyncIssue = {
  severity: "warning";
  errorCode:
    | "lift_proof_line_mismatch"
    | "lift_proof_unit_mismatch"
    | "lift_proofing_id_missing"
    | "lift_proof_url_missing";
  message: string;
  surface: "proof_sync";
  metadata: Record<string, unknown>;
};

type ProjectTransitApprovalItem = {
  entityType: "ProjectTransitApproval";
  id: string;
  projectId: string;
  status: TransitApprovalStatus;
  submittedByName?: string;
  submittedDate?: string;
  comment?: string;
  submittedAt?: string;
  createdAt: string;
  updatedAt: string;
};

type AuthContext = {
  mode: "user" | "share";
  actorType: "user" | "share_participant";
  actorId: string;
  profile: UserProfileItem | null;
  actorName: string;
  isPlatformAdmin: boolean;
  customerIds: Set<string>;
  shareLink?: ProjectShareLinkItem | null;
  participant?: ShareParticipantItem | null;
};

type AuditEvent = {
  eventType: string;
  scopeId: string;
  actorType: "user" | "share_participant";
  actorId: string;
  actorName: string;
  shareLinkId?: string;
  createdAt: string;
  detail: Record<string, unknown>;
};

type ProjectListItem = {
  id: string;
  projectMode?: "live" | "internal_sandbox";
  customerId: string;
  customerName: string;
  customerLogoUrl?: string | null;
  sourceCustomerId?: string;
  sourceCustomerName?: string;
  marketId: string;
  marketName: string;
  venueId: string;
  venueName: string;
  title: string;
  poNumber?: string;
  adspaceOrderNumber?: string;
  extId: string;
  liftOrderId?: string | null;
  liftOrderUrl?: string | null;
  orderSubmittedAt?: string | null;
  orderSubmittedByName?: string | null;
  orderSubmissionNote?: string | null;
  productionReleasedAt?: string | null;
  productionReleasedByName?: string | null;
  productionReleaseNote?: string | null;
  artworkDueDate?: string;
  postDate?: string;
  endClientName?: string;
  contractNumber?: string;
  createdAt: string;
  updatedAt: string;
  assignment: {
    required: number;
    assigned: number;
    complete: boolean;
  };
  proofs: {
    total: number;
    approved: number;
    pending: number;
    revised: number;
    waitingForProof: number;
  };
  transit: {
    enabled: boolean;
    status: "not_required" | "not_started" | "pending" | "approved" | "rejected" | "changes_requested";
  };
  production: {
    policy: "direct" | "hold_for_release";
    ready: boolean;
    awaitingRelease: boolean;
    released: boolean;
  };
  needsAttention: boolean;
  scopeIncludedCount: number;
};

const client = new DynamoDBClient({});
const s3 = new S3Client({});
const CORE_TABLE_NAME = requiredEnv("CORE_TABLE_NAME");
const AUDIT_TABLE_NAME = requiredEnv("AUDIT_TABLE_NAME");
const PROJECT_ASSETS_BUCKET_NAME = requiredEnv("PROJECT_ASSETS_BUCKET_NAME");
const VENUE_ASSETS_BUCKET_NAME = process.env.VENUE_ASSETS_BUCKET_NAME || "";
const GENERATED_DOCS_BUCKET_NAME = process.env.GENERATED_DOCS_BUCKET_NAME || "";
const SHORT_LINKS_TABLE_NAME = process.env.SHORT_LINKS_TABLE_NAME || "";
const APP_BASE_URL = process.env.APP_BASE_URL || "https://app.adspace360.com";
const SHORT_BASE_URL = process.env.SHORT_BASE_URL || "https://go.adspace360.com";
const NOTIFICATIONS_FROM_EMAIL = process.env.NOTIFICATIONS_FROM_EMAIL || "noreply@adspace360.com";
const INTERNAL_SANDBOX_CUSTOMER_ID = "ltl_demo";
const INTERNAL_SANDBOX_CUSTOMER_NAME = "LTL Demo";
const INTERNAL_SANDBOX_LIFT_CUSTOMER_ID = "1249";
let responsePerfContext: { routeKey: string; startedAt: number } | null = null;

type LocalCacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const SHORT_CACHE_TTL_MS = 30_000;
const USER_CACHE_TTL_MS = 60_000;
const LIFT_PROOF_AUTO_SYNC_STALE_MS = 15 * 60 * 1000;
const LIFT_PROOF_AUTO_SYNC_QUIET_MS = 14 * 24 * 60 * 60 * 1000;
const appSettingsCache: { current: LocalCacheEntry<AppSettingsItem | null> | null } = { current: null };
const userProfileBySubCache = new Map<string, LocalCacheEntry<UserProfileItem | null>>();
const userProfileByEmailCache = new Map<string, LocalCacheEntry<UserProfileItem | null>>();
const userProfilesListCache: { current: LocalCacheEntry<UserProfileItem[]> | null } = { current: null };
const customersListCache: { current: LocalCacheEntry<CustomerItem[]> | null } = { current: null };
const customerByIdCache = new Map<string, LocalCacheEntry<CustomerItem | null>>();
const entityScanCache = new Map<string, LocalCacheEntry<Array<Record<string, any>>>>();
const projectListResponseCache = new Map<string, LocalCacheEntry<ProjectListItem[]>>();
const projectWorkspaceResponseCache = new Map<string, LocalCacheEntry<Record<string, unknown>>>();
const projectHubBootstrapResponseCache = new Map<string, LocalCacheEntry<Record<string, unknown>>>();

export async function handler(event: ApiEvent) {
  const method = (event.requestContext?.http?.method || event.routeKey?.split(" ")[0] || "UNKNOWN") as HttpMethod | "UNKNOWN";
  const routeKey = event.routeKey || `${method} ${event.rawPath || event.requestContext?.http?.path || ""}`;
  responsePerfContext = { routeKey, startedAt: Date.now() };

  try {
    if (method === "OPTIONS") return noContent();

    switch (routeKey) {
      case "GET /api/share-links/resolve":
        return ok(await resolveShareLink(event));
      case "POST /api/share-links/identify":
        return ok(await identifyShareParticipant(getBody(event)));
      case "GET /api/share/projects/{projectId}":
        return ok(await getProjectDetail(requirePath(event, "projectId"), await requireShareContext(event, requirePath(event, "projectId"), "hub", false)));
      case "GET /api/share/projects/{projectId}/workspace":
        return ok(await getProjectWorkspace(requirePath(event, "projectId"), await requireShareContext(event, requirePath(event, "projectId"), "artwork", false)));
      case "GET /api/share/projects/{projectId}/documents":
        return ok({ documents: await listProjectDocumentsResponse(requirePath(event, "projectId"), await requireShareContext(event, requirePath(event, "projectId"), "hub", false)) });
      case "GET /api/share/projects/{projectId}/creatives":
        return ok(await listProjectCreativesResponse(requirePath(event, "projectId"), await requireShareContext(event, requirePath(event, "projectId"), "artwork", false)));
      case "POST /api/share/projects/{projectId}/creatives":
        return created(await createProjectCreative(requirePath(event, "projectId"), getBody(event), await requireShareContext(event, requirePath(event, "projectId"), "artwork", true)));
      case "PATCH /api/share/projects/{projectId}/creatives/{creativeId}":
        return ok(await updateProjectCreative(requirePath(event, "projectId"), requirePath(event, "creativeId"), getBody(event), await requireShareContext(event, requirePath(event, "projectId"), "artwork", true)));
      case "DELETE /api/share/projects/{projectId}/creatives/{creativeId}":
        return ok(await deleteProjectCreative(requirePath(event, "projectId"), requirePath(event, "creativeId"), await requireShareContext(event, requirePath(event, "projectId"), "artwork", true)));
      case "POST /api/share/projects/{projectId}/submit":
        return ok(await submitProjectOrder(requirePath(event, "projectId"), getBody(event), await requireShareContext(event, requirePath(event, "projectId"), "assignment", true)));
      case "POST /api/share/projects/{projectId}/submit-preview":
        return ok(await previewProjectOrderSubmission(requirePath(event, "projectId"), getBody(event), await requireShareContext(event, requirePath(event, "projectId"), "assignment", true)));
      case "PATCH /api/share/projects/{projectId}/assignments/{inventoryId}":
        return ok(await updateProjectAssignment(requirePath(event, "projectId"), requirePath(event, "inventoryId"), getBody(event), await requireShareContext(event, requirePath(event, "projectId"), "assignment", true)));
      case "GET /api/share/projects/{projectId}/proofs":
        return ok(await listProjectProofsResponse(
          requirePath(event, "projectId"),
          await requireShareContext(event, requirePath(event, "projectId"), "proofs", false),
          event.queryStringParameters?.refresh === "1"
        ));
      case "PATCH /api/share/projects/{projectId}/proofs/{lineItemId}":
        return ok(await updateProjectProofLine(requirePath(event, "projectId"), requirePath(event, "lineItemId"), getBody(event), await requireShareContext(event, requirePath(event, "projectId"), "proofs", true)));
      case "GET /api/share/projects/{projectId}/transit":
        return ok(await getProjectTransitResponse(requirePath(event, "projectId"), await requireShareContext(event, requirePath(event, "projectId"), "transit", false)));
      case "PUT /api/share/projects/{projectId}/transit":
        return ok(await upsertProjectTransit(requirePath(event, "projectId"), getBody(event), await requireShareContext(event, requirePath(event, "projectId"), "transit", true)));
      case "POST /api/share/projects/{projectId}/errors": {
        const body = getBody(event);
        return ok(
          await logProjectErrorEvent(
            requirePath(event, "projectId"),
            body,
            await requireShareContext(
              event,
              requirePath(event, "projectId"),
              coerceShareWorkspace(body.workspace),
              false
            )
          )
        );
      }
    }

    const auth = await requireUserAuthContext(event);

    switch (routeKey) {
      case "GET /api/projects":
        return ok({ projects: await listProjects(event.queryStringParameters?.customerId, auth) });
      case "GET /api/projects/{projectId}":
        if (event.queryStringParameters?.allocationOverride === "1") {
          return ok(await getProjectAllocationOverrideResponse(requirePath(event, "projectId"), auth));
        }
        if (event.queryStringParameters?.hub === "1") {
          return ok(await getProjectHubBootstrap(requirePath(event, "projectId"), auth));
        }
        return ok(await getProjectDetail(requirePath(event, "projectId"), auth));
      case "GET /api/projects/{projectId}/workspace":
        return ok(await getProjectWorkspace(requirePath(event, "projectId"), auth));
      case "GET /api/projects/{projectId}/allocation-override":
        return ok(await getProjectAllocationOverrideResponse(requirePath(event, "projectId"), auth));
      case "POST /api/projects/{projectId}/allocation-override/rows":
        return created(await createProjectAllocationOverrideRow(requirePath(event, "projectId"), getBody(event), auth));
      case "PATCH /api/projects/{projectId}/allocation-override/rows/{rowId}":
        return ok(await updateProjectAllocationOverrideRow(requirePath(event, "projectId"), requirePath(event, "rowId"), getBody(event), auth));
      case "DELETE /api/projects/{projectId}/allocation-override/rows/{rowId}":
        return ok(await removeProjectAllocationOverrideRow(requirePath(event, "projectId"), requirePath(event, "rowId"), getBody(event), auth));
      case "GET /api/projects/{projectId}/lift-order-url":
        return ok(await getProjectLiftOrderUrl(requirePath(event, "projectId"), auth));
      case "GET /api/projects/{projectId}/activity":
        return ok({ events: await listProjectAuditEvents(requirePath(event, "projectId"), auth) });
      case "GET /api/projects/{projectId}/documents":
        return ok({ documents: await listProjectDocumentsResponse(requirePath(event, "projectId"), auth) });
      case "POST /api/projects/{projectId}/documents":
        {
          const payload = getBody(event);
          if (payload.action === "generate_creative_package") {
            return created(await createProjectCreativePackage(requirePath(event, "projectId"), auth));
          }
          return created(await createProjectDocument(requirePath(event, "projectId"), payload, auth));
        }
      case "GET /api/projects/{projectId}/share-links":
        return ok({ shareLinks: await listProjectShareLinks(requirePath(event, "projectId"), auth) });
      case "POST /api/projects/{projectId}/share-links":
        return created(await createProjectShareLink(requirePath(event, "projectId"), getBody(event), auth));
      case "PATCH /api/share-links/{shareLinkId}":
        return ok(await updateProjectShareLink(requirePath(event, "shareLinkId"), getBody(event), auth));
      case "GET /api/projects/{projectId}/creatives":
        return ok(await listProjectCreativesResponse(requirePath(event, "projectId"), auth));
      case "GET /api/projects/{projectId}/proofs":
        return ok(await listProjectProofsResponse(requirePath(event, "projectId"), auth, event.queryStringParameters?.refresh === "1"));
      case "PATCH /api/projects/{projectId}/proofs/{lineItemId}":
        return ok(await updateProjectProofLine(requirePath(event, "projectId"), requirePath(event, "lineItemId"), getBody(event), auth));
      case "GET /api/projects/{projectId}/transit":
        return ok(await getProjectTransitResponse(requirePath(event, "projectId"), auth));
      case "PUT /api/projects/{projectId}/transit":
        return ok(await upsertProjectTransit(requirePath(event, "projectId"), getBody(event), auth));
      case "POST /api/projects/{projectId}/errors":
        return ok(await logProjectErrorEvent(requirePath(event, "projectId"), getBody(event), auth));
      case "POST /api/projects/{projectId}/release-production":
        return ok(await releaseProjectProduction(requirePath(event, "projectId"), getBody(event), auth));
      case "POST /api/projects":
        return created(await createProject(getBody(event), auth));
      case "POST /api/projects/{projectId}/submit":
        return ok(await submitProjectOrder(requirePath(event, "projectId"), getBody(event), auth));
      case "POST /api/projects/{projectId}/submit-preview":
        return ok(await previewProjectOrderSubmission(requirePath(event, "projectId"), getBody(event), auth));
      case "POST /api/projects/{projectId}/creatives":
        return created(await createProjectCreative(requirePath(event, "projectId"), getBody(event), auth));
      case "PATCH /api/projects/{projectId}/creatives/{creativeId}":
        return ok(
          await updateProjectCreative(
            requirePath(event, "projectId"),
            requirePath(event, "creativeId"),
            getBody(event),
            auth
          )
        );
      case "DELETE /api/projects/{projectId}/creatives/{creativeId}":
        return ok(await deleteProjectCreative(requirePath(event, "projectId"), requirePath(event, "creativeId"), auth));
      case "PATCH /api/projects/{projectId}/assignments/{inventoryId}":
        return ok(await updateProjectAssignment(requirePath(event, "projectId"), requirePath(event, "inventoryId"), getBody(event), auth));
      case "PATCH /api/projects/{projectId}":
        {
          const payload = getBody(event);
          if (payload.action === "allocation_override_create") {
            return created(await createProjectAllocationOverrideRow(requirePath(event, "projectId"), payload, auth));
          }
          if (payload.action === "allocation_override_update") {
            return ok(await updateProjectAllocationOverrideRow(requirePath(event, "projectId"), requiredString(payload, "rowId"), payload, auth));
          }
          if (payload.action === "allocation_override_remove") {
            return ok(await removeProjectAllocationOverrideRow(requirePath(event, "projectId"), requiredString(payload, "rowId"), payload, auth));
          }
          return ok(await updateProject(requirePath(event, "projectId"), payload, auth));
        }
      case "GET /api/admin/settings":
        return ok(
          event.queryStringParameters?.recentWorkflowErrors !== undefined
            ? {
                issues: await listRecentWorkflowIssues(
                  auth,
                  optionalNumber(event.queryStringParameters?.recentWorkflowErrors) ?? 10
                ),
              }
            : event.queryStringParameters?.branding !== undefined
            ? await getAdminBranding(auth)
            : event.queryStringParameters?.liftSmokeOrder !== undefined
            ? await runLiftReadinessSmokeTest(event.queryStringParameters.liftSmokeOrder || "", auth)
            : event.queryStringParameters?.liftCustomerSearch !== undefined
            ? { customers: await listLiftCustomerContacts(event.queryStringParameters?.liftCustomerSearch || "", auth) }
            : event.queryStringParameters?.customerId
            ? await getCustomerSettings(event.queryStringParameters.customerId, auth)
            : await getAdminSettings(auth)
        );
      case "PATCH /api/admin/settings":
        return ok(await handleAdminSettingsPatch(getBody(event), auth));
      default:
        return json(404, { error: "Route not found", routeKey });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected project API error";
    const statusCode =
      error instanceof HttpError
        ? error.statusCode
        : message.toLowerCase().includes("not found")
          ? 404
          : message.toLowerCase().includes("required") || message.toLowerCase().includes("invalid")
            ? 400
            : 500;

    return json(statusCode, { error: message, routeKey });
  } finally {
    responsePerfContext = null;
  }
}

async function listProjects(customerId: string | undefined, auth: AuthContext) {
  const startedAt = Date.now();
  if (customerId) assertCustomerAccess(auth, customerId);
  if (customerId) {
    const customer = await findCustomerById(customerId);
    if (!customer) throw new HttpError(404, `Customer ${customerId} not found`);
    assertCustomerReadable(auth, customer);
  }

  const cacheKey = `projects:${customerId || "all"}:${authScopeCacheKey(auth)}`;
  const cached = readLocalCache(projectListResponseCache.get(cacheKey));
  if (cached.hit) {
    logPerf("listProjects.cacheHit", startedAt, {
      customerId: customerId || "all",
      projectCount: cached.value.length,
      platformAdmin: auth.isPlatformAdmin,
    }, 25, 250);
    return cached.value;
  }

  const rawProjects = (await scanByEntityType("Project"))
    .filter((item): item is ProjectItem => item.entityType === "Project")
    .filter((project) => hasProjectAccess(auth, project))
    .filter((project) => (customerId ? project.customerId === customerId : true))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const customers = (await scanByEntityType("Customer")).filter(
    (item): item is CustomerItem => item.entityType === "Customer"
  );
  const customerById = new Map(customers.map((customer) => [customer.id, customer] as const));

  const projects = auth.isPlatformAdmin
    ? rawProjects
    : rawProjects
        .map((project) => ({
          project,
          customer: project.projectMode === "internal_sandbox" ? null : customerById.get(project.customerId) || null,
        }))
        .filter(({ project, customer }) => project.projectMode === "internal_sandbox" || !customer || customerStatus(customer) !== "inactive")
        .map(({ project }) => project);

  const childCollectionsByProjectId = await loadProjectSummaryChildCollections(projects.map((project) => project.id));
  const response = await Promise.all(
    projects.map((project) => {
      const collections = childCollectionsByProjectId.get(project.id) || emptyProjectSummaryChildCollections();
      return toProjectListItem(project, collections.scope, {
        customer: project.projectMode === "internal_sandbox" ? null : customerById.get(project.customerId) || null,
        assignments: collections.assignments,
        proofLines: collections.proofLines,
        transit: collections.transit,
      })
    })
  );
  logPerf("listProjects", startedAt, {
    customerId: customerId || "all",
    projectCount: response.length,
    platformAdmin: auth.isPlatformAdmin,
  });
  projectListResponseCache.set(cacheKey, makeLocalCacheEntry(response, SHORT_CACHE_TTL_MS));
  return response;
}

type ProjectSummaryChildCollections = {
  scope: ProjectScopeItem | null;
  assignments: ProjectAssignmentItem[];
  proofLines: ProjectProofLineItem[];
  transit: ProjectTransitApprovalItem | null;
};

type ProjectRecordBundle = ProjectSummaryChildCollections & {
  project: ProjectItem | null;
  creatives: ProjectCreativeAssetItem[];
  allocationOverrideRows: ProjectAllocationOverrideRowItem[];
};

function emptyProjectSummaryChildCollections(): ProjectSummaryChildCollections {
  return {
    scope: null,
    assignments: [],
    proofLines: [],
    transit: null,
  };
}

async function loadProjectSummaryChildCollections(projectIds: string[]) {
  const entries = await Promise.all(
    projectIds.map(async (projectId) => {
      const items = await queryByPk(`PROJECT#${projectId}`);
      const collections = parseProjectRecordBundle(items);
      return [projectId, collections] as const;
    })
  );
  return new Map(entries);
}

async function getProjectDetail(projectId: string, auth: AuthContext) {
  const startedAt = Date.now();
  const bundle = await loadProjectRecordBundle(projectId);
  const project = bundle.project;
  if (!project) throw new HttpError(404, `Project ${projectId} not found`);
  assertProjectAccess(auth, project);
  const customer = await assertProjectCustomerReadable(auth, project);

  const projectSummary = await toProjectListItem(project, bundle.scope, {
    customer,
    proofLines: bundle.proofLines,
    transit: bundle.transit,
  });
  const response = {
    project: projectSummary,
    scope: {
      includedIds: bundle.scope?.includedIds || [],
    },
  };
  logPerf("getProjectDetail", startedAt, {
    projectId,
    projectMode: project.projectMode || "live",
    hasLiftOrder: !!project.liftOrderId,
  });
  return response;
}

async function getProjectWorkspace(projectId: string, auth: AuthContext) {
  const startedAt = Date.now();
  const cacheKey = projectScopedCacheKey("workspace", projectId, auth);
  const cached = readLocalCache(projectWorkspaceResponseCache.get(cacheKey));
  if (cached.hit) {
    logPerf("getProjectWorkspace.cacheHit", startedAt, { projectId }, 25, 250);
    return cached.value;
  }

  const bundle = await loadProjectRecordBundle(projectId);
  const project = bundle.project;
  if (!project) throw new HttpError(404, `Project ${projectId} not found`);
  assertProjectAccess(auth, project);
  const customer = await assertProjectCustomerReadable(auth, project);

  const scope = bundle.scope;
  const includedIds = new Set(scope?.includedIds || []);
  const [venue, venueInventory, maps, variants] = await Promise.all([
    findVenueById(project.venueId),
    listInventoryForVenue(project.venueId),
    listMapsForVenue(project.venueId),
    listVariantsForVenue(project.venueId),
  ]);
  const scopedInventory = venueInventory.filter((item) => includedIds.has(item.id));
  const assignmentMap = buildAssignmentMap(bundle.assignments);
  const assignmentStateMap = buildAssignmentStateMap(bundle.assignments);
  const assignedInventoryIdsByCreative = buildAssignedInventoryIdsByCreative(bundle.assignments, scopedInventory);
  const workspaceInventory = buildWorkspaceInventory(scopedInventory, assignmentMap, assignmentStateMap);

  const projectSummary = await toProjectListItem(project, scope, {
    customer,
    assignments: bundle.assignments,
    proofLines: bundle.proofLines,
    transit: bundle.transit,
  });

  const response = {
    project: {
      ...projectSummary,
      documentSourceMode: normalizeDocumentSourceMode(venue?.documentSourceMode, venue?.documentLibraryUrl),
      documentLibraryUrl: venue?.documentLibraryUrl || "",
    },
    scope: {
      includedIds: scope?.includedIds || [],
    },
    workspace: {
      maps: buildWorkspaceMaps(maps, workspaceInventory),
      variants: buildWorkspaceVariants(variants, scopedInventory),
      inventory: workspaceInventory,
      creatives: await Promise.all(
        bundle.creatives.map((creative) =>
          toWorkspaceCreative(creative, assignedInventoryIdsByCreative.get(creative.id) || [])
        )
      ),
    },
  };
  logPerf("getProjectWorkspace", startedAt, {
    projectId,
    projectMode: project.projectMode || "live",
    inventoryCount: workspaceInventory.length,
    creativeCount: bundle.creatives.length,
    mapCount: maps.length,
  });
  projectWorkspaceResponseCache.set(cacheKey, makeLocalCacheEntry(response, SHORT_CACHE_TTL_MS));
  return response;
}

async function getProjectAllocationOverrideResponse(projectId: string, auth: AuthContext) {
  const startedAt = Date.now();
  assertPlatformAdmin(auth);

  const bundle = await loadProjectRecordBundle(projectId);
  const project = bundle.project;
  if (!project) throw new HttpError(404, `Project ${projectId} not found`);
  assertProjectAccess(auth, project);

  const [customer, venue, venueInventory, maps, variants] = await Promise.all([
    project.projectMode === "internal_sandbox" ? Promise.resolve(null) : findCustomerById(project.customerId),
    findVenueById(project.venueId),
    listInventoryForVenue(project.venueId),
    listMapsForVenue(project.venueId),
    listVariantsForVenue(project.venueId),
  ]);
  if (customer) assertCustomerReadable(auth, customer);

  const scopeIds = new Set(bundle.scope?.includedIds || []);
  const assignmentMap = buildAssignmentMap(bundle.assignments);
  const proofById = new Map(bundle.proofLines.map((proof) => [proof.id, proof] as const));
  const creativeById = new Map(bundle.creatives.map((creative) => [creative.id, creative] as const));
  const signedUrlCache = new Map<string, Promise<string>>();
  const projectSummary = await toProjectListItem(project, bundle.scope, {
    customer,
    assignments: bundle.assignments,
    proofLines: bundle.proofLines,
    transit: bundle.transit,
  });

  const rows = await hydrateAllocationOverrideRows(bundle.allocationOverrideRows, {
    proofById,
    creativeById,
    variants,
    signedUrlCache,
  });

  const response = {
    project: {
      ...projectSummary,
      documentSourceMode: normalizeDocumentSourceMode(venue?.documentSourceMode, venue?.documentLibraryUrl),
      documentLibraryUrl: venue?.documentLibraryUrl || "",
    },
    scope: { includedIds: bundle.scope?.includedIds || [] },
    workspace: {
      maps: buildWorkspaceMaps(maps, buildWorkspaceInventory(venueInventory, assignmentMap, buildAssignmentStateMap(bundle.assignments))),
      variants: buildWorkspaceVariants(variants, venueInventory),
      inventory: venueInventory
        .slice()
        .sort((a, b) => (a.mapName || "").localeCompare(b.mapName || "") || a.inventoryId.localeCompare(b.inventoryId))
        .map((item) => ({
          id: item.inventoryId,
          recordId: item.id,
          locationName: item.mapName || undefined,
          mapId: item.locationId,
          mediaVariantKey: item.mediaVariantKey,
          unitNumber: item.unitNumber || "",
          x: item.x ?? 0.5,
          y: item.y ?? 0.5,
          isActive: item.isActive,
          isInScope: scopeIds.has(item.id),
          assignedCreativeId: assignmentMap.get(item.id) ?? null,
          assignmentUpdatedAt: buildAssignmentStateMap(bundle.assignments).get(item.id)?.updatedAt || null,
        })),
      creatives: await Promise.all(
        bundle.creatives.map((creative) => toWorkspaceCreative(creative, []))
      ),
    },
    proofLines: await Promise.all(
      bundle.proofLines.map((proof) => toProjectProofLineResponse(proof, variants, creativeById, signedUrlCache))
    ),
    override: {
      rows,
      activeCount: rows.filter((row) => !row.hidden).length,
      hiddenCount: rows.filter((row) => row.hidden).length,
      liftSync: {
        status: "not_supported" as const,
        message: "Lift allocation updates are not supported yet. These overrides affect Adspace proofing, allocation, and transit outputs only.",
      },
    },
  };
  logPerf("getProjectAllocationOverrideResponse", startedAt, {
    projectId,
    overrideRows: rows.length,
    inventoryCount: venueInventory.length,
  });
  return response;
}

async function createProjectAllocationOverrideRow(projectId: string, payload: Record<string, unknown>, auth: AuthContext) {
  assertPlatformAdmin(auth);
  const project = await findProjectById(projectId);
  if (!project) throw new HttpError(404, `Project ${projectId} not found`);
  assertProjectAccess(auth, project);

  const sourceProofLineId = optionalString(payload.sourceProofLineId) || null;
  const sourceCreativeId = optionalString(payload.sourceCreativeId) || null;
  const sourceProof = sourceProofLineId ? await findProjectProofLineById(projectId, sourceProofLineId) : null;
  const sourceCreative = sourceCreativeId ? await findProjectCreativeById(projectId, sourceCreativeId) : null;
  const sourceType = normalizeAllocationOverrideSourceType(payload.sourceType, sourceProof, sourceCreative);
  const now = isoNow();
  const assignedInventoryIds = await validateAllocationOverrideInventory(project.venueId, readStringArray(payload.assignedInventoryIds));
  const mediaVariantKey = optionalString(payload.mediaVariantKey) || sourceProof?.mediaVariantKey || sourceCreative?.mediaVariantKey || "";
  if (!mediaVariantKey) throw new HttpError(400, "mediaVariantKey is required");
  const hidden = optionalBoolean(payload.hidden) === true;
  if (hidden && !optionalString(payload.adminNote)) {
    throw new HttpError(400, "adminNote is required when removing an override row");
  }

  const row: ProjectAllocationOverrideRowItem = {
    entityType: "ProjectAllocationOverrideRow",
    id: makeId("allocovr"),
    projectId,
    sourceType,
    sourceProofLineId,
    sourceCreativeId,
    sourceLineNumber: optionalNumber(payload.sourceLineNumber) ?? sourceProof?.lineNumber ?? null,
    sourceLiftOrderLineId: optionalNumber(payload.sourceLiftOrderLineId) ?? sourceProof?.liftOrderLineId ?? null,
    sourceLiftProofingId: optionalNumber(payload.sourceLiftProofingId) ?? sourceProof?.liftProofingId ?? null,
    productLabel: optionalString(payload.productLabel) || sourceProof?.mediaVariantLabel || sourceCreative?.fileMeta || "Manual override line",
    dimensionsLabel: optionalString(payload.dimensionsLabel) || formatVariantLabel(mediaVariantKey),
    quantity: optionalNumber(payload.quantity) ?? sourceProof?.quantity ?? Math.max(1, assignedInventoryIds.length || sourceProof?.locations.length || 1),
    mediaVariantKey,
    assignedInventoryIds,
    hidden,
    hiddenAt: hidden ? now : null,
    hiddenByName: hidden ? auth.actorName : null,
    overrideAsset: normalizeOverrideAsset(payload.overrideAsset),
    liftSyncStatus: "not_supported",
    adminNote: optionalString(payload.adminNote) || null,
    createdAt: now,
    createdByName: auth.actorName,
    updatedAt: now,
    updatedByName: auth.actorName,
  };

  await putCore(buildProjectAllocationOverrideRowRecord(row));
  await writeAudit(`PROJECT#${projectId}`, "allocation_override.row_created", auth, {
    projectId,
    rowId: row.id,
    sourceType: row.sourceType,
    assignedInventoryIds: row.assignedInventoryIds,
    adminNote: row.adminNote || null,
  });
  invalidateProjectResponseCaches();
  return { row: (await hydrateAllocationOverrideRows([row], await loadAllocationOverrideHydrationContext(project)))[0] };
}

async function updateProjectAllocationOverrideRow(projectId: string, rowId: string, payload: Record<string, unknown>, auth: AuthContext) {
  assertPlatformAdmin(auth);
  const project = await findProjectById(projectId);
  if (!project) throw new HttpError(404, `Project ${projectId} not found`);
  assertProjectAccess(auth, project);
  const existing = await findProjectAllocationOverrideRowById(projectId, rowId);
  if (!existing) throw new HttpError(404, `Allocation override row ${rowId} not found`);

  const nextAssignedInventoryIds = hasOwn(payload, "assignedInventoryIds")
    ? await validateAllocationOverrideInventory(project.venueId, readStringArray(payload.assignedInventoryIds))
    : existing.assignedInventoryIds;
  const now = isoNow();
  const next: ProjectAllocationOverrideRowItem = {
    ...existing,
    productLabel: hasOwn(payload, "productLabel") ? requiredString(payload, "productLabel") : existing.productLabel,
    dimensionsLabel: hasOwn(payload, "dimensionsLabel") ? requiredString(payload, "dimensionsLabel") : existing.dimensionsLabel,
    quantity: optionalNumber(payload.quantity) ?? existing.quantity,
    mediaVariantKey: hasOwn(payload, "mediaVariantKey") ? requiredString(payload, "mediaVariantKey") : existing.mediaVariantKey,
    assignedInventoryIds: nextAssignedInventoryIds,
    overrideAsset: hasOwn(payload, "overrideAsset") ? normalizeOverrideAsset(payload.overrideAsset) : existing.overrideAsset,
    adminNote: hasOwn(payload, "adminNote") ? optionalString(payload.adminNote) || null : existing.adminNote,
    hidden: optionalBoolean(payload.hidden) ?? existing.hidden,
    hiddenAt: optionalBoolean(payload.hidden) === false ? null : existing.hiddenAt,
    hiddenByName: optionalBoolean(payload.hidden) === false ? null : existing.hiddenByName,
    updatedAt: now,
    updatedByName: auth.actorName,
  };

  await putCore(buildProjectAllocationOverrideRowRecord(next));
  await writeAudit(`PROJECT#${projectId}`, "allocation_override.row_updated", auth, {
    projectId,
    rowId: next.id,
    assignedInventoryIds: next.assignedInventoryIds,
    hasOverrideAsset: !!next.overrideAsset,
    adminNote: next.adminNote || null,
  });
  invalidateProjectResponseCaches();
  return { row: (await hydrateAllocationOverrideRows([next], await loadAllocationOverrideHydrationContext(project)))[0] };
}

async function removeProjectAllocationOverrideRow(projectId: string, rowId: string, payload: Record<string, unknown>, auth: AuthContext) {
  assertPlatformAdmin(auth);
  const project = await findProjectById(projectId);
  if (!project) throw new HttpError(404, `Project ${projectId} not found`);
  assertProjectAccess(auth, project);
  const existing = await findProjectAllocationOverrideRowById(projectId, rowId);
  if (!existing) throw new HttpError(404, `Allocation override row ${rowId} not found`);
  const adminNote = optionalString(payload.adminNote);
  if (!adminNote) throw new HttpError(400, "adminNote is required when removing an override row");
  const now = isoNow();
  const next: ProjectAllocationOverrideRowItem = {
    ...existing,
    hidden: true,
    hiddenAt: now,
    hiddenByName: auth.actorName,
    adminNote,
    updatedAt: now,
    updatedByName: auth.actorName,
  };
  await putCore(buildProjectAllocationOverrideRowRecord(next));
  await writeAudit(`PROJECT#${projectId}`, "allocation_override.row_removed", auth, {
    projectId,
    rowId: next.id,
    adminNote,
  });
  invalidateProjectResponseCaches();
  return { row: (await hydrateAllocationOverrideRows([next], await loadAllocationOverrideHydrationContext(project)))[0] };
}

function normalizeDocumentSourceMode(value: unknown, documentLibraryUrl?: string | null): "adspace" | "external" | "hybrid" {
  const normalized = optionalString(value).toLowerCase();
  if (normalized === "external" || normalized === "hybrid" || normalized === "adspace") {
    return normalized;
  }
  return optionalString(documentLibraryUrl) ? "hybrid" : "adspace";
}

async function getProjectHubBootstrap(projectId: string, auth: AuthContext) {
  const startedAt = Date.now();
  const cacheKey = projectScopedCacheKey("hub-bootstrap", projectId, auth);
  const cached = readLocalCache(projectHubBootstrapResponseCache.get(cacheKey));
  if (cached.hit) {
    logPerf("getProjectHubBootstrap.cacheHit", startedAt, { projectId }, 25, 250);
    return cached.value;
  }

  const workspace = (await getProjectWorkspace(projectId, auth)) as {
    project: ProjectListItem;
    scope: { includedIds: string[] };
    workspace: {
      maps: unknown[];
      variants: unknown[];
      inventory: unknown[];
      creatives: unknown[];
    };
  };
  const [transit, events] = await Promise.all([
    findProjectTransitApproval(projectId),
    rawListProjectAuditEvents(projectId),
  ]);
  const response = {
    ...workspace,
    viewer: {
      isPlatformAdmin: auth.isPlatformAdmin,
      role: auth.profile?.role || "customer_admin",
      customerIds: Array.from(auth.customerIds),
    },
    transit: {
      projectId: workspace.project.id,
      enabled: !!workspace.project.liftOrderId,
      status: transit?.status || "not_started",
      submittedByName: transit?.submittedByName || null,
      submittedDate: transit?.submittedDate || null,
      comment: transit?.comment || null,
      submittedAt: transit?.submittedAt || null,
      updatedAt: transit?.updatedAt || null,
    },
    events,
  };

  projectHubBootstrapResponseCache.set(cacheKey, makeLocalCacheEntry(response, SHORT_CACHE_TTL_MS));
  logPerf("getProjectHubBootstrap", startedAt, {
    projectId,
    projectMode: workspace.project.projectMode || "live",
    inventoryCount: Array.isArray(workspace.workspace?.inventory) ? workspace.workspace.inventory.length : 0,
    creativeCount: Array.isArray(workspace.workspace?.creatives) ? workspace.workspace.creatives.length : 0,
    eventCount: events.length,
  });
  return response;
}

async function getProjectLiftOrderUrl(projectId: string, auth: AuthContext) {
  const project = await findProjectById(projectId);
  if (!project) throw new HttpError(404, `Project ${projectId} not found`);
  assertProjectAccess(auth, project);
  await assertProjectCustomerReadable(auth, project);
  if (!project.liftOrderId) {
    throw new HttpError(400, "This project does not have a Lift order number yet.");
  }
  const settings = hydrateAppSettings(await findAppSettings(), auth.actorName);
  const url = await resolveLiftOrderUrlSafe(project, settings);
  if (!url) {
    throw new HttpError(404, "The Lift order link is not available yet.");
  }
  return { url };
}

async function listProjectCreativesResponse(projectId: string, auth: AuthContext) {
  const project = await findProjectById(projectId);
  if (!project) throw new HttpError(404, `Project ${projectId} not found`);
  assertProjectAccess(auth, project);
  await assertProjectCustomerReadable(auth, project);

  const creatives = await listProjectCreatives(projectId);
  return {
    creatives: await Promise.all(creatives.map((creative) => toWorkspaceCreative(creative, []))),
  };
}

async function listProjectProofsResponse(projectId: string, auth: AuthContext, forceSync = false) {
  const startedAt = Date.now();
  const project = await findProjectById(projectId);
  if (!project) throw new HttpError(404, `Project ${projectId} not found`);
  assertProjectAccess(auth, project);
  await assertProjectCustomerReadable(auth, project);

  let syncError: string | null = null;
  const syncAttempted = !!project.liftOrderId && forceSync;
  if (syncAttempted) {
    try {
      await syncProjectProofLinesFromLift(project, auth, { forceRead: forceSync });
    } catch (error) {
      console.warn("Lift proof sync failed while listing project proofs", { projectId, liftOrderId: project.liftOrderId, error });
      syncError = error instanceof Error ? error.message : "Lift proof sync could not refresh yet.";
    }
  }
  let [proofs, variants, creatives, allocationOverrideRows] = await Promise.all([
    listProjectProofLines(projectId),
    listVariantsForVenue(project.venueId),
    listProjectCreatives(projectId),
    listProjectAllocationOverrideRows(projectId),
  ]);

  const needsProofCommentBackfill =
    !!project.liftOrderId &&
    !syncAttempted &&
    proofs.some(
      (proof) =>
        proof.liftProofingId != null &&
        !!optionalString(proof.printTeamFeedback) &&
        proof.proofCommentCount == null &&
        (!proof.proofComments || proof.proofComments.length === 0)
    );
  if (needsProofCommentBackfill) {
    try {
      await syncProjectProofLinesFromLift(project, auth, { forceRead: true });
      proofs = await listProjectProofLines(projectId);
      allocationOverrideRows = await listProjectAllocationOverrideRows(projectId);
    } catch (error) {
      console.warn("Lift proof comment backfill failed while listing project proofs", {
        projectId,
        liftOrderId: project.liftOrderId,
        error,
      });
    }
  }

  const creativesById = new Map(creatives.map((creative) => [creative.id, creative] as const));
  const signedUrlCache = new Map<string, Promise<string>>();
  const hydratedOverrides = await hydrateAllocationOverrideRows(allocationOverrideRows, {
    proofById: new Map(proofs.map((proof) => [proof.id, proof] as const)),
    creativeById: creativesById,
    variants,
    signedUrlCache,
  });
  const overrideByProofLineId = new Map(
    hydratedOverrides
      .filter((row) => row.sourceProofLineId)
      .map((row) => [row.sourceProofLineId as string, row] as const)
  );
  const syncSettings = hydrateAppSettings(await findAppSettings(), auth.actorName);
  const syncState = getProjectProofSyncState(project, proofs, syncSettings);

  const proofResponses = await Promise.all(
    proofs.map((proof) => toProjectProofLineResponse(proof, variants, creativesById, signedUrlCache))
  );
  const response = {
    proofs: proofResponses
      .map((proof) => applyAllocationOverrideToProofResponse(proof, overrideByProofLineId.get(proof.lineItemId)))
      .filter((proof) => proof != null),
    sync: {
      attempted: syncAttempted,
      ok: !syncError,
      message: syncError,
      syncedAt: syncAttempted && !syncError ? isoNow() : null,
      lastLiftProofSyncAt: syncState.lastLiftProofSyncAt,
      lastLiftProofChangeAt: syncState.lastLiftProofChangeAt,
      autoRefreshEligible: syncState.autoRefreshEligible,
      autoRefreshRecommended: !syncAttempted && syncState.autoRefreshRecommended,
      autoRefreshPausedReason: syncState.autoRefreshPausedReason,
    },
  };
  logPerf("listProjectProofsResponse", startedAt, {
    projectId,
    projectMode: project.projectMode || "live",
    proofCount: proofs.length,
  });
  return response;
}

function getProjectProofSyncState(project: ProjectItem, proofs: ProjectProofLineItem[], settings: AppSettingsItem) {
  const lastLiftProofSyncAt =
    project.lastLiftProofSyncAt ||
    latestIso(proofs.map((proof) => proof.lastLiftSyncAt || null)) ||
    null;
  const lastLiftProofChangeAt =
    project.lastLiftProofChangeAt ||
    latestIso(proofs.map((proof) => proof.updatedAt || proof.lastLiftSyncAt || null)) ||
    project.orderSubmittedAt ||
    null;
  const hasInteractiveProofs =
    proofs.length > 0 &&
    proofs.some((proof) => proof.status !== "approved" || proof.revised || !(proof.liftProofThumbUrl || proof.liftProofFullUrl || proof.proofObjectKey));
  const autoRefreshEligible =
    !!project.liftOrderId &&
    !project.productionReleasedAt &&
    settings.integrations.liftProofSyncEnabled &&
    settings.integrations.primaryPrintVendor.enabled &&
    hasInteractiveProofs;
  const quietMs = lastLiftProofChangeAt ? Date.now() - Date.parse(lastLiftProofChangeAt) : 0;
  const syncAgeMs = lastLiftProofSyncAt ? Date.now() - Date.parse(lastLiftProofSyncAt) : Number.POSITIVE_INFINITY;
  const quieted = Number.isFinite(quietMs) && quietMs > LIFT_PROOF_AUTO_SYNC_QUIET_MS;
  const stale = !Number.isFinite(syncAgeMs) || syncAgeMs > LIFT_PROOF_AUTO_SYNC_STALE_MS;
  return {
    lastLiftProofSyncAt,
    lastLiftProofChangeAt,
    autoRefreshEligible,
    autoRefreshRecommended: autoRefreshEligible && !quieted && stale,
    autoRefreshPausedReason: autoRefreshEligible && quieted ? "inactive_14_days" : null,
  };
}

function latestIso(values: Array<string | null | undefined>) {
  let latest: string | null = null;
  let latestMs = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!value) continue;
    const ms = Date.parse(value);
    if (!Number.isFinite(ms) || ms <= latestMs) continue;
    latestMs = ms;
    latest = value;
  }
  return latest;
}

async function getProjectTransitResponse(projectId: string, auth: AuthContext) {
  const project = await findProjectById(projectId);
  if (!project) throw new HttpError(404, `Project ${projectId} not found`);
  assertProjectAccess(auth, project);
  await assertProjectCustomerReadable(auth, project);

  const transit = await findProjectTransitApproval(projectId);
  return {
    transit: toProjectTransitResponse(transit, project),
  };
}

async function listProjectDocumentsResponse(projectId: string, auth: AuthContext) {
  const project = await findProjectById(projectId);
  if (!project) throw new HttpError(404, `Project ${projectId} not found`);
  assertProjectAccess(auth, project);
  await assertProjectCustomerReadable(auth, project);

  const documents = await listProjectDocuments(projectId);
  return Promise.all(documents.map((document) => toProjectDocumentResponse(document)));
}

async function createProjectDocument(projectId: string, payload: Record<string, unknown>, auth: AuthContext) {
  const project = await findProjectById(projectId);
  if (!project) throw new HttpError(404, `Project ${projectId} not found`);
  assertProjectAccess(auth, project);
  await assertProjectMutable(auth, project, "upload project documents");

  const bucketName = requiredString(payload, "bucketName");
  const objectKey = requiredString(payload, "objectKey");
  const filename = requiredString(payload, "filename");
  const now = isoNow();

  const document: ProjectDocumentItem = {
    entityType: "ProjectDocument",
    id: makeId("doc"),
    projectId,
    category: "project_document",
    assetKind: "projectDocument",
    bucketName,
    objectKey,
    thumbObjectKey: optionalString(payload.thumbObjectKey),
    filename,
    contentType: optionalString(payload.contentType),
    thumbContentType: optionalString(payload.thumbContentType),
    sizeBytes: optionalNumber(payload.sizeBytes),
    source: "uploaded",
    uploadedByName: auth.actorName,
    createdAt: now,
    updatedAt: now,
  };

  await putCore(buildProjectDocumentRecord(document));
  await writeAudit(`PROJECT#${projectId}`, "document.uploaded", auth, {
    documentId: document.id,
    category: document.category,
    assetKind: document.assetKind,
    filename: document.filename,
    contentType: document.contentType || null,
    sizeBytes: document.sizeBytes || null,
    source: document.source,
  });

  return {
    document: await toProjectDocumentResponse(document),
  };
}

async function createProjectCreativePackage(projectId: string, auth: AuthContext) {
  const bundle = await loadProjectRecordBundle(projectId);
  const project = bundle.project;
  if (!project) throw new HttpError(404, `Project ${projectId} not found`);
  assertProjectAccess(auth, project);
  await assertProjectCustomerReadable(auth, project);
  if (!GENERATED_DOCS_BUCKET_NAME) throw new HttpError(500, "Generated documents bucket is not configured.");

  const [inventory, variants] = await Promise.all([
    listInventoryForVenue(project.venueId),
    listVariantsForVenue(project.venueId),
  ]);
  const includedIds = new Set(
    bundle.scope?.includedIds?.length
      ? bundle.scope.includedIds
      : inventory.filter((item) => item.isActive).map((item) => item.id)
  );
  const includedInventory = inventory
    .filter((item) => includedIds.has(item.id))
    .sort(
      (a, b) =>
        (a.variantLabel || a.mediaVariantKey).localeCompare(b.variantLabel || b.mediaVariantKey) ||
        a.inventoryId.localeCompare(b.inventoryId)
    );
  const assignmentsByInventoryId = new Map(bundle.assignments.map((assignment) => [assignment.inventoryId, assignment]));
  const creativesById = new Map(bundle.creatives.map((creative) => [creative.id, creative]));
  const variantsByKey = new Map(variants.map((variant) => [variant.mediaVariantKey, variant]));
  const proofLinesByCreativeId = new Map<string, ProjectProofLineItem[]>();
  for (const proof of bundle.proofLines) {
    if (!proof.clientCreativeId) continue;
    const existing = proofLinesByCreativeId.get(proof.clientCreativeId) || [];
    existing.push(proof);
    proofLinesByCreativeId.set(proof.clientCreativeId, existing);
  }

  const now = isoNow();
  const adspaceOrderNumber = getProjectAdspaceOrderNumber(project);
  const csvHeaders = [
    "row_type",
    "project_id",
    "project_title",
    "as360_order_number",
    "lift_order_id",
    "contract_number",
    "po_number",
    "customer_name",
    "source_customer_name",
    "market_name",
    "venue_name",
    "inventory_record_id",
    "inventory_id",
    "map_name",
    "media",
    "media_variant_key",
    "media_variant_label",
    "unit_number",
    "trim_height",
    "trim_width",
    "safe_height",
    "safe_width",
    "assignment_status",
    "creative_id",
    "filename",
    "file_meta",
    "revised",
    "proof_line_numbers",
    "lift_order_line_ids",
    "vendor_route",
    "external_vendor_id",
    "assignment_updated_at",
  ];
  const manifestRows: Array<Record<string, string | number | boolean | null>> = [];
  const assignedCreativeIds = new Set<string>();

  for (const item of includedInventory) {
    const assignment = assignmentsByInventoryId.get(item.id);
    const creative = assignment?.creativeId ? creativesById.get(assignment.creativeId) : null;
    if (creative) assignedCreativeIds.add(creative.id);
    const variant = variantsByKey.get(item.mediaVariantKey);
    const vendorId = optionalString((variant as Record<string, unknown> | undefined)?.externalVendorId) || null;
    const proofLines = creative ? proofLinesByCreativeId.get(creative.id) || [] : [];

    manifestRows.push({
      row_type: "inventory_assignment",
      project_id: project.id,
      project_title: project.title,
      as360_order_number: adspaceOrderNumber,
      lift_order_id: project.liftOrderId || "",
      contract_number: project.contractNumber || "",
      po_number: project.poNumber || "",
      customer_name: project.customerName,
      source_customer_name: project.sourceCustomerName || "",
      market_name: project.marketName,
      venue_name: project.venueName,
      inventory_record_id: item.id,
      inventory_id: item.inventoryId,
      map_name: item.mapName || "",
      media: item.mediaType || variant?.mediaType || "",
      media_variant_key: item.mediaVariantKey,
      media_variant_label: item.variantLabel || variant?.label || item.mediaVariantKey,
      unit_number: item.unitNumber || variant?.unitNumber || "",
      trim_height: item.trimHeight ?? "",
      trim_width: item.trimWidth ?? "",
      safe_height: item.safeHeight ?? "",
      safe_width: item.safeWidth ?? "",
      assignment_status: creative ? "assigned" : "unassigned",
      creative_id: creative?.id || "",
      filename: creative?.filename || "",
      file_meta: creative?.fileMeta || "",
      revised: proofLines.some((proof) => proof.revised),
      proof_line_numbers: proofLines.map((proof) => proof.lineNumber).join("|"),
      lift_order_line_ids: proofLines.map((proof) => proof.liftOrderLineId).filter(Boolean).join("|"),
      vendor_route: vendorId ? "external_vendor" : "primary_print_vendor",
      external_vendor_id: vendorId || "",
      assignment_updated_at: assignment?.updatedAt || "",
    });
  }

  for (const creative of bundle.creatives) {
    if (assignedCreativeIds.has(creative.id)) continue;
    const variant = variantsByKey.get(creative.mediaVariantKey);
    const proofLines = proofLinesByCreativeId.get(creative.id) || [];
    manifestRows.push({
      row_type: "unassigned_artwork",
      project_id: project.id,
      project_title: project.title,
      as360_order_number: adspaceOrderNumber,
      lift_order_id: project.liftOrderId || "",
      contract_number: project.contractNumber || "",
      po_number: project.poNumber || "",
      customer_name: project.customerName,
      source_customer_name: project.sourceCustomerName || "",
      market_name: project.marketName,
      venue_name: project.venueName,
      inventory_record_id: "",
      inventory_id: "",
      map_name: "",
      media: variant?.mediaType || "",
      media_variant_key: creative.mediaVariantKey,
      media_variant_label: variant?.label || creative.mediaVariantKey,
      unit_number: variant?.unitNumber || "",
      trim_height: "",
      trim_width: "",
      safe_height: "",
      safe_width: "",
      assignment_status: "unassigned_artwork",
      creative_id: creative.id,
      filename: creative.filename,
      file_meta: creative.fileMeta,
      revised: proofLines.some((proof) => proof.revised),
      proof_line_numbers: proofLines.map((proof) => proof.lineNumber).join("|"),
      lift_order_line_ids: proofLines.map((proof) => proof.liftOrderLineId).filter(Boolean).join("|"),
      vendor_route: "unassigned",
      external_vendor_id: "",
      assignment_updated_at: "",
    });
  }

  const zip = new JSZip();
  const usedFilenames = new Map<string, number>();
  const missingFiles: Array<{ creativeId: string; filename: string; reason: string }> = [];
  const packageFiles: Array<{ creativeId: string; filename: string; packagePath: string; sizeBytes?: number | null; contentType?: string | null }> = [];

  for (const creative of bundle.creatives) {
    const packageFilename = uniquePackageFilename(creative.filename, usedFilenames);
    const packagePath = `artwork/${packageFilename}`;
    try {
      const content = await getS3ObjectBuffer(creative.bucketName, creative.objectKey);
      zip.file(packagePath, content);
      packageFiles.push({
        creativeId: creative.id,
        filename: creative.filename,
        packagePath,
        sizeBytes: creative.sizeBytes ?? content.length,
        contentType: creative.contentType || null,
      });
    } catch (error) {
      missingFiles.push({
        creativeId: creative.id,
        filename: creative.filename,
        reason: error instanceof Error ? error.message : "Unable to read artwork asset",
      });
    }
  }

  const manifest = {
    generatedAt: now,
    generatedByName: auth.actorName,
    project: {
      id: project.id,
      title: project.title,
      projectMode: project.projectMode || "live",
      customerId: project.customerId,
      customerName: project.customerName,
      sourceCustomerId: project.sourceCustomerId || null,
      sourceCustomerName: project.sourceCustomerName || null,
      marketId: project.marketId,
      marketName: project.marketName,
      venueId: project.venueId,
      venueName: project.venueName,
      adspaceOrderNumber,
      liftOrderId: project.liftOrderId || null,
      contractNumber: project.contractNumber || null,
      poNumber: project.poNumber || null,
      artworkDueDate: project.artworkDueDate || null,
      postDate: project.postDate || null,
    },
    summary: {
      artworkFileCount: bundle.creatives.length,
      packagedFileCount: packageFiles.length,
      missingFileCount: missingFiles.length,
      includedInventoryCount: includedInventory.length,
      assignedInventoryCount: manifestRows.filter((row) => row.row_type === "inventory_assignment" && row.assignment_status === "assigned").length,
      unassignedInventoryCount: manifestRows.filter((row) => row.row_type === "inventory_assignment" && row.assignment_status !== "assigned").length,
      unassignedArtworkCount: manifestRows.filter((row) => row.row_type === "unassigned_artwork").length,
    },
    files: packageFiles,
    missingFiles,
    allocationRows: manifestRows,
    vendorScoping: {
      currentScope: "project",
      note: "Future vendor portals can filter allocationRows by vendor_route and external_vendor_id so vendors only receive their portion of the project.",
    },
  };

  zip.file("manifest/creative-allocation.csv", buildCsv(csvHeaders, manifestRows));
  zip.file("manifest/creative-allocation.json", JSON.stringify(manifest, null, 2));

  const zipBuffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  const id = makeId("doc");
  const filename = `creative-allocation-${adspaceOrderNumber}.zip`;
  const objectKey = `order-packages/${project.id}/${now.replace(/[:.]/g, "-")}-${filename}`;
  await s3.send(
    new PutObjectCommand({
      Bucket: GENERATED_DOCS_BUCKET_NAME,
      Key: objectKey,
      Body: zipBuffer,
      ContentType: "application/zip",
    })
  );

  const document: ProjectDocumentItem = {
    entityType: "ProjectDocument",
    id,
    projectId,
    category: "order_package",
    assetKind: "orderPackage",
    bucketName: GENERATED_DOCS_BUCKET_NAME,
    objectKey,
    filename,
    contentType: "application/zip",
    sizeBytes: zipBuffer.length,
    source: "generated",
    uploadedByName: auth.actorName,
    createdAt: now,
    updatedAt: now,
  };

  await putCore(buildProjectDocumentRecord(document));
  await writeAudit(`PROJECT#${projectId}`, "document.creative_package_generated", auth, {
    projectId,
    documentId: document.id,
    filename: document.filename,
    artworkFileCount: manifest.summary.artworkFileCount,
    packagedFileCount: manifest.summary.packagedFileCount,
    includedInventoryCount: manifest.summary.includedInventoryCount,
    missingFileCount: manifest.summary.missingFileCount,
  });

  return {
    document: await toProjectDocumentResponse(document),
    manifestSummary: manifest.summary,
  };
}

function coerceShareWorkspace(value: unknown): ShareWorkspace {
  if (
    value === "hub" ||
    value === "artwork" ||
    value === "assignment" ||
    value === "proofs" ||
    value === "transit"
  ) {
    return value;
  }
  return "hub";
}

async function logProjectErrorEvent(projectId: string, body: Record<string, unknown>, auth: AuthContext) {
  const project = await findProjectById(projectId);
  if (!project) throw new HttpError(404, `Project ${projectId} not found`);
  assertProjectAccess(auth, project);

  const message = String(body.message || "").trim();
  const surface = String(body.surface || "").trim();
  if (!message) throw new HttpError(400, "message is required");
  if (!surface) throw new HttpError(400, "surface is required");

  const severity =
    body.severity === "info" || body.severity === "warning" || body.severity === "error"
      ? body.severity
      : "error";

  await recordWorkflowError(`PROJECT#${projectId}`, auth, {
    severity,
    errorCode: String(body.errorCode || "workflow_error"),
    message,
    surface,
    actionType: body.actionType ? String(body.actionType) : undefined,
    metadata: typeof body.metadata === "object" && body.metadata ? (body.metadata as Record<string, unknown>) : undefined,
  });

  return { ok: true as const };
}

async function createProject(payload: Record<string, unknown>, auth: AuthContext) {
  const venueId = requiredString(payload, "venueId");
  const title = requiredString(payload, "title");
  const requestedCustomerId = requiredString(payload, "customerId");
  const requestedMarketId = requiredString(payload, "marketId");
  const projectMode = optionalProjectMode(payload.projectMode) || "live";

  const customer =
    projectMode === "internal_sandbox"
      ? await ensureInternalSandboxCustomer(auth.actorName)
      : await findCustomerById(requestedCustomerId);
  if (!customer) throw new HttpError(404, `Customer ${requestedCustomerId} not found`);
  if (projectMode === "internal_sandbox") {
    assertPlatformAdmin(auth);
  } else {
    assertCustomerAccess(auth, requestedCustomerId);
    assertCustomerMutable(auth, customer, "create projects");
  }

  const market = await findMarketById(requestedMarketId);
  if (!market) throw new HttpError(404, `Market ${requestedMarketId} not found`);

  const venue = await findVenueById(venueId);
  if (!venue) throw new HttpError(404, `Venue ${venueId} not found`);
  if (projectMode === "internal_sandbox") {
    if (venue.marketId !== market.id) {
      throw new HttpError(400, `Venue ${venueId} does not belong to market ${requestedMarketId}`);
    }
  } else if (market.customerId !== requestedCustomerId) {
    throw new HttpError(400, `Market ${requestedMarketId} does not belong to customer ${requestedCustomerId}`);
  } else if (venue.customerId !== requestedCustomerId || venue.marketId !== requestedMarketId) {
    throw new HttpError(400, `Venue ${venueId} does not belong to the selected customer and market`);
  }

  const includedIds = (await listInventoryForVenue(venueId))
    .filter((item) => item.isActive)
    .map((item) => item.id);

  const now = isoNow();
  const projectId = makeId("proj");
  const adspaceOrderNumber = await generateUniqueAdspaceOrderNumber();

  const project: ProjectItem = {
    entityType: "Project",
    id: projectId,
    projectMode,
    customerId: customer.id,
    customerName: customer.name,
    sourceCustomerId: projectMode === "internal_sandbox" ? venue.customerId : undefined,
    sourceCustomerName: projectMode === "internal_sandbox" ? venue.customerName : undefined,
    marketId: market.id,
    marketName: market.name,
    venueId: venue.id,
    venueName: venue.name,
    title,
    poNumber: optionalString(payload.poNumber),
    adspaceOrderNumber,
    extId: makeAdspaceExternalId(adspaceOrderNumber),
    liftOrderId: null,
    orderSubmittedAt: null,
    orderSubmittedByName: null,
    orderSubmissionNote: null,
    productionReleasedAt: null,
    productionReleasedByName: null,
    productionReleaseNote: null,
    artworkDueDate: optionalDate(payload.artworkDueDate),
    postDate: optionalDate(payload.postDate),
    endClientName: optionalString(payload.endClientName),
    contractNumber: optionalString(payload.contractNumber),
    createdAt: now,
    updatedAt: now,
  };

  const scope: ProjectScopeItem = {
    entityType: "ProjectScope",
    id: projectId,
    projectId,
    includedIds,
    createdAt: now,
    updatedAt: now,
  };

  await putCore(buildProjectRecord(project));
  await putCore(buildProjectScopeRecord(scope));
  await writeAudit(`PROJECT#${projectId}`, "project.created", auth, {
    projectId,
    customerId: customer.id,
    marketId: market.id,
    venueId: venue.id,
    projectMode,
    sourceCustomerId: project.sourceCustomerId || null,
    includedCount: includedIds.length,
  });

  return {
    project: await toProjectListItem(project, scope),
    scope: { includedIds },
  };
}

async function updateProject(projectId: string, payload: Record<string, unknown>, auth: AuthContext) {
  const existing = await findProjectById(projectId);
  if (!existing) throw new HttpError(404, `Project ${projectId} not found`);
  assertProjectAccess(auth, existing);
  await assertProjectMutable(auth, existing, "edit projects");

  let nextProject: ProjectItem = {
    ...existing,
    title: optionalString(payload.title) || existing.title,
    poNumber: optionalString(payload.poNumber) || undefined,
    artworkDueDate: optionalDate(payload.artworkDueDate),
    postDate: optionalDate(payload.postDate),
    endClientName: optionalString(payload.endClientName) || undefined,
    contractNumber: optionalString(payload.contractNumber) || undefined,
    updatedAt: isoNow(),
  };
  let liftOrderOverride: { previous: string | null; next: string | null; note: string | null } | null = null;

  if (Object.prototype.hasOwnProperty.call(payload, "liftOrderId")) {
    assertPlatformAdmin(auth);
    const requestedLiftOrderId = optionalString(payload.liftOrderId);
    const normalizedLiftOrderId = requestedLiftOrderId ? requestedLiftOrderId.toUpperCase() : null;
    if (normalizedLiftOrderId && !/^[A-Z0-9-]{3,40}$/.test(normalizedLiftOrderId)) {
      throw new HttpError(400, "Lift order number must be 3-40 letters, numbers, or dashes.");
    }
    const previousLiftOrderId = existing.liftOrderId || null;
    if (previousLiftOrderId !== normalizedLiftOrderId) {
      liftOrderOverride = {
        previous: previousLiftOrderId,
        next: normalizedLiftOrderId,
        note: optionalString(payload.liftOrderOverrideNote) || null,
      };
      nextProject = {
        ...nextProject,
        liftOrderId: normalizedLiftOrderId,
        liftOrderLookupSource: normalizedLiftOrderId ? "manual_override" : null,
        liftOrderOverriddenAt: nextProject.updatedAt,
        liftOrderOverriddenByName: auth.actorName,
        liftOrderOverrideNote: liftOrderOverride.note,
      };
    }
  }

  let nextScope = (await findProjectScopeByProjectId(projectId)) || {
    entityType: "ProjectScope" as const,
    id: projectId,
    projectId,
    includedIds: [],
    createdAt: existing.createdAt,
    updatedAt: existing.updatedAt,
  };

  const requestedIncludedIds = Array.isArray(payload.includedIds)
    ? Array.from(
        new Set(
          payload.includedIds
            .filter((value): value is string => typeof value === "string")
            .map((value) => value.trim())
            .filter(Boolean)
        )
      )
    : null;

  const requestedVenueId = optionalString(payload.venueId);
  const isVenueChange = !!requestedVenueId && requestedVenueId !== existing.venueId;

  if (isVenueChange) {
    const projectItems = await queryByPk(`PROJECT#${projectId}`);
    const hasWorkflowChildren = projectItems.some((item) => {
      const sk = String(item.sk || "");
      return sk !== "PROJECT" && sk !== "SCOPE";
    });
    if (hasWorkflowChildren) {
      throw new HttpError(400, "Venue changes are locked because this project already has downstream workflow data.");
    }

    const venue = await findVenueById(requestedVenueId);
    if (!venue) throw new HttpError(404, `Venue ${requestedVenueId} not found`);
    assertCustomerAccess(auth, venue.customerId);

    const customer = await findCustomerById(venue.customerId);
    if (!customer) throw new HttpError(404, `Customer ${venue.customerId} not found`);

    const market = await findMarketById(venue.marketId);
    if (!market) throw new HttpError(404, `Market ${venue.marketId} not found`);

    const includedIds = (await listInventoryForVenue(venue.id))
      .filter((item) => item.isActive)
      .map((item) => item.id);

    nextProject = {
      ...nextProject,
      customerId: customer.id,
      customerName: customer.name,
      marketId: market.id,
      marketName: market.name,
      venueId: venue.id,
      venueName: venue.name,
    };

    nextScope = {
      ...nextScope,
      includedIds,
      updatedAt: nextProject.updatedAt,
    };
  }

  if (requestedIncludedIds) {
    if (existing.liftOrderId) {
      throw new HttpError(400, "Included inventory cannot be edited after the order has been submitted.");
    }

    const venueInventoryIds = new Set((await listInventoryForVenue(nextProject.venueId)).map((item) => item.id));
    const invalidIds = requestedIncludedIds.filter((id) => !venueInventoryIds.has(id));
    if (invalidIds.length > 0) {
      throw new HttpError(400, `One or more selected inventory items are not valid for this venue.`);
    }

    nextScope = {
      ...nextScope,
      includedIds: requestedIncludedIds,
      updatedAt: nextProject.updatedAt,
    };
  }

  await putCore(buildProjectRecord(nextProject));
  await putCore(buildProjectScopeRecord(nextScope));
  if (liftOrderOverride) {
    const staleProofs = await listProjectProofLines(projectId);
    await Promise.all(staleProofs.map((proof) => deleteProjectProofLine(proof)));
  }
  await writeAudit(`PROJECT#${projectId}`, "project.updated", auth, {
    projectId,
    title: nextProject.title,
    venueId: nextProject.venueId,
    includedCount: nextScope.includedIds.length,
  });
  if (liftOrderOverride) {
    await writeAudit(`PROJECT#${projectId}`, "project.lift_order_overridden", auth, {
      projectId,
      previousLiftOrderId: liftOrderOverride.previous,
      nextLiftOrderId: liftOrderOverride.next,
      note: liftOrderOverride.note,
    });
  }

  return {
    project: await toProjectListItem(nextProject, nextScope),
    scope: { includedIds: nextScope.includedIds },
  };
}

async function createProjectCreative(projectId: string, payload: Record<string, unknown>, auth: AuthContext) {
  const project = await findProjectById(projectId);
  if (!project) throw new HttpError(404, `Project ${projectId} not found`);
  assertProjectAccess(auth, project);
  await assertProjectMutable(auth, project, "upload artwork");

  const bucketName = requiredString(payload, "bucketName");
  const objectKey = requiredString(payload, "objectKey");
  const filename = requiredString(payload, "filename");
  const mediaVariantKey = requiredString(payload, "mediaVariantKey");
  const fileMeta = requiredString(payload, "fileMeta");
  const color = requiredString(payload, "color");
  const thumbObjectKey = optionalString(payload.thumbObjectKey) || undefined;

  if (bucketName !== PROJECT_ASSETS_BUCKET_NAME) {
    throw new HttpError(400, "Creative assets must be stored in the configured project assets bucket.");
  }

  const now = isoNow();
  const creative: ProjectCreativeAssetItem = {
    entityType: "CreativeAsset",
    id: makeId("creative"),
    projectId,
    filename,
    fileMeta,
    mediaVariantKey,
    color,
    bucketName,
    objectKey,
    thumbObjectKey,
    contentType: optionalString(payload.contentType) || undefined,
    thumbContentType: optionalString(payload.thumbContentType) || undefined,
    sizeBytes: optionalNumber(payload.sizeBytes),
    uploadedByName: auth.actorName,
    createdAt: now,
    updatedAt: now,
  };

  await putCore(buildProjectCreativeRecord(creative));
  await writeAudit(`PROJECT#${projectId}`, "creative.uploaded", auth, {
    projectId,
    creativeId: creative.id,
    filename: creative.filename,
    mediaVariantKey: creative.mediaVariantKey,
  });
  await dispatchProjectNotificationEvent({
    project,
    auth,
    eventType: "artwork_uploaded",
    occurredAt: now,
    detail: {
      filename: creative.filename,
      mediaVariantKey: creative.mediaVariantKey,
    },
  });

  return {
    creative: await toWorkspaceCreative(creative, []),
  };
}

async function updateProjectCreative(
  projectId: string,
  creativeId: string,
  payload: Record<string, unknown>,
  auth: AuthContext
) {
  const project = await findProjectById(projectId);
  if (!project) throw new HttpError(404, `Project ${projectId} not found`);
  assertProjectAccess(auth, project);
  await assertProjectMutable(auth, project, "replace artwork");

  const existing = await findProjectCreativeById(projectId, creativeId);
  if (!existing) throw new HttpError(404, `Creative ${creativeId} not found`);

  const bucketName = requiredString(payload, "bucketName");
  const objectKey = requiredString(payload, "objectKey");
  if (bucketName !== PROJECT_ASSETS_BUCKET_NAME) {
    throw new HttpError(400, "Creative assets must be stored in the configured project assets bucket.");
  }

  const nextCreative: ProjectCreativeAssetItem = {
    ...existing,
    bucketName,
    objectKey,
    thumbObjectKey: optionalString(payload.thumbObjectKey) || undefined,
    filename: optionalString(payload.filename) || existing.filename,
    fileMeta: optionalString(payload.fileMeta) || existing.fileMeta,
    contentType: optionalString(payload.contentType) || existing.contentType,
    thumbContentType: optionalString(payload.thumbContentType) || existing.thumbContentType,
    sizeBytes: optionalNumber(payload.sizeBytes) ?? existing.sizeBytes,
    updatedAt: isoNow(),
    uploadedByName: auth.actorName,
  };

  await putCore(buildProjectCreativeRecord(nextCreative));
  await writeAudit(`PROJECT#${projectId}`, "creative.updated", auth, {
    projectId,
    creativeId,
    filename: nextCreative.filename,
    mediaVariantKey: nextCreative.mediaVariantKey,
  });

  const scope = await findProjectScopeByProjectId(projectId);
  const includedIds = new Set(scope?.includedIds || []);
  const scopedInventory = (await listInventoryForVenue(project.venueId)).filter((item) => includedIds.has(item.id));
  const assignments = await listProjectAssignments(projectId);
  const assignedInventoryIdsByCreative = buildAssignedInventoryIdsByCreative(assignments, scopedInventory);

  return {
    creative: await toWorkspaceCreative(nextCreative, assignedInventoryIdsByCreative.get(nextCreative.id) || []),
  };
}

async function deleteProjectCreative(projectId: string, creativeId: string, auth: AuthContext) {
  const project = await findProjectById(projectId);
  if (!project) throw new HttpError(404, `Project ${projectId} not found`);
  assertProjectAccess(auth, project);
  await assertProjectMutable(auth, project, "delete artwork");

  const creative = await findProjectCreativeById(projectId, creativeId);
  if (!creative) throw new HttpError(404, `Creative ${creativeId} not found`);

  const assignments = await listProjectAssignments(projectId);
  const assignmentsToClear = assignments.filter((assignment) => assignment.creativeId === creativeId);
  const proofs = await listProjectProofLines(projectId);
  const proofsToDelete = proofs.filter((proof) => proof.clientCreativeId === creativeId);
  const now = isoNow();

  await Promise.all(
    assignmentsToClear.map((assignment) =>
      putCore(
        buildProjectAssignmentRecord({
          ...assignment,
          creativeId: null,
          updatedAt: now,
          updatedByName: auth.actorName,
        })
      )
    )
  );

  await Promise.all(
    proofsToDelete.map((proof) => deleteCore(`PROJECT#${proof.projectId}`, `PROOF#${String(proof.lineNumber).padStart(4, "0")}#${proof.id}`))
  );

  await deleteCore(`PROJECT#${creative.projectId}`, `CREATIVE#${creative.createdAt}#${creative.id}`);
  await Promise.all([
    deleteS3Object(creative.bucketName, creative.objectKey),
    creative.thumbObjectKey ? deleteS3Object(creative.bucketName, creative.thumbObjectKey) : Promise.resolve(),
  ]);

  await writeAudit(`PROJECT#${projectId}`, "creative.deleted", auth, {
    projectId,
    creativeId,
    filename: creative.filename,
    clearedAssignmentIds: assignmentsToClear.map((assignment) => assignment.inventoryId),
    deletedProofLineIds: proofsToDelete.map((proof) => proof.id),
  });

  return {
    deletedCreativeId: creativeId,
    clearedAssignmentIds: assignmentsToClear.map((assignment) => assignment.inventoryId),
    deletedProofLineIds: proofsToDelete.map((proof) => proof.id),
  };
}

async function submitProjectOrder(projectId: string, payload: Record<string, unknown>, auth: AuthContext) {
  if (optionalBoolean(payload.previewOnly)) {
    return previewProjectOrderSubmission(projectId, payload, auth);
  }
  const project = await findProjectById(projectId);
  if (!project) throw new HttpError(404, `Project ${projectId} not found`);
  assertProjectAccess(auth, project);
  await assertProjectMutable(auth, project, "submit orders");

  if (project.liftOrderId) {
    throw new HttpError(400, `Project ${projectId} has already been submitted`);
  }

  const scope = await findProjectScopeByProjectId(projectId);
  const includedIds = new Set(scope?.includedIds || []);
  const required = includedIds.size;
  if (required === 0) {
    throw new HttpError(400, "Project scope is empty and cannot be submitted");
  }

  const assignments = await listProjectAssignments(projectId);
  const scopedInventory = (await listInventoryForVenue(project.venueId)).filter((item) => includedIds.has(item.id));
  const creatives = await listProjectCreatives(projectId);
  const customer = await findCustomerById(project.customerId);
  if (!customer) throw new HttpError(404, `Customer ${project.customerId} not found`);
  const assignedCount = assignments.filter((assignment) => {
    if (!assignment.creativeId) return false;
    return includedIds.has(assignment.inventoryId);
  }).length;

  if (assignedCount < required) {
    throw new HttpError(400, `Project allocation is incomplete (${assignedCount}/${required} assigned)`);
  }

  const now = isoNow();
  const note = optionalString(payload.note) || null;
  const liftPayload = await buildLiftCreateOrderPayload({
    project,
    customer,
    scopedInventory,
    creatives,
    assignments,
    note,
    actorName: auth.actorName,
  });

  if (!liftPayload.validation.ok) {
    throw new HttpError(400, liftPayload.validation.errors[0] || "Lift order payload is invalid");
  }

  const settings = hydrateAppSettings(await findAppSettings(), auth.actorName);
  const orderIntegrationEnabled = settings.integrations.liftOrderIntegrationEnabled && settings.integrations.primaryPrintVendor.enabled;
  const submissionResult = orderIntegrationEnabled
    ? await submitLiftCreateOrder(liftPayload.payload, settings, auth, project.id)
    : {
        liftOrderId: makeLiftOrderId(),
        responseBody: {
          mode: "local_stub",
          message: "Lift order integration is disabled, so a synthetic order number was assigned.",
        } as Record<string, unknown>,
        lookupSource: "create_order" as const,
      };
  const liftOrderId = submissionResult.liftOrderId;
  const lineCount = liftPayload.payload.product_data.length;
  const adspaceOrderNumber = getProjectAdspaceOrderNumber(project);

  const nextProject: ProjectItem = {
    ...project,
    adspaceOrderNumber,
    extId: makeAdspaceExternalId(adspaceOrderNumber),
    liftOrderId,
    liftOrderLookupSource: submissionResult.lookupSource,
    orderSubmittedAt: now,
    orderSubmittedByName: auth.actorName,
    orderSubmissionNote: note,
    updatedAt: now,
  };

  await putCore(buildProjectRecord(nextProject));
  await seedProofLinesForSubmittedProject(projectId, liftPayload.baselineProofs, auth.actorName);
  const snapshotDocuments: ProjectDocumentItem[] = [];
  try {
    const requestDocument = await createLiftSnapshotDocument(
      projectId,
      liftOrderId,
      "request",
      liftPayload.payload,
      auth.actorName
    );
    if (requestDocument) snapshotDocuments.push(requestDocument);
  } catch (error) {
    console.warn("Failed to capture Lift request payload snapshot", { projectId, liftOrderId, error });
    await recordWorkflowError(`PROJECT#${projectId}`, auth, {
      severity: "warning",
      errorCode: "lift_payload_snapshot_failed",
      message: "The Lift request payload snapshot could not be stored after submission.",
      surface: "order_submission",
      metadata: {
        liftOrderId,
      },
    });
  }
  try {
    const responseDocument = await createLiftSnapshotDocument(
      projectId,
      liftOrderId,
      "response",
      submissionResult.responseBody,
      auth.actorName
    );
    if (responseDocument) snapshotDocuments.push(responseDocument);
  } catch (error) {
    console.warn("Failed to capture Lift response snapshot", { projectId, liftOrderId, error });
    await recordWorkflowError(`PROJECT#${projectId}`, auth, {
      severity: "warning",
      errorCode: "lift_response_snapshot_failed",
      message: "The Lift response snapshot could not be stored after submission.",
      surface: "order_submission",
      metadata: {
        liftOrderId,
      },
    });
  }

  if (orderIntegrationEnabled && settings.integrations.liftProofSyncEnabled) {
    await syncProjectProofLinesFromLift(nextProject, auth).catch(async (error) => {
      console.warn("Initial Lift proof sync failed after submission", { projectId, liftOrderId, error });
      await recordWorkflowError(`PROJECT#${projectId}`, auth, {
        severity: "warning",
        errorCode: "lift_initial_sync_failed",
        message: "The order was submitted, but the initial Lift sync did not complete.",
        surface: "order_submission",
        metadata: {
          liftOrderId,
          reason: error instanceof Error ? error.message : "Unknown error",
        },
      });
    });
  }

  await writeAudit(`PROJECT#${projectId}`, "project.submitted", auth, {
    projectId,
    projectMode: project.projectMode || "live",
    liftOrderId,
    routedLiftCustomerId: customer.liftCustomerId || null,
    sourceCustomerId: project.sourceCustomerId || null,
    requiredCount: required,
    assignedCount,
    lineCount,
    note,
    liftPayloadDocumentIds: snapshotDocuments.map((document) => document.id),
    lookupSource: submissionResult.lookupSource,
  });
  await dispatchProjectNotificationEvent({
    project: nextProject,
    auth,
    eventType: "order_submitted",
    occurredAt: now,
    oneTimePerProject: true,
    detail: {
      liftOrderId,
      lineCount,
      lookupSource: submissionResult.lookupSource,
    },
  });

  return {
    project: await toProjectListItem(await findProjectById(projectId) || nextProject, scope),
    submission: {
      liftOrderId,
      submittedAt: now,
      submittedByName: auth.actorName,
      note,
    },
    documents: await Promise.all(snapshotDocuments.map((document) => toProjectDocumentResponse(document))),
  };
}

async function previewProjectOrderSubmission(projectId: string, payload: Record<string, unknown>, auth: AuthContext) {
  const project = await findProjectById(projectId);
  if (!project) throw new HttpError(404, `Project ${projectId} not found`);
  assertProjectAccess(auth, project);
  await assertProjectMutable(auth, project, "preview Lift payload");

  if (project.liftOrderId) {
    throw new HttpError(400, `Project ${projectId} has already been submitted`);
  }

  const scope = await findProjectScopeByProjectId(projectId);
  const includedIds = new Set(scope?.includedIds || []);
  const required = includedIds.size;
  if (required === 0) {
    throw new HttpError(400, "Project scope is empty and cannot be previewed for submission");
  }

  const assignments = await listProjectAssignments(projectId);
  const scopedInventory = (await listInventoryForVenue(project.venueId)).filter((item) => includedIds.has(item.id));
  const creatives = await listProjectCreatives(projectId);
  const customer = await findCustomerById(project.customerId);
  if (!customer) throw new HttpError(404, `Customer ${project.customerId} not found`);

  const assignedCount = assignments.filter((assignment) => {
    if (!assignment.creativeId) return false;
    return includedIds.has(assignment.inventoryId);
  }).length;

  const note = optionalString(payload.note) || null;
  const persistSnapshot = optionalBoolean(payload.persistSnapshot) ?? false;
  const liftPayload = await buildLiftCreateOrderPayload({
    project,
    customer,
    scopedInventory,
    creatives,
    assignments,
    note,
    actorName: auth.actorName,
  });

  let document: Awaited<ReturnType<typeof toProjectDocumentResponse>> | null = null;
  if (persistSnapshot) {
    try {
      const snapshot = await createLiftPreviewPayloadDocument(project, liftPayload.payload, auth.actorName);
      if (snapshot) {
        document = await toProjectDocumentResponse(snapshot);
      }
    } catch (error) {
      console.warn("Failed to capture Lift preview payload snapshot", { projectId, error });
      await recordWorkflowError(`PROJECT#${projectId}`, auth, {
        severity: "warning",
        errorCode: "lift_preview_snapshot_failed",
        message: "The Lift preview payload snapshot could not be stored.",
        surface: "order_submission_preview",
        metadata: {
          projectId,
        },
      });
    }
  }

  return {
    project: await toProjectListItem(project, scope),
    preview: {
      payload: liftPayload.payload,
      validation: liftPayload.validation,
      completeness: {
        required,
        assigned: assignedCount,
        remaining: Math.max(required - assignedCount, 0),
      },
      lines: liftPayload.payload.product_data.map((line, index) => ({
        lineNumber: index + 1,
        mediaVariantLabel: line.mediaVariantLabel,
        filename: line.file_name,
        unitNumber: line.productSku,
        quantity: line.productQty,
        assignedLocations: line.assigned_Locations.split(",").map((value) => value.trim()).filter(Boolean),
        trimHeight: line.trim_height,
        trimWidth: line.trim_width,
        safeHeight: line.safe_height,
        safeWidth: line.safe_width,
      })),
      snapshotDocument: document,
    },
  };
}

type LiftCreateOrderProduct = {
  productSku: string;
  productCategory: "Art";
  productQty: number;
  file_name: string;
  art_file: string;
  trim_height: string;
  trim_width: string;
  safe_height: string;
  safe_width: string;
  assigned_Locations: string;
  mediaVariantLabel: string;
};

type LiftCreateOrderProductInternal = LiftCreateOrderProduct & {
  mediaVariantKey: string;
  clientCreativeId: string;
};

type LiftCreateOrderPayload = {
  ext_id: string;
  po_number: string;
  contract_no?: string;
  customer_id: string;
  order_title: string;
  order_note?: string;
  product_data: LiftCreateOrderProduct[];
};

async function buildLiftCreateOrderPayload(args: {
  project: ProjectItem;
  customer: CustomerItem;
  scopedInventory: InventoryItem[];
  creatives: ProjectCreativeAssetItem[];
  assignments: ProjectAssignmentItem[];
  note?: string | null;
  actorName: string;
}) {
  const { project, customer, scopedInventory, creatives, assignments, note, actorName } = args;
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!customer.liftCustomerId?.trim()) {
    errors.push(`Customer ${customer.name} is missing a Lift customer ID in Internal Admin setup.`);
  }

  const creativesById = new Map(creatives.map((creative) => [creative.id, creative]));
  const inventoryByRecordId = new Map(scopedInventory.map((item) => [item.id, item]));
  const grouped = new Map<string, {
    creative: ProjectCreativeAssetItem;
    unitNumber: string;
    mediaVariantKey: string;
    mediaVariantLabel: string;
    trimHeight: number | null;
    trimWidth: number | null;
    safeHeight: number | null;
    safeWidth: number | null;
    locations: string[];
    artFileUrl: string;
  }>();

  for (const assignment of assignments) {
    if (!assignment.creativeId) continue;
    const inventory = inventoryByRecordId.get(assignment.inventoryId);
    if (!inventory) continue;
    const creative = creativesById.get(assignment.creativeId);
    if (!creative) {
      errors.push(`Assigned creative ${assignment.creativeId} could not be found for inventory ${inventory.inventoryId}.`);
      continue;
    }
    const unitNumber = String(inventory.unitNumber || "").trim();
    if (!unitNumber) {
      errors.push(`Inventory ${inventory.inventoryId} is missing a Lift product SKU / unit number.`);
      continue;
    }
    const trimHeight = inventory.trimHeight ?? null;
    const trimWidth = inventory.trimWidth ?? null;
    const safeHeight = inventory.safeHeight ?? null;
    const safeWidth = inventory.safeWidth ?? null;
    if ([trimHeight, trimWidth, safeHeight, safeWidth].some((value) => value == null)) {
      errors.push(`Inventory ${inventory.inventoryId} is missing trim or safe dimensions required for Lift.`);
      continue;
    }

    const artFileUrl = await signLiftOutboundAssetUrl(creative.bucketName || PROJECT_ASSETS_BUCKET_NAME, creative.objectKey);
    const groupKey = `${creative.id}||${unitNumber}||${inventory.mediaVariantKey}`;
    const existing = grouped.get(groupKey);
    const mediaVariantLabel = formatVariantLabel(inventory.mediaVariantKey);
    if (!existing) {
      grouped.set(groupKey, {
        creative,
        unitNumber,
        mediaVariantKey: inventory.mediaVariantKey,
        mediaVariantLabel,
        trimHeight,
        trimWidth,
        safeHeight,
        safeWidth,
        locations: [inventory.inventoryId],
        artFileUrl,
      });
      continue;
    }

    if (
      existing.trimHeight !== trimHeight ||
      existing.trimWidth !== trimWidth ||
      existing.safeHeight !== safeHeight ||
      existing.safeWidth !== safeWidth
    ) {
      errors.push(
        `Grouped Lift line mismatch for ${creative.filename} / ${unitNumber}: trim or safe dimensions differ across assigned locations.`
      );
      continue;
    }
    existing.locations.push(inventory.inventoryId);
  }

  const adspaceOrderNumber = getProjectAdspaceOrderNumber(project);
  const extId = makeAdspaceExternalId(adspaceOrderNumber);
  const poNumber = normalizeLiftPoNumber(project.poNumber, adspaceOrderNumber);
  const product_data: LiftCreateOrderProductInternal[] = Array.from(grouped.values())
    .map((group) => {
      group.locations.sort((a, b) => a.localeCompare(b));
      return {
        productSku: group.unitNumber,
        productCategory: "Art" as const,
        productQty: group.locations.length,
        file_name: sanitizeLiftFilename(group.creative.filename),
        art_file: group.artFileUrl,
        trim_height: String(group.trimHeight),
        trim_width: String(group.trimWidth),
        safe_height: String(group.safeHeight),
        safe_width: String(group.safeWidth),
        mediaVariantLabel: group.mediaVariantLabel,
        assigned_Locations: group.locations.join(", "),
        mediaVariantKey: group.mediaVariantKey,
        clientCreativeId: group.creative.id,
      };
    })
    .sort((a, b) => {
      const byVariant = a.mediaVariantLabel.localeCompare(b.mediaVariantLabel, undefined, { sensitivity: "base" });
      if (byVariant !== 0) return byVariant;
      const byFilename = a.file_name.localeCompare(b.file_name, undefined, { sensitivity: "base" });
      if (byFilename !== 0) return byFilename;
      return a.productSku.localeCompare(b.productSku, undefined, { sensitivity: "base" });
    });

  const payload: LiftCreateOrderPayload = {
    ext_id: extId,
    po_number: poNumber,
    contract_no: project.contractNumber || undefined,
    customer_id: customer.liftCustomerId || "",
    order_title: project.title,
    order_note: note || undefined,
    product_data: product_data.map(({ mediaVariantKey: _mvk, clientCreativeId: _creativeId, ...line }) => line),
  };

  const baselineProofs: ProjectProofLineItem[] = product_data.map((line, index) => ({
    entityType: "ProjectProofLine",
    id: makeId("proof"),
    projectId: project.id,
    lineNumber: index + 1,
    mediaVariantKey: line.mediaVariantKey,
    mediaVariantLabel: line.mediaVariantLabel,
    unitNumber: line.productSku,
    quantity: line.productQty,
    locations: line.assigned_Locations.split(",").map((value) => value.trim()).filter(Boolean),
    clientCreativeId: line.clientCreativeId,
    clientFileName: line.file_name,
    liftOrderLineId: null,
    liftProofingId: null,
    liftProofThumbUrl: null,
    liftProofFullUrl: null,
    liftProofStatus: null,
    lastLiftSyncAt: null,
    status: "waiting",
    revised: false,
    printTeamFeedback: "",
    createdAt: isoNow(),
    updatedAt: isoNow(),
    updatedByName: actorName,
  }));

  return {
    payload,
    baselineProofs,
    validation: {
      ok: errors.length === 0,
      errors,
      warnings,
    },
  };
}

function normalizeLiftPoNumber(projectPoNumber: string | undefined, adspaceOrderNumber: string) {
  const trimmed = String(projectPoNumber || "").trim();
  if (trimmed) return trimmed;
  return adspaceOrderNumber;
}

function makeAdspaceExternalId(adspaceOrderNumber: string) {
  return `AS360-${adspaceOrderNumber}`;
}

function getProjectAdspaceOrderNumber(project: Pick<ProjectItem, "id" | "extId" | "adspaceOrderNumber" | "createdAt">) {
  const explicit = String(project.adspaceOrderNumber || "").trim();
  if (/^\d{8}$/.test(explicit)) return explicit;

  const as360Match = String(project.extId || "").trim().match(/^AS360-(\d{8})$/i);
  if (as360Match) return as360Match[1];

  const legacyZMatch = String(project.extId || "").trim().match(/^Z(\d{8})$/i);
  if (legacyZMatch) return legacyZMatch[1];

  const idDigits = String(project.id || "").replace(/\D+/g, "").slice(-8);
  if (idDigits) return idDigits.padStart(8, "0");

  return numericHash(`${project.id}|${project.createdAt}`).toString().padStart(8, "0").slice(-8);
}

async function generateUniqueAdspaceOrderNumber() {
  const existing = (await scanByEntityType("Project"))
    .filter((item): item is ProjectItem => item.entityType === "Project")
    .map((project) => getProjectAdspaceOrderNumber(project));
  const used = new Set(existing);

  for (let attempt = 0; attempt < 25; attempt += 1) {
    const candidate = String(Math.floor(Math.random() * 100000000)).padStart(8, "0");
    if (!used.has(candidate)) return candidate;
  }

  for (let attempt = 0; attempt < 25; attempt += 1) {
    const candidate = numericHash(`${Date.now()}|${Math.random()}|${attempt}`).toString().padStart(8, "0").slice(-8);
    if (!used.has(candidate)) return candidate;
  }

  throw new HttpError(500, "Unable to generate a unique Adspace order number.");
}

function numericHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 100000000;
  }
  return hash;
}

function logPerf(
  label: string,
  startedAt: number,
  metadata: Record<string, unknown> = {},
  infoThresholdMs = 300,
  warnThresholdMs = 1200
) {
  const durationMs = Date.now() - startedAt;
  if (durationMs < infoThresholdMs) return;
  const payload = { label, durationMs, ...metadata };
  const message = `[perf] ${JSON.stringify(payload)}`;
  if (durationMs >= warnThresholdMs) {
    console.warn(message);
    return;
  }
  console.info(message);
}

function makeLocalCacheEntry<T>(value: T, ttlMs: number): LocalCacheEntry<T> {
  return {
    value,
    expiresAt: Date.now() + ttlMs,
  };
}

function readLocalCache<T>(entry: LocalCacheEntry<T> | null | undefined): { hit: true; value: T } | { hit: false } {
  if (!entry || entry.expiresAt <= Date.now()) {
    return { hit: false };
  }
  return { hit: true, value: entry.value };
}

function cacheUserProfile(profile: UserProfileItem) {
  userProfileBySubCache.set(profile.cognitoSub, makeLocalCacheEntry(profile, USER_CACHE_TTL_MS));
  userProfileByEmailCache.set(profile.email.toLowerCase(), makeLocalCacheEntry(profile, USER_CACHE_TTL_MS));
}

function invalidateSettingsCaches() {
  appSettingsCache.current = null;
  entityScanCache.delete("AppSettings");
}

function invalidateUserCaches(profile?: UserProfileItem | null) {
  userProfilesListCache.current = null;
  entityScanCache.delete("UserProfile");
  if (!profile) {
    userProfileBySubCache.clear();
    userProfileByEmailCache.clear();
    return;
  }
  userProfileBySubCache.delete(profile.cognitoSub);
  userProfileByEmailCache.delete(profile.email.toLowerCase());
}

function invalidateCustomerCaches(customerId?: string) {
  customersListCache.current = null;
  entityScanCache.delete("Customer");
  if (customerId) {
    customerByIdCache.delete(customerId);
    return;
  }
  customerByIdCache.clear();
}

function invalidateEntityScanForWrite(entityType: unknown) {
  projectListResponseCache.clear();
  projectWorkspaceResponseCache.clear();
  projectHubBootstrapResponseCache.clear();
  if (typeof entityType !== "string") return;
  entityScanCache.delete(entityType);
  if (entityType === "Customer") {
    invalidateCustomerCaches();
  }
  if (entityType === "UserProfile") {
    invalidateUserCaches();
  }
  if (entityType === "AppSettings") {
    invalidateSettingsCaches();
  }
}

function invalidateEntityScanCaches() {
  entityScanCache.clear();
  projectListResponseCache.clear();
  projectWorkspaceResponseCache.clear();
  projectHubBootstrapResponseCache.clear();
  invalidateCustomerCaches();
  invalidateUserCaches();
  invalidateSettingsCaches();
}

function invalidateProjectResponseCaches() {
  projectListResponseCache.clear();
  projectWorkspaceResponseCache.clear();
  projectHubBootstrapResponseCache.clear();
}

function authScopeCacheKey(auth: AuthContext) {
  if (auth.isPlatformAdmin) return "platform";
  if (auth.mode === "share") return `share:${auth.shareLink?.id || auth.actorId}`;
  return Array.from(auth.customerIds).sort().join(",");
}

function projectScopedCacheKey(prefix: string, projectId: string, auth: AuthContext) {
  return `${prefix}:${projectId}:${authScopeCacheKey(auth)}`;
}

function sanitizeLiftFilename(name: string) {
  return String(name || "")
    .replace(/[^a-zA-Z0-9 ._-]+/g, "_")
    .trim();
}

async function signLiftOutboundAssetUrl(bucketName: string, key: string) {
  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: key,
  });
  return getSignedUrl(s3, command, { expiresIn: 60 * 60 * 24 });
}

async function getS3ObjectBuffer(bucketName: string, key: string) {
  const response = await s3.send(
    new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
    })
  );
  const body = response.Body as
    | { transformToByteArray?: () => Promise<Uint8Array>; [Symbol.asyncIterator]?: () => AsyncIterator<Uint8Array> }
    | undefined;
  if (!body) return Buffer.alloc(0);
  if (typeof body.transformToByteArray === "function") {
    return Buffer.from(await body.transformToByteArray());
  }
  if (typeof body[Symbol.asyncIterator] === "function") {
    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  throw new Error("S3 object body is not readable");
}

function uniquePackageFilename(filename: string, used: Map<string, number>) {
  const safe = sanitizeLiftFilename(filename || "artwork-file") || "artwork-file";
  const firstSeen = used.get(safe);
  if (firstSeen === undefined) {
    used.set(safe, 1);
    return safe;
  }
  const nextCount = firstSeen + 1;
  used.set(safe, nextCount);
  const dotIndex = safe.lastIndexOf(".");
  if (dotIndex > 0) {
    return `${safe.slice(0, dotIndex)}-${nextCount}${safe.slice(dotIndex)}`;
  }
  return `${safe}-${nextCount}`;
}

function buildCsv(headers: string[], rows: Array<Record<string, unknown>>) {
  return [
    headers.map(csvEscape).join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
  ].join("\n");
}

function csvEscape(value: unknown) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function resolveLiftUrl(baseUrl: string, pathOrUrl: string) {
  const trimmed = String(pathOrUrl || "").trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const normalizedBaseUrl = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!normalizedBaseUrl) return "";
  return `${normalizedBaseUrl}/${trimmed.replace(/^\/+/, "")}`;
}

function getLiftEnvironmentConfig(
  vendor: AppSettingsItem["integrations"]["primaryPrintVendor"],
  environment?: LiftEnvironmentKey
) {
  return vendor.environments[environment || vendor.activeEnvironment];
}

function resolveLiftEnvironmentUrl(
  vendor: AppSettingsItem["integrations"]["primaryPrintVendor"],
  value: string,
  environment?: LiftEnvironmentKey
) {
  return resolveLiftUrl(getLiftEnvironmentConfig(vendor, environment).baseUrl, value);
}

function parseLiftHeaders(raw: string) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return {} as Record<string, string>;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.fromEntries(
        Object.entries(parsed).map(([key, value]) => [key, String(value)])
      );
    }
  } catch {
    // fall through to line parsing
  }

  return Object.fromEntries(
    trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [key, ...rest] = line.split(":");
        return [key.trim(), rest.join(":").trim()];
      })
      .filter(([key, value]) => key && value)
  );
}

function parseMaybeJson(text: string) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractLiftOrderId(value: unknown): string | null {
  if (typeof value === "string") {
    const match = value.match(/\bA\d{7,8}\b/i);
    return match ? match[0].toUpperCase() : null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractLiftOrderId(item);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (/order(_|\s)?number|order(_|\s)?id|liftOrderId/i.test(key)) {
        const found = extractLiftOrderId(nested);
        if (found) return found;
      }
    }
    for (const nested of Object.values(value as Record<string, unknown>)) {
      const found = extractLiftOrderId(nested);
      if (found) return found;
    }
  }
  return null;
}

async function submitLiftCreateOrder(
  payload: LiftCreateOrderPayload,
  settings: AppSettingsItem,
  auth: AuthContext,
  projectId: string
) {
  const config = settings.integrations.primaryPrintVendor;
  const orderUrl = resolveLiftEnvironmentUrl(config, getLiftEnvironmentConfig(config).orderEndpointUrl);
  const lookupUrl = resolveLiftEnvironmentUrl(config, getLiftEnvironmentConfig(config).fallbackOrderLookupUrl);
  if (!orderUrl) throw new HttpError(400, "Lift create-order endpoint is not configured in Internal Admin.");
  if (!config.companyId.trim()) throw new HttpError(400, "Lift company ID is not configured in Internal Admin.");
  if (!config.createOrderUsername.trim() || !config.createOrderPassword.trim()) {
    throw new HttpError(400, "Lift create-order credentials are not configured in Internal Admin.");
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Ext_ID: payload.ext_id,
    User: config.createOrderUsername,
    Password: config.createOrderPassword,
    "Company ID": config.companyId,
    ...parseLiftHeaders(config.defaultHeaders),
  };

  const response = await fetch(orderUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const responseText = await response.text();
  const responseBody = parseMaybeJson(responseText) || { raw: responseText };

  const directOrderId = extractLiftOrderId(responseBody) || extractLiftOrderId(responseText);
  if (response.ok && directOrderId) {
    return {
      liftOrderId: directOrderId,
      responseBody,
      lookupSource: "create_order" as const,
    };
  }

  const proxyLikeFailure =
    !response.ok ||
    /proxy error|error reading from remote server/i.test(responseText);

  if (!proxyLikeFailure) {
    throw new HttpError(502, `Lift create_order failed: ${responseText || response.statusText}`);
  }
  if (!lookupUrl) {
    throw new HttpError(502, "Lift create_order failed and fallback order lookup is not configured.");
  }

  const lookup = await fetch(`${lookupUrl}${lookupUrl.includes("?") ? "&" : "?"}offset=0&p0=${encodeURIComponent(payload.po_number)}`, {
    method: "GET",
    headers: parseLiftHeaders(config.defaultHeaders),
  });
  const lookupText = await lookup.text();
  const lookupBody = parseMaybeJson(lookupText) || { raw: lookupText };
  const fallbackOrderId = extractLiftOrderId(lookupBody) || extractLiftOrderId(lookupText);
  if (!fallbackOrderId) {
    await recordWorkflowError(`PROJECT#${projectId}`, auth, {
      severity: "error",
      errorCode: "lift_order_lookup_failed",
      message: "Lift order creation failed and the fallback order lookup could not find an order number.",
      surface: "order_submission",
      metadata: {
        poNumber: payload.po_number,
        createOrderStatus: response.status,
      },
    });
    throw new HttpError(502, "Lift order creation failed and fallback lookup did not return an order number.");
  }

  return {
    liftOrderId: fallbackOrderId,
    responseBody: {
      createOrder: responseBody,
      fallbackLookup: lookupBody,
    },
    lookupSource: "fallback_lookup" as const,
  };
}

export function mergeProjectProofLinesFromLift(args: {
  existingProofs: ProjectProofLineItem[];
  rawLines: Array<Record<string, unknown>>;
  actorName: string;
  syncedAt?: string;
}) {
  const syncedAt = args.syncedAt || isoNow();
  const existingByLineNumber = new Map<number, ProjectProofLineItem[]>();
  const existingByLiftOrderLineId = new Map<number, ProjectProofLineItem[]>();
  const existingByProofingId = new Map(
    args.existingProofs
      .filter((proof) => proof.liftProofingId != null)
      .map((proof) => [proof.liftProofingId as number, proof])
  );
  for (const proof of args.existingProofs) {
    const lineNumberProofs = existingByLineNumber.get(proof.lineNumber) || [];
    lineNumberProofs.push(proof);
    existingByLineNumber.set(proof.lineNumber, lineNumberProofs);
    if (proof.liftOrderLineId != null) {
      const orderLineProofs = existingByLiftOrderLineId.get(proof.liftOrderLineId) || [];
      orderLineProofs.push(proof);
      existingByLiftOrderLineId.set(proof.liftOrderLineId, orderLineProofs);
    }
  }
  const nextById = new Map(args.existingProofs.map((proof) => [proof.id, proof]));
  const changedProofs: ProjectProofLineItem[] = [];
  const activeProofIds = new Set<string>();
  const issues: ProofSyncIssue[] = [];

  for (const rawLine of args.rawLines) {
    const lineNumber = Number(rawLine.LINE_NUMBER ?? 0);
    if (!Number.isFinite(lineNumber) || lineNumber <= 0) continue;
    if (isCanceledLiftProofLine(rawLine)) continue;

    const rawOrderLineId = optionalNumber(rawLine.ORDER_LINE_ID);
    const existingLineProofs =
      (rawOrderLineId != null ? existingByLiftOrderLineId.get(rawOrderLineId) : null) ||
      existingByLineNumber.get(lineNumber) ||
      [];
    if (!existingLineProofs.length) continue;

    const rawUnitNumber = optionalString(rawLine.UNIT_NUMBER) || null;
    const rawQuantity = optionalNumber(rawLine.QUANTITY);
    const lineIdentityProof = existingLineProofs[0];
    if (rawOrderLineId != null && lineIdentityProof.liftOrderLineId != null && lineIdentityProof.liftOrderLineId !== rawOrderLineId) {
      issues.push({
        severity: "warning",
        errorCode: "lift_proof_line_mismatch",
        message: `Lift returned line ${lineNumber} with an unexpected order-line id.`,
        surface: "proof_sync",
        metadata: {
          expectedLiftOrderLineId: lineIdentityProof.liftOrderLineId,
          returnedLiftOrderLineId: rawOrderLineId,
          lineNumber,
        },
      });
      continue;
    }
    if (rawUnitNumber && lineIdentityProof.unitNumber && lineIdentityProof.unitNumber !== rawUnitNumber) {
      issues.push({
        severity: "warning",
        errorCode: "lift_proof_unit_mismatch",
        message: `Lift returned line ${lineNumber} with a unit number that does not match the stored proof line.`,
        surface: "proof_sync",
        metadata: {
          expectedUnitNumber: lineIdentityProof.unitNumber,
          returnedUnitNumber: rawUnitNumber,
          lineNumber,
          liftOrderLineId: rawOrderLineId,
        },
      });
      continue;
    }

    const lineStepNumber = optionalNumber(rawLine.LINE_STEP_NUMBER) ?? optionalNumber(rawLine.STEP_NUMBER);
    const isProofReviewStep = lineStepNumber === 7.02;
    const proofRecords = normalizeLiftProofRecordsForLine(liftProofRecordsForLine(rawLine));
    const consumedExistingIds = new Set<string>();

    for (const proofRecord of proofRecords) {
      // Muna confirmed Apex Adspace uses ATTACHMENT_ID as the Lift proofing id.
      const proofingId = optionalNumber(proofRecord?.ATTACHMENT_ID) ?? null;
      const existing =
        (proofingId != null ? existingByProofingId.get(proofingId) : null) ||
        existingLineProofs.find((proof) => !consumedExistingIds.has(proof.id) && !proof.liftProofingId) ||
        (proofRecords.length === 1 ? existingLineProofs.find((proof) => !consumedExistingIds.has(proof.id)) : null) ||
        buildLiftProofLineShell({
          projectId: lineIdentityProof.projectId,
          rawLine: {
            ...rawLine,
            ...proofRecord,
            LINE_NUMBER: rawLine.LINE_NUMBER,
            ORDER_LINE_ID: rawLine.ORDER_LINE_ID,
            LINE_STEP_NUMBER: rawLine.LINE_STEP_NUMBER,
            UNIT_NUMBER: rawLine.UNIT_NUMBER,
          },
          actorName: args.actorName,
          existing: lineIdentityProof,
          syncedAt,
          preserveExistingId: false,
        });
      consumedExistingIds.add(existing.id);

      const liftStatus = optionalString(proofRecord?.PROOF_APPROVAL_STATUS) || null;
      const nextProofThumbUrl =
        isProofReviewStep
          ? optionalString(proofRecord?.PROOF_LINK) || optionalString(proofRecord?.PROOF_LINK_LOW) || null
          : null;
      const nextProofFullUrl =
        isProofReviewStep
          ? optionalString(proofRecord?.HIRES_PDF_PROOF) ||
            optionalString(proofRecord?.PROOF_LINK_HIGH) ||
            optionalString(proofRecord?.PROOF_LINE_HIGH) ||
            null
          : null;
      const nextProofingId = proofingId ?? existing.liftProofingId ?? null;
      const hasLiftProofAsset = !!(nextProofThumbUrl || nextProofFullUrl);
      const proofComments = liftProofCommentsForRecord(proofRecord);
      const proofCommentCount = proofComments.length;
      const proofCommentAttachmentCount = proofComments.reduce((sum, comment) => sum + comment.attachments.length, 0);
      const latestProofCommentAt = latestProofCommentTimestamp(proofComments);
      const proofVersion = buildProjectProofVersion({
        proofRecord,
        attachmentId: nextProofingId,
        orderLineId: rawOrderLineId ?? existing.liftOrderLineId ?? null,
        proofThumbUrl: nextProofThumbUrl,
        proofFullUrl: nextProofFullUrl,
        status: liftStatus,
        comments: proofComments,
      });

      if (isProofReviewStep && proofRecord && !nextProofingId) {
        issues.push({
          severity: "warning",
          errorCode: "lift_proofing_id_missing",
          message: `Lift returned line ${lineNumber} without a proofing record id.`,
          surface: "proof_sync",
          metadata: {
            lineNumber,
            liftOrderLineId: rawOrderLineId,
            unitNumber: rawUnitNumber || existing.unitNumber || null,
          },
        });
      }
      if (isProofReviewStep && proofRecord && !hasLiftProofAsset) {
        issues.push({
          severity: "warning",
          errorCode: "lift_proof_url_missing",
          message: `Lift returned line ${lineNumber} without a current proof URL.`,
          surface: "proof_sync",
          metadata: {
            lineNumber,
            liftOrderLineId: rawOrderLineId,
            proofingId: nextProofingId,
            unitNumber: rawUnitNumber || existing.unitNumber || null,
          },
        });
      }

      const nextStatus: ProofLineStatus =
        !isProofReviewStep || !proofRecord || !hasLiftProofAsset
          ? "waiting"
          : liftStatus === "APPROVED"
          ? "approved"
          : "pending";

      const nextProof: ProjectProofLineItem = {
        ...existing,
        lineNumber,
        liftOrderLineId: rawOrderLineId ?? existing.liftOrderLineId ?? null,
        unitNumber: rawUnitNumber || existing.unitNumber || null,
        quantity: rawQuantity ?? existing.quantity ?? null,
        liftProofingId: nextProofingId,
        liftProofThumbUrl: nextProofThumbUrl,
        liftProofFullUrl: nextProofFullUrl,
        liftProofStatus: liftStatus,
        lastLiftSyncAt: syncedAt,
        status: nextStatus,
        printTeamFeedback:
          latestProofCommentBody(proofComments) ||
          optionalString(proofRecord?.PROOF_COMMENT) ||
          optionalString(proofRecord?.REPORT_URL) ||
          existing.printTeamFeedback,
        proofComments,
        proofCommentCount,
        proofCommentAttachmentCount,
        latestProofCommentAt,
        proofVersions: mergeProjectProofVersions(existing, proofVersion, syncedAt),
        updatedAt: syncedAt,
        updatedByName: args.actorName,
      };

      nextById.set(nextProof.id, nextProof);
      activeProofIds.add(nextProof.id);
      changedProofs.push(nextProof);
      if (nextProof.liftProofingId != null) existingByProofingId.set(nextProof.liftProofingId, nextProof);
    }
  }
  const obsoleteProofs = args.existingProofs.filter((proof) => !activeProofIds.has(proof.id));
  preserveObsoleteProofVersions(nextById, changedProofs, obsoleteProofs, syncedAt);
  for (const proof of obsoleteProofs) {
    nextById.delete(proof.id);
  }

  return {
    updatedProofs: Array.from(nextById.values()).sort(
      (a, b) =>
        a.lineNumber - b.lineNumber ||
        (a.liftProofingId ?? Number.MAX_SAFE_INTEGER) - (b.liftProofingId ?? Number.MAX_SAFE_INTEGER) ||
        a.id.localeCompare(b.id)
    ),
    changedProofs,
    obsoleteProofs,
    issues,
  };
}

function liftProofRecordsForLine(rawLine: Record<string, unknown>) {
  const proofs = Array.isArray(rawLine.PROOFS) ? rawLine.PROOFS : [];
  const nestedProofs = proofs.filter((proof): proof is Record<string, unknown> => !!proof && typeof proof === "object");
  if (nestedProofs.length > 0) return nestedProofs;
  const directProof = firstLiftProofRecord(rawLine);
  return directProof ? [directProof] : [rawLine];
}

function normalizeLiftProofRecordsForLine(records: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const grouped = new Map<string, Array<Record<string, unknown>>>();
  const passthrough: Array<Record<string, unknown>> = [];

  for (const record of records) {
    const attachmentId = optionalNumber(record.ATTACHMENT_ID);
    if (attachmentId == null) {
      passthrough.push(record);
      continue;
    }
    const key = String(attachmentId);
    const group = grouped.get(key) || [];
    group.push(record);
    grouped.set(key, group);
  }

  const normalized = Array.from(grouped.values()).map((group) => {
    const base = group[0] || {};
    return {
      ...base,
      ...group[group.length - 1],
      PROOF_COMMENT_ROWS: group,
    } as Record<string, unknown>;
  });

  return [...passthrough, ...normalized];
}

function liftProofCommentsForRecord(record: Record<string, unknown> | undefined | null) {
  if (!record) return [];
  const rows = Array.isArray(record.PROOF_COMMENT_ROWS)
    ? record.PROOF_COMMENT_ROWS.filter((row): row is Record<string, unknown> => !!row && typeof row === "object")
    : [record];

  const comments: ProjectProofComment[] = [];
  rows.forEach((row, index) => {
    const body = optionalString(row.PROOF_COMMENT);
    const attachments = liftProofCommentAttachments(row.COMMENT_ATTACHMENT);
    if (!body && attachments.length === 0) return;
    comments.push({
      id: buildProofCommentId(row, index),
      body,
      createdAt: optionalString(row.COMMENT_TS) || null,
      attachments,
    });
  });
  return comments.sort(compareProofComments);
}

function liftProofCommentAttachments(value: unknown) {
  if (!Array.isArray(value)) return [];
  const attachments: ProjectProofCommentAttachment[] = [];
  value.forEach((attachment) => {
    if (!attachment || typeof attachment !== "object") return;
    const row = attachment as Record<string, unknown>;
    const url = optionalString(row.LINK_TO_ATTACHMENT);
    if (!url) return;
    attachments.push({
      url,
      createdAt: optionalString(row.COM_ATTACHMENT_TS) || null,
      filename: filenameFromUrl(url),
    });
  });
  return attachments;
}

function buildProofCommentId(row: Record<string, unknown>, index: number) {
  const attachmentId = optionalNumber(row.ATTACHMENT_ID) ?? "proof";
  const timestamp = optionalString(row.COMMENT_TS) || "no-ts";
  const body = optionalString(row.PROOF_COMMENT) || "attachment";
  return `${attachmentId}:${timestamp}:${index}:${body.slice(0, 32)}`;
}

function compareProofComments(a: ProjectProofComment, b: ProjectProofComment) {
  return parseLiftProofDate(a.createdAt) - parseLiftProofDate(b.createdAt) || a.id.localeCompare(b.id);
}

function parseLiftProofDate(value?: string | null) {
  if (!value) return 0;
  const direct = Date.parse(value);
  if (Number.isFinite(direct)) return direct;
  const match = value.match(/^(\d{1,2})-([A-Z]{3})-(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s+(AM|PM)$/i);
  if (!match) return 0;
  const months: Record<string, number> = {
    JAN: 0,
    FEB: 1,
    MAR: 2,
    APR: 3,
    MAY: 4,
    JUN: 5,
    JUL: 6,
    AUG: 7,
    SEP: 8,
    OCT: 9,
    NOV: 10,
    DEC: 11,
  };
  const month = months[match[2].toUpperCase()];
  if (month == null) return 0;
  let hour = Number(match[4]);
  if (match[7].toUpperCase() === "PM" && hour < 12) hour += 12;
  if (match[7].toUpperCase() === "AM" && hour === 12) hour = 0;
  return Date.UTC(Number(match[3]), month, Number(match[1]), hour, Number(match[5]), Number(match[6]));
}

function latestProofCommentTimestamp(comments: ProjectProofComment[]) {
  return comments.length ? comments[comments.length - 1].createdAt || null : null;
}

function latestProofCommentBody(comments: ProjectProofComment[]) {
  for (let index = comments.length - 1; index >= 0; index -= 1) {
    const body = optionalString(comments[index].body);
    if (body) return body;
  }
  return "";
}

function buildProjectProofVersion(args: {
  proofRecord: Record<string, unknown> | undefined | null;
  attachmentId: number | null;
  orderLineId: number | null;
  proofThumbUrl: string | null;
  proofFullUrl: string | null;
  status: string | null;
  comments: ProjectProofComment[];
}) {
  return {
    attachmentId: args.attachmentId,
    orderLineId: args.orderLineId,
    proofFilename: optionalString(args.proofRecord?.PROOF_FILENAME) || null,
    proofThumbUrl: args.proofThumbUrl,
    proofFullUrl: args.proofFullUrl,
    status: args.status,
    createdAt: optionalString(args.proofRecord?.CREATION_DATE) || null,
    replacedAt: null,
    current: true,
    comments: args.comments,
  } satisfies ProjectProofVersion;
}

function mergeProjectProofVersions(
  existing: ProjectProofLineItem,
  currentVersion: ProjectProofVersion,
  replacedAt: string
) {
  const versionsByAttachmentId = new Map<string, ProjectProofVersion>();
  const existingVersions = Array.isArray(existing.proofVersions) ? existing.proofVersions : [];

  for (const version of existingVersions) {
    const key = proofVersionKey(version);
    versionsByAttachmentId.set(key, { ...version, current: false });
  }

  if (
    existing.liftProofingId != null &&
    existing.liftProofingId !== currentVersion.attachmentId &&
    ((existing.proofComments && existing.proofComments.length) || existing.liftProofThumbUrl || existing.liftProofFullUrl)
  ) {
    const previousCurrent = buildStoredProofVersionFromLine(existing, replacedAt);
    versionsByAttachmentId.set(proofVersionKey(previousCurrent), previousCurrent);
  }

  versionsByAttachmentId.set(proofVersionKey(currentVersion), currentVersion);
  return Array.from(versionsByAttachmentId.values()).sort(compareProjectProofVersions);
}

function preserveObsoleteProofVersions(
  nextById: Map<string, ProjectProofLineItem>,
  changedProofs: ProjectProofLineItem[],
  obsoleteProofs: ProjectProofLineItem[],
  replacedAt: string
) {
  for (const obsolete of obsoleteProofs) {
    if (!obsolete.liftOrderLineId) continue;
    const target = Array.from(nextById.values()).find(
      (proof) => proof.id !== obsolete.id && proof.liftOrderLineId === obsolete.liftOrderLineId
    );
    if (!target) continue;
    const historical = buildStoredProofVersionFromLine(obsolete, replacedAt);
    const nextVersions = mergeStoredProofVersion(target.proofVersions || [], historical);
    const nextTarget = { ...target, proofVersions: nextVersions };
    nextById.set(nextTarget.id, nextTarget);
    const changedIndex = changedProofs.findIndex((proof) => proof.id === nextTarget.id);
    if (changedIndex >= 0) changedProofs[changedIndex] = nextTarget;
    else changedProofs.push(nextTarget);
  }
}

function buildStoredProofVersionFromLine(proof: ProjectProofLineItem, replacedAt: string) {
  return {
    attachmentId: proof.liftProofingId ?? null,
    orderLineId: proof.liftOrderLineId ?? null,
    proofFilename: proof.clientFileName || null,
    proofThumbUrl: proof.liftProofThumbUrl || null,
    proofFullUrl: proof.liftProofFullUrl || null,
    status: proof.liftProofStatus || proof.status || null,
    createdAt: proof.createdAt || null,
    replacedAt,
    current: false,
    comments: proof.proofComments || [],
  } satisfies ProjectProofVersion;
}

function mergeStoredProofVersion(versions: ProjectProofVersion[], version: ProjectProofVersion) {
  const byKey = new Map<string, ProjectProofVersion>(versions.map((item) => [proofVersionKey(item), { ...item, current: false }]));
  byKey.set(proofVersionKey(version), version);
  return Array.from(byKey.values()).sort(compareProjectProofVersions);
}

function proofVersionKey(version: ProjectProofVersion) {
  return version.attachmentId != null ? `attachment:${version.attachmentId}` : `line:${version.orderLineId || "unknown"}:${version.createdAt || "unknown"}`;
}

function compareProjectProofVersions(a: ProjectProofVersion, b: ProjectProofVersion) {
  const aCurrent = a.current === true;
  const bCurrent = b.current === true;
  if (aCurrent !== bCurrent) return aCurrent ? -1 : 1;
  return parseLiftProofDate(b.createdAt || b.replacedAt) - parseLiftProofDate(a.createdAt || a.replacedAt);
}

function filenameFromUrl(url: string) {
  try {
    const pathname = new URL(url).pathname;
    const name = pathname.split("/").pop() || "";
    return name ? decodeURIComponent(name) : null;
  } catch {
    const name = url.split("?")[0].split("/").pop() || "";
    return name || null;
  }
}

function firstLiftProofRecord(rawLine: Record<string, unknown>) {
  const proofs = Array.isArray(rawLine.PROOFS) ? rawLine.PROOFS : [];
  const firstNestedProof = (proofs[0] || null) as Record<string, unknown> | null;
  return (
    firstNestedProof ||
    (rawLine.ATTACHMENT_ID ||
    rawLine.PROOF_LINK_LOW ||
    rawLine.PROOF_LINK_HIGH ||
    rawLine.PROOF_LINE_HIGH ||
    rawLine.PROOF_APPROVAL_STATUS ||
    rawLine.PROOF_COMMENT ||
    rawLine.PROOF_FILENAME
      ? rawLine
      : null)
  );
}

function buildLiftProofLineShell(args: {
  projectId: string;
  rawLine: Record<string, unknown>;
  actorName: string;
  existing?: ProjectProofLineItem;
  syncedAt: string;
  preserveExistingId?: boolean;
}) {
  const lineNumber = optionalNumber(args.rawLine.LINE_NUMBER) || args.existing?.lineNumber || 0;
  const orderLineId = optionalNumber(args.rawLine.ORDER_LINE_ID) ?? args.existing?.liftOrderLineId ?? null;
  const productName = optionalString(args.rawLine.PRODUCT_NAME) || args.existing?.mediaVariantLabel || `Lift line ${lineNumber}`;
  const printH = optionalNumber(args.rawLine.PRINT_H_IN) || 0;
  const printW = optionalNumber(args.rawLine.PRINT_W_IN) || 0;
  const mediaVariantKey = printH || printW ? `${productName}||${printH}||${printW}` : args.existing?.mediaVariantKey || `${productName}||0||0`;
  const proofRecord = firstLiftProofRecord(args.rawLine);
  const proofFilename =
    optionalString(proofRecord?.PROOF_FILENAME) ||
    optionalString(proofRecord?.FILE_NAME) ||
    optionalString(args.rawLine.PROOF_FILENAME) ||
    optionalString(args.rawLine.FILE_NAME) ||
    args.existing?.clientFileName ||
    `${productName} line ${lineNumber}`;
  const unitNumber = optionalString(args.rawLine.UNIT_NUMBER) || args.existing?.unitNumber || null;
  const quantity = optionalNumber(args.rawLine.QUANTITY) ?? args.existing?.quantity ?? null;

  return {
    entityType: "ProjectProofLine" as const,
    id: args.preserveExistingId === false ? makeId("proof") : args.existing?.id || makeId("proof"),
    projectId: args.projectId,
    lineNumber,
    liftOrderLineId: orderLineId,
    liftProofingId: optionalNumber(proofRecord?.ATTACHMENT_ID) ?? args.existing?.liftProofingId ?? null,
    mediaVariantKey,
    mediaVariantLabel: formatVariantLabel(mediaVariantKey),
    unitNumber,
    quantity,
    locations: args.existing?.locations || [],
    clientCreativeId: args.existing?.clientCreativeId || "",
    clientFileName: proofFilename,
    proofThumbObjectKey: args.existing?.proofThumbObjectKey,
    proofObjectKey: args.existing?.proofObjectKey,
    liftProofThumbUrl: args.existing?.liftProofThumbUrl || null,
    liftProofFullUrl: args.existing?.liftProofFullUrl || null,
    liftProofStatus: args.existing?.liftProofStatus || null,
    lastLiftSyncAt: args.existing?.lastLiftSyncAt || null,
    status: args.existing?.status || "waiting",
    revised: args.existing?.revised || false,
    printTeamFeedback: args.existing?.printTeamFeedback,
    proofComments: args.existing?.proofComments || [],
    proofCommentCount: args.existing?.proofCommentCount || 0,
    proofCommentAttachmentCount: args.existing?.proofCommentAttachmentCount || 0,
    latestProofCommentAt: args.existing?.latestProofCommentAt || null,
    proofVersions: args.existing?.proofVersions || [],
    createdAt: args.existing?.createdAt || args.syncedAt,
    updatedAt: args.syncedAt,
    updatedByName: args.actorName,
  } satisfies ProjectProofLineItem;
}

async function ensureProofLinesForManualLiftRelink(args: {
  project: ProjectItem;
  existingProofs: ProjectProofLineItem[];
  rawLines: Array<Record<string, unknown>>;
  actorName: string;
  syncedAt: string;
}) {
  if (args.project.liftOrderLookupSource !== "manual_override" && args.existingProofs.length > 0) {
    return args.existingProofs;
  }

  const existingByLineNumber = new Map(args.existingProofs.map((proof) => [proof.lineNumber, proof]));
  const existingByLiftOrderLineId = new Map(
    args.existingProofs
      .filter((proof) => proof.liftOrderLineId != null)
      .map((proof) => [proof.liftOrderLineId as number, proof])
  );
  const nextById = new Map(args.existingProofs.map((proof) => [proof.id, proof]));
  const changedProofs: ProjectProofLineItem[] = [];

  for (const rawLine of args.rawLines) {
    const lineNumber = optionalNumber(rawLine.LINE_NUMBER);
    if (!lineNumber || lineNumber <= 0) continue;
    const orderLineId = optionalNumber(rawLine.ORDER_LINE_ID);
    const existing =
      (orderLineId != null ? existingByLiftOrderLineId.get(orderLineId) : null) ||
      existingByLineNumber.get(lineNumber);
    const nextProof = buildLiftProofLineShell({
      projectId: args.project.id,
      rawLine,
      actorName: args.actorName,
      existing,
      syncedAt: args.syncedAt,
    });
    nextById.set(nextProof.id, nextProof);

    if (
      !existing ||
      existing.liftOrderLineId !== nextProof.liftOrderLineId ||
      existing.mediaVariantKey !== nextProof.mediaVariantKey ||
      existing.mediaVariantLabel !== nextProof.mediaVariantLabel ||
      existing.clientFileName !== nextProof.clientFileName ||
      existing.unitNumber !== nextProof.unitNumber
    ) {
      changedProofs.push(nextProof);
    }
  }

  for (const proof of changedProofs) {
    await putCore(buildProjectProofLineRecord(proof));
  }

  return Array.from(nextById.values()).sort((a, b) => a.lineNumber - b.lineNumber);
}

async function syncProjectProofLinesFromLift(project: ProjectItem, auth: AuthContext, options: { forceRead?: boolean } = {}) {
  if (!project.liftOrderId) return;
  const settings = hydrateAppSettings(await findAppSettings(), auth.actorName);
  if (!options.forceRead && (!settings.integrations.liftProofSyncEnabled || !settings.integrations.primaryPrintVendor.enabled)) return;

  const rawLines = await fetchLiftProofSyncLines(project.liftOrderId, settings, project.id, auth);

  const syncedAt = isoNow();
  if (!rawLines.length) {
    await updateProjectLiftProofSyncMetadata(project, syncedAt, false);
    invalidateProjectResponseCaches();
    return;
  }

  const existingProofs = await listProjectProofLines(project.id);
  const proofLinesForMerge = await ensureProofLinesForManualLiftRelink({
    project,
    existingProofs,
    rawLines,
    actorName: auth.actorName,
    syncedAt,
  });
  const hadReadyProofsBefore = existingProofs.some((proof) => !!(proof.liftProofThumbUrl || proof.liftProofFullUrl || proof.proofObjectKey));
  const allApprovedBefore = existingProofs.length > 0 && existingProofs.every((proof) => proof.status === "approved");
  const merged = mergeProjectProofLinesFromLift({
    existingProofs: proofLinesForMerge,
    rawLines,
    actorName: auth.actorName,
    syncedAt,
  });
  const variants = await listVariantsForVenue(project.venueId);

  for (const issue of merged.issues) {
    await recordWorkflowError(`PROJECT#${project.id}`, auth, issue);
  }
  for (const nextProof of merged.changedProofs) {
    await putCore(buildProjectProofLineRecord(nextProof));
  }
  for (const obsoleteProof of merged.obsoleteProofs) {
    await deleteProjectProofLine(obsoleteProof);
  }
  const proofSyncChanged = merged.changedProofs.length > 0 || merged.obsoleteProofs.length > 0;
  await updateProjectLiftProofSyncMetadata(project, syncedAt, proofSyncChanged);
  invalidateProjectResponseCaches();

  const latestProofs = merged.updatedProofs;
  const readyCount = latestProofs.filter((proof) => !!(proof.liftProofThumbUrl || proof.liftProofFullUrl || proof.proofObjectKey)).length;
  const approvedCount = latestProofs.filter((proof) => proof.status === "approved").length;
  const allApprovedAfter = latestProofs.length > 0 && approvedCount === latestProofs.length;
  if (!hadReadyProofsBefore && readyCount > 0) {
    await dispatchProjectNotificationEvent({
      project,
      auth,
      eventType: "proofs_ready",
      occurredAt: isoNow(),
      detail: {
        readyCount,
        totalCount: latestProofs.length,
      },
    });
  }
  if (!allApprovedBefore && allApprovedAfter) {
    await dispatchProjectNotificationEvent({
      project,
      auth,
      eventType: "all_proofs_approved",
      occurredAt: isoNow(),
      detail: {
        approvedCount,
        totalCount: latestProofs.length,
      },
    });
    const transit = await findProjectTransitApproval(project.id);
    if (transit?.status === "approved") {
      await dispatchProjectNotificationEvent({
        project,
        auth,
        eventType: "production_release_ready",
        occurredAt: isoNow(),
        detail: {},
      });
    }
  }

  return Promise.all(latestProofs.map((proof) => toProjectProofLineResponse(proof, variants)));
}

async function updateProjectLiftProofSyncMetadata(project: ProjectItem, syncedAt: string, changed: boolean) {
  const nextProject: ProjectItem = {
    ...project,
    lastLiftProofSyncAt: syncedAt,
    lastLiftProofChangeAt: changed ? syncedAt : project.lastLiftProofChangeAt || null,
  };
  await putCore(buildProjectRecord(nextProject));
}

async function fetchLiftProofSyncLines(
  liftOrderId: string,
  settings: AppSettingsItem,
  projectId: string,
  auth: AuthContext
) {
  const config = settings.integrations.primaryPrintVendor;
  const flush = await fetchLiftFlushOrder(liftOrderId, settings, projectId, auth);
  const order = flush?.rowset?.[0];
  const orderLines = Array.isArray(order?.LINES) ? (order.LINES as Array<Record<string, unknown>>) : [];
  if (!orderLines.length) return [];

  const resolverUrl = resolveLiftEnvironmentUrl(config, getLiftEnvironmentConfig(config).proofUrlResolverUrl);
  if (!resolverUrl) return orderLines;

  const proofReadyLines = orderLines.filter((line) => {
    const lineStepNumber = optionalNumber(line.LINE_STEP_NUMBER) ?? optionalNumber(line.STEP_NUMBER);
    return lineStepNumber === 7.02 && optionalNumber(line.ORDER_LINE_ID) != null;
  });
  if (!proofReadyLines.length) return orderLines;

  let failedLineReads = 0;
  const proofRows = await mapWithConcurrency(proofReadyLines, 5, async (line) => {
    const orderLineId = optionalNumber(line.ORDER_LINE_ID);
    if (orderLineId == null) return [];
    try {
      const proofReport = await fetchLiftProofReport(liftOrderId, settings, projectId, auth, orderLineId);
      return Array.isArray(proofReport?.rowset) ? (proofReport.rowset as Array<Record<string, unknown>>) : [];
    } catch {
      failedLineReads += 1;
      return [];
    }
  });
  const flattenedProofRows = proofRows.flat();
  if (flattenedProofRows.length > 0) {
    return mergeLiftOrderLinesWithProofRows(orderLines, flattenedProofRows);
  }

  // If line-level proof reads failed outright, try one full AS360ProofReport as a compatibility fallback.
  if (failedLineReads > 0) {
    try {
      const proofReport = await fetchLiftProofReport(liftOrderId, settings, projectId, auth);
      if (Array.isArray(proofReport?.rowset)) {
        return mergeLiftOrderLinesWithProofRows(orderLines, proofReport.rowset as Array<Record<string, unknown>>);
      }
    } catch {
      return orderLines;
    }
  }

  return orderLines;
}

function buildLiftQueryUrl(endpointUrl: string, params: Record<string, string>) {
  const url = new URL(endpointUrl);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

async function fetchLiftProofReport(
  liftOrderId: string,
  settings: AppSettingsItem,
  projectId: string,
  auth: AuthContext,
  orderLineId?: number
) {
  const config = settings.integrations.primaryPrintVendor;
  const resolverUrl = resolveLiftEnvironmentUrl(config, getLiftEnvironmentConfig(config).proofUrlResolverUrl);
  if (!resolverUrl) {
    throw new HttpError(400, "Lift proof resolver endpoint is not configured in Internal Admin.");
  }
  const url = buildLiftQueryUrl(resolverUrl, {
    offset: "0",
    p1: liftOrderId,
    p2: orderLineId == null ? "" : String(orderLineId),
  });
  const response = await fetch(url, {
    method: "GET",
    headers: parseLiftHeaders(config.defaultHeaders),
  });
  const responseText = await response.text();
  const responseBody = parseMaybeJson(responseText);
  if (!response.ok || !responseBody) {
    await recordWorkflowError(`PROJECT#${projectId}`, auth, {
      severity: "warning",
      errorCode: "lift_flush_sync_failed",
      message: "Lift proof resolver could not be refreshed.",
      surface: "proof_sync",
      metadata: {
        liftOrderId,
        orderLineId,
        status: response.status,
        endpoint: "proofUrlResolverUrl",
      },
    });
    throw new HttpError(502, `Lift proof resolver failed for order ${liftOrderId}`);
  }
  return responseBody;
}

function mergeLiftOrderLinesWithProofRows(
  orderLines: Array<Record<string, unknown>>,
  proofRows: Array<Record<string, unknown>>
) {
  const proofRowsByLineId = new Map<number, Array<Record<string, unknown>>>();
  const proofRowsByLineNumber = new Map<number, Array<Record<string, unknown>>>();

  for (const row of proofRows) {
    if (isCanceledLiftProofLine(row)) continue;
    const orderLineId = optionalNumber(row.ORDER_LINE_ID);
    const lineNumber = optionalNumber(row.LINE_NUMBER);
    if (orderLineId != null) {
      const rows = proofRowsByLineId.get(orderLineId) || [];
      rows.push(row);
      proofRowsByLineId.set(orderLineId, rows);
    }
    if (lineNumber != null) {
      const rows = proofRowsByLineNumber.get(lineNumber) || [];
      rows.push(row);
      proofRowsByLineNumber.set(lineNumber, rows);
    }
  }

  return orderLines.map((line) => {
    const orderLineId = optionalNumber(line.ORDER_LINE_ID);
    const lineNumber = optionalNumber(line.LINE_NUMBER);
    const matchedProofRows =
      (orderLineId != null ? proofRowsByLineId.get(orderLineId) : null) ||
      (lineNumber != null ? proofRowsByLineNumber.get(lineNumber) : null);
    const proofRow = matchedProofRows?.[0];
    if (!proofRow) return line;
    return {
      ...line,
      ...proofRow,
      PROOFS: matchedProofRows,
      LINE_NUMBER: proofRow.LINE_NUMBER ?? line.LINE_NUMBER,
      ORDER_LINE_ID: proofRow.ORDER_LINE_ID ?? line.ORDER_LINE_ID,
      LINE_STEP_NUMBER: proofRow.LINE_STEP_NUMBER ?? proofRow.STEP_NUMBER ?? line.LINE_STEP_NUMBER,
      UNIT_NUMBER: line.UNIT_NUMBER ?? proofRow.UNIT_NUMBER,
    };
  });
}

function isCanceledLiftProofLine(row: Record<string, unknown>) {
  if (optionalNumber(row.LINE_STEP_ID) === -1) return true;

  const hasLineStepNumber = Object.prototype.hasOwnProperty.call(row, "LINE_STEP_NUMBER");
  const hasStepNumber = Object.prototype.hasOwnProperty.call(row, "STEP_NUMBER");
  if (!hasLineStepNumber && !hasStepNumber) return false;

  const value = hasLineStepNumber ? row.LINE_STEP_NUMBER : row.STEP_NUMBER;
  if (value == null) return true;
  return typeof value === "string" && value.trim() === "";
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  iteratee: (value: T, index: number) => Promise<R>
) {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, values.length));
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < values.length) {
        const currentIndex = nextIndex++;
        results[currentIndex] = await iteratee(values[currentIndex], currentIndex);
      }
    })
  );
  return results;
}

type LiftSmokeEndpointResult = {
  label: string;
  configured: boolean;
  ok: boolean;
  status?: number;
  durationMs?: number;
  message: string;
  urlHost?: string | null;
  rowCount?: number;
  lineCount?: number;
  completeRowCount?: number;
  requiredFieldsPresent?: string[];
  requiredFieldsMissing?: string[];
  sample?: Record<string, unknown>;
};

async function runLiftReadinessSmokeTest(orderNumberValue: string, auth: AuthContext) {
  assertPlatformAdmin(auth);
  const orderNumber = orderNumberValue.trim();
  if (!orderNumber) throw new HttpError(400, "A Lift order number is required for the readiness smoke test.");

  const settings = hydrateAppSettings(await findAppSettings(), auth.actorName);
  const vendor = settings.integrations.primaryPrintVendor;
  const environment = getLiftEnvironmentConfig(vendor);
  const headers = parseLiftHeaders(vendor.defaultHeaders);

  const [orderSync, proofReport, orderUrl] = await Promise.all([
    smokeFetchLiftOrderSync(vendor, environment.flushSyncUrl, headers, orderNumber),
    smokeFetchLiftProofReport(vendor, environment.proofUrlResolverUrl, headers, orderNumber),
    smokeFetchLiftOrderUrl(vendor, environment.orderUrlResolverUrl, headers, orderNumber),
  ]);

  return {
    orderNumber,
    activeEnvironment: vendor.activeEnvironment,
    testedAt: isoNow(),
    enabled: vendor.enabled,
    endpoints: {
      orderSync,
      proofReport,
      orderUrl,
    },
  };
}

async function smokeFetchLiftOrderSync(
  vendor: AppSettingsItem["integrations"]["primaryPrintVendor"],
  endpointValue: string,
  headers: Record<string, string>,
  orderNumber: string
): Promise<LiftSmokeEndpointResult> {
  const label = "AS360Orders";
  const endpointUrl = resolveLiftEnvironmentUrl(vendor, endpointValue);
  if (!endpointUrl) return liftSmokeUnconfigured(label, "AS360Orders / Flush Sync URL is not configured.");

  const response = await liftSmokeFetchJson(label, endpointUrl, headers, { offset: "0", p0: orderNumber }, 10_000);
  if (!response.ok || !response.body || typeof response.body !== "object") return response;

  const rowset = Array.isArray((response.body as Record<string, unknown>).rowset)
    ? ((response.body as Record<string, unknown>).rowset as Array<Record<string, unknown>>)
    : [];
  const firstOrder = rowset[0] || {};
  const lines = Array.isArray(firstOrder.LINES) ? (firstOrder.LINES as Array<Record<string, unknown>>) : [];
  const firstLine = lines[0] || {};
  const requiredHeaderFields = ["ORDER_NUMBER", "CUSTOMER_ID", "ORDER_TITLE", "PO_NUMBER", "ORDER_STATUS"];
  const requiredLineFields = ["LINE_NUMBER", "ORDER_LINE_ID", "QUANTITY", "PRODUCT_NAME", "LINE_STEP_NUMBER"];
  const requiredFields = [
    ...requiredHeaderFields.map((field) => `rowset[0].${field}`),
    ...requiredLineFields.map((field) => `rowset[0].LINES[0].${field}`),
  ];
  const missingFields = [
    ...requiredHeaderFields.filter((field) => !hasSmokeValue(firstOrder[field])).map((field) => `rowset[0].${field}`),
    ...requiredLineFields.filter((field) => !hasSmokeValue(firstLine[field])).map((field) => `rowset[0].LINES[0].${field}`),
  ];

  return {
    ...response,
    rowCount: rowset.length,
    lineCount: lines.length,
    requiredFieldsPresent: requiredFields.filter((field) => !missingFields.includes(field)),
    requiredFieldsMissing: missingFields,
    ok: response.ok && rowset.length > 0 && lines.length > 0 && missingFields.length === 0,
    message:
      rowset.length === 0
        ? "AS360Orders returned no order rows."
        : lines.length === 0
          ? "AS360Orders returned the order header, but no line rows."
          : missingFields.length
            ? "AS360Orders responded, but one or more expected fields are missing."
            : "AS360Orders returned the expected slim order and line shape.",
    sample: {
      orderNumber: optionalString(firstOrder.ORDER_NUMBER),
      customerId: optionalNumber(firstOrder.CUSTOMER_ID),
      orderStatus: optionalString(firstOrder.ORDER_STATUS),
      firstLineNumber: optionalNumber(firstLine.LINE_NUMBER),
      firstOrderLineId: optionalNumber(firstLine.ORDER_LINE_ID),
      firstLineStepNumber: optionalNumber(firstLine.LINE_STEP_NUMBER),
      firstProductName: optionalString(firstLine.PRODUCT_NAME),
    },
  };
}

async function smokeFetchLiftProofReport(
  vendor: AppSettingsItem["integrations"]["primaryPrintVendor"],
  endpointValue: string,
  headers: Record<string, string>,
  orderNumber: string
): Promise<LiftSmokeEndpointResult> {
  const label = "AS360ProofReport";
  const endpointUrl = resolveLiftEnvironmentUrl(vendor, endpointValue);
  if (!endpointUrl) return liftSmokeUnconfigured(label, "AS360ProofReport / Proof URL Resolver URL is not configured.");

  const response = await liftSmokeFetchJson(label, endpointUrl, headers, { offset: "0", p1: orderNumber, p2: "" }, 24_000);
  if (!response.ok || !response.body || typeof response.body !== "object") return response;

  const rowset = Array.isArray((response.body as Record<string, unknown>).rowset)
    ? ((response.body as Record<string, unknown>).rowset as Array<Record<string, unknown>>)
    : [];
  const proofRows = rowset.map((row) => ({
    raw: row,
    normalized: normalizeLiftProofSmokeRow(row),
  }));
  const requiredFields = [
    "orderNumber",
    "orderLineId",
    "lineNumber",
    "lineStepNumber",
    "attachmentId",
    "proofFilename",
    "proofLinkLow",
    "proofLinkHigh",
    "approvalStatus",
  ];
  const completeRows = proofRows.filter(({ normalized }) => requiredFields.every((field) => hasSmokeValue(normalized[field])));
  const proofRow =
    completeRows[0] ||
    proofRows.find(({ normalized }) => hasSmokeValue(normalized.orderLineId) && hasSmokeValue(normalized.proofFilename)) ||
    proofRows[0];
  const firstProof = proofRow?.normalized || {};
  const missingFields = requiredFields.filter((field) => !hasSmokeValue(firstProof[field]));

  return {
    ...response,
    rowCount: rowset.length,
    completeRowCount: completeRows.length,
    requiredFieldsPresent: requiredFields.filter((field) => !missingFields.includes(field)),
    requiredFieldsMissing: missingFields,
    ok: response.ok && rowset.length > 0 && completeRows.length > 0,
    message:
      rowset.length === 0
        ? "AS360ProofReport returned no proof rows. That can be expected before Lift publishes proof assets."
        : completeRows.length === 0
          ? "AS360ProofReport responded, but no proof rows contained the full expected field set."
          : completeRows.length === rowset.length
            ? "AS360ProofReport returned the expected proof line shape for every row."
            : "AS360ProofReport returned usable proof rows, with some incomplete rows to review.",
    sample: {
      orderNumber: optionalString(firstProof.orderNumber),
      orderLineId: optionalNumber(firstProof.orderLineId),
      lineNumber: optionalNumber(firstProof.lineNumber),
      lineStepNumber: optionalNumber(firstProof.lineStepNumber),
      attachmentId: optionalNumber(firstProof.attachmentId),
      proofFilename: optionalString(firstProof.proofFilename),
      hasLowProofLink: Boolean(optionalString(firstProof.proofLinkLow)),
      hasHighProofLink: Boolean(optionalString(firstProof.proofLinkHigh)),
      approvalStatus: optionalString(firstProof.approvalStatus),
    },
  };
}

function normalizeLiftProofSmokeRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    orderNumber: row.ORDER_NUMBER,
    orderLineId: row.ORDER_LINE_ID,
    lineNumber: row.LINE_NUMBER,
    lineStepNumber: row.LINE_STEP_NUMBER ?? row.STEP_NUMBER,
    attachmentId: row.ATTACHMENT_ID,
    proofFilename: row.PROOF_FILENAME ?? row.FILE_NAME,
    proofLinkLow: row.PROOF_LINK_LOW ?? row.PROOF_LINK ?? row.PROOF_URL,
    proofLinkHigh: row.PROOF_LINK_HIGH ?? row.PROOF_LINE_HIGH ?? row.HIRES_PDF_PROOF,
    approvalStatus: row.PROOF_APPROVAL_STATUS,
  };
}

async function smokeFetchLiftOrderUrl(
  vendor: AppSettingsItem["integrations"]["primaryPrintVendor"],
  endpointValue: string,
  headers: Record<string, string>,
  orderNumber: string
): Promise<LiftSmokeEndpointResult> {
  const label = "Lift Order URL";
  const endpointUrl = resolveLiftEnvironmentUrl(vendor, endpointValue);
  if (!endpointUrl) return liftSmokeUnconfigured(label, "Lift order URL resolver is not configured.");

  const response = await liftSmokeFetchJson(label, endpointUrl, headers, { offset: "0", p0: orderNumber }, 8_000);
  if (!response.ok || !response.body || typeof response.body !== "object") return response;

  const url = optionalString((response.body as Record<string, unknown>).url);
  return {
    ...response,
    ok: response.ok && Boolean(url),
    message: url ? "Lift order deep link resolved successfully." : "Lift order URL resolver responded without a url field.",
    sample: {
      hasUrl: Boolean(url),
      urlHost: url ? safeUrlHost(url) : null,
    },
  };
}

async function liftSmokeFetchJson(
  label: string,
  endpointUrl: string,
  headers: Record<string, string>,
  params: Record<string, string>,
  timeoutMs: number
): Promise<LiftSmokeEndpointResult & { body?: unknown }> {
  const startedAt = Date.now();
  let url = "";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    url = buildLiftQueryUrl(endpointUrl, params);
    const response = await fetch(url, { method: "GET", headers, signal: controller.signal });
    const responseText = await response.text();
    const body = parseMaybeJson(responseText);
    const durationMs = Date.now() - startedAt;
    clearTimeout(timeout);
    return {
      label,
      configured: true,
      ok: response.ok,
      status: response.status,
      durationMs,
      urlHost: safeUrlHost(url),
      message: response.ok ? `${label} responded successfully.` : `${label} returned HTTP ${response.status}.`,
      body,
    };
  } catch (error) {
    clearTimeout(timeout);
    const timedOut = error instanceof Error && error.name === "AbortError";
    return {
      label,
      configured: true,
      ok: false,
      durationMs: Date.now() - startedAt,
      urlHost: safeUrlHost(url || endpointUrl),
      message: timedOut
        ? `${label} did not respond within ${Math.round(timeoutMs / 1000)} seconds. Check endpoint reachability, report cost, or host configuration.`
        : error instanceof Error
          ? error.message
          : `${label} smoke test failed.`,
    };
  }
}

function liftSmokeUnconfigured(label: string, message: string): LiftSmokeEndpointResult {
  return {
    label,
    configured: false,
    ok: false,
    message,
  };
}

function hasSmokeValue(value: unknown) {
  return value !== undefined && value !== null && String(value).trim().length > 0;
}

function safeUrlHost(value: string) {
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

async function fetchLiftFlushOrder(
  liftOrderId: string,
  settings: AppSettingsItem,
  projectId: string,
  auth: AuthContext
) {
  const config = settings.integrations.primaryPrintVendor;
  const syncUrl = resolveLiftEnvironmentUrl(config, getLiftEnvironmentConfig(config).flushSyncUrl);
  if (!syncUrl) {
    throw new HttpError(400, "Lift sync endpoint is not configured in Internal Admin.");
  }
  const url = buildLiftQueryUrl(syncUrl, {
    offset: "0",
    p0: liftOrderId,
  });
  const response = await fetch(url, {
    method: "GET",
    headers: parseLiftHeaders(config.defaultHeaders),
  });
  const responseText = await response.text();
  const responseBody = parseMaybeJson(responseText);
  if (!response.ok || !responseBody) {
    await recordWorkflowError(`PROJECT#${projectId}`, auth, {
      severity: "warning",
      errorCode: "lift_flush_sync_failed",
      message: "Lift proof/order sync could not be refreshed.",
      surface: "proof_sync",
      metadata: {
        liftOrderId,
        status: response.status,
      },
    });
    throw new HttpError(502, `Lift flush sync failed for order ${liftOrderId}`);
  }
  return responseBody;
}

function createLiftJwt(clientId: string, clientSecret: string) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64UrlEncode(
    JSON.stringify({
      iss: `https://www.lifterp.com/${clientId}`,
      aud: "https://www.lifterp.com",
      iat: now,
      exp: now + 60 * 10,
    })
  );
  const signature = createHmac("sha256", clientSecret)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function base64UrlEncode(value: string) {
  return Buffer.from(value).toString("base64url");
}

async function sendLiftProofDecision(args: {
  project: ProjectItem;
  proof: ProjectProofLineItem;
  auth: AuthContext;
  settings: AppSettingsItem;
  body: Record<string, unknown>;
}) {
  const { project, proof, auth, settings, body } = args;
  const config = settings.integrations.primaryPrintVendor;
  if (!config.proofClientId.trim() || !config.proofClientSecret.trim()) {
    throw new HttpError(400, "Lift proof API credentials are not configured in Internal Admin.");
  }
  const proofingId = proof.liftProofingId;
  if (!proofingId) {
    throw new HttpError(400, "This proof line has not been linked to a Lift ATTACHMENT_ID / proofing record yet.");
  }
  const proofUrl = resolveLiftEnvironmentUrl(config, getLiftEnvironmentConfig(config).proofEndpointUrlTemplate)
    .replace("%0", encodeURIComponent(config.companyId))
    .replace("%1", encodeURIComponent(String(proofingId)));
  if (!proofUrl) throw new HttpError(400, "Lift proof endpoint is not configured in Internal Admin.");

  const jwt = createLiftJwt(config.proofClientId, config.proofClientSecret);
  const response = await fetch(proofUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
      "Lift-ERP-Client-Id": config.proofClientId,
      ...parseLiftHeaders(config.defaultHeaders),
    },
    body: JSON.stringify(body),
  });
  const responseText = await response.text();
  const responseBody = parseMaybeJson(responseText) || { raw: responseText };
  if (!response.ok) {
    await recordWorkflowError(`PROJECT#${project.id}`, auth, {
      severity: "error",
      errorCode: body.approve === false ? "lift_proof_reject_failed" : "lift_proof_approve_failed",
      message: "Lift proofing request failed.",
      surface: "proof_approval",
      metadata: {
        liftOrderId: project.liftOrderId,
        proofingId,
        status: response.status,
        body: responseBody,
      },
    });
    throw new HttpError(502, "Lift proofing request failed.");
  }
  return responseBody;
}

async function resolveLiftOrderUrl(
  liftOrderId: string,
  settings: AppSettingsItem
) {
  const config = settings.integrations.primaryPrintVendor;
  const resolverUrl = resolveLiftEnvironmentUrl(config, getLiftEnvironmentConfig(config).orderUrlResolverUrl);
  if (!resolverUrl) return null;
  const response = await fetch(`${resolverUrl}${resolverUrl.includes("?") ? "&" : "?"}offset=0&p0=${encodeURIComponent(liftOrderId)}`, {
    method: "GET",
    headers: parseLiftHeaders(config.defaultHeaders),
  });
  const text = await response.text();
  const parsed = parseMaybeJson(text);
  if (!response.ok) return null;
  return optionalString(parsed?.url) || null;
}

async function resolveLiftOrderUrlSafe(project: ProjectItem, settings: AppSettingsItem) {
  if (!project.liftOrderId) return null;
  try {
    return await resolveLiftOrderUrl(project.liftOrderId, settings);
  } catch (error) {
    console.warn("Failed to resolve Lift order deep link", {
      projectId: project.id,
      liftOrderId: project.liftOrderId,
      error,
    });
    return null;
  }
}

async function updateProjectAssignment(
  projectId: string,
  inventoryId: string,
  payload: Record<string, unknown>,
  auth: AuthContext
) {
  const startedAt = Date.now();
  const project = await findProjectById(projectId);
  if (!project) throw new HttpError(404, `Project ${projectId} not found`);
  assertProjectAccess(auth, project);
  await assertProjectMutable(auth, project, "update assignments");
  if (project.productionReleasedAt) throw new HttpError(400, "Assignments are locked after production release");

  const scope = await findProjectScopeByProjectId(projectId);
  if (!scope?.includedIds.includes(inventoryId)) {
    throw new HttpError(400, `Inventory ${inventoryId} is not in the project scope`);
  }

  const inventory = await findInventoryById(inventoryId);
  if (!inventory) throw new HttpError(404, `Inventory ${inventoryId} not found`);
  if (inventory.venueId !== project.venueId) {
    throw new HttpError(400, `Inventory ${inventoryId} does not belong to the project's venue`);
  }

  const creativeId = normalizeCreativeId(payload.creativeId);
  const existingAssignments = await listProjectAssignments(projectId);
  const previousAssignedCount = existingAssignments.filter(
    (assignment) => !!assignment.creativeId && scope.includedIds.includes(assignment.inventoryId)
  ).length;
  const existingAssignment = existingAssignments.find((assignment) => assignment.inventoryId === inventoryId) || null;
  const expectedUpdatedAt = payload.expectedUpdatedAt === null ? null : optionalString(payload.expectedUpdatedAt) || null;
  const currentUpdatedAt = existingAssignment?.updatedAt || null;
  if (expectedUpdatedAt !== currentUpdatedAt) {
    throw new HttpError(409, "This inventory assignment changed since you loaded the page. Refresh and try again.");
  }
  let creative: ProjectCreativeAssetItem | null = null;
  if (creativeId) {
    creative = await findProjectCreativeById(projectId, creativeId);
    if (!creative) throw new HttpError(404, `Creative ${creativeId} not found`);
    if (creative.mediaVariantKey !== inventory.mediaVariantKey) {
      throw new HttpError(400, "Creative media variant does not match the selected inventory item");
    }
  }

  const now = isoNow();
  const assignment: ProjectAssignmentItem = {
    entityType: "ProjectAssignment",
    id: `${projectId}:${inventoryId}`,
    projectId,
    inventoryId,
    creativeId,
    updatedAt: now,
    updatedByName: auth.actorName,
  };

  await putCore(buildProjectAssignmentRecord(assignment));
  await writeAudit(`PROJECT#${projectId}`, creativeId ? "assignment.updated" : "assignment.cleared", auth, {
    projectId,
    inventoryId,
    inventoryLabel: inventory.inventoryId,
    creativeId,
    creativeFilename: creative?.filename || null,
  });
  if (creativeId && creative) {
    await dispatchProjectNotificationEvent({
      project,
      auth,
      eventType: "creatives_assigned",
      occurredAt: now,
      detail: {
        inventoryId,
        inventoryLabel: inventory.inventoryId,
        creativeId,
        creativeFilename: creative.filename,
      },
    });
  }
  const nextAssignedCount =
    existingAssignments.filter((assignment) => {
      if (assignment.inventoryId === inventoryId) return false;
      return !!assignment.creativeId && scope.includedIds.includes(assignment.inventoryId);
    }).length + (creativeId ? 1 : 0);
  if (scope.includedIds.length > 0 && previousAssignedCount < scope.includedIds.length && nextAssignedCount >= scope.includedIds.length) {
    await dispatchProjectNotificationEvent({
      project,
      auth,
      eventType: "all_inventory_assigned",
      occurredAt: now,
      detail: {
        assignedCount: nextAssignedCount,
        requiredCount: scope.includedIds.length,
      },
    });
  }

  const response = {
    assignment: toWorkspaceAssignment(assignment, inventory.inventoryId),
  };
  logPerf("updateProjectAssignment", startedAt, {
    projectId,
    inventoryId,
    assigned: !!creativeId,
  });
  return response;
}

async function updateProjectProofLine(
  projectId: string,
  lineItemId: string,
  payload: Record<string, unknown>,
  auth: AuthContext
) {
  const project = await findProjectById(projectId);
  if (!project) throw new HttpError(404, `Project ${projectId} not found`);
  assertProjectAccess(auth, project);
  await assertProjectMutable(auth, project, "update proofs");
  if (project.productionReleasedAt) throw new HttpError(400, "Proof approvals are locked after production release");
  const settings = hydrateAppSettings(await findAppSettings(), auth.actorName);

  let existing = await findProjectProofLineById(projectId, lineItemId);
  if (!existing) throw new HttpError(404, `Proof line ${lineItemId} not found`);
  const expectedUpdatedAt = payload.expectedUpdatedAt === null ? null : optionalString(payload.expectedUpdatedAt) || null;
  if (expectedUpdatedAt !== (existing.updatedAt || null)) {
    throw new HttpError(409, "This proof line changed since you loaded it. Refresh and try again.");
  }

  const useClientCreativeAsProof = optionalBoolean(payload.useClientCreativeAsProof) === true;
  const clientCreative = useClientCreativeAsProof
    ? await findProjectCreativeById(projectId, existing.clientCreativeId)
    : null;
  if (useClientCreativeAsProof && !clientCreative) {
    throw new HttpError(404, `Creative ${existing.clientCreativeId} not found for proof line ${lineItemId}`);
  }

  const nextStatus = optionalProofStatus(payload.status) ?? existing.status;
  const proofDecisionComment = optionalString(payload.proofDecisionComment) || null;
  const shouldUseLiftProofing =
    !!project.liftOrderId &&
    settings.integrations.liftProofSyncEnabled &&
    settings.integrations.primaryPrintVendor.enabled;

  if (shouldUseLiftProofing && (!existing.liftProofingId || !existing.liftOrderLineId)) {
    await syncProjectProofLinesFromLift(project, auth).catch(() => undefined);
    existing = await findProjectProofLineById(projectId, lineItemId);
    if (!existing) throw new HttpError(404, `Proof line ${lineItemId} not found`);
  }

  if (shouldUseLiftProofing) {
    if (nextStatus === "approved") {
      await sendLiftProofDecision({
        project,
        proof: existing,
        auth,
        settings,
        body: {
          approve: true,
          approveQuantity: 1,
          comment: proofDecisionComment,
          userName: "ADSPACE360",
        },
      });
    } else if (optionalBoolean(payload.revised) === true && useClientCreativeAsProof && clientCreative) {
      const revisedArtUrl = await signLiftOutboundAssetUrl(
        clientCreative.bucketName || PROJECT_ASSETS_BUCKET_NAME,
        clientCreative.objectKey
      );
      await sleep(3500);
      await sendLiftProofDecision({
        project,
        proof: existing,
        auth,
        settings,
        body: {
          approve: false,
          comment: proofDecisionComment,
          userName: "ADSPACE360",
          rejectReason: "REVISED_ART_WILL_BE_SENT",
          artUrl: revisedArtUrl,
          upload: true,
        },
      });
    } else if (existing.status === "approved" && nextStatus === "pending") {
      await sendLiftProofDecision({
        project,
        proof: existing,
        auth,
        settings,
        body: {
          approve: false,
          comment: proofDecisionComment,
          userName: "ADSPACE360",
          rejectReason: "REJECT",
        },
      });
    }
  }

  const nextUpdatedAt = isoNow();
  const clearsLiftProofForRevision = shouldUseLiftProofing && useClientCreativeAsProof && optionalBoolean(payload.revised) === true;
  const nextProofLine: ProjectProofLineItem = {
    ...existing,
    status:
      clearsLiftProofForRevision
        ? "waiting"
        : useClientCreativeAsProof
        ? nextStatus || "pending"
        : nextStatus,
    revised: optionalBoolean(payload.revised) ?? existing.revised,
    clientFileName:
      payload.clientFileName === null
        ? existing.clientFileName
        : optionalString(payload.clientFileName) || existing.clientFileName,
    proofObjectKey:
      clearsLiftProofForRevision
        ? undefined
        : useClientCreativeAsProof
        ? clientCreative?.objectKey
        : payload.proofObjectKey === null
        ? undefined
        : optionalString(payload.proofObjectKey) || existing.proofObjectKey,
    proofThumbObjectKey:
      clearsLiftProofForRevision
        ? undefined
        : useClientCreativeAsProof
        ? clientCreative?.thumbObjectKey
        : payload.proofThumbObjectKey === null
        ? undefined
        : optionalString(payload.proofThumbObjectKey) || existing.proofThumbObjectKey,
    liftProofThumbUrl:
      clearsLiftProofForRevision
        ? null
        : existing.liftProofThumbUrl ?? null,
    liftProofFullUrl:
      clearsLiftProofForRevision
        ? null
        : existing.liftProofFullUrl ?? null,
    printTeamFeedback:
      clearsLiftProofForRevision
        ? undefined
        : payload.printTeamFeedback === null
        ? undefined
        : optionalString(payload.printTeamFeedback) || existing.printTeamFeedback,
    proofComments: clearsLiftProofForRevision ? [] : existing.proofComments || [],
    proofCommentCount: clearsLiftProofForRevision ? 0 : existing.proofCommentCount || 0,
    proofCommentAttachmentCount: clearsLiftProofForRevision ? 0 : existing.proofCommentAttachmentCount || 0,
    latestProofCommentAt: clearsLiftProofForRevision ? null : existing.latestProofCommentAt || null,
    proofVersions: clearsLiftProofForRevision
      ? mergeStoredProofVersion(existing.proofVersions || [], buildStoredProofVersionFromLine(existing, nextUpdatedAt))
      : existing.proofVersions || [],
    updatedAt: nextUpdatedAt,
    updatedByName: auth.actorName,
  };

  await putCore(buildProjectProofLineRecord(nextProofLine));
  if (shouldUseLiftProofing) {
    await syncProjectProofLinesFromLift(project, auth).catch(() => undefined);
  }
  await writeAudit(`PROJECT#${projectId}`, "proof.updated", auth, {
    projectId,
    lineItemId,
    status: nextProofLine.status,
    revised: nextProofLine.revised,
    lineNumber: nextProofLine.lineNumber,
    proofDecisionComment,
  });
  if (optionalBoolean(payload.revised) === true && useClientCreativeAsProof && clientCreative) {
    await dispatchProjectNotificationEvent({
      project,
      auth,
      eventType: "revised_art_uploaded",
      occurredAt: nextProofLine.updatedAt,
      detail: {
        lineNumber: nextProofLine.lineNumber,
        clientFileName: clientCreative.filename,
      },
    });
  }
  if (!shouldUseLiftProofing) {
    const latestProofs = await listProjectProofLines(projectId);
    const approvedCount = latestProofs.filter((line) => line.status === "approved").length;
    if (latestProofs.length > 0 && approvedCount === latestProofs.length) {
      await dispatchProjectNotificationEvent({
        project,
        auth,
        eventType: "all_proofs_approved",
        occurredAt: nextProofLine.updatedAt,
        detail: {
          approvedCount,
          totalCount: latestProofs.length,
        },
      });
      const transit = await findProjectTransitApproval(projectId);
      if (transit?.status === "approved") {
        await dispatchProjectNotificationEvent({
          project,
          auth,
          eventType: "production_release_ready",
          occurredAt: nextProofLine.updatedAt,
          detail: {},
        });
      }
    }
  }

  const variants = await listVariantsForVenue(project.venueId);
  const latest = (await findProjectProofLineById(projectId, lineItemId)) || nextProofLine;
  return {
    proof: await toProjectProofLineResponse(latest, variants),
  };
}

async function upsertProjectTransit(
  projectId: string,
  payload: Record<string, unknown>,
  auth: AuthContext
) {
  const project = await findProjectById(projectId);
  if (!project) throw new HttpError(404, `Project ${projectId} not found`);
  assertProjectAccess(auth, project);
  await assertProjectMutable(auth, project, "update transit approval");
  if (project.productionReleasedAt) throw new HttpError(400, "Transit approval is locked after production release");

  const existing = await findProjectTransitApproval(projectId);
  const expectedUpdatedAt = payload.expectedUpdatedAt === null ? null : optionalString(payload.expectedUpdatedAt) || null;
  if (expectedUpdatedAt !== (existing?.updatedAt || null)) {
    throw new HttpError(409, "Transit approval changed since you loaded it. Refresh and try again.");
  }
  const now = isoNow();
  const nextStatus = optionalTransitStatus(payload.status) ?? existing?.status ?? "not_started";
  const clearFields = nextStatus === "not_started";

  const transit: ProjectTransitApprovalItem = {
    entityType: "ProjectTransitApproval",
    id: existing?.id || projectId,
    projectId,
    status: nextStatus,
    submittedByName: clearFields ? undefined : optionalString(payload.submittedByName) || existing?.submittedByName,
    submittedDate: clearFields ? undefined : optionalDate(payload.submittedDate) || existing?.submittedDate,
    comment: clearFields ? undefined : optionalString(payload.comment) || existing?.comment,
    submittedAt: clearFields ? undefined : optionalString(payload.submittedAt) || existing?.submittedAt || now,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  await putCore(buildProjectTransitRecord(transit));
  await writeAudit(`PROJECT#${projectId}`, "transit.updated", auth, {
    projectId,
    status: transit.status,
    submittedByName: transit.submittedByName || null,
  });
  if (existing?.status !== transit.status && (transit.status === "approved" || transit.status === "rejected")) {
    await dispatchProjectNotificationEvent({
      project,
      auth,
      eventType: transit.status === "approved" ? "transit_accepted" : "transit_rejected",
      occurredAt: now,
      detail: {
        status: transit.status,
        comment: transit.comment || null,
      },
    });
  }
  if (existing?.status !== "approved" && transit.status === "approved") {
    const proofLines = await listProjectProofLines(projectId);
    const approvedCount = proofLines.filter((line) => line.status === "approved").length;
    if (proofLines.length > 0 && approvedCount === proofLines.length) {
      await dispatchProjectNotificationEvent({
        project,
        auth,
        eventType: "production_release_ready",
        occurredAt: now,
        detail: {},
      });
    }
  }

  return {
    transit: toProjectTransitResponse(transit, project),
  };
}

async function releaseProjectProduction(
  projectId: string,
  payload: Record<string, unknown>,
  auth: AuthContext
) {
  const project = await findProjectById(projectId);
  if (!project) throw new HttpError(404, `Project ${projectId} not found`);
  assertProjectAccess(auth, project);
  await assertProjectMutable(auth, project, "release production");
  if (!project.liftOrderId) throw new HttpError(400, "Project must be submitted before production can be released");
  if (project.productionReleasedAt) {
    return {
      project: await toProjectListItem(project, await findProjectScopeByProjectId(projectId)),
      release: {
        releasedAt: project.productionReleasedAt,
        releasedByName: project.productionReleasedByName || auth.actorName,
        note: project.productionReleaseNote || null,
      },
    };
  }

  const rollup = await toProjectListItem(project, await findProjectScopeByProjectId(projectId));
  if (!rollup.production.ready) {
    throw new HttpError(400, "Production release is locked until proofs are approved and transit approval is accepted");
  }

  const now = isoNow();
  const nextProject: ProjectItem = {
    ...project,
    productionReleasedAt: now,
    productionReleasedByName: auth.actorName,
    productionReleaseNote: optionalString(payload.note) || null,
    updatedAt: now,
  };

  await putCore(buildProjectRecord(nextProject));
  await writeAudit(`PROJECT#${projectId}`, "project.production_released", auth, {
    projectId,
    releasedAt: now,
    note: nextProject.productionReleaseNote,
  });

  return {
    project: await toProjectListItem(nextProject, await findProjectScopeByProjectId(projectId)),
    release: {
      releasedAt: now,
      releasedByName: auth.actorName,
      note: nextProject.productionReleaseNote,
    },
  };
}

async function listProjectShareLinks(projectId: string, auth: AuthContext) {
  const project = await findProjectById(projectId);
  if (!project) throw new HttpError(404, `Project ${projectId} not found`);
  assertProjectAccess(auth, project);
  await assertProjectCustomerReadable(auth, project);

  const links = await rawListProjectShareLinks(projectId);
  const participants = await listProjectShareParticipants(projectId);
  const events = await rawListProjectAuditEvents(projectId);

  return links.map((link) => {
    const linkParticipants = participants.filter((participant) => participant.shareLinkId === link.id);
    const linkEvents = events.filter((event) => event.shareLinkId === link.id);
    return toProjectShareLinkResponse(link, linkParticipants, linkEvents);
  });
}

async function createProjectShareLink(projectId: string, payload: Record<string, unknown>, auth: AuthContext) {
  const project = await findProjectById(projectId);
  if (!project) throw new HttpError(404, `Project ${projectId} not found`);
  assertProjectAccess(auth, project);
  await assertProjectMutable(auth, project, "create shared links");
  if (project.projectMode === "internal_sandbox") {
    throw new HttpError(400, "Shared links are disabled for internal sandbox projects.");
  }

  const accessType = optionalShareAccessType(payload.accessType) || "collaboration";
  const label = optionalString(payload.label) || shareAccessLabel(accessType);
  const now = isoNow();
  const rawToken = createShareToken();
  const tokenHash = hashShareToken(rawToken);
  const shortCode = createShortCode();
  const link: ProjectShareLinkItem = {
    entityType: "ProjectShareLink",
    id: makeId("share"),
    projectId,
    label,
    accessType,
    status: "active",
    tokenHash,
    shortCode,
    createdByName: auth.actorName,
    createdAt: now,
    updatedAt: now,
    expiresAt: optionalDate(payload.expiresAt) || null,
  };

  await putCore(buildProjectShareLinkRecord(link));
  await putShortLinkRecord(shortCode, buildShareTargetPath(projectId, accessType, rawToken), link.expiresAt);
  await writeAudit(`PROJECT#${projectId}`, "share_link.created", auth, {
    projectId,
    shareLinkId: link.id,
    accessType,
    shortCode,
  });

  return {
    shareLink: toProjectShareLinkResponse(link, [], []),
  };
}

async function updateProjectShareLink(shareLinkId: string, payload: Record<string, unknown>, auth: AuthContext) {
  const existing = await findShareLinkById(shareLinkId);
  if (!existing) throw new HttpError(404, `Share link ${shareLinkId} not found`);
  const project = await findProjectById(existing.projectId);
  if (!project) throw new HttpError(404, `Project ${existing.projectId} not found`);
  assertProjectAccess(auth, project);
  await assertProjectMutable(auth, project, "update shared links");

  const nextLabel = optionalString(payload.label) || existing.label;
  const shouldRegenerate = optionalBoolean(payload.regenerate) === true;
  const nextStatus = optionalShareLinkStatus(payload.status) || existing.status;
  const now = isoNow();

  let nextLink: ProjectShareLinkItem = {
    ...existing,
    label: nextLabel,
    status: nextStatus,
    updatedAt: now,
  };

  let replacementToken: string | null = null;
  if (shouldRegenerate) {
    replacementToken = createShareToken();
    const nextShortCode = createShortCode();
    await putShortLinkRecord(nextShortCode, buildShareTargetPath(existing.projectId, existing.accessType, replacementToken), existing.expiresAt || null);
    if (existing.shortCode) await revokeShortLinkRecord(existing.shortCode);
    nextLink = {
      ...nextLink,
      tokenHash: hashShareToken(replacementToken),
      shortCode: nextShortCode,
    };
  } else if (existing.shortCode && nextStatus === "revoked") {
    await revokeShortLinkRecord(existing.shortCode);
  }

  await putCore(buildProjectShareLinkRecord(nextLink));
  await writeAudit(`PROJECT#${existing.projectId}`, shouldRegenerate ? "share_link.regenerated" : "share_link.updated", auth, {
    projectId: existing.projectId,
    shareLinkId: existing.id,
    status: nextLink.status,
    shortCode: nextLink.shortCode,
  });

  const participants = await listShareParticipants(nextLink.id);
  const events = (await rawListProjectAuditEvents(existing.projectId)).filter((event) => event.shareLinkId === nextLink.id);
  return {
    shareLink: toProjectShareLinkResponse(nextLink, participants, events),
  };
}

async function resolveShareLink(event: ApiEvent) {
  const token = event.queryStringParameters?.token?.trim() || readShareToken(event);
  if (!token) throw new HttpError(400, "token is required");

  const shareLink = await findShareLinkByToken(token);
  if (!shareLink) throw new HttpError(404, "Shared link not found");
  const project = await findProjectById(shareLink.projectId);
  const customer = project ? await findCustomerById(project.customerId) : null;

  return {
    shareLink: {
      id: shareLink.id,
      projectId: shareLink.projectId,
      label: shareLink.label,
      customerName: customer?.name || project?.customerName || "",
      customerLogoUrl: await signCustomerLogoUrl(customer),
      accessType: shareLink.accessType,
      status: shareLink.status,
      expiresAt: shareLink.expiresAt || null,
      shortUrl: shareLink.shortCode ? `${SHORT_BASE_URL}/${shareLink.shortCode}` : null,
    },
  };
}

async function identifyShareParticipant(payload: Record<string, unknown>) {
  const token = requiredString(payload, "token");
  const displayName = requiredString(payload, "displayName");
  const email = requiredString(payload, "email").toLowerCase();
  const shareLink = await findShareLinkByToken(token);
  if (!shareLink) throw new HttpError(404, "Shared link not found");
  if (shareLink.status !== "active") throw new HttpError(403, "This shared link has been revoked");

  const existing = await findShareParticipantByEmail(shareLink.id, email);
  const now = isoNow();
  const participant: ShareParticipantItem = existing
    ? {
        ...existing,
        displayName,
        lastSeenAt: now,
      }
    : {
        entityType: "ShareParticipant",
        id: makeId("participant"),
        projectId: shareLink.projectId,
        shareLinkId: shareLink.id,
        displayName,
        email,
        emailLower: email.toLowerCase(),
        firstSeenAt: now,
        lastSeenAt: now,
      };

  await putCore(buildShareParticipantRecord(participant));
  await writeAudit(
    `PROJECT#${shareLink.projectId}`,
    existing ? "share_participant.returned" : "share_participant.identified",
    {
      mode: "share",
      actorType: "share_participant",
      actorId: participant.id,
      profile: null,
      actorName: participant.displayName,
      isPlatformAdmin: false,
      customerIds: new Set<string>(),
      shareLink,
      participant,
    },
    {
      projectId: shareLink.projectId,
      shareLinkId: shareLink.id,
      email: participant.email,
    }
  );

  return {
    participant: {
      id: participant.id,
      shareLinkId: participant.shareLinkId,
      displayName: participant.displayName,
      email: participant.email,
      firstSeenAt: participant.firstSeenAt,
      lastSeenAt: participant.lastSeenAt,
    },
  };
}

async function findCustomerById(customerId: string) {
  const cached = readLocalCache(customerByIdCache.get(customerId));
  if (cached.hit) return cached.value;
  const items = await queryByPk(`CUSTOMER#${customerId}`);
  const customer = items.find((item): item is CustomerItem => item.entityType === "Customer") || null;
  customerByIdCache.set(customerId, makeLocalCacheEntry(customer, SHORT_CACHE_TTL_MS));
  return customer;
}

async function findCustomerByName(customerName: string) {
  const customers = await scanByEntityType("Customer");
  return (
    customers
      .filter((item): item is CustomerItem => item.entityType === "Customer")
      .find((customer) => normalizeText(customer.name) === normalizeText(customerName)) || null
  );
}

async function assertProjectCustomerReadable(auth: AuthContext, project: ProjectItem) {
  if (project.projectMode === "internal_sandbox") return null;
  const customer = await findCustomerById(project.customerId);
  if (!customer) throw new HttpError(404, `Customer ${project.customerId} not found`);
  assertCustomerReadable(auth, customer);
  return customer;
}

async function assertProjectMutable(auth: AuthContext, project: ProjectItem, action: string) {
  if (project.projectMode === "internal_sandbox") {
    if (auth.isPlatformAdmin) return;
    throw new HttpError(403, `Internal sandbox projects can only be changed by platform admins.`);
  }
  const customer = await findCustomerById(project.customerId);
  if (!customer) throw new HttpError(404, `Customer ${project.customerId} not found`);
  assertCustomerMutable(auth, customer, action);
}

async function ensureInternalSandboxCustomer(actorName: string) {
  const existing = (await findCustomerById(INTERNAL_SANDBOX_CUSTOMER_ID)) || (await findCustomerByName(INTERNAL_SANDBOX_CUSTOMER_NAME));
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
      invalidateCustomerCaches(next.id);
    }
    customerByIdCache.set(next.id, makeLocalCacheEntry(next, SHORT_CACHE_TTL_MS));
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
  invalidateCustomerCaches(customer.id);
  customerByIdCache.set(customer.id, makeLocalCacheEntry(customer, SHORT_CACHE_TTL_MS));
  await writeAudit(`ADMIN_SETTINGS#CUSTOMER#${customer.id}`, "customer.created", {
    mode: "user",
    actorType: "user",
    actorId: "system",
    profile: null,
    actorName,
    isPlatformAdmin: true,
    customerIds: new Set<string>(),
  }, {
    customerId: customer.id,
    name: customer.name,
    liftCustomerId: customer.liftCustomerId,
    isActive: true,
    isInternalSandbox: true,
  });
  return customer;
}

async function findMarketById(marketId: string) {
  const items = await queryByGsi1(`MARKET#${marketId}`);
  return items.find((item): item is MarketItem => item.entityType === "Market") || null;
}

async function findVenueById(venueId: string) {
  const items = await queryByPk(`VENUE#${venueId}`);
  return items.find((item): item is VenueItem => item.entityType === "Venue") || null;
}

async function findProjectById(projectId: string) {
  const items = await queryByPk(`PROJECT#${projectId}`);
  return items.find((item): item is ProjectItem => item.entityType === "Project") || null;
}

async function loadProjectRecordBundle(projectId: string): Promise<ProjectRecordBundle> {
  const items = await queryByPk(`PROJECT#${projectId}`);
  return parseProjectRecordBundle(items);
}

function parseProjectRecordBundle(items: Array<Record<string, any>>): ProjectRecordBundle {
  return {
    project: items.find((item): item is ProjectItem => item.entityType === "Project") || null,
    scope: items.find((item): item is ProjectScopeItem => item.entityType === "ProjectScope") || null,
    creatives: items
      .filter((item): item is ProjectCreativeAssetItem => item.entityType === "CreativeAsset")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    assignments: items
      .filter((item): item is ProjectAssignmentItem => item.entityType === "ProjectAssignment")
      .sort((a, b) => a.inventoryId.localeCompare(b.inventoryId)),
    proofLines: items
      .filter((item): item is ProjectProofLineItem => item.entityType === "ProjectProofLine")
      .sort((a, b) => a.lineNumber - b.lineNumber),
    allocationOverrideRows: items
      .filter((item): item is ProjectAllocationOverrideRowItem => item.entityType === "ProjectAllocationOverrideRow")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    transit: items.find((item): item is ProjectTransitApprovalItem => item.entityType === "ProjectTransitApproval") || null,
  };
}

async function findProjectScopeByProjectId(projectId: string) {
  const items = await queryByPk(`PROJECT#${projectId}`, "SCOPE");
  return items.find((item): item is ProjectScopeItem => item.entityType === "ProjectScope") || null;
}

async function findAppSettings() {
  const cached = readLocalCache(appSettingsCache.current);
  if (cached.hit) return cached.value;
  const items = await queryByPk("APPSETTINGS#global");
  const settings = items.find((item): item is AppSettingsItem => item.entityType === "AppSettings") || null;
  appSettingsCache.current = makeLocalCacheEntry(settings, SHORT_CACHE_TTL_MS);
  return settings;
}

async function findCustomerSettings(customerId: string) {
  const items = await queryByPk(`CUSTOMER#${customerId}`, "SETTINGS#");
  return items.find((item): item is CustomerSettingsItem => item.entityType === "CustomerSettings") || null;
}

async function findNotificationDigest(customerId: string, ruleId: string) {
  const items = await queryByPk(`CUSTOMER#${customerId}`, `NOTIFICATION_DIGEST#${ruleId}`);
  return items.find((item): item is NotificationDigestItem => item.entityType === "NotificationDigest") || null;
}

async function listCustomerVendors(customerId: string) {
  const items = await queryByPk(`CUSTOMER#${customerId}`, "VENDOR#");
  return items
    .filter((item): item is CustomerVendorItem => item.entityType === "CustomerVendor")
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function findCustomerVendor(customerId: string, vendorId: string) {
  const items = await queryByPk(`CUSTOMER#${customerId}`, `VENDOR#${vendorId}`);
  return items.find((item): item is CustomerVendorItem => item.entityType === "CustomerVendor") || null;
}

async function listInventoryForVenue(venueId: string) {
  const items = await queryByGsi2(`VENUE#${venueId}`, "INVENTORY#");
  return items.filter((item): item is InventoryItem => item.entityType === "InventoryItem");
}

async function listMapsForVenue(venueId: string) {
  const items = await queryByPk(`VENUE#${venueId}`, "MAP#");
  return items
    .filter((item): item is RoomMapItem => item.entityType === "RoomMap")
    .sort((a, b) => (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name));
}

async function listVariantsForVenue(venueId: string) {
  const items = await queryByPk(`VENUE#${venueId}`, "VARIANT#");
  return items
    .filter((item): item is MediaVariantItem => item.entityType === "MediaVariant")
    .sort((a, b) => a.label.localeCompare(b.label));
}

async function listProjectCreatives(projectId: string) {
  const items = await queryByPk(`PROJECT#${projectId}`, "CREATIVE#");
  return items
    .filter((item): item is ProjectCreativeAssetItem => item.entityType === "CreativeAsset")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

async function listProjectDocuments(projectId: string) {
  const items = await queryByPk(`PROJECT#${projectId}`, "DOC#");
  return items
    .filter((item): item is ProjectDocumentItem => item.entityType === "ProjectDocument")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function listProjectAssignments(projectId: string) {
  const items = await queryByPk(`PROJECT#${projectId}`, "ASSIGNMENT#");
  return items
    .filter((item): item is ProjectAssignmentItem => item.entityType === "ProjectAssignment")
    .sort((a, b) => a.inventoryId.localeCompare(b.inventoryId));
}

async function findProjectNotificationDispatch(projectId: string, eventType: NotificationEventType) {
  const items = await queryByPk(`PROJECT#${projectId}`, `NOTIFY#${eventType}`);
  return items.find((item): item is ProjectNotificationDispatchItem => item.entityType === "ProjectNotificationDispatch") || null;
}

async function listProjectProofLines(projectId: string) {
  const items = await queryByPk(`PROJECT#${projectId}`, "PROOF#");
  return items
    .filter((item): item is ProjectProofLineItem => item.entityType === "ProjectProofLine")
    .sort((a, b) => a.lineNumber - b.lineNumber || (a.liftProofingId ?? 0) - (b.liftProofingId ?? 0) || a.id.localeCompare(b.id));
}

async function listProjectAllocationOverrideRows(projectId: string) {
  const items = await queryByPk(`PROJECT#${projectId}`, "ALLOCOVR#");
  return items
    .filter((item): item is ProjectAllocationOverrideRowItem => item.entityType === "ProjectAllocationOverrideRow")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

async function deleteProjectProofLine(proof: ProjectProofLineItem) {
  await deleteCore(`PROJECT#${proof.projectId}`, `PROOF#${String(proof.lineNumber).padStart(4, "0")}#${proof.id}`);
}

async function listUserProfiles() {
  const cached = readLocalCache(userProfilesListCache.current);
  if (cached.hit) return cached.value;
  const items = await scanByEntityType("UserProfile");
  const profiles = items
    .filter((item): item is UserProfileItem => item.entityType === "UserProfile")
    .sort((a, b) => (a.displayName || a.email).localeCompare(b.displayName || b.email));
  userProfilesListCache.current = makeLocalCacheEntry(profiles, SHORT_CACHE_TTL_MS);
  for (const profile of profiles) {
    cacheUserProfile(profile);
  }
  return profiles;
}

async function listCustomers() {
  await ensureInternalSandboxCustomer("System");
  const cached = readLocalCache(customersListCache.current);
  if (cached.hit) return cached.value;
  const items = await scanByEntityType("Customer");
  const customers = items
    .filter((item): item is CustomerItem => item.entityType === "Customer")
    .sort((a, b) => a.name.localeCompare(b.name));
  customersListCache.current = makeLocalCacheEntry(customers, SHORT_CACHE_TTL_MS);
  for (const customer of customers) {
    customerByIdCache.set(customer.id, makeLocalCacheEntry(customer, SHORT_CACHE_TTL_MS));
  }
  return customers;
}

async function rawListProjectShareLinks(projectId: string) {
  const items = await queryByPk(`PROJECT#${projectId}`, "SHARELINK#");
  return items
    .filter((item): item is ProjectShareLinkItem => item.entityType === "ProjectShareLink")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function listShareParticipants(shareLinkId: string) {
  const items = await queryByPk(`SHARELINK#${shareLinkId}`, "PARTICIPANT#");
  return items
    .filter((item): item is ShareParticipantItem => item.entityType === "ShareParticipant")
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
}

async function listProjectShareParticipants(projectId: string) {
  const items = await queryByGsi1(`PROJECT#${projectId}`, "SHAREPARTICIPANT#");
  return items
    .filter((item): item is ShareParticipantItem => item.entityType === "ShareParticipant")
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
}

async function findProjectProofLineById(projectId: string, lineItemId: string) {
  const items = await queryByGsi1(`PROOF#${lineItemId}`);
  const proof = items.find((item): item is ProjectProofLineItem => item.entityType === "ProjectProofLine") || null;
  if (!proof) return null;
  return proof.projectId === projectId ? proof : null;
}

async function findProjectAllocationOverrideRowById(projectId: string, rowId: string) {
  const items = await queryByGsi1(`ALLOCOVR#${rowId}`);
  const row = items.find((item): item is ProjectAllocationOverrideRowItem => item.entityType === "ProjectAllocationOverrideRow") || null;
  if (!row) return null;
  return row.projectId === projectId ? row : null;
}

async function findShareLinkById(shareLinkId: string) {
  const items = await queryByGsi1(`SHARELINK#${shareLinkId}`);
  return items.find((item): item is ProjectShareLinkItem => item.entityType === "ProjectShareLink") || null;
}

async function findShareLinkByToken(token: string) {
  const items = await queryByGsi2(`SHARETOKEN#${hashShareToken(token)}`);
  return items.find((item): item is ProjectShareLinkItem => item.entityType === "ProjectShareLink") || null;
}

async function findShareParticipantById(shareLinkId: string, participantId: string) {
  const participants = await listShareParticipants(shareLinkId);
  return participants.find((participant) => participant.id === participantId) || null;
}

async function findShareParticipantByEmail(shareLinkId: string, email: string) {
  const participants = await listShareParticipants(shareLinkId);
  const normalized = email.trim().toLowerCase();
  return participants.find((participant) => participant.emailLower === normalized) || null;
}

async function findProjectTransitApproval(projectId: string) {
  const items = await queryByPk(`PROJECT#${projectId}`, "TRANSIT");
  return items.find((item): item is ProjectTransitApprovalItem => item.entityType === "ProjectTransitApproval") || null;
}

async function findProjectCreativeById(projectId: string, creativeId: string) {
  const items = await queryByGsi1(`CREATIVE#${creativeId}`);
  const creative = items.find((item): item is ProjectCreativeAssetItem => item.entityType === "CreativeAsset") || null;
  if (!creative) return null;
  return creative.projectId === projectId ? creative : null;
}

async function findInventoryById(inventoryId: string) {
  const items = await queryByGsi1(`INVENTORY#${inventoryId}`);
  return items.find((item): item is InventoryItem => item.entityType === "InventoryItem") || null;
}

type AllocationOverrideHydrationContext = {
  proofById: Map<string, ProjectProofLineItem>;
  creativeById: Map<string, ProjectCreativeAssetItem>;
  variants: MediaVariantItem[];
  signedUrlCache: Map<string, Promise<string>>;
};

async function loadAllocationOverrideHydrationContext(project: ProjectItem): Promise<AllocationOverrideHydrationContext> {
  const [proofs, creatives, variants] = await Promise.all([
    listProjectProofLines(project.id),
    listProjectCreatives(project.id),
    listVariantsForVenue(project.venueId),
  ]);
  return {
    proofById: new Map(proofs.map((proof) => [proof.id, proof] as const)),
    creativeById: new Map(creatives.map((creative) => [creative.id, creative] as const)),
    variants,
    signedUrlCache: new Map<string, Promise<string>>(),
  };
}

function normalizeAllocationOverrideSourceType(
  value: unknown,
  sourceProof: ProjectProofLineItem | null,
  sourceCreative: ProjectCreativeAssetItem | null
): AllocationOverrideSourceType {
  const parsed = optionalString(value);
  if (parsed === "proof" || parsed === "creative" || parsed === "manual") return parsed;
  if (sourceProof) return "proof";
  if (sourceCreative) return "creative";
  return "manual";
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => optionalString(item)).filter(Boolean);
}

async function validateAllocationOverrideInventory(venueId: string, inventoryIds: string[]) {
  const uniqueIds = Array.from(new Set(inventoryIds));
  if (!uniqueIds.length) return [];
  const inventory = await Promise.all(uniqueIds.map((inventoryId) => findInventoryById(inventoryId)));
  const missing = uniqueIds.filter((inventoryId, index) => !inventory[index]);
  if (missing.length) throw new HttpError(400, `Unknown inventory item(s): ${missing.join(", ")}`);
  const outsideVenue = inventory.filter((item): item is InventoryItem => !!item && item.venueId !== venueId);
  if (outsideVenue.length) {
    throw new HttpError(400, `Inventory does not belong to this venue: ${outsideVenue.map((item) => item.inventoryId).join(", ")}`);
  }
  return uniqueIds;
}

function normalizeOverrideAsset(value: unknown): ProjectAllocationOverrideRowItem["overrideAsset"] {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  const bucketName = requiredString(payload, "bucketName");
  const objectKey = requiredString(payload, "objectKey");
  const filename = requiredString(payload, "filename");
  if (bucketName !== PROJECT_ASSETS_BUCKET_NAME) {
    throw new HttpError(400, "Override artwork must be stored in the configured project assets bucket.");
  }
  return {
    bucketName,
    objectKey,
    filename,
    thumbObjectKey: optionalString(payload.thumbObjectKey) || null,
    contentType: optionalString(payload.contentType) || null,
    thumbContentType: optionalString(payload.thumbContentType) || null,
    sizeBytes: optionalNumber(payload.sizeBytes) ?? null,
  };
}

async function hydrateAllocationOverrideRows(
  rows: ProjectAllocationOverrideRowItem[],
  context: AllocationOverrideHydrationContext
) {
  return Promise.all(
    rows.map(async (row) => {
      const sourceProof = row.sourceProofLineId ? context.proofById.get(row.sourceProofLineId) || null : null;
      const sourceCreative = row.sourceCreativeId ? context.creativeById.get(row.sourceCreativeId) || null : null;
      const fallbackProofFullUrl = sourceProof?.liftProofFullUrl ||
        (sourceProof?.proofObjectKey ? await signBucketReadUrl(PROJECT_ASSETS_BUCKET_NAME, sourceProof.proofObjectKey, undefined, context.signedUrlCache) : null);
      const fallbackProofThumbUrl = sourceProof?.proofThumbObjectKey
        ? await signBucketReadUrl(PROJECT_ASSETS_BUCKET_NAME, sourceProof.proofThumbObjectKey, undefined, context.signedUrlCache)
        : sourceProof?.liftProofThumbUrl || fallbackProofFullUrl;
      const fallbackCreativeFullUrl = sourceCreative
        ? await signBucketReadUrl(sourceCreative.bucketName || PROJECT_ASSETS_BUCKET_NAME, sourceCreative.objectKey, undefined, context.signedUrlCache)
        : null;
      const fallbackCreativeThumbUrl = sourceCreative?.thumbObjectKey
        ? await signBucketReadUrl(sourceCreative.bucketName || PROJECT_ASSETS_BUCKET_NAME, sourceCreative.thumbObjectKey, undefined, context.signedUrlCache)
        : fallbackCreativeFullUrl;
      const overrideFullUrl = row.overrideAsset
        ? await signBucketReadUrl(row.overrideAsset.bucketName, row.overrideAsset.objectKey, undefined, context.signedUrlCache)
        : null;
      const overrideThumbUrl = row.overrideAsset?.thumbObjectKey
        ? await signBucketReadUrl(row.overrideAsset.bucketName, row.overrideAsset.thumbObjectKey, undefined, context.signedUrlCache)
        : overrideFullUrl;
      const variant = context.variants.find((item) => item.mediaVariantKey === row.mediaVariantKey);
      return {
        id: row.id,
        projectId: row.projectId,
        sourceType: row.sourceType,
        sourceProofLineId: row.sourceProofLineId || null,
        sourceCreativeId: row.sourceCreativeId || null,
        sourceLineNumber: row.sourceLineNumber ?? sourceProof?.lineNumber ?? null,
        sourceLiftOrderLineId: row.sourceLiftOrderLineId ?? sourceProof?.liftOrderLineId ?? null,
        sourceLiftProofingId: row.sourceLiftProofingId ?? sourceProof?.liftProofingId ?? null,
        productLabel: row.productLabel,
        dimensionsLabel: row.dimensionsLabel,
        quantity: row.quantity,
        mediaVariantKey: row.mediaVariantKey,
        mediaVariantLabel: variant?.label || formatVariantLabel(row.mediaVariantKey),
        assignedInventoryIds: row.assignedInventoryIds || [],
        hidden: !!row.hidden,
        hiddenAt: row.hiddenAt || null,
        hiddenByName: row.hiddenByName || null,
        liftSyncStatus: row.liftSyncStatus || "not_supported",
        adminNote: row.adminNote || null,
        createdAt: row.createdAt,
        createdByName: row.createdByName,
        updatedAt: row.updatedAt,
        updatedByName: row.updatedByName,
        asset: {
          filename: row.overrideAsset?.filename || sourceProof?.clientFileName || sourceCreative?.filename || "Override artwork",
          thumbUrl: overrideThumbUrl || fallbackProofThumbUrl || fallbackCreativeThumbUrl,
          fullUrl: overrideFullUrl || fallbackProofFullUrl || fallbackCreativeFullUrl,
          source: row.overrideAsset ? "override" : sourceProof ? "proof" : sourceCreative ? "creative" : "manual",
          contentType: row.overrideAsset?.contentType || sourceCreative?.contentType || null,
        },
      };
    })
  );
}

type ProjectListItemOptions = {
  customer?: CustomerItem | null;
  assignments?: ProjectAssignmentItem[];
  proofLines?: ProjectProofLineItem[];
  transit?: ProjectTransitApprovalItem | null;
};

async function toProjectListItem(
  project: ProjectItem,
  scope: ProjectScopeItem | null,
  options: ProjectListItemOptions = {}
): Promise<ProjectListItem> {
  const [customer, assignments, proofLines, transit] = await Promise.all([
    options.customer !== undefined ? Promise.resolve(options.customer) : findCustomerById(project.customerId),
    options.assignments ? Promise.resolve(options.assignments) : listProjectAssignments(project.id),
    options.proofLines ? Promise.resolve(options.proofLines) : listProjectProofLines(project.id),
    options.transit !== undefined ? Promise.resolve(options.transit) : findProjectTransitApproval(project.id),
  ]);
  const required = scope?.includedIds.length || 0;
  const assignmentMap = buildAssignmentMap(assignments);
  let assigned = 0;
  for (const inventoryId of scope?.includedIds || []) {
    if (assignmentMap.get(inventoryId)) assigned += 1;
  }
  const proofsApproved = proofLines.filter((line) => line.status === "approved").length;
  const proofsPending = proofLines.filter((line) => line.status === "pending").length;
  const proofsWaiting = proofLines.filter((line) => line.status === "waiting").length;
  const proofsRevised = proofLines.filter((line) => line.revised).length;
  const transitStatus = project.liftOrderId ? transit?.status || "not_started" : "not_required";
  const productionReady =
    !!project.liftOrderId &&
    proofLines.length > 0 &&
    proofsApproved === proofLines.length &&
    transitStatus === "approved";
  const productionReleased = !!project.productionReleasedAt;
  const adspaceOrderNumber = getProjectAdspaceOrderNumber(project);
  const customerLogoUrl = await signCustomerLogoUrl(customer);

  return {
    id: project.id,
    projectMode: project.projectMode || "live",
    customerId: project.customerId,
    customerName: project.customerName,
    customerLogoUrl,
    sourceCustomerId: project.sourceCustomerId,
    sourceCustomerName: project.sourceCustomerName,
    marketId: project.marketId,
    marketName: project.marketName,
    venueId: project.venueId,
    venueName: project.venueName,
    title: project.title,
    poNumber: project.poNumber,
    adspaceOrderNumber,
    extId: makeAdspaceExternalId(adspaceOrderNumber),
    liftOrderId: project.liftOrderId,
    orderSubmittedAt: project.orderSubmittedAt || null,
    orderSubmittedByName: project.orderSubmittedByName || null,
    orderSubmissionNote: project.orderSubmissionNote || null,
    productionReleasedAt: project.productionReleasedAt || null,
    productionReleasedByName: project.productionReleasedByName || null,
    productionReleaseNote: project.productionReleaseNote || null,
    artworkDueDate: project.artworkDueDate,
    postDate: project.postDate,
    endClientName: project.endClientName,
    contractNumber: project.contractNumber,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    assignment: {
      required,
      assigned,
      complete: required > 0 && assigned >= required,
    },
    proofs: {
      total: proofLines.length,
      approved: proofsApproved,
      pending: proofsPending,
      revised: proofsRevised,
      waitingForProof: proofsWaiting,
    },
    transit: {
      enabled: !!project.liftOrderId,
      status: transitStatus,
    },
    production: {
      policy: "hold_for_release",
      ready: productionReady,
      awaitingRelease: productionReady && !productionReleased,
      released: productionReleased,
    },
    needsAttention: !project.liftOrderId
      ? required > 0 && assigned < required
      : !productionReleased && (proofsPending > 0 || proofsWaiting > 0 || transitStatus === "rejected"),
    scopeIncludedCount: required,
  };
}

async function listProjectAuditEvents(projectId: string, auth: AuthContext) {
  const project = await findProjectById(projectId);
  if (!project) throw new HttpError(404, `Project ${projectId} not found`);
  assertProjectAccess(auth, project);
  return rawListProjectAuditEvents(projectId);
}

function defaultAppSettings(actorName: string): AppSettingsItem {
  return {
    entityType: "AppSettings",
    id: "global",
    shareDefaults: {
      collaboration: { enabled: true, defaultExpiresInDays: null },
      artworkUpload: { enabled: true, defaultExpiresInDays: null },
      transitApproval: { enabled: true, defaultExpiresInDays: null },
      viewOnly: { enabled: true, defaultExpiresInDays: null },
      requireParticipantIdentity: true,
    },
    notifications: {
      proofApproved: true,
      transitDecision: true,
      productionReleased: true,
      workflowErrors: true,
      emailRecipients: "support@tlco.com",
    },
    workflowPolicies: {
      productionApprovalMode: "hold_for_release",
      transitRunsInParallel: true,
      lockProofUndoAfterRelease: true,
    },
    dataDefaults: {
      projectScopeDefault: "all_active_visible",
      inactiveInventoryVisibilityDefault: "show_unavailable",
      respectVenueMapSortOrder: true,
    },
    files: {
      previewPdfInLightbox: true,
      replaceFilePreservesAssignments: true,
      projectDocumentRetentionDays: 365,
      generatedDocumentRetentionDays: 365,
    },
    integrations: {
      liftOrderIntegrationEnabled: false,
      liftProofSyncEnabled: false,
      retryOnTransientLiftFailure: true,
      primaryPrintVendor: {
        enabled: false,
        vendorName: "Larger Than Life, Inc.",
        platformLabel: "Lift ERP",
        activeEnvironment: "prod",
        environments: {
          prod: defaultLiftEnvironmentConfig("prod"),
          qa1: defaultLiftEnvironmentConfig("qa1"),
        },
        companyId: "91",
        createOrderUsername: "",
        createOrderPassword: "",
        proofClientId: "",
        proofClientSecret: "",
        defaultHeaders: "",
        payloadNotes: "",
      },
    },
    updatedAt: isoNow(),
    updatedByName: actorName,
  };
}

function defaultLiftEnvironmentConfig(environment: LiftEnvironmentKey): LiftEnvironmentConfig {
  if (environment === "qa1") {
    return {
      baseUrl: "",
      orderEndpointUrl: "http://devcompute/lifterp-qa1/lifterp/liftqa1/erp/api/create_order",
      fallbackOrderLookupUrl: "",
      orderUrlResolverUrl: "",
      customerContactListUrl: "",
      proofEndpointUrlTemplate: "",
      flushSyncUrl: "",
      proofUrlResolverUrl: "",
    };
  }

  return {
    baseUrl: "",
    orderEndpointUrl: "http://prod-lifterp/lifterp/ords/lifterp/lift/erp/api/create_order",
    fallbackOrderLookupUrl: "",
    orderUrlResolverUrl: "",
    customerContactListUrl:
      "https://ltlco.lifterp.com/ords/lift/erp/flush/ondemand/91/CustomerContactLIst/CustomerContactList?",
    proofEndpointUrlTemplate: "",
    flushSyncUrl: "",
    proofUrlResolverUrl: "",
  };
}

function defaultCustomerSettings(customerId: string, actorName: string, appSettings: AppSettingsItem): CustomerSettingsItem {
  return {
    entityType: "CustomerSettings",
    id: customerId,
    customerId,
    notifications: {
      proofApproved: appSettings.notifications.proofApproved,
      transitDecision: appSettings.notifications.transitDecision,
      productionReleased: appSettings.notifications.productionReleased,
      workflowErrors: appSettings.notifications.workflowErrors,
      emailRecipients: appSettings.notifications.emailRecipients,
      rules: buildDefaultNotificationRules(appSettings.notifications.emailRecipients),
    },
    transitApproval: {
      defaultMode: "enabled_all_orders",
      allowProjectOverride: true,
    },
    collaboration: {
      collaborationLinksEnabled: appSettings.shareDefaults.collaboration.enabled,
      artworkUploadLinksEnabled: appSettings.shareDefaults.artworkUpload.enabled,
      transitApprovalLinksEnabled: appSettings.shareDefaults.transitApproval.enabled,
      viewOnlyLinksEnabled: appSettings.shareDefaults.viewOnly.enabled,
      requireParticipantIdentity: appSettings.shareDefaults.requireParticipantIdentity,
    },
    updatedAt: isoNow(),
    updatedByName: actorName,
  };
}

function hydrateAppSettings(existing: AppSettingsItem | null | undefined, actorName: string) {
  const defaults = defaultAppSettings(actorName);
  if (!existing) return defaults;
  const existingVendor = (existing.integrations?.primaryPrintVendor || {}) as Partial<
    AppSettingsItem["integrations"]["primaryPrintVendor"] & {
      environmentLabel?: string;
      baseUrl?: string;
      orderEndpointPath?: string;
      fallbackOrderLookupPath?: string;
      orderUrlResolverPath?: string;
      customerContactListPath?: string;
      proofEndpointPath?: string;
      syncEndpointPath?: string;
      proofUrlResolverPath?: string;
    }
  >;
  const activeEnvironment = normalizeLiftEnvironmentKey(
    existingVendor.activeEnvironment ||
      (String(existingVendor.environmentLabel || "").toLowerCase().includes("qa") ? "qa1" : "prod")
  );
  const defaultEnvironments = {
    prod: defaultLiftEnvironmentConfig("prod"),
    qa1: defaultLiftEnvironmentConfig("qa1"),
  };
  const existingEnvironments = existingVendor.environments || ({} as Record<LiftEnvironmentKey, Partial<LiftEnvironmentConfig>>);
  const legacyActiveEnvironmentConfig: Partial<LiftEnvironmentConfig> = {
    baseUrl: existingVendor.baseUrl,
    orderEndpointUrl: existingVendor.orderEndpointPath,
    fallbackOrderLookupUrl: existingVendor.fallbackOrderLookupPath,
    orderUrlResolverUrl: existingVendor.orderUrlResolverPath,
    customerContactListUrl: existingVendor.customerContactListPath,
    proofEndpointUrlTemplate: existingVendor.proofEndpointPath,
    flushSyncUrl: existingVendor.syncEndpointPath,
    proofUrlResolverUrl: existingVendor.proofUrlResolverPath,
  };
  return {
    ...defaults,
    ...existing,
    shareDefaults: {
      ...defaults.shareDefaults,
      ...existing.shareDefaults,
      collaboration: {
        ...defaults.shareDefaults.collaboration,
        ...existing.shareDefaults?.collaboration,
      },
      artworkUpload: {
        ...defaults.shareDefaults.artworkUpload,
        ...existing.shareDefaults?.artworkUpload,
      },
      transitApproval: {
        ...defaults.shareDefaults.transitApproval,
        ...existing.shareDefaults?.transitApproval,
      },
      viewOnly: {
        ...defaults.shareDefaults.viewOnly,
        ...existing.shareDefaults?.viewOnly,
      },
    },
    notifications: {
      ...defaults.notifications,
      ...existing.notifications,
    },
    workflowPolicies: {
      ...defaults.workflowPolicies,
      ...existing.workflowPolicies,
    },
    dataDefaults: {
      ...defaults.dataDefaults,
      ...existing.dataDefaults,
    },
    files: {
      ...defaults.files,
      ...existing.files,
    },
    integrations: {
      ...defaults.integrations,
      ...existing.integrations,
      primaryPrintVendor: {
        ...defaults.integrations.primaryPrintVendor,
        ...existingVendor,
        activeEnvironment,
        environments: {
          prod: {
            ...defaultEnvironments.prod,
            ...(existingEnvironments.prod || {}),
            ...(activeEnvironment === "prod" ? omitUndefinedLiftEnvironmentConfig(legacyActiveEnvironmentConfig) : {}),
          },
          qa1: {
            ...defaultEnvironments.qa1,
            ...(existingEnvironments.qa1 || {}),
            ...(activeEnvironment === "qa1" ? omitUndefinedLiftEnvironmentConfig(legacyActiveEnvironmentConfig) : {}),
          },
        },
      },
    },
  };
}

function normalizeLiftEnvironmentKey(value: string | null | undefined): LiftEnvironmentKey {
  return String(value || "").toLowerCase() === "qa1" ? "qa1" : "prod";
}

function omitUndefinedLiftEnvironmentConfig(
  config: Partial<LiftEnvironmentConfig>
): Partial<LiftEnvironmentConfig> {
  return Object.fromEntries(
    Object.entries(config).filter(([, value]) => value !== undefined)
  ) as Partial<LiftEnvironmentConfig>;
}

function hydrateCustomerSettings(
  existing: CustomerSettingsItem | null | undefined,
  customerId: string,
  actorName: string,
  appSettings: AppSettingsItem
) {
  const defaults = defaultCustomerSettings(customerId, actorName, appSettings);
  if (!existing) return defaults;
  return {
    ...defaults,
    ...existing,
    notifications: {
      ...defaults.notifications,
      ...existing.notifications,
      rules:
        existing.notifications?.rules && existing.notifications.rules.length > 0
          ? sanitizeNotificationRules(existing.notifications.rules)
          : buildDefaultNotificationRules(existing.notifications?.emailRecipients || defaults.notifications.emailRecipients),
    },
    transitApproval: {
      ...defaults.transitApproval,
      ...existing.transitApproval,
    },
    collaboration: {
      ...defaults.collaboration,
      ...existing.collaboration,
    },
  };
}

async function getAdminSettings(auth: AuthContext) {
  const existing = await findAppSettings();
  const settings = hydrateAppSettings(existing, auth.actorName);
  if (!existing) {
    await putCore(buildAppSettingsRecord(settings));
    appSettingsCache.current = makeLocalCacheEntry(settings, SHORT_CACHE_TTL_MS);
  }

  const [profiles, customers] = await Promise.all([listUserProfiles(), listCustomers()]);
  const visibleCustomers = auth.isPlatformAdmin
    ? customers
    : customers.filter((customer) => auth.customerIds.has(customer.id));
  const visibleProfiles = auth.isPlatformAdmin
    ? profiles
    : profiles.filter((profile) => profile.customerIds.some((customerId) => auth.customerIds.has(customerId)));

  return {
    settings,
    viewer: {
      isPlatformAdmin: auth.isPlatformAdmin,
      role: auth.profile?.role || "customer_admin",
      customerIds: Array.from(auth.customerIds),
    },
    users: visibleProfiles.map((profile) => ({
      id: profile.id,
      displayName: profile.displayName,
      email: profile.email,
      role: profile.role,
      customerIds: profile.customerIds,
      isActive: profile.isActive,
      updatedAt: profile.updatedAt,
    })),
    customers: await Promise.all(
      visibleCustomers.map(async (customer) => ({
        id: customer.id,
        name: customer.name,
        status: customerStatus(customer),
        isActive: customer.isActive,
        isInternalSandbox: customer.isInternalSandbox === true,
        liftCustomerId: customer.liftCustomerId,
        logoUrl: await signCustomerLogoUrl(customer),
      }))
    ),
  };
}

async function getAdminBranding(auth: AuthContext) {
  if (!auth.profile) {
    throw new HttpError(401, "Authenticated user profile is required for branding");
  }
  const profile = auth.profile;

  if (auth.isPlatformAdmin) {
    return {
      viewer: {
        isPlatformAdmin: true,
        role: profile.role,
        customerIds: Array.from(auth.customerIds),
        displayName: profile.displayName,
        email: profile.email,
      },
      brand: {
        name: "Adspace360",
        logoUrl: null,
        alt: "Adspace360",
        companyName: "Adspace360",
      },
    };
  }

  const primaryCustomerId = profile.customerIds[0] || Array.from(auth.customerIds)[0] || "";
  const customer = primaryCustomerId ? await findCustomerById(primaryCustomerId) : null;
  if (customer) {
    assertCustomerReadable(auth, customer);
  }
  const customerName = customer?.name || "Adspace360";

  return {
    viewer: {
      isPlatformAdmin: false,
      role: profile.role,
      customerIds: Array.from(auth.customerIds),
      displayName: profile.displayName,
      email: profile.email,
    },
    brand: {
      name: customerName,
      logoUrl: customer ? await signCustomerLogoUrl(customer) : null,
      alt: customerName,
      companyName: customerName,
    },
  };
}

async function updateAdminSettings(payload: Record<string, unknown>, auth: AuthContext) {
  const existing = hydrateAppSettings(await findAppSettings(), auth.actorName);
  const next: AppSettingsItem = {
    ...existing,
    shareDefaults: {
      collaboration: {
        enabled: optionalBoolean(payload.shareCollaborationEnabled) ?? existing.shareDefaults.collaboration.enabled,
        defaultExpiresInDays:
          payload.shareCollaborationExpiresInDays === null
            ? null
            : optionalNumber(payload.shareCollaborationExpiresInDays) ?? existing.shareDefaults.collaboration.defaultExpiresInDays,
      },
      artworkUpload: {
        enabled: optionalBoolean(payload.shareArtworkUploadEnabled) ?? existing.shareDefaults.artworkUpload.enabled,
        defaultExpiresInDays:
          payload.shareArtworkUploadExpiresInDays === null
            ? null
            : optionalNumber(payload.shareArtworkUploadExpiresInDays) ?? existing.shareDefaults.artworkUpload.defaultExpiresInDays,
      },
      transitApproval: {
        enabled: optionalBoolean(payload.shareTransitApprovalEnabled) ?? existing.shareDefaults.transitApproval.enabled,
        defaultExpiresInDays:
          payload.shareTransitApprovalExpiresInDays === null
            ? null
            : optionalNumber(payload.shareTransitApprovalExpiresInDays) ?? existing.shareDefaults.transitApproval.defaultExpiresInDays,
      },
      viewOnly: {
        enabled: optionalBoolean(payload.shareViewOnlyEnabled) ?? existing.shareDefaults.viewOnly.enabled,
        defaultExpiresInDays:
          payload.shareViewOnlyExpiresInDays === null
            ? null
            : optionalNumber(payload.shareViewOnlyExpiresInDays) ?? existing.shareDefaults.viewOnly.defaultExpiresInDays,
      },
      requireParticipantIdentity:
        optionalBoolean(payload.requireParticipantIdentity) ?? existing.shareDefaults.requireParticipantIdentity,
    },
    notifications: {
      proofApproved: optionalBoolean(payload.notifyProofApproved) ?? existing.notifications.proofApproved,
      transitDecision: optionalBoolean(payload.notifyTransitDecision) ?? existing.notifications.transitDecision,
      productionReleased: optionalBoolean(payload.notifyProductionReleased) ?? existing.notifications.productionReleased,
      workflowErrors: optionalBoolean(payload.notifyWorkflowErrors) ?? existing.notifications.workflowErrors,
      emailRecipients: optionalString(payload.notificationEmailRecipients) ?? existing.notifications.emailRecipients,
    },
    workflowPolicies: {
      productionApprovalMode: "hold_for_release",
      transitRunsInParallel: optionalBoolean(payload.transitRunsInParallel) ?? existing.workflowPolicies.transitRunsInParallel,
      lockProofUndoAfterRelease:
        optionalBoolean(payload.lockProofUndoAfterRelease) ?? existing.workflowPolicies.lockProofUndoAfterRelease,
    },
    dataDefaults: {
      projectScopeDefault: "all_active_visible",
      inactiveInventoryVisibilityDefault:
        payload.inactiveInventoryVisibilityDefault === "hidden" || payload.inactiveInventoryVisibilityDefault === "show_unavailable"
          ? payload.inactiveInventoryVisibilityDefault
          : existing.dataDefaults.inactiveInventoryVisibilityDefault,
      respectVenueMapSortOrder:
        optionalBoolean(payload.respectVenueMapSortOrder) ?? existing.dataDefaults.respectVenueMapSortOrder,
    },
    files: {
      previewPdfInLightbox: optionalBoolean(payload.previewPdfInLightbox) ?? existing.files.previewPdfInLightbox,
      replaceFilePreservesAssignments:
        optionalBoolean(payload.replaceFilePreservesAssignments) ?? existing.files.replaceFilePreservesAssignments,
      projectDocumentRetentionDays:
        optionalNumber(payload.projectDocumentRetentionDays) ?? existing.files.projectDocumentRetentionDays,
      generatedDocumentRetentionDays:
        optionalNumber(payload.generatedDocumentRetentionDays) ?? existing.files.generatedDocumentRetentionDays,
    },
    integrations: {
      liftOrderIntegrationEnabled:
        optionalBoolean(payload.liftOrderIntegrationEnabled) ?? existing.integrations.liftOrderIntegrationEnabled,
      liftProofSyncEnabled:
        optionalBoolean(payload.liftProofSyncEnabled) ?? existing.integrations.liftProofSyncEnabled,
      retryOnTransientLiftFailure:
        optionalBoolean(payload.retryOnTransientLiftFailure) ?? existing.integrations.retryOnTransientLiftFailure,
      primaryPrintVendor: {
        enabled:
          optionalBoolean(payload.primaryPrintVendorEnabled) ?? existing.integrations.primaryPrintVendor.enabled,
        vendorName:
          hasOwn(payload, "primaryPrintVendorName")
            ? optionalString(payload.primaryPrintVendorName)
            : existing.integrations.primaryPrintVendor.vendorName,
        platformLabel:
          hasOwn(payload, "primaryPrintPlatformLabel")
            ? optionalString(payload.primaryPrintPlatformLabel)
            : existing.integrations.primaryPrintVendor.platformLabel,
        activeEnvironment:
          hasOwn(payload, "primaryPrintActiveEnvironment")
            ? normalizeLiftEnvironmentKey(optionalString(payload.primaryPrintActiveEnvironment))
            : existing.integrations.primaryPrintVendor.activeEnvironment,
        environments: {
          prod: {
            ...existing.integrations.primaryPrintVendor.environments.prod,
            baseUrl:
              hasOwn(payload, "primaryPrintProdBaseUrl")
                ? optionalString(payload.primaryPrintProdBaseUrl)
                : existing.integrations.primaryPrintVendor.environments.prod.baseUrl,
            orderEndpointUrl:
              hasOwn(payload, "primaryPrintProdOrderEndpointUrl")
                ? optionalString(payload.primaryPrintProdOrderEndpointUrl)
                : existing.integrations.primaryPrintVendor.environments.prod.orderEndpointUrl,
            fallbackOrderLookupUrl:
              hasOwn(payload, "primaryPrintProdFallbackOrderLookupUrl")
                ? optionalString(payload.primaryPrintProdFallbackOrderLookupUrl)
                : existing.integrations.primaryPrintVendor.environments.prod.fallbackOrderLookupUrl,
            orderUrlResolverUrl:
              hasOwn(payload, "primaryPrintProdOrderUrlResolverUrl")
                ? optionalString(payload.primaryPrintProdOrderUrlResolverUrl)
                : existing.integrations.primaryPrintVendor.environments.prod.orderUrlResolverUrl,
            customerContactListUrl:
              hasOwn(payload, "primaryPrintProdCustomerContactListUrl")
                ? optionalString(payload.primaryPrintProdCustomerContactListUrl)
                : existing.integrations.primaryPrintVendor.environments.prod.customerContactListUrl,
            proofEndpointUrlTemplate:
              hasOwn(payload, "primaryPrintProdProofEndpointUrlTemplate")
                ? optionalString(payload.primaryPrintProdProofEndpointUrlTemplate)
                : existing.integrations.primaryPrintVendor.environments.prod.proofEndpointUrlTemplate,
            flushSyncUrl:
              hasOwn(payload, "primaryPrintProdFlushSyncUrl")
                ? optionalString(payload.primaryPrintProdFlushSyncUrl)
                : existing.integrations.primaryPrintVendor.environments.prod.flushSyncUrl,
            proofUrlResolverUrl:
              hasOwn(payload, "primaryPrintProdProofUrlResolverUrl")
                ? optionalString(payload.primaryPrintProdProofUrlResolverUrl)
                : existing.integrations.primaryPrintVendor.environments.prod.proofUrlResolverUrl,
          },
          qa1: {
            ...existing.integrations.primaryPrintVendor.environments.qa1,
            baseUrl:
              hasOwn(payload, "primaryPrintQa1BaseUrl")
                ? optionalString(payload.primaryPrintQa1BaseUrl)
                : existing.integrations.primaryPrintVendor.environments.qa1.baseUrl,
            orderEndpointUrl:
              hasOwn(payload, "primaryPrintQa1OrderEndpointUrl")
                ? optionalString(payload.primaryPrintQa1OrderEndpointUrl)
                : existing.integrations.primaryPrintVendor.environments.qa1.orderEndpointUrl,
            fallbackOrderLookupUrl:
              hasOwn(payload, "primaryPrintQa1FallbackOrderLookupUrl")
                ? optionalString(payload.primaryPrintQa1FallbackOrderLookupUrl)
                : existing.integrations.primaryPrintVendor.environments.qa1.fallbackOrderLookupUrl,
            orderUrlResolverUrl:
              hasOwn(payload, "primaryPrintQa1OrderUrlResolverUrl")
                ? optionalString(payload.primaryPrintQa1OrderUrlResolverUrl)
                : existing.integrations.primaryPrintVendor.environments.qa1.orderUrlResolverUrl,
            customerContactListUrl:
              hasOwn(payload, "primaryPrintQa1CustomerContactListUrl")
                ? optionalString(payload.primaryPrintQa1CustomerContactListUrl)
                : existing.integrations.primaryPrintVendor.environments.qa1.customerContactListUrl,
            proofEndpointUrlTemplate:
              hasOwn(payload, "primaryPrintQa1ProofEndpointUrlTemplate")
                ? optionalString(payload.primaryPrintQa1ProofEndpointUrlTemplate)
                : existing.integrations.primaryPrintVendor.environments.qa1.proofEndpointUrlTemplate,
            flushSyncUrl:
              hasOwn(payload, "primaryPrintQa1FlushSyncUrl")
                ? optionalString(payload.primaryPrintQa1FlushSyncUrl)
                : existing.integrations.primaryPrintVendor.environments.qa1.flushSyncUrl,
            proofUrlResolverUrl:
              hasOwn(payload, "primaryPrintQa1ProofUrlResolverUrl")
                ? optionalString(payload.primaryPrintQa1ProofUrlResolverUrl)
                : existing.integrations.primaryPrintVendor.environments.qa1.proofUrlResolverUrl,
          },
        },
        companyId:
          hasOwn(payload, "primaryPrintCompanyId")
            ? optionalString(payload.primaryPrintCompanyId)
            : existing.integrations.primaryPrintVendor.companyId,
        createOrderUsername:
          hasOwn(payload, "primaryPrintCreateOrderUsername")
            ? optionalString(payload.primaryPrintCreateOrderUsername)
            : existing.integrations.primaryPrintVendor.createOrderUsername,
        createOrderPassword:
          hasOwn(payload, "primaryPrintCreateOrderPassword")
            ? optionalString(payload.primaryPrintCreateOrderPassword)
            : existing.integrations.primaryPrintVendor.createOrderPassword,
        proofClientId:
          hasOwn(payload, "primaryPrintProofClientId")
            ? optionalString(payload.primaryPrintProofClientId)
            : existing.integrations.primaryPrintVendor.proofClientId,
        proofClientSecret:
          hasOwn(payload, "primaryPrintProofClientSecret")
            ? optionalString(payload.primaryPrintProofClientSecret)
            : existing.integrations.primaryPrintVendor.proofClientSecret,
        defaultHeaders:
          hasOwn(payload, "primaryPrintDefaultHeaders")
            ? optionalString(payload.primaryPrintDefaultHeaders)
            : existing.integrations.primaryPrintVendor.defaultHeaders,
        payloadNotes:
          hasOwn(payload, "primaryPrintPayloadNotes")
            ? optionalString(payload.primaryPrintPayloadNotes)
            : existing.integrations.primaryPrintVendor.payloadNotes,
      },
    },
    updatedAt: isoNow(),
    updatedByName: auth.actorName,
  };

  await putCore(buildAppSettingsRecord(next));
  invalidateSettingsCaches();
  await writeAudit("ADMIN_SETTINGS#global", "admin.settings.updated", auth, {
    updatedSections: [
      "shareDefaults",
      "notifications",
      "workflowPolicies",
      "dataDefaults",
      "files",
      "integrations",
    ],
  });

  const hydrated = await getAdminSettings(auth);
  return hydrated;
}

async function handleAdminSettingsPatch(payload: Record<string, unknown>, auth: AuthContext) {
  const adminAction = optionalString(payload.adminAction);
  const customerId = optionalString(payload.customerId);
  const vendorAction = optionalString(payload.vendorAction);
  const userAction = optionalString(payload.userAction);

  if (adminAction === "notification_preview" || adminAction === "notification_test_send") {
    return previewOrSendNotificationTest(payload, auth, adminAction === "notification_test_send");
  }

  if (adminAction === "run_error_drill") {
    return runControlledWorkflowErrorDrill(payload, auth);
  }

  if (userAction === "update_user") {
    const userId = requiredString(payload, "userId");
    return updateUserProfile(userId, payload, auth);
  }

  if (customerId && vendorAction === "create_vendor") {
    return createCustomerVendor(customerId, payload, auth);
  }

  if (customerId && vendorAction === "update_vendor") {
    const vendorId = requiredString(payload, "vendorId");
    return updateCustomerVendor(customerId, vendorId, payload, auth);
  }

  if (customerId) {
    return updateCustomerSettings(customerId, payload, auth);
  }

  return updateAdminSettings(payload, auth);
}

async function updateUserProfile(userId: string, payload: Record<string, unknown>, auth: AuthContext) {
  const target =
    (await findUserProfileBySub(userId)) ||
    (await findUserProfileByEmail(userId.toLowerCase()));
  if (!target) throw new HttpError(404, `User ${userId} not found`);

  const canEdit =
    auth.isPlatformAdmin ||
    (target.role !== "platform_admin" && target.customerIds.some((customerId) => auth.customerIds.has(customerId)));
  if (!canEdit) throw new HttpError(403, "You do not have access to update that user");

  const next: UserProfileItem = {
    ...target,
    displayName: hasOwn(payload, "displayName") ? requiredString(payload, "displayName") : target.displayName,
    isActive: optionalBoolean(payload.isActive) ?? target.isActive,
    updatedAt: isoNow(),
  };

  await putCore(buildUserProfileRecord(next));
  invalidateUserCaches(target);
  cacheUserProfile(next);
  await writeAudit(`ADMIN_SETTINGS#USER#${target.id}`, "admin.user.updated", auth, {
    userId: target.id,
    email: target.email,
    role: target.role,
    customerIds: target.customerIds,
    displayName: next.displayName,
    isActive: next.isActive,
  });

  return getAdminSettings(auth);
}

async function getCustomerSettings(customerId: string, auth: AuthContext) {
  assertCustomerAccess(auth, customerId);
  const customer = await findCustomerById(customerId);
  if (!customer) throw new HttpError(404, `Customer ${customerId} not found`);

  const appSettings = hydrateAppSettings(await findAppSettings(), auth.actorName);
  const existing = await findCustomerSettings(customerId);
  const settings = hydrateCustomerSettings(existing, customerId, auth.actorName, appSettings);
  if (!existing) {
    await putCore(buildCustomerSettingsRecord(settings));
  }

  const [profiles, vendors] = await Promise.all([listUserProfiles(), listCustomerVendors(customerId)]);

  return {
    customer: {
      id: customer.id,
      name: customer.name,
      status: customerStatus(customer),
      isActive: customer.isActive,
      isInternalSandbox: customer.isInternalSandbox === true,
      liftCustomerId: customer.liftCustomerId,
      logoUrl: await signCustomerLogoUrl(customer),
    },
    viewer: {
      isPlatformAdmin: auth.isPlatformAdmin,
      role: auth.profile?.role || "customer_admin",
      customerIds: Array.from(auth.customerIds),
    },
    settings,
    users: profiles
      .filter((profile) => profile.customerIds.includes(customerId))
      .map((profile) => ({
        id: profile.id,
        displayName: profile.displayName,
        email: profile.email,
        role: profile.role,
        customerIds: profile.customerIds,
        isActive: profile.isActive,
        updatedAt: profile.updatedAt,
      })),
    vendors: vendors.map((vendor) => ({
      id: vendor.id,
      customerId: vendor.customerId,
      name: vendor.name,
      contactName: vendor.contactName || "",
      email: vendor.email || "",
      phone: vendor.phone || "",
      notes: vendor.notes || "",
      isActive: vendor.isActive,
      updatedAt: vendor.updatedAt,
      updatedByName: vendor.updatedByName,
    })),
  };
}

async function listRecentWorkflowIssues(auth: AuthContext, limit = 10) {
  assertPlatformAdmin(auth);
  const issues = await Promise.all(
    (await rawListRecentWorkflowErrors(limit)).map(async (event) => {
      const normalizedProjectId = String(event.projectId || "").replace(/^PROJECT#/, "");
      const project = normalizedProjectId ? await findProjectById(normalizedProjectId) : null;
      if (!project || !hasProjectAccess(auth, project)) return null;
      return {
        projectId: project.id,
        projectTitle: project.title,
        projectMode: project.projectMode || "live",
        customerId: project.customerId,
        customerName: project.customerName,
        sourceCustomerName: project.sourceCustomerName || null,
        venueName: project.venueName,
        createdAt: String(event.createdAt || ""),
        actorName: String(event.actorName || "System"),
        severity:
          event.detail?.severity === "info" || event.detail?.severity === "warning" || event.detail?.severity === "error"
            ? event.detail.severity
            : "error",
        errorCode: String(event.detail?.errorCode || "workflow_error"),
        message: String(event.detail?.message || "A workflow issue was recorded."),
        surface: String(event.detail?.surface || "workflow"),
        metadata:
          typeof event.detail?.metadata === "object" && event.detail?.metadata
            ? (event.detail.metadata as Record<string, unknown>)
            : {},
        isDrill: event.detail?.metadata?.drill === true,
      };
    })
  );

  return issues.filter(Boolean);
}

async function resolveNotificationSampleProject(customerId: string) {
  const projects = (await scanByEntityType("Project"))
    .filter((item): item is ProjectItem => item.entityType === "Project")
    .filter((project) => project.customerId === customerId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return projects[0] || null;
}

function buildSyntheticNotificationProject(customer: CustomerItem): ProjectItem {
  const now = isoNow();
  return {
    entityType: "Project",
    id: "preview_only",
    projectMode: customer.isInternalSandbox ? "internal_sandbox" : "live",
    customerId: customer.id,
    customerName: customer.name,
    sourceCustomerId: customer.isInternalSandbox ? "intersection" : undefined,
    sourceCustomerName: customer.isInternalSandbox ? "Intersection" : undefined,
    marketId: "preview_market",
    marketName: "Preview Market",
    venueId: "preview_venue",
    venueName: "Preview Venue",
    title: `${customer.name} Preview Project`,
    poNumber: "AS360PREV",
    adspaceOrderNumber: "AS360PREV",
    extId: "AS360-PREVIEW",
    createdAt: now,
    updatedAt: now,
  };
}

function buildNotificationPreviewDetail(eventType: NotificationEventType, project: ProjectItem) {
  switch (eventType) {
    case "artwork_uploaded":
      return {
        filename: `${project.title.replace(/\s+/g, "-")}-A.pdf`,
        mediaVariantKey: "2-Sheet Poster • 46.2\"h x 60.2\"w",
      };
    case "creatives_assigned":
      return {
        creativeFilename: `${project.title.replace(/\s+/g, "-")}-A.pdf`,
        inventoryLabel: `${project.venueName} / PS-2-001`,
      };
    case "all_inventory_assigned":
      return { assignedCount: 6, requiredCount: 6 };
    case "order_submitted":
      return { liftOrderId: project.liftOrderId || "A0219265", lineCount: 4 };
    case "proofs_ready":
      return { readyCount: 4, totalCount: 4 };
    case "revised_art_uploaded":
      return { lineNumber: 2, clientFileName: `${project.title.replace(/\s+/g, "-")}-REV-B.pdf` };
    case "all_proofs_approved":
      return { approvedCount: 4, totalCount: 4 };
    case "transit_accepted":
      return { comment: "Transit approved in preview mode." };
    case "transit_rejected":
      return { comment: "Transit rejected in preview mode." };
    case "production_release_ready":
      return {};
    case "workflow_errors":
      return {
        message: "Preview workflow issue for operator review.",
        surface: "notifications",
        errorCode: "preview_workflow_issue",
        severity: "warning",
      };
  }
}

function normalizeNotificationEventType(value: unknown): NotificationEventType {
  if (
    value === "artwork_uploaded" ||
    value === "creatives_assigned" ||
    value === "all_inventory_assigned" ||
    value === "order_submitted" ||
    value === "proofs_ready" ||
    value === "revised_art_uploaded" ||
    value === "all_proofs_approved" ||
    value === "transit_accepted" ||
    value === "transit_rejected" ||
    value === "production_release_ready" ||
    value === "workflow_errors"
  ) {
    return value;
  }
  throw new HttpError(400, "A valid notification event type is required");
}

async function previewOrSendNotificationTest(payload: Record<string, unknown>, auth: AuthContext, send: boolean) {
  assertPlatformAdmin(auth);
  const customerId = requiredString(payload, "customerId");
  const eventType = normalizeNotificationEventType(payload.eventType);
  const customer = await findCustomerById(customerId);
  if (!customer) throw new HttpError(404, `Customer ${customerId} not found`);

  const appSettings = hydrateAppSettings(await findAppSettings(), auth.actorName);
  const customerSettings = hydrateCustomerSettings(await findCustomerSettings(customerId), customerId, auth.actorName, appSettings);
  const matchingRules = customerSettings.notifications.rules.filter(
    (rule) => rule.isActive && rule.eventTypes.includes(eventType) && parseNotificationRecipients(rule.recipients).length > 0
  );

  const existingProject = await resolveNotificationSampleProject(customerId);
  const sampleProject = existingProject || buildSyntheticNotificationProject(customer);
  const occurredAt = isoNow();
  const detail = buildNotificationPreviewDetail(eventType, sampleProject);
  const baseMessage = buildProjectNotificationMessage({
    eventType,
    project: sampleProject,
    actorName: auth.actorName,
    occurredAt,
    detail,
  });

  const defaultTestRecipient = auth.profile?.email?.trim() || "";
  const overrideRecipients = parseNotificationRecipients(optionalString(payload.recipientsOverride) || "");
  const previews = await Promise.all(
    matchingRules.map(async (rule) => {
      const configuredRecipients = parseNotificationRecipients(rule.recipients);
      const effectiveRecipients = overrideRecipients.length ? overrideRecipients : defaultTestRecipient ? [defaultTestRecipient] : [];
      if (rule.deliveryMode === "digest") {
        const digest = renderDigestMessage({
          customerName: customer.name,
          ruleLabel: rule.label || "Notification digest",
          entries: [
            {
              eventType,
              subject: baseMessage.subject,
              headline: baseMessage.headline,
              summary: baseMessage.summary,
              detailLines: baseMessage.detailLines,
              projectTitle: sampleProject.title,
              venueName: sampleProject.venueName,
              actorName: auth.actorName,
              occurredAt,
              ctaUrl: baseMessage.ctaUrl,
            },
          ],
          ctaLabel: "Open project",
          ctaUrl: baseMessage.ctaUrl,
        });
        if (send && effectiveRecipients.length) {
          await sendNotificationEmail({
            sender: NOTIFICATIONS_FROM_EMAIL,
            recipients: effectiveRecipients,
            subject: digest.subject,
            html: digest.html,
            text: digest.text,
          });
        }
        return {
          ruleId: rule.id,
          ruleLabel: rule.label || "Notification rule",
          deliveryMode: rule.deliveryMode,
          configuredRecipients,
          effectiveRecipients,
          subject: digest.subject,
          html: digest.html,
          text: digest.text,
        };
      }

      const rendered = renderNotificationMessage(baseMessage);
      if (send && effectiveRecipients.length) {
        await sendNotificationEmail({
          sender: NOTIFICATIONS_FROM_EMAIL,
          recipients: effectiveRecipients,
          subject: baseMessage.subject,
          html: rendered.html,
          text: rendered.text,
        });
      }
      return {
        ruleId: rule.id,
        ruleLabel: rule.label || "Notification rule",
        deliveryMode: rule.deliveryMode,
        configuredRecipients,
        effectiveRecipients,
        subject: baseMessage.subject,
        html: rendered.html,
        text: rendered.text,
      };
    })
  );

  return {
    customer: {
      id: customer.id,
      name: customer.name,
    },
    eventType,
    sent: send,
    sentCount: send ? previews.filter((preview) => preview.effectiveRecipients.length > 0).length : 0,
    defaultTestRecipient: defaultTestRecipient || null,
    projectSample: {
      id: existingProject?.id || null,
      title: sampleProject.title,
      venueName: sampleProject.venueName,
      source: existingProject ? "existing" : "synthetic",
      projectMode: sampleProject.projectMode || "live",
    },
    previews,
  };
}

function normalizeErrorDrillType(value: unknown) {
  if (
    value === "proof_sync_mismatch" ||
    value === "missing_proof_url" ||
    value === "flush_sync_failure" ||
    value === "notification_delivery_failure"
  ) {
    return value;
  }
  throw new HttpError(400, "A valid drill type is required");
}

function buildWorkflowErrorDrillDetail(drillType: string) {
  switch (drillType) {
    case "proof_sync_mismatch":
      return {
        severity: "warning" as const,
        errorCode: "proof_sync_identity_mismatch",
        message: "Controlled drill: proof sync returned a line identity that does not match the expected unit grouping.",
        surface: "proofs",
        metadata: {
          drill: true,
          drillType,
          expectedUnitNumber: "2SHEET_4",
          returnedUnitNumber: "2SHEET_SPECIAL",
        },
      };
    case "missing_proof_url":
      return {
        severity: "warning" as const,
        errorCode: "lift_proof_url_missing",
        message: "Controlled drill: Lift returned a proof line record, but the current proof URL is still unavailable.",
        surface: "proofs",
        metadata: {
          drill: true,
          drillType,
          liftProofingId: 90210,
        },
      };
    case "flush_sync_failure":
      return {
        severity: "error" as const,
        errorCode: "lift_flush_sync_failed",
        message: "Controlled drill: the Lift flush sync request failed and requires operator follow-up.",
        surface: "integrations",
        metadata: {
          drill: true,
          drillType,
          endpoint: "flushSyncUrl",
        },
      };
    case "notification_delivery_failure":
      return {
        severity: "warning" as const,
        errorCode: "notification_delivery_failed",
        message: "Controlled drill: a workflow notification could not be delivered to one or more recipients.",
        surface: "notifications",
        metadata: {
          drill: true,
          drillType,
          ruleLabel: "Proofing stakeholders",
        },
      };
    default:
      throw new HttpError(400, "Unsupported drill type");
  }
}

async function runControlledWorkflowErrorDrill(payload: Record<string, unknown>, auth: AuthContext) {
  assertPlatformAdmin(auth);
  const customerId = requiredString(payload, "customerId");
  const projectId = optionalString(payload.projectId);
  const drillType = normalizeErrorDrillType(payload.drillType);
  const customer = await findCustomerById(customerId);
  if (!customer) throw new HttpError(404, `Customer ${customerId} not found`);

  const targetProject = projectId ? await findProjectById(projectId) : await resolveNotificationSampleProject(customerId);
  if (!targetProject) {
    throw new HttpError(400, `No project is available for ${customer.name}. Create or choose a project before running an error drill.`);
  }
  if (targetProject.customerId !== customerId) {
    throw new HttpError(400, "The selected project does not belong to the chosen customer.");
  }
  if (!hasProjectAccess(auth, targetProject)) {
    throw new HttpError(403, `You do not have access to project ${targetProject.id}`);
  }

  const detail = buildWorkflowErrorDrillDetail(drillType);
  await writeAudit(`PROJECT#${targetProject.id}`, "workflow.error", auth, {
    severity: detail.severity,
    errorCode: detail.errorCode,
    message: detail.message,
    surface: detail.surface,
    actionType: "ops_drill",
    metadata: detail.metadata,
  });

  return {
    ok: true as const,
    customer: {
      id: customer.id,
      name: customer.name,
    },
    project: {
      id: targetProject.id,
      title: targetProject.title,
      venueName: targetProject.venueName,
      projectMode: targetProject.projectMode || "live",
    },
    issue: {
      drillType,
      severity: detail.severity,
      errorCode: detail.errorCode,
      message: detail.message,
      surface: detail.surface,
    },
  };
}

async function listLiftCustomerContacts(search: string, auth: AuthContext) {
  assertPlatformAdmin(auth);
  const settings = hydrateAppSettings(await findAppSettings(), auth.actorName);
  const config = settings.integrations.primaryPrintVendor;
  const endpointUrl = resolveLiftEnvironmentUrl(config, getLiftEnvironmentConfig(config).customerContactListUrl);
  if (!endpointUrl) {
    throw new HttpError(400, "Lift customer contact list endpoint is not configured in Internal Admin.");
  }

  const response = await fetch(endpointUrl, {
    method: "GET",
    headers: parseLiftHeaders(config.defaultHeaders),
  });
  const csv = await response.text();
  if (!response.ok || !csv.trim()) {
    throw new HttpError(502, "Lift customer contact list could not be loaded.");
  }

  const normalizedSearch = normalizeText(search || "");
  return parseLiftCustomerContactsCsv(csv)
    .filter((customer) => {
      if (!normalizedSearch) return true;
      return [
        customer.customerId,
        customer.customerName,
        customer.customerNumber,
        customer.customerType,
        customer.customerStatus,
        customer.salesRep,
        customer.defaultInvoiceEmailAddress,
      ]
        .filter(Boolean)
        .some((value) => normalizeText(value).includes(normalizedSearch));
    })
    .slice(0, 50);
}

async function updateCustomerSettings(customerId: string, payload: Record<string, unknown>, auth: AuthContext) {
  assertCustomerAccess(auth, customerId);
  const customer = await findCustomerById(customerId);
  if (!customer) throw new HttpError(404, `Customer ${customerId} not found`);

  const appSettings = hydrateAppSettings(await findAppSettings(), auth.actorName);
  const existing = hydrateCustomerSettings(await findCustomerSettings(customerId), customerId, auth.actorName, appSettings);
  const next: CustomerSettingsItem = {
    ...existing,
    notifications: {
      ...deriveLegacyNotificationSettings(
        hasOwn(payload, "notificationRules")
          ? sanitizeNotificationRules(payload.notificationRules)
          : existing.notifications.rules
      ),
      rules:
        hasOwn(payload, "notificationRules")
          ? sanitizeNotificationRules(payload.notificationRules)
          : existing.notifications.rules,
    },
    transitApproval: {
      defaultMode:
        optionalCustomerTransitDefaultMode(payload.transitApprovalDefaultMode) ?? existing.transitApproval.defaultMode,
      allowProjectOverride:
        optionalBoolean(payload.allowTransitProjectOverride) ?? existing.transitApproval.allowProjectOverride,
    },
    collaboration: {
      collaborationLinksEnabled:
        optionalBoolean(payload.customerShareCollaborationEnabled) ?? existing.collaboration.collaborationLinksEnabled,
      artworkUploadLinksEnabled:
        optionalBoolean(payload.customerShareArtworkUploadEnabled) ?? existing.collaboration.artworkUploadLinksEnabled,
      transitApprovalLinksEnabled:
        optionalBoolean(payload.customerShareTransitApprovalEnabled) ?? existing.collaboration.transitApprovalLinksEnabled,
      viewOnlyLinksEnabled:
        optionalBoolean(payload.customerShareViewOnlyEnabled) ?? existing.collaboration.viewOnlyLinksEnabled,
      requireParticipantIdentity:
        optionalBoolean(payload.customerRequireParticipantIdentity) ?? existing.collaboration.requireParticipantIdentity,
    },
    updatedAt: isoNow(),
    updatedByName: auth.actorName,
  };

  await putCore(buildCustomerSettingsRecord(next));
  await writeAudit(`ADMIN_SETTINGS#CUSTOMER#${customerId}`, "customer.settings.updated", auth, {
    customerId,
    updatedSections: ["notifications", "transitApproval", "collaboration"],
  });

  return getCustomerSettings(customerId, auth);
}

async function createCustomerVendor(customerId: string, payload: Record<string, unknown>, auth: AuthContext) {
  assertCustomerAccess(auth, customerId);
  const customer = await findCustomerById(customerId);
  if (!customer) throw new HttpError(404, `Customer ${customerId} not found`);

  const name = requiredString(payload, "name");
  const vendor: CustomerVendorItem = {
    entityType: "CustomerVendor",
    id: makeId("vendor"),
    customerId,
    name,
    contactName: optionalString(payload.contactName) || undefined,
    email: optionalString(payload.email) || undefined,
    phone: optionalString(payload.phone) || undefined,
    notes: optionalString(payload.notes) || undefined,
    isActive: optionalBoolean(payload.isActive) ?? true,
    createdAt: isoNow(),
    updatedAt: isoNow(),
    updatedByName: auth.actorName,
  };

  await putCore(buildCustomerVendorRecord(vendor));
  await writeAudit(`ADMIN_SETTINGS#CUSTOMER#${customerId}`, "customer.vendor.created", auth, {
    customerId,
    vendorId: vendor.id,
    vendorName: vendor.name,
  });

  return {
    vendor: {
      id: vendor.id,
      customerId: vendor.customerId,
      name: vendor.name,
      contactName: vendor.contactName || "",
      email: vendor.email || "",
      phone: vendor.phone || "",
      notes: vendor.notes || "",
      isActive: vendor.isActive,
      updatedAt: vendor.updatedAt,
      updatedByName: vendor.updatedByName,
    },
  };
}

async function updateCustomerVendor(customerId: string, vendorId: string, payload: Record<string, unknown>, auth: AuthContext) {
  assertCustomerAccess(auth, customerId);
  const existing = await findCustomerVendor(customerId, vendorId);
  if (!existing) throw new HttpError(404, `Vendor ${vendorId} not found for customer ${customerId}`);

  const next: CustomerVendorItem = {
    ...existing,
    name: hasOwn(payload, "name") ? requiredString(payload, "name") : existing.name,
    contactName: hasOwn(payload, "contactName") ? optionalString(payload.contactName) || undefined : existing.contactName,
    email: hasOwn(payload, "email") ? optionalString(payload.email) || undefined : existing.email,
    phone: hasOwn(payload, "phone") ? optionalString(payload.phone) || undefined : existing.phone,
    notes: hasOwn(payload, "notes") ? optionalString(payload.notes) || undefined : existing.notes,
    isActive: optionalBoolean(payload.isActive) ?? existing.isActive,
    updatedAt: isoNow(),
    updatedByName: auth.actorName,
  };

  await putCore(buildCustomerVendorRecord(next));
  await writeAudit(`ADMIN_SETTINGS#CUSTOMER#${customerId}`, "customer.vendor.updated", auth, {
    customerId,
    vendorId,
    changes: payload,
  });

  return {
    vendor: {
      id: next.id,
      customerId: next.customerId,
      name: next.name,
      contactName: next.contactName || "",
      email: next.email || "",
      phone: next.phone || "",
      notes: next.notes || "",
      isActive: next.isActive,
      updatedAt: next.updatedAt,
      updatedByName: next.updatedByName,
    },
  };
}

async function findUserProfileBySub(cognitoSub: string) {
  const cached = readLocalCache(userProfileBySubCache.get(cognitoSub));
  if (cached.hit) return cached.value;
  const items = await queryByPk(`USER#${cognitoSub}`);
  const profile = items.find((item): item is UserProfileItem => item.entityType === "UserProfile") || null;
  if (profile) cacheUserProfile(profile);
  else userProfileBySubCache.set(cognitoSub, makeLocalCacheEntry(null, USER_CACHE_TTL_MS));
  return profile;
}

async function findUserProfileByEmail(email: string) {
  const normalizedEmail = email.toLowerCase();
  const cached = readLocalCache(userProfileByEmailCache.get(normalizedEmail));
  if (cached.hit) return cached.value;
  const items = await queryByGsi1(`USER_EMAIL#${email.toLowerCase()}`);
  const profile = items.find((item): item is UserProfileItem => item.entityType === "UserProfile") || null;
  if (profile) cacheUserProfile(profile);
  else userProfileByEmailCache.set(normalizedEmail, makeLocalCacheEntry(null, USER_CACHE_TTL_MS));
  return profile;
}

async function requireUserAuthContext(event: ApiEvent): Promise<AuthContext> {
  const claims = event.requestContext?.authorizer?.jwt?.claims || {};
  const cognitoSub = claims.sub;
  const email = claims.email || claims.username || claims["cognito:username"];
  if (!cognitoSub && !email) throw new HttpError(401, "Authenticated identity is missing JWT claims");

  const profile =
    (cognitoSub ? await findUserProfileBySub(cognitoSub) : null) ||
    (email ? await findUserProfileByEmail(email) : null);

  if (!profile) throw new HttpError(403, `No UserProfile found for ${email || cognitoSub}`);
  if (!profile.isActive) throw new HttpError(403, `UserProfile for ${profile.email} is inactive`);

  return {
    mode: "user",
    actorType: "user",
    actorId: profile.id,
    profile,
    actorName: profile.displayName || profile.email,
    isPlatformAdmin: profile.role === "platform_admin",
    customerIds: new Set(profile.customerIds || []),
    shareLink: null,
    participant: null,
  };
}

async function requireShareContext(
  event: ApiEvent,
  projectId: string,
  workspace: ShareWorkspace,
  requireEditAccess: boolean
): Promise<AuthContext> {
  const token = readShareToken(event);
  if (!token) throw new HttpError(401, "A valid shared access token is required");

  const shareLink = await findShareLinkByToken(token);
  if (!shareLink) throw new HttpError(403, "This shared link is not valid");
  if (shareLink.projectId !== projectId) throw new HttpError(403, "This shared link does not belong to the requested project");
  if (shareLink.status !== "active") throw new HttpError(403, "This shared link has been revoked");
  if (shareLink.expiresAt && new Date(shareLink.expiresAt).getTime() < Date.now()) {
    throw new HttpError(403, "This shared link has expired");
  }

  const canAccess = requireEditAccess
    ? canEditShareWorkspace(shareLink.accessType, workspace)
    : canViewShareWorkspace(shareLink.accessType, workspace);
  if (!canAccess) throw new HttpError(403, "This shared link does not allow that action");

  let participant: ShareParticipantItem | null = null;
  if (requireEditAccess) {
    const participantId = readShareParticipantId(event);
    if (!participantId) throw new HttpError(401, "Identify yourself before making edits with this shared link");
    participant = await findShareParticipantById(shareLink.id, participantId);
    if (!participant) throw new HttpError(403, "This shared participant is not valid for the link");
    await touchShareParticipant(participant);
  }

  return {
    mode: "share",
    actorType: "share_participant",
    actorId: participant?.id || shareLink.id,
    profile: null,
    actorName: participant?.displayName || shareLink.label,
    isPlatformAdmin: false,
    customerIds: new Set<string>(),
    shareLink,
    participant,
  };
}

function hasCustomerAccess(auth: AuthContext, customerId: string) {
  if (auth.mode === "share") return true;
  return auth.isPlatformAdmin || auth.customerIds.has(customerId);
}

function hasProjectAccess(auth: AuthContext, project: ProjectItem) {
  if (project.projectMode === "internal_sandbox") {
    return auth.mode !== "share" && auth.isPlatformAdmin;
  }
  return hasCustomerAccess(auth, project.customerId);
}

function assertCustomerAccess(auth: AuthContext, customerId: string) {
  if (hasCustomerAccess(auth, customerId)) return;
  throw new HttpError(403, `You do not have access to customer ${customerId}`);
}

function assertProjectAccess(auth: AuthContext, project: ProjectItem) {
  if (hasProjectAccess(auth, project)) return;
  throw new HttpError(403, `You do not have access to project ${project.id}`);
}

function assertPlatformAdmin(auth: AuthContext) {
  if (auth.mode !== "user" || !auth.isPlatformAdmin) {
    throw new HttpError(403, "Platform admin access is required");
  }
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

function normalizeText(value: string) {
  return value.trim().toLowerCase();
}

async function queryByPk(pk: string, skPrefix?: string) {
  const startedAt = Date.now();
  const response = await client.send(
    new QueryCommand({
      TableName: CORE_TABLE_NAME,
      KeyConditionExpression: skPrefix ? "pk = :pk AND begins_with(sk, :skPrefix)" : "pk = :pk",
      ExpressionAttributeValues: marshall(skPrefix ? { ":pk": pk, ":skPrefix": skPrefix } : { ":pk": pk }),
    })
  );

  const items = (response.Items || []).map((item) => unmarshall(item) as Record<string, any>);
  logPerf("queryByPk", startedAt, { pk, skPrefix: skPrefix || null, count: items.length }, 200, 1000);
  return items;
}

async function queryByGsi1(gsi1pk: string, gsi1skPrefix?: string) {
  const startedAt = Date.now();
  const response = await client.send(
    new QueryCommand({
      TableName: CORE_TABLE_NAME,
      IndexName: "gsi1",
      KeyConditionExpression: gsi1skPrefix ? "gsi1pk = :gsi1pk AND begins_with(gsi1sk, :gsi1skPrefix)" : "gsi1pk = :gsi1pk",
      ExpressionAttributeValues: marshall(gsi1skPrefix ? { ":gsi1pk": gsi1pk, ":gsi1skPrefix": gsi1skPrefix } : { ":gsi1pk": gsi1pk }),
    })
  );

  const items = (response.Items || []).map((item) => unmarshall(item) as Record<string, any>);
  logPerf("queryByGsi1", startedAt, { gsi1pk, gsi1skPrefix: gsi1skPrefix || null, count: items.length }, 200, 1000);
  return items;
}

async function queryByGsi2(gsi2pk: string, gsi2skPrefix?: string) {
  const startedAt = Date.now();
  const response = await client.send(
    new QueryCommand({
      TableName: CORE_TABLE_NAME,
      IndexName: "gsi2",
      KeyConditionExpression: gsi2skPrefix ? "gsi2pk = :gsi2pk AND begins_with(gsi2sk, :gsi2skPrefix)" : "gsi2pk = :gsi2pk",
      ExpressionAttributeValues: marshall(gsi2skPrefix ? { ":gsi2pk": gsi2pk, ":gsi2skPrefix": gsi2skPrefix } : { ":gsi2pk": gsi2pk }),
    })
  );

  const items = (response.Items || []).map((item) => unmarshall(item) as Record<string, any>);
  logPerf("queryByGsi2", startedAt, { gsi2pk, gsi2skPrefix: gsi2skPrefix || null, count: items.length }, 200, 1000);
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
  logPerf("scanByEntityType", startedAt, { entityType, count: items.length }, 250, 1000);
  return items;
}

async function rawListProjectAuditEvents(projectId: string) {
  const response = await client.send(
    new QueryCommand({
      TableName: AUDIT_TABLE_NAME,
      KeyConditionExpression: "projectId = :projectId",
      ExpressionAttributeValues: marshall({ ":projectId": `PROJECT#${projectId}` }),
      ScanIndexForward: false,
      Limit: 50,
    })
  );

  return (response.Items || []).map((item) => unmarshall(item) as Record<string, any>);
}

async function rawListRecentWorkflowErrors(limit = 10) {
  const response = await client.send(
    new ScanCommand({
      TableName: AUDIT_TABLE_NAME,
      FilterExpression: "eventType = :eventType",
      ExpressionAttributeValues: marshall({ ":eventType": "workflow.error" }),
    })
  );

  return (response.Items || [])
    .map((item) => unmarshall(item) as Record<string, any>)
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
    .slice(0, Math.max(1, Math.min(limit, 25)));
}

async function putCore(item: Record<string, unknown>) {
  invalidateEntityScanForWrite(item.entityType);
  await client.send(
    new PutItemCommand({
      TableName: CORE_TABLE_NAME,
      Item: marshall(item, { removeUndefinedValues: true }),
    })
  );
}

async function deleteCore(pk: string, sk: string) {
  invalidateEntityScanCaches();
  await client.send(
    new DeleteItemCommand({
      TableName: CORE_TABLE_NAME,
      Key: marshall({ pk, sk }),
    })
  );
}

async function touchShareParticipant(participant: ShareParticipantItem) {
  const next = {
    ...participant,
    lastSeenAt: isoNow(),
  };
  await putCore(buildShareParticipantRecord(next));
}

async function putShortLinkRecord(code: string, targetPath: string, expiresAt?: string | null) {
  if (!SHORT_LINKS_TABLE_NAME) return;
  const epochExpiresAt = expiresAt ? Math.floor(new Date(expiresAt).getTime() / 1000) : undefined;
  await client.send(
    new PutItemCommand({
      TableName: SHORT_LINKS_TABLE_NAME,
      Item: marshall(
        {
          code,
          status: "active",
          targetPath,
          expiresAt: epochExpiresAt,
        },
        { removeUndefinedValues: true }
      ),
    })
  );
}

async function revokeShortLinkRecord(code: string) {
  if (!SHORT_LINKS_TABLE_NAME || !code) return;
  await client.send(
    new PutItemCommand({
      TableName: SHORT_LINKS_TABLE_NAME,
      Item: marshall({
        code,
        status: "revoked",
        targetPath: "/link-unavailable",
      }),
    })
  );
}

async function deleteS3Object(bucket: string, key: string) {
  try {
    await s3.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: key,
      })
    );
  } catch (error) {
    console.warn("Failed to delete S3 object", { bucket, key, error });
  }
}

async function writeAudit(scopeId: string, eventType: string, auth: AuthContext, detail: Record<string, unknown>) {
  const createdAt = isoNow();
  const auditEvent: AuditEvent = {
    eventType,
    scopeId,
    actorType: auth.actorType,
    actorId: auth.actorId,
    actorName: auth.actorName,
    shareLinkId: auth.shareLink?.id,
    createdAt,
    detail,
  };

  await client.send(
    new PutItemCommand({
      TableName: AUDIT_TABLE_NAME,
      Item: marshall({ projectId: scopeId, ...auditEvent }, { removeUndefinedValues: true }),
    })
  );
}

function buildProjectRecord(project: ProjectItem) {
  return {
    pk: `PROJECT#${project.id}`,
    sk: "PROJECT",
    gsi1pk: `CUSTOMER#${project.customerId}`,
    gsi1sk: `PROJECT#${project.createdAt}#${project.id}`,
    gsi2pk: `VENUE#${project.venueId}`,
    gsi2sk: `PROJECT#${project.createdAt}#${project.id}`,
    ...project,
  };
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

function buildProjectScopeRecord(scope: ProjectScopeItem) {
  return {
    pk: `PROJECT#${scope.projectId}`,
    sk: "SCOPE",
    gsi1pk: `PROJECT#${scope.projectId}`,
    gsi1sk: "SCOPE",
    gsi2pk: `PROJECT#${scope.projectId}`,
    gsi2sk: "SCOPE",
    ...scope,
  };
}

function buildProjectCreativeRecord(creative: ProjectCreativeAssetItem) {
  return {
    pk: `PROJECT#${creative.projectId}`,
    sk: `CREATIVE#${creative.createdAt}#${creative.id}`,
    gsi1pk: `CREATIVE#${creative.id}`,
    gsi1sk: `PROJECT#${creative.projectId}`,
    gsi2pk: `PROJECT#${creative.projectId}`,
    gsi2sk: `CREATIVE#${creative.createdAt}#${creative.id}`,
    ...creative,
  };
}

function buildProjectDocumentRecord(document: ProjectDocumentItem) {
  return {
    pk: `PROJECT#${document.projectId}`,
    sk: `DOC#${document.createdAt}#${document.id}`,
    gsi1pk: `PROJECTDOC#${document.id}`,
    gsi1sk: `PROJECT#${document.projectId}`,
    gsi2pk: `PROJECT#${document.projectId}`,
    gsi2sk: `DOC#${document.createdAt}#${document.id}`,
    ...document,
  };
}

async function createLiftSnapshotDocument(
  projectId: string,
  liftOrderId: string,
  snapshotType: "request" | "response",
  snapshotPayload: Record<string, unknown>,
  actorName: string
) {
  if (!GENERATED_DOCS_BUCKET_NAME) return null;

  const now = isoNow();
  const id = makeId("doc");
  const filename = `lift-order-${liftOrderId}-${snapshotType}.json`;
  const objectKey = `lift-payloads/${projectId}/${now.replace(/[:.]/g, "-")}-${filename}`;
  const body = JSON.stringify(
    {
      liftOrderId,
      projectId,
      capturedAt: now,
      snapshotType,
      payload: snapshotPayload,
    },
    null,
    2
  );

  await s3.send(
    new PutObjectCommand({
      Bucket: GENERATED_DOCS_BUCKET_NAME,
      Key: objectKey,
      Body: body,
      ContentType: "application/json",
    })
  );

  const document: ProjectDocumentItem = {
    entityType: "ProjectDocument",
    id,
    projectId,
    category: "lift_payload",
    assetKind: "liftPayload",
    bucketName: GENERATED_DOCS_BUCKET_NAME,
    objectKey,
    filename,
    contentType: "application/json",
    sizeBytes: Buffer.byteLength(body, "utf8"),
    source: "generated",
    uploadedByName: actorName,
    createdAt: now,
    updatedAt: now,
  };

  await putCore(buildProjectDocumentRecord(document));
  return document;
}

async function createLiftPreviewPayloadDocument(project: ProjectItem, previewPayload: Record<string, unknown>, actorName: string) {
  if (!GENERATED_DOCS_BUCKET_NAME) return null;

  const now = isoNow();
  const id = makeId("doc");
  const adspaceOrderNumber = getProjectAdspaceOrderNumber(project);
  const filename = `lift-preview-${adspaceOrderNumber}-request.json`;
  const objectKey = `lift-payloads/${project.id}/${now.replace(/[:.]/g, "-")}-${filename}`;
  const body = JSON.stringify(
    {
      projectId: project.id,
      adspaceOrderNumber,
      capturedAt: now,
      snapshotType: "preview",
      payload: previewPayload,
    },
    null,
    2
  );

  await s3.send(
    new PutObjectCommand({
      Bucket: GENERATED_DOCS_BUCKET_NAME,
      Key: objectKey,
      Body: body,
      ContentType: "application/json",
    })
  );

  const document: ProjectDocumentItem = {
    entityType: "ProjectDocument",
    id,
    projectId: project.id,
    category: "lift_payload",
    assetKind: "liftPayload",
    bucketName: GENERATED_DOCS_BUCKET_NAME,
    objectKey,
    filename,
    contentType: "application/json",
    sizeBytes: Buffer.byteLength(body, "utf8"),
    source: "generated",
    uploadedByName: actorName,
    createdAt: now,
    updatedAt: now,
  };

  await putCore(buildProjectDocumentRecord(document));
  return document;
}

function buildProjectAssignmentRecord(assignment: ProjectAssignmentItem) {
  return {
    pk: `PROJECT#${assignment.projectId}`,
    sk: `ASSIGNMENT#${assignment.inventoryId}`,
    gsi1pk: `ASSIGNMENT#${assignment.id}`,
    gsi1sk: `PROJECT#${assignment.projectId}`,
    gsi2pk: `PROJECT#${assignment.projectId}`,
    gsi2sk: `ASSIGNMENT#${assignment.inventoryId}`,
    ...assignment,
  };
}

function buildProjectProofLineRecord(proof: ProjectProofLineItem) {
  return {
    pk: `PROJECT#${proof.projectId}`,
    sk: `PROOF#${String(proof.lineNumber).padStart(4, "0")}#${proof.id}`,
    gsi1pk: `PROOF#${proof.id}`,
    gsi1sk: `PROJECT#${proof.projectId}`,
    gsi2pk: `PROJECT#${proof.projectId}`,
    gsi2sk: `PROOF#${String(proof.lineNumber).padStart(4, "0")}#${proof.id}`,
    ...proof,
  };
}

function buildProjectAllocationOverrideRowRecord(row: ProjectAllocationOverrideRowItem) {
  return {
    pk: `PROJECT#${row.projectId}`,
    sk: `ALLOCOVR#${row.createdAt}#${row.id}`,
    gsi1pk: `ALLOCOVR#${row.id}`,
    gsi1sk: `PROJECT#${row.projectId}`,
    gsi2pk: `PROJECT#${row.projectId}`,
    gsi2sk: `ALLOCOVR#${row.createdAt}#${row.id}`,
    ...row,
  };
}

function buildProjectTransitRecord(transit: ProjectTransitApprovalItem) {
  return {
    pk: `PROJECT#${transit.projectId}`,
    sk: "TRANSIT",
    gsi1pk: `TRANSIT#${transit.projectId}`,
    gsi1sk: `PROJECT#${transit.projectId}`,
    gsi2pk: `PROJECT#${transit.projectId}`,
    gsi2sk: "TRANSIT",
    ...transit,
  };
}

function buildProjectShareLinkRecord(link: ProjectShareLinkItem) {
  return {
    pk: `PROJECT#${link.projectId}`,
    sk: `SHARELINK#${link.createdAt}#${link.id}`,
    gsi1pk: `SHARELINK#${link.id}`,
    gsi1sk: `PROJECT#${link.projectId}`,
    gsi2pk: `SHARETOKEN#${link.tokenHash}`,
    gsi2sk: `PROJECT#${link.projectId}`,
    ...link,
  };
}

function buildShareParticipantRecord(participant: ShareParticipantItem) {
  return {
    pk: `SHARELINK#${participant.shareLinkId}`,
    sk: `PARTICIPANT#${participant.id}`,
    gsi1pk: `PROJECT#${participant.projectId}`,
    gsi1sk: `SHAREPARTICIPANT#${participant.shareLinkId}#${participant.id}`,
    gsi2pk: `SHAREPARTICIPANT#${participant.shareLinkId}`,
    gsi2sk: `EMAIL#${participant.emailLower}`,
    ...participant,
  };
}

function buildAppSettingsRecord(settings: AppSettingsItem) {
  return {
    pk: "APPSETTINGS#global",
    sk: "PROFILE",
    gsi1pk: "APPSETTINGS#global",
    gsi1sk: "PROFILE",
    gsi2pk: "APPSETTINGS#global",
    gsi2sk: "PROFILE",
    ...settings,
  };
}

function buildCustomerSettingsRecord(settings: CustomerSettingsItem) {
  return {
    pk: `CUSTOMER#${settings.customerId}`,
    sk: "SETTINGS#customer",
    gsi1pk: `CUSTOMERSETTINGS#${settings.customerId}`,
    gsi1sk: "PROFILE",
    gsi2pk: `CUSTOMER#${settings.customerId}`,
    gsi2sk: "SETTINGS#customer",
    ...settings,
  };
}

function buildCustomerVendorRecord(vendor: CustomerVendorItem) {
  return {
    pk: `CUSTOMER#${vendor.customerId}`,
    sk: `VENDOR#${vendor.id}`,
    gsi1pk: `VENDOR#${vendor.id}`,
    gsi1sk: `CUSTOMER#${vendor.customerId}`,
    gsi2pk: `CUSTOMER#${vendor.customerId}`,
    gsi2sk: `VENDOR#${vendor.name}#${vendor.id}`,
    ...vendor,
  };
}

function buildNotificationDigestRecord(digest: NotificationDigestItem) {
  return {
    pk: `CUSTOMER#${digest.customerId}`,
    sk: `NOTIFICATION_DIGEST#${digest.ruleId}`,
    gsi1pk: `NOTIFICATION_DIGEST#${digest.customerId}`,
    gsi1sk: `RULE#${digest.ruleId}`,
    gsi2pk: `CUSTOMER#${digest.customerId}`,
    gsi2sk: `NOTIFICATION_DIGEST#${digest.ruleId}`,
    ...digest,
  };
}

function buildProjectNotificationDispatchRecord(dispatch: ProjectNotificationDispatchItem) {
  return {
    pk: `PROJECT#${dispatch.projectId}`,
    sk: `NOTIFY#${dispatch.eventType}`,
    gsi1pk: `PROJECT_NOTIFICATION#${dispatch.projectId}`,
    gsi1sk: `EVENT#${dispatch.eventType}`,
    gsi2pk: `PROJECT#${dispatch.projectId}`,
    gsi2sk: `NOTIFY#${dispatch.eventType}`,
    ...dispatch,
  };
}

function buildWorkspaceMaps(
  maps: RoomMapItem[],
  inventory: Array<{ mapId: string; assignedCreativeId: string | null }>
) {
  const counts = new Map<string, { total: number; assigned: number }>();
  inventory.forEach((item) => {
    const next = counts.get(item.mapId) || { total: 0, assigned: 0 };
    next.total += 1;
    if (item.assignedCreativeId) next.assigned += 1;
    counts.set(item.mapId, next);
  });

  return maps.map((map) => {
    const count = counts.get(map.id) || { total: 0, assigned: 0 };
    return {
      id: map.id,
      name: map.name,
      sortOrder: map.sortOrder ?? 0,
      assigned: count.assigned,
      total: count.total,
      imageUrl: map.mapUrl || "",
    };
  });
}

function buildWorkspaceVariants(variants: MediaVariantItem[], inventory: InventoryItem[]) {
  const byKey = new Map<string, MediaVariantItem>();
  variants.forEach((variant) => byKey.set(variant.mediaVariantKey, variant));
  inventory.forEach((item) => {
    if (byKey.has(item.mediaVariantKey)) return;
    byKey.set(item.mediaVariantKey, {
      entityType: "MediaVariant",
      id: makeId("variant"),
      venueId: item.venueId,
      mediaVariantKey: item.mediaVariantKey,
      label: item.variantLabel,
      mediaType: item.mediaType,
      color: undefined,
      abbreviation: undefined,
      unitNumber: item.unitNumber,
      updatedAt: item.updatedAt,
    });
  });

  return Array.from(byKey.values()).map((variant) => {
    const [fallbackMediaName, fallbackW, fallbackH] = parseVariantKey(variant.mediaVariantKey);
    const [labelMediaName, labelDims] = variant.label.split("·").map((part) => part.trim());
    return {
      key: variant.mediaVariantKey,
      mediaName: variant.mediaType || labelMediaName || fallbackMediaName,
      w: fallbackW,
      h: fallbackH,
      shortLabel: variant.abbreviation || makeShortLabel(variant.mediaType || labelMediaName || fallbackMediaName),
      color: variant.color || colorForVariantKey(variant.mediaVariantKey),
      label: variant.label || `${variant.mediaType || fallbackMediaName} · ${labelDims || ""}`.trim(),
      unitNumber: variant.unitNumber || undefined,
    };
  });
}

function buildWorkspaceInventory(
  inventory: InventoryItem[],
  assignmentMap: Map<string, string | null>,
  assignmentStateMap: Map<string, ProjectAssignmentItem>
) {
  return inventory
    .filter((item) => item.isActive)
    .map((item) => ({
      id: item.inventoryId,
      recordId: item.id,
      locationName: item.mapName || undefined,
      mapId: item.locationId,
      mediaVariantKey: item.mediaVariantKey,
      unitNumber: item.unitNumber || "",
      x: item.x ?? 0.5,
      y: item.y ?? 0.5,
      assignedCreativeId: assignmentMap.get(item.id) ?? null,
      assignmentUpdatedAt: assignmentStateMap.get(item.id)?.updatedAt || null,
    }));
}

async function toWorkspaceCreative(creative: ProjectCreativeAssetItem, assignedInventoryIds: string[]) {
  const assetUrl = await signBucketReadUrl(creative.bucketName || PROJECT_ASSETS_BUCKET_NAME, creative.objectKey);
  const thumbUrl = creative.thumbObjectKey
    ? await signBucketReadUrl(creative.bucketName || PROJECT_ASSETS_BUCKET_NAME, creative.thumbObjectKey)
    : null;
  const isImage = isImageAsset(creative.contentType, creative.filename);

  return {
    id: creative.id,
    filename: creative.filename,
    fileMeta: creative.fileMeta,
    mediaVariantKey: creative.mediaVariantKey,
    color: creative.color,
    contentType: creative.contentType || null,
    createdAt: creative.createdAt,
    thumbUrl: thumbUrl || (isImage ? assetUrl : null),
    fullUrl: assetUrl,
    assignedInventoryIds,
  };
}

async function toProjectProofLineResponse(
  proof: ProjectProofLineItem,
  variants: MediaVariantItem[],
  creativesById?: Map<string, ProjectCreativeAssetItem>,
  signedUrlCache?: Map<string, Promise<string>>
) {
  const creative = creativesById?.get(proof.clientCreativeId) || await findProjectCreativeById(proof.projectId, proof.clientCreativeId);
  const variant = variants.find((item) => item.mediaVariantKey === proof.mediaVariantKey);
  const [fallbackMediaName, fallbackW, fallbackH] = parseVariantKey(proof.mediaVariantKey);
  const mediaVariantLabel = variant?.label || proof.mediaVariantLabel || formatVariantLabel(proof.mediaVariantKey);

  const clientFullUrl = creative
    ? await signBucketReadUrl(creative.bucketName || PROJECT_ASSETS_BUCKET_NAME, creative.objectKey, undefined, signedUrlCache)
    : null;
  const clientThumbUrl = creative?.thumbObjectKey
    ? await signBucketReadUrl(creative.bucketName || PROJECT_ASSETS_BUCKET_NAME, creative.thumbObjectKey, undefined, signedUrlCache)
    : clientFullUrl;
  const proofFullUrl =
    proof.liftProofFullUrl ||
    (proof.proofObjectKey ? await signBucketReadUrl(PROJECT_ASSETS_BUCKET_NAME, proof.proofObjectKey, undefined, signedUrlCache) : null);
  const proofThumbUrl = proof.proofThumbObjectKey
    ? await signBucketReadUrl(PROJECT_ASSETS_BUCKET_NAME, proof.proofThumbObjectKey, undefined, signedUrlCache)
    : proof.liftProofThumbUrl || proofFullUrl;

  return {
    lineItemId: proof.id,
    lineNumber: proof.lineNumber,
    liftOrderLineId: proof.liftOrderLineId ?? null,
    liftProofingId: proof.liftProofingId ?? null,
    mediaVariantKey: proof.mediaVariantKey,
    mediaVariantLabel,
    mediaName: variant?.mediaType || variant?.label.split("·")[0]?.trim() || fallbackMediaName,
    w: fallbackW,
    h: fallbackH,
    unitNumber: proof.unitNumber ?? null,
    quantity: proof.quantity ?? null,
    assignedLocations: proof.locations,
    locations: proof.locations,
    clientCreativeId: proof.clientCreativeId,
    clientFileName: proof.clientFileName,
    clientThumbUrl,
    clientFullUrl,
    proofThumbUrl,
    proofFullUrl,
    status: proof.status,
    revised: proof.revised,
    printTeamFeedback: proof.printTeamFeedback || null,
    proofComments: proof.proofComments || [],
    proofCommentCount: proof.proofCommentCount || proof.proofComments?.length || 0,
    proofCommentAttachmentCount:
      proof.proofCommentAttachmentCount ||
      proof.proofComments?.reduce((sum, comment) => sum + (comment.attachments?.length || 0), 0) ||
      0,
    latestProofCommentAt: proof.latestProofCommentAt || null,
    proofVersions: proof.proofVersions || [],
    updatedAt: proof.updatedAt,
    updatedByName: proof.updatedByName || null,
  };
}

function applyAllocationOverrideToProofResponse(
  proof: Awaited<ReturnType<typeof toProjectProofLineResponse>>,
  override: Awaited<ReturnType<typeof hydrateAllocationOverrideRows>>[number] | undefined
) {
  if (!override) return proof;
  if (override.hidden) return null;
  const locations = override.assignedInventoryIds || proof.locations || [];
  return {
    ...proof,
    assignedLocations: locations,
    locations,
    quantity: override.quantity ?? proof.quantity ?? null,
    clientFileName: override.asset?.filename || proof.clientFileName,
    clientThumbUrl: override.asset?.thumbUrl || proof.clientThumbUrl,
    clientFullUrl: override.asset?.fullUrl || proof.clientFullUrl,
    allocationOverride: {
      rowId: override.id,
      sourceType: override.sourceType,
      updatedAt: override.updatedAt,
      updatedByName: override.updatedByName,
      liftSyncStatus: override.liftSyncStatus,
    },
  };
}

function toProjectTransitResponse(transit: ProjectTransitApprovalItem | null, project: ProjectItem) {
  return {
    projectId: project.id,
    enabled: !!project.liftOrderId,
    status: transit?.status || "not_started",
    submittedByName: transit?.submittedByName || null,
    submittedDate: transit?.submittedDate || null,
    comment: transit?.comment || null,
    submittedAt: transit?.submittedAt || null,
    updatedAt: transit?.updatedAt || null,
  };
}

function toProjectShareLinkResponse(
  link: ProjectShareLinkItem,
  participants: ShareParticipantItem[],
  events: Array<Record<string, any>>
) {
  const lastActivity =
    events[0]?.createdAt ||
    participants.reduce<string | null>((latest, participant) => {
      if (!latest || participant.lastSeenAt > latest) return participant.lastSeenAt;
      return latest;
    }, null);

  return {
    id: link.id,
    projectId: link.projectId,
    label: link.label,
    accessType: link.accessType,
    status: link.status,
    createdByName: link.createdByName,
    createdAt: link.createdAt,
    updatedAt: link.updatedAt,
    expiresAt: link.expiresAt || null,
    shortCode: link.shortCode,
    shortUrl: link.shortCode ? `${SHORT_BASE_URL}/${link.shortCode}` : null,
    participantCount: participants.length,
    actionCount: events.length,
    lastActivityAt: lastActivity,
    recentActivity: events.slice(0, 5).map((event) => ({
      eventType: event.eventType,
      createdAt: event.createdAt,
      actorName: event.actorName,
      actorType: event.actorType,
      shareLinkId: event.shareLinkId || null,
      detail: event.detail || {},
    })),
  };
}

function toWorkspaceAssignment(assignment: ProjectAssignmentItem, inventoryLabel: string) {
  return {
    id: assignment.id,
    projectId: assignment.projectId,
    inventoryId: assignment.inventoryId,
    inventoryLabel,
    creativeId: assignment.creativeId,
    updatedAt: assignment.updatedAt,
    updatedByName: assignment.updatedByName,
  };
}

function buildAssignmentMap(assignments: ProjectAssignmentItem[]) {
  const map = new Map<string, string | null>();
  assignments.forEach((assignment) => map.set(assignment.inventoryId, assignment.creativeId));
  return map;
}

function buildAssignmentStateMap(assignments: ProjectAssignmentItem[]) {
  const map = new Map<string, ProjectAssignmentItem>();
  assignments.forEach((assignment) => map.set(assignment.inventoryId, assignment));
  return map;
}

function buildAssignedInventoryIdsByCreative(assignments: ProjectAssignmentItem[], inventory: InventoryItem[]) {
  const labelsByInventoryId = new Map(inventory.map((item) => [item.id, item.inventoryId]));
  const byCreative = new Map<string, string[]>();
  assignments.forEach((assignment) => {
    if (!assignment.creativeId) return;
    const inventoryLabel = labelsByInventoryId.get(assignment.inventoryId);
    if (!inventoryLabel) return;
    const next = byCreative.get(assignment.creativeId) || [];
    next.push(inventoryLabel);
    byCreative.set(assignment.creativeId, next);
  });
  for (const values of byCreative.values()) values.sort((a, b) => a.localeCompare(b));
  return byCreative;
}

async function signProjectAssetReadUrl(key: string) {
  return signBucketReadUrl(PROJECT_ASSETS_BUCKET_NAME, key);
}

function buildUserProfileRecord(profile: UserProfileItem) {
  return {
    pk: `USER#${profile.cognitoSub}`,
    sk: "PROFILE",
    gsi1pk: `USER_EMAIL#${profile.email.toLowerCase()}`,
    gsi1sk: "PROFILE",
    gsi2pk: `ROLE#${profile.role}`,
    gsi2sk: `USER#${(profile.displayName || profile.email).toLowerCase()}#${profile.cognitoSub}`,
    ...profile,
    email: profile.email.toLowerCase(),
  };
}

async function signBucketReadUrl(
  bucketName: string,
  key: string,
  responseContentType?: string,
  cache?: Map<string, Promise<string>>,
  responseContentDisposition?: string
) {
  const cacheKey = `${bucketName}|${key}|${responseContentType || ""}|${responseContentDisposition || ""}`;
  if (cache?.has(cacheKey)) {
    return cache.get(cacheKey)!;
  }
  const promise = getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
      ResponseContentType: responseContentType,
      ResponseContentDisposition: responseContentDisposition,
    }),
    { expiresIn: 60 * 60 }
  );
  if (cache) {
    cache.set(cacheKey, promise);
  }
  return promise;
}

function attachmentContentDisposition(filename: string) {
  const safeFilename = (sanitizeLiftFilename(filename) || "download").replace(/"/g, "");
  return `attachment; filename="${safeFilename}"`;
}

async function toProjectDocumentResponse(document: ProjectDocumentItem) {
  const isDownloadPackage = document.assetKind === "orderPackage" || document.contentType === "application/zip";
  const fullUrl = await signBucketReadUrl(
    document.bucketName,
    document.objectKey,
    document.contentType,
    undefined,
    isDownloadPackage ? attachmentContentDisposition(document.filename) : undefined
  );
  const thumbUrl = document.thumbObjectKey
    ? await signBucketReadUrl(document.bucketName, document.thumbObjectKey)
    : null;

  return {
    id: document.id,
    projectId: document.projectId,
    category: document.category,
    assetKind: document.assetKind,
    filename: document.filename,
    contentType: document.contentType || null,
    thumbContentType: document.thumbContentType || null,
    sizeBytes: document.sizeBytes || null,
    source: document.source,
    uploadedByName: document.uploadedByName,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    thumbUrl,
    fullUrl,
  };
}

function parseVariantKey(key: string) {
  const [mediaName = "Media", w = "0", h = "0"] = key.split("||");
  return [mediaName, Number(w || 0), Number(h || 0)] as const;
}

function formatVariantLabel(key: string) {
  const [mediaName, w, h] = parseVariantKey(key);
  const height = Number.isFinite(w) ? trimTrailingZeros(w) : "0";
  const width = Number.isFinite(h) ? trimTrailingZeros(h) : "0";
  return `${mediaName} • ${height}"h x ${width}"w`;
}

function trimTrailingZeros(value: number) {
  return Number.isInteger(value) ? String(value) : String(value).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function makeShortLabel(value: string) {
  return value
    .split(/[\s/-]+/)
    .map((part) => part.charAt(0).toUpperCase())
    .join("")
    .slice(0, 4) || "ART";
}

function colorForVariantKey(key: string) {
  const normalized = key.toLowerCase();
  if (normalized.includes("2-sheet")) return "#f4c84a";
  if (normalized.includes("column wrap")) return "#34d399";
  if (normalized.includes("stair riser")) return "#a78bfa";
  if (normalized.includes("rotunda")) return "#f97316";
  return "#60a5fa";
}

function isImageAsset(contentType: string | undefined, filename: string) {
  if (contentType?.startsWith("image/")) return true;
  return /\.(png|jpe?g|gif|webp|svg)$/i.test(filename);
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

function requiredString(payload: Record<string, unknown>, key: string) {
  const value = optionalString(payload[key]);
  if (!value) throw new HttpError(400, `${key} is required`);
  return value;
}

function hasOwn(payload: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(payload, key);
}

function optionalString(value: unknown) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed;
}

function optionalDate(value: unknown) {
  const parsed = optionalString(value);
  return parsed || undefined;
}

function optionalNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function normalizeCreativeId(value: unknown) {
  if (value === null) return null;
  const parsed = optionalString(value);
  return parsed || null;
}

function readShareToken(event: ApiEvent) {
  return (
    event.headers?.["x-share-token"] ||
    event.headers?.["X-Share-Token"] ||
    event.queryStringParameters?.share ||
    event.queryStringParameters?.token ||
    ""
  ).trim();
}

function readShareParticipantId(event: ApiEvent) {
  return (
    event.headers?.["x-share-participant-id"] ||
    event.headers?.["X-Share-Participant-Id"] ||
    ""
  ).trim();
}

function canViewShareWorkspace(accessType: ShareAccessType, workspace: ShareWorkspace) {
  switch (accessType) {
    case "collaboration":
      return workspace === "hub" || workspace === "artwork" || workspace === "assignment" || workspace === "proofs";
    case "artwork_upload":
      return workspace === "artwork";
    case "transit_approval":
      return workspace === "transit";
    case "view_only":
      return workspace === "hub" || workspace === "artwork" || workspace === "assignment" || workspace === "proofs";
    default:
      return false;
  }
}

function canEditShareWorkspace(accessType: ShareAccessType, workspace: ShareWorkspace) {
  if (accessType === "collaboration") return workspace === "artwork" || workspace === "assignment" || workspace === "proofs";
  if (accessType === "artwork_upload") return workspace === "artwork";
  if (accessType === "transit_approval") return workspace === "transit";
  return false;
}

function createShareToken() {
  return randomBytes(24).toString("base64url");
}

function hashShareToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function createShortCode() {
  return randomBytes(5).toString("base64url").toLowerCase();
}

function buildShareTargetPath(projectId: string, accessType: ShareAccessType, token: string) {
  const suffix = token ? `?share=${encodeURIComponent(token)}` : "";
  if (accessType === "artwork_upload") return `/p/${projectId}/artwork${suffix}`;
  if (accessType === "transit_approval") return `/p/${projectId}/transit${suffix}`;
  return `/p/${projectId}${suffix}`;
}

function shareAccessLabel(accessType: ShareAccessType) {
  if (accessType === "artwork_upload") return "Artwork Upload Only";
  if (accessType === "transit_approval") return "Transit Approval";
  if (accessType === "view_only") return "View Only";
  return "End Client Collaboration";
}

function optionalBoolean(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function optionalProjectMode(value: unknown): ProjectItem["projectMode"] | undefined {
  const parsed = optionalString(value);
  if (!parsed) return undefined;
  if (parsed === "live" || parsed === "internal_sandbox") return parsed;
  throw new HttpError(400, `Invalid project mode ${parsed}`);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function optionalCustomerTransitDefaultMode(value: unknown): CustomerSettingsItem["transitApproval"]["defaultMode"] | undefined {
  const parsed = optionalString(value);
  if (!parsed) return undefined;
  if (parsed === "enabled_all_orders" || parsed === "manual_per_project") return parsed;
  throw new HttpError(400, `Invalid customer transit approval mode ${parsed}`);
}

function optionalProofStatus(value: unknown): ProofLineStatus | undefined {
  const parsed = optionalString(value);
  if (!parsed) return undefined;
  if (parsed === "waiting" || parsed === "pending" || parsed === "approved") return parsed;
  throw new HttpError(400, `Invalid proof status ${parsed}`);
}

function optionalTransitStatus(value: unknown): TransitApprovalStatus | undefined {
  const parsed = optionalString(value);
  if (!parsed) return undefined;
  if (parsed === "not_started" || parsed === "pending" || parsed === "approved" || parsed === "rejected") return parsed;
  throw new HttpError(400, `Invalid transit status ${parsed}`);
}

function optionalShareAccessType(value: unknown): ShareAccessType | undefined {
  const parsed = optionalString(value);
  if (!parsed) return undefined;
  if (parsed === "collaboration" || parsed === "artwork_upload" || parsed === "transit_approval" || parsed === "view_only") {
    return parsed;
  }
  throw new HttpError(400, `Invalid share access type ${parsed}`);
}

function optionalShareLinkStatus(value: unknown): ShareLinkStatus | undefined {
  const parsed = optionalString(value);
  if (!parsed) return undefined;
  if (parsed === "active" || parsed === "revoked") return parsed;
  throw new HttpError(400, `Invalid share link status ${parsed}`);
}

function buildDefaultNotificationRules(emailRecipients: string): NotificationRule[] {
  const recipients = optionalString(emailRecipients) || "";
  if (!recipients) return [];
  return [
    {
      id: "default_customer_alerts",
      label: "Core workflow updates",
      eventTypes: ["all_proofs_approved", "transit_accepted", "transit_rejected", "production_release_ready"],
      recipients,
      deliveryMode: "instant",
      isActive: true,
    },
  ];
}

function sanitizeNotificationRules(value: unknown): NotificationRule[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry, index) => {
      if (!entry || typeof entry !== "object") return null;
      const candidate = entry as Record<string, unknown>;
      const eventTypes = Array.isArray(candidate.eventTypes)
        ? candidate.eventTypes.map(optionalNotificationEventType).filter((item): item is NotificationEventType => !!item)
        : [];
      const recipients = optionalString(candidate.recipients) || "";
      if (!eventTypes.length && !recipients) return null;
      return {
        id: optionalString(candidate.id) || `rule_${index + 1}`,
        label: optionalString(candidate.label) || `Notification rule ${index + 1}`,
        eventTypes,
        recipients,
        deliveryMode: optionalNotificationDeliveryMode(candidate.deliveryMode) || "instant",
        isActive: optionalBoolean(candidate.isActive) ?? true,
      } satisfies NotificationRule;
    })
    .filter((item): item is NotificationRule => !!item);
}

function deriveLegacyNotificationSettings(rules: NotificationRule[]) {
  const activeRules = rules.filter((rule) => rule.isActive);
  const eventSet = new Set(activeRules.flatMap((rule) => rule.eventTypes));
  const recipients = Array.from(
    new Set(
      activeRules
        .flatMap((rule) => rule.recipients.split(","))
        .map((value) => value.trim())
        .filter(Boolean)
    )
  ).join(", ");

  return {
    proofApproved: eventSet.has("all_proofs_approved"),
    transitDecision: eventSet.has("transit_accepted") || eventSet.has("transit_rejected"),
    productionReleased: eventSet.has("production_release_ready"),
    workflowErrors: eventSet.has("workflow_errors"),
    emailRecipients: recipients,
  };
}

function optionalNotificationEventType(value: unknown): NotificationEventType | undefined {
  const parsed = optionalString(value);
  switch (parsed) {
    case "artwork_uploaded":
    case "creatives_assigned":
    case "all_inventory_assigned":
    case "order_submitted":
    case "proofs_ready":
    case "revised_art_uploaded":
    case "all_proofs_approved":
    case "transit_accepted":
    case "transit_rejected":
    case "production_release_ready":
    case "workflow_errors":
      return parsed;
    default:
      return undefined;
  }
}

function optionalNotificationDeliveryMode(value: unknown): NotificationRule["deliveryMode"] | undefined {
  const parsed = optionalString(value);
  if (parsed === "instant" || parsed === "digest") return parsed;
  return undefined;
}

function parseCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      const next = line[index + 1];
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current);
  return values.map((value) => value.trim());
}

function parseLiftCustomerContactsCsv(csv: string): LiftCustomerContact[] {
  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])) as Record<string, string>;
    return {
      customerId: row.CUSTOMER_ID || "",
      customerName: row.CUSTOMER_NAME || "",
      customerNumber: row.CUSTOMER_NUMBER || "",
      customerType: row.CUSTOMER_TYPE || "",
      customerStatus: row.CUSTOMER_STATUS || "",
      salesRep: row.SALES_REP || "",
      defaultInvoiceEmailAddress: row.DEFAULT_INVOICE_EMAIL_ADDRESS || "",
      createdDate: row.CREATED_DATE || "",
    };
  });
}

function parseNotificationRecipients(value: string) {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
    )
  );
}

function projectWorkspacePath(projectId: string) {
  return `/p/${projectId}`;
}

function buildProjectNotificationLink(projectId: string) {
  return `${APP_BASE_URL}${projectWorkspacePath(projectId)}`;
}

function formatNotificationTimestamp(value: string) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "America/New_York",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function buildProjectNotificationMessage(args: {
  eventType: NotificationEventType;
  project: ProjectItem;
  actorName: string;
  occurredAt: string;
  detail: Record<string, unknown>;
}) {
  const { eventType, project, actorName, occurredAt, detail } = args;
  const metaLines = [
    `Customer: ${project.customerName}`,
    `Project: ${project.title}`,
    `Venue: ${project.venueName}`,
    `Updated by: ${actorName}`,
    `When: ${formatNotificationTimestamp(occurredAt)}`,
  ];
  const base = {
    ctaLabel: "Open project",
    ctaUrl: buildProjectNotificationLink(project.id),
    metaLines,
    accentColor: "#3b66f5",
  };

  switch (eventType) {
    case "artwork_uploaded":
      return {
        ...base,
        subject: `${project.title}: artwork uploaded`,
        headline: "New artwork was uploaded",
        summary: `${actorName} uploaded ${String(detail.filename || "new artwork")} for ${project.venueName}.`,
        detailLines: [
          `Filename: ${String(detail.filename || "Unknown file")}`,
          `Variant: ${String(detail.mediaVariantKey || "Unknown variant")}`,
        ],
      };
    case "creatives_assigned":
      return {
        ...base,
        subject: `${project.title}: creatives assigned`,
        headline: "A creative was assigned",
        summary: `${actorName} assigned ${String(detail.creativeFilename || "a creative")} to ${String(detail.inventoryLabel || "an inventory item")}.`,
        detailLines: [
          `Location: ${String(detail.inventoryLabel || "Unknown location")}`,
          `Creative: ${String(detail.creativeFilename || "Unknown creative")}`,
        ],
      };
    case "all_inventory_assigned":
      return {
        ...base,
        subject: `${project.title}: all inventory assigned`,
        headline: "All scoped inventory is assigned",
        summary: `${project.title} is fully assigned and ready to move forward.`,
        detailLines: [`Coverage: ${String(detail.assignedCount || 0)}/${String(detail.requiredCount || 0)} assigned`],
        accentColor: "#2a9d67",
      };
    case "order_submitted":
      return {
        ...base,
        subject: `${project.title}: order submitted`,
        headline: "Order submitted to Lift",
        summary: `${project.title} was submitted successfully and now carries Lift order ${String(detail.liftOrderId || "pending")}.`,
        detailLines: [
          `Lift order: ${String(detail.liftOrderId || "Pending")}`,
          `Line groups: ${String(detail.lineCount || 0)}`,
        ],
        accentColor: "#2a9d67",
      };
    case "proofs_ready":
      return {
        ...base,
        subject: `${project.title}: proofs ready`,
        headline: "Proofs are ready for review",
        summary: `Lift has returned proof files for ${project.title}.`,
        detailLines: [`Ready lines: ${String(detail.readyCount || 0)} of ${String(detail.totalCount || 0)}`],
      };
    case "revised_art_uploaded":
      return {
        ...base,
        subject: `${project.title}: revised art uploaded`,
        headline: "Revised artwork was uploaded",
        summary: `${actorName} uploaded revised artwork for proof line ${String(detail.lineNumber || "unknown")}.`,
        detailLines: [
          `Creative: ${String(detail.clientFileName || "Unknown file")}`,
          `Proof line: ${String(detail.lineNumber || "Unknown")}`,
        ],
      };
    case "all_proofs_approved":
      return {
        ...base,
        subject: `${project.title}: all proofs approved`,
        headline: "All proofs are approved",
        summary: `${project.title} has all proofs approved and is one step closer to release.`,
        detailLines: [`Approved lines: ${String(detail.approvedCount || 0)} of ${String(detail.totalCount || 0)}`],
        accentColor: "#2a9d67",
      };
    case "transit_accepted":
      return {
        ...base,
        subject: `${project.title}: transit approved`,
        headline: "Transit approval was accepted",
        summary: `${actorName} approved transit for ${project.title}.`,
        detailLines: detail.comment ? [`Comment: ${String(detail.comment)}`] : [],
        accentColor: "#2a9d67",
      };
    case "transit_rejected":
      return {
        ...base,
        subject: `${project.title}: transit rejected`,
        headline: "Transit approval was rejected",
        summary: `${actorName} rejected transit for ${project.title}.`,
        detailLines: detail.comment ? [`Comment: ${String(detail.comment)}`] : [],
        accentColor: "#c4573f",
      };
    case "production_release_ready":
      return {
        ...base,
        subject: `${project.title}: production release ready`,
        headline: "Production release is ready",
        summary: `${project.title} has cleared proofs and transit approval and is ready for production release.`,
        detailLines: [`Lift order: ${String(project.liftOrderId || "Pending")}`],
        accentColor: "#2a9d67",
      };
    case "workflow_errors":
      return {
        ...base,
        subject: `${project.title}: workflow issue needs attention`,
        headline: "A workflow issue was recorded",
        summary: String(detail.message || "An error needs attention in the Adspace workflow."),
        detailLines: [
          `Surface: ${String(detail.surface || "workflow")}`,
          `Error code: ${String(detail.errorCode || "workflow_error")}`,
          `Severity: ${String(detail.severity || "error")}`,
        ],
        accentColor: "#c4573f",
      };
  }
}

async function queueNotificationDigest(args: {
  customerId: string;
  customerName: string;
  rule: NotificationRule;
  entry: NotificationDigestEntryPayload;
}) {
  const existing = await findNotificationDigest(args.customerId, args.rule.id);
  const now = isoNow();
  const digest: NotificationDigestItem = existing
    ? {
        ...existing,
        customerName: args.customerName,
        recipients: args.rule.recipients,
        ruleLabel: args.rule.label,
        entries: [...existing.entries, args.entry].slice(-25),
        updatedAt: now,
      }
    : {
        entityType: "NotificationDigest",
        id: `${args.customerId}:${args.rule.id}`,
        customerId: args.customerId,
        customerName: args.customerName,
        ruleId: args.rule.id,
        ruleLabel: args.rule.label,
        recipients: args.rule.recipients,
        entries: [args.entry],
        nextSendAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        createdAt: now,
        updatedAt: now,
      };

  await putCore(buildNotificationDigestRecord(digest));
}

async function markProjectNotificationDispatched(projectId: string, eventType: NotificationEventType) {
  const now = isoNow();
  const next: ProjectNotificationDispatchItem = {
    entityType: "ProjectNotificationDispatch",
    id: `${projectId}:${eventType}`,
    projectId,
    eventType,
    createdAt: now,
    updatedAt: now,
  };
  await putCore(buildProjectNotificationDispatchRecord(next));
}

async function dispatchProjectNotificationEvent(args: {
  project: ProjectItem;
  auth: AuthContext;
  eventType: NotificationEventType;
  detail: Record<string, unknown>;
  occurredAt?: string;
  oneTimePerProject?: boolean;
}) {
  const occurredAt = args.occurredAt || isoNow();
  if (args.oneTimePerProject) {
    const existingDispatch = await findProjectNotificationDispatch(args.project.id, args.eventType);
    if (existingDispatch) return;
  }

  const appSettings = hydrateAppSettings(await findAppSettings(), args.auth.actorName);
  const customerSettings = hydrateCustomerSettings(
    await findCustomerSettings(args.project.customerId),
    args.project.customerId,
    args.auth.actorName,
    appSettings
  );
  const matchingRules = customerSettings.notifications.rules.filter(
    (rule) =>
      rule.isActive &&
      rule.eventTypes.includes(args.eventType) &&
      parseNotificationRecipients(rule.recipients).length > 0
  );
  if (matchingRules.length === 0) return;

  const message = buildProjectNotificationMessage({
    eventType: args.eventType,
    project: args.project,
    actorName: args.auth.actorName,
    occurredAt,
    detail: args.detail,
  });
  const rendered = renderNotificationMessage(message);
  let handled = false;

  for (const rule of matchingRules) {
    try {
      if (rule.deliveryMode === "digest") {
        await queueNotificationDigest({
          customerId: args.project.customerId,
          customerName: args.project.customerName,
          rule,
          entry: {
            eventType: args.eventType,
            subject: message.subject,
            headline: message.headline,
            summary: message.summary,
            detailLines: message.detailLines,
            projectTitle: args.project.title,
            venueName: args.project.venueName,
            actorName: args.auth.actorName,
            occurredAt,
            ctaUrl: message.ctaUrl,
          },
        });
      } else {
        await sendNotificationEmail({
          sender: NOTIFICATIONS_FROM_EMAIL,
          recipients: parseNotificationRecipients(rule.recipients),
          subject: message.subject,
          html: rendered.html,
          text: rendered.text,
        });
      }
      handled = true;
    } catch (error) {
      console.warn("Failed to dispatch project notification", {
        projectId: args.project.id,
        eventType: args.eventType,
        ruleId: rule.id,
        error,
      });
      if (args.eventType !== "workflow_errors") {
        await writeAudit(`PROJECT#${args.project.id}`, "workflow.error", args.auth, {
          severity: "warning",
          errorCode: "notification_delivery_failed",
          message: `A notification email could not be delivered for ${args.eventType}.`,
          surface: "notifications",
          metadata: {
            ruleId: rule.id,
            reason: error instanceof Error ? error.message : "Unknown notification error",
          },
        });
      }
    }
  }

  if (handled && args.oneTimePerProject) {
    await markProjectNotificationDispatched(args.project.id, args.eventType);
  }
}

async function recordWorkflowError(
  projectId: string,
  auth: AuthContext,
  detail: {
    severity?: "info" | "warning" | "error";
    errorCode: string;
    message: string;
    surface: string;
    actionType?: string;
    metadata?: Record<string, unknown>;
  }
) {
  await writeAudit(projectId, "workflow.error", auth, {
    severity: detail.severity || "error",
    errorCode: detail.errorCode,
    message: detail.message,
    surface: detail.surface,
    actionType: detail.actionType,
    metadata: detail.metadata,
  });

  const normalizedProjectId = projectId.replace(/^PROJECT#/, "");
  const project = await findProjectById(normalizedProjectId);
  if (!project) return;
  await dispatchProjectNotificationEvent({
    project,
    auth,
    eventType: "workflow_errors",
    detail,
  });
}

async function signCustomerLogoUrl(customer: CustomerItem | null | undefined) {
  if (!customer?.logoObjectKey) return null;
  const bucket = customer.logoBucketName || VENUE_ASSETS_BUCKET_NAME;
  if (!bucket) return null;
  return signBucketReadUrl(bucket, customer.logoObjectKey);
}

async function seedProofLinesForSubmittedProject(projectId: string, proofLines: ProjectProofLineItem[], actorName: string) {
  const existing = await listProjectProofLines(projectId);
  if (existing.length > 0) return;

  for (const proofLine of proofLines.map((line) => ({
    ...line,
    projectId,
    updatedByName: actorName,
  }))) {
    await putCore(buildProjectProofLineRecord(proofLine));
  }
}

function makeId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function makeExternalId() {
  return `Z${Math.floor(Math.random() * 100000000)
    .toString()
    .padStart(8, "0")}`;
}

function makeLiftOrderId() {
  return `A${Math.floor(Math.random() * 100000000)
    .toString()
    .padStart(8, "0")}`;
}

function isoNow() {
  return new Date().toISOString();
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env ${name}`);
  return value;
}

class HttpError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

function json(statusCode: number, body: Record<string, unknown>) {
  return {
    statusCode,
    headers: corsHeaders(),
    body: JSON.stringify(body),
  };
}

function ok(body: Record<string, unknown>) {
  return json(200, body);
}

function created(body: Record<string, unknown>) {
  return json(201, body);
}

function noContent() {
  return {
    statusCode: 204,
    headers: corsHeaders(),
    body: "",
  };
}

function corsHeaders() {
  const routeKey = responsePerfContext?.routeKey || "";
  const routeMs = responsePerfContext ? String(Date.now() - responsePerfContext.startedAt) : "";
  return {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization,content-type,x-share-token,x-share-participant-id",
    "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
    "x-adspace-route-key": routeKey,
    "x-adspace-route-ms": routeMs,
    "access-control-expose-headers": "x-adspace-route-key,x-adspace-route-ms",
  };
}
