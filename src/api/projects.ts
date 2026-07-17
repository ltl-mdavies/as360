import { buildDocumentThumbUrl } from "../logic/imageUrls";
import type { CreativeAsset, InventoryItem, MapLayer, MediaVariant } from "../logic/mockAssignment";

export type ApiClientLike = {
  request<T>(path: string, options?: Omit<RequestInit, "headers"> & { headers?: HeadersInit }): Promise<T>;
};

export type ApiProjectWorkspaceResponse = {
  project: {
    id: string;
    projectMode?: "live" | "internal_sandbox";
    customerId: string;
    customerName: string;
    customerLogoUrl?: string | null;
    sourceCustomerId?: string | null;
    sourceCustomerName?: string | null;
    marketId: string;
    marketName: string;
    venueId: string;
    venueName: string;
    documentSourceMode?: "adspace" | "external" | "hybrid";
    documentLibraryUrl?: string;
    photoGalleryUrl?: string;
    venueDocumentUrl?: string;
    venueVideoUrl?: string;
    title: string;
    poNumber?: string;
    adspaceOrderNumber?: string;
    extId: string;
    liftOrderId?: string | null;
    liftOrderUrl?: string | null;
    liftOrderLookupSource?: "create_order" | "fallback_lookup" | "manual_override" | null;
    liftOrderOverriddenAt?: string | null;
    liftOrderOverriddenByName?: string | null;
    liftOrderOverrideNote?: string | null;
    orderSubmittedAt?: string | null;
    orderSubmittedByName?: string | null;
    orderSubmissionNote?: string | null;
    orderLifecycleStatus?: "active" | "on_hold" | "cancelled";
    orderLifecycleReason?: string | null;
    orderLifecycleNote?: string | null;
    orderLifecycleUpdatedAt?: string | null;
    orderLifecycleUpdatedByName?: string | null;
    productionReleasedAt?: string | null;
    productionReleasedByName?: string | null;
    productionReleaseNote?: string | null;
    artworkDueDate?: string;
    postDate?: string;
    endClientName?: string;
    contractNumber?: string;
    createdAt: string;
    updatedAt: string;
    assignment?: {
      required: number;
      assigned: number;
      complete: boolean;
    };
    proofs?: {
      total: number;
      approved: number;
      pending: number;
      revised: number;
      waitingForProof: number;
    };
    transit?: {
      enabled: boolean;
      status: "not_required" | "not_started" | "pending" | "approved" | "rejected" | "changes_requested";
    };
    production?: {
      policy: "direct" | "hold_for_release";
      ready: boolean;
      awaitingRelease: boolean;
      released: boolean;
    };
    liftSync?: {
      phase:
        | "not_submitted"
        | "waiting_for_proof"
        | "proof_review"
        | "proof_approved"
        | "in_production"
        | "completed"
        | "cancelled"
        | "missing"
        | "unknown";
      label: string;
      minLineStepNumber?: number | null;
      maxLineStepNumber?: number | null;
      proofActionable: boolean;
      productionReference: boolean;
      completed: boolean;
      orderStatusRaw?: string | null;
      orderStatusNormalized?: "active" | "cancelled" | "missing" | "unknown" | null;
      healthStatus?: "ok" | "cancelled" | "missing" | "sync_failed" | "unknown" | null;
      healthMessage?: string | null;
      lastOrderSyncAt?: string | null;
    };
    needsAttention?: boolean;
  };
  scope: {
    includedIds: string[];
    sourceType?: "full_venue" | "venue_preset" | "manual";
    presetId?: string | null;
    presetName?: string | null;
    appliedAt?: string | null;
  };
  workspace: {
    maps: Array<{
      id: string;
      name: string;
      assigned: number;
      total: number;
      imageUrl: string;
    }>;
    variants: Array<{
      key: string;
      mediaName: string;
      w: number;
      h: number;
      shortLabel?: string;
      color?: string;
      label?: string;
      unitNumber?: string;
    }>;
    inventory: Array<{
      id: string;
      recordId?: string;
      locationName?: string;
      mapId: string;
      mediaVariantKey: string;
      mediaType?: string | null;
      unitNumber?: string;
      trimHeight?: number | null;
      trimWidth?: number | null;
      safeHeight?: number | null;
      safeWidth?: number | null;
      notes?: string;
      x: number;
      y: number;
      assignedCreativeId?: string | null;
      assignmentUpdatedAt?: string | null;
    }>;
    creatives: Array<{
      id: string;
      filename: string;
      fileMeta: string;
      mediaVariantKey: string;
      color: string;
      contentType?: string | null;
      createdAt?: string;
      thumbUrl?: string | null;
      fullUrl?: string | null;
      assignedInventoryIds?: string[];
    }>;
  };
};

export type ApiProjectHubBootstrapResponse = ApiProjectWorkspaceResponse & {
  viewer: {
    isPlatformAdmin: boolean;
    role: "platform_admin" | "customer_admin" | "vendor_admin" | "vendor_user";
    customerIds: string[];
  };
  transit: ApiProjectTransitResponse;
  events: ApiProjectAuditEvent[];
};

export type ApiSignedUploadResponse = {
  bucket: string;
  key: string;
  assetKind: string;
  retentionClass: string;
  uploadUrl: string;
  expiresInSeconds: number;
};

export type ProjectAssetKind =
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

export type ApiProjectProofLineResponse = {
  lineItemId: string;
  lineNumber: number;
  lineStepNumber?: number | null;
  liftOrderLineId?: number | null;
  liftLineSnapshot?: ApiLiftLineSnapshot | null;
  liftProofingId?: number | null;
  mediaVariantKey: string;
  mediaVariantLabel?: string;
  liftProductId?: number | null;
  liftProductName?: string | null;
  productionRoute?: "primary_print_vendor" | "external_vendor";
  vendorAccountId?: string | null;
  vendorName?: string | null;
  routeLabel?: string | null;
  integrationMode?: "lift" | "adspace";
  mediaName: string;
  w: number;
  h: number;
  unitNumber?: string | null;
  quantity?: number | null;
  assignedLocations?: string[];
  locations: string[];
  clientCreativeId: string;
  clientFileName: string;
  clientThumbUrl?: string | null;
  clientFullUrl?: string | null;
  proofThumbUrl?: string | null;
  proofFullUrl?: string | null;
  liftProofStatus?: string | null;
  proofApprovedBy?: string | null;
  proofApprovedDate?: string | null;
  technicalReports?: ApiProjectProofTechnicalReport[];
  status: "waiting" | "pending" | "approved";
  revised: boolean;
  printTeamFeedback?: string | null;
  proofComments?: ApiProjectProofComment[];
  proofCommentCount?: number;
  proofCommentAttachmentCount?: number;
  latestProofCommentAt?: string | null;
  proofVersions?: ApiProjectProofVersion[];
  vendorProofSubmittedAt?: string | null;
  vendorProofSubmittedByName?: string | null;
  vendorProofSubmittedByVendorAccountId?: string | null;
  vendorProofFilename?: string | null;
  vendorProofContentType?: string | null;
  vendorProofSizeBytes?: number | null;
  vendorProofNote?: string | null;
  updatedAt?: string;
  updatedByName?: string | null;
};

export type ApiLiftOrderSnapshot = {
  orderNumber?: string | null;
  customerId?: number | null;
  orderTitle?: string | null;
  poNumber?: string | number | null;
  customerName?: string | null;
  creationDate?: string | null;
  createdBy?: string | null;
  orderTypeName?: string | null;
  orderStatus?: string | null;
  orderStepId?: number | null;
  headerStepNumber?: number | null;
};

export type ApiLiftLineSnapshot = {
  lineNumber?: number | null;
  orderLineId?: number | null;
  quantity?: number | null;
  productName?: string | null;
  unitNumber?: string | null;
  material?: string | null;
  lineStepId?: number | null;
  lineStepNumber?: number | null;
  printHeightIn?: number | null;
  printWidthIn?: number | null;
};

export type ApiLiftShippingSnapshot = {
  orderNumber?: string | null;
  orderLineId?: number | null;
  trackingNumber?: string | null;
  trackerMessage?: string | null;
  trackerShortMessage?: string | null;
  shipMethod?: string | null;
  locationName?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  addressLine3?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | number | null;
  actualShipDate?: string | null;
};

export type ApiProjectProofTechnicalReport = {
  reportId?: number | null;
  definitionId?: number | null;
  definitionLabel?: string | null;
  reportUrl?: string | null;
};

export type ApiProjectProofCommentAttachment = {
  url: string;
  createdAt?: string | null;
  filename?: string | null;
};

export type ApiProjectProofComment = {
  id: string;
  body: string;
  createdAt?: string | null;
  attachments: ApiProjectProofCommentAttachment[];
};

export type ApiProjectProofVersion = {
  attachmentId?: number | null;
  orderLineId?: number | null;
  proofFilename?: string | null;
  proofThumbUrl?: string | null;
  proofFullUrl?: string | null;
  status?: string | null;
  proofApprovedBy?: string | null;
  proofApprovedDate?: string | null;
  technicalReports?: ApiProjectProofTechnicalReport[];
  createdAt?: string | null;
  replacedAt?: string | null;
  current?: boolean;
  comments: ApiProjectProofComment[];
};

export type ApiProjectProofsResponse = {
  proofs: ApiProjectProofLineResponse[];
  sync?: {
    attempted: boolean;
    ok: boolean;
    message?: string | null;
    syncedAt?: string | null;
    lastLiftProofSyncAt?: string | null;
    lastLiftProofChangeAt?: string | null;
    autoRefreshEligible?: boolean;
    autoRefreshRecommended?: boolean;
    autoRefreshPausedReason?: string | null;
  };
};

export type ApiRealtimeConfigResponse = {
  websocketUrl: string;
};

export type ApiAllocationOverrideInventoryItem = ApiProjectWorkspaceResponse["workspace"]["inventory"][number] & {
  isActive?: boolean;
  isInScope?: boolean;
};

export type ApiAllocationOverrideRow = {
  id: string;
  projectId: string;
  sourceType: "proof" | "creative" | "manual";
  sourceProofLineId?: string | null;
  sourceCreativeId?: string | null;
  sourceLineNumber?: number | null;
  sourceLiftOrderLineId?: number | null;
  sourceLiftProofingId?: number | null;
  productLabel: string;
  dimensionsLabel: string;
  quantity: number;
  mediaVariantKey: string;
  mediaVariantLabel?: string;
  assignedInventoryIds: string[];
  hidden: boolean;
  hiddenAt?: string | null;
  hiddenByName?: string | null;
  liftSyncStatus: "not_supported" | "pending" | "synced" | "failed";
  adminNote?: string | null;
  createdAt: string;
  createdByName: string;
  updatedAt: string;
  updatedByName: string;
  asset: {
    filename: string;
    thumbUrl?: string | null;
    fullUrl?: string | null;
    source: "override" | "proof" | "creative" | "manual";
    contentType?: string | null;
  };
};

export type ApiAllocationOverrideResponse = {
  project: ApiProjectWorkspaceResponse["project"];
  scope: ApiProjectWorkspaceResponse["scope"];
  workspace: Omit<ApiProjectWorkspaceResponse["workspace"], "inventory"> & {
    inventory: ApiAllocationOverrideInventoryItem[];
  };
  proofLines: ApiProjectProofLineResponse[];
  override: {
    rows: ApiAllocationOverrideRow[];
    activeCount: number;
    hiddenCount: number;
    liftSync: {
      status: "not_supported" | "pending" | "synced" | "failed";
      message?: string | null;
    };
  };
};

export type AllocationOverrideAssetInput = {
  bucketName: string;
  objectKey: string;
  thumbObjectKey?: string | null;
  filename: string;
  contentType?: string | null;
  thumbContentType?: string | null;
  sizeBytes?: number | null;
};

export type AllocationOverrideRowInput = {
  sourceType?: "proof" | "creative" | "manual";
  sourceProofLineId?: string | null;
  sourceCreativeId?: string | null;
  sourceLineNumber?: number | null;
  sourceLiftOrderLineId?: number | null;
  sourceLiftProofingId?: number | null;
  productLabel?: string;
  dimensionsLabel?: string;
  quantity?: number;
  mediaVariantKey?: string;
  assignedInventoryIds?: string[];
  overrideAsset?: AllocationOverrideAssetInput | null;
  adminNote?: string | null;
  hidden?: boolean;
};

export type ApiProjectTransitResponse = {
  projectId: string;
  enabled: boolean;
  status: "not_started" | "pending" | "approved" | "rejected";
  submittedByName?: string | null;
  submittedDate?: string | null;
  comment?: string | null;
  submittedAt?: string | null;
  updatedAt?: string | null;
};

export type ApiProjectShareLink = {
  id: string;
  projectId: string;
  label: string;
  accessType: "collaboration" | "artwork_upload" | "transit_approval" | "view_only";
  status: "active" | "revoked";
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string | null;
  shortCode?: string | null;
  shortUrl?: string | null;
  participantCount: number;
  actionCount: number;
  lastActivityAt?: string | null;
  recentActivity: Array<{
    eventType: string;
    createdAt: string;
    actorName: string;
    actorType: string;
    shareLinkId?: string | null;
    detail?: Record<string, unknown>;
  }>;
};

export type ApiShareParticipant = {
  id: string;
  shareLinkId: string;
  displayName: string;
  email: string;
  firstSeenAt: string;
  lastSeenAt: string;
};

export type ApiProjectAuditEvent = {
  eventType: string;
  createdAt: string;
  actorType: string;
  actorId: string;
  actorName: string;
  shareLinkId?: string | null;
  detail?: Record<string, unknown>;
};

export type ApiProjectDocument = {
  id: string;
  projectId: string;
  vendorOrderId?: string | null;
  vendorAccountId?: string | null;
  category: "project_document" | "lift_payload" | "allocation_report" | "order_package" | "reconciliation";
  assetKind: "projectDocument" | "liftPayload" | "allocationReport" | "orderPackage" | "reconciliation";
  filename: string;
  contentType?: string | null;
  thumbContentType?: string | null;
  sizeBytes?: number | null;
  source: "uploaded" | "generated";
  uploadedByName: string;
  createdAt: string;
  updatedAt: string;
  thumbUrl?: string | null;
  fullUrl: string;
};

export type ApiLiftPayloadPreviewLine = {
  lineNumber: number;
  mediaVariantLabel: string;
  filename: string;
  productIdentifier?: string;
  productId?: number | null;
  unitNumber: string;
  quantity: number;
  assignedLocations: string[];
  trimHeight: string;
  trimWidth: string;
  safeHeight: string;
  safeWidth: string;
};

export type ApiLiftPayloadPreview = {
  productIdentifierMode?: "unit_number" | "product_id";
  payload: {
    ext_id: string;
    po_number: string;
    contract_no?: string;
    customer_id: string;
    order_title: string;
    order_note?: string;
    product_data: Array<Array<{
      productSku: string;
      product_id?: number;
      unit_number?: string;
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
    }>>;
  };
  validation: {
    ok: boolean;
    errors: string[];
    warnings: string[];
  };
  completeness: {
    required: number;
    assigned: number;
    remaining: number;
  };
  lines: ApiLiftPayloadPreviewLine[];
  snapshotDocument?: ApiProjectDocument | null;
};

export type ApiAdminSettings = {
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
    productionApprovalMode: "direct" | "hold_for_release";
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
      activeEnvironment: "prod" | "qa1";
      productIdentifierMode: "unit_number" | "product_id";
      environments: {
        prod: ApiLiftEnvironmentConfig;
        qa1: ApiLiftEnvironmentConfig;
      };
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

export type ApiLiftEnvironmentConfig = {
  baseUrl: string;
  orderEndpointUrl: string;
  fallbackOrderLookupUrl: string;
  orderUrlResolverUrl: string;
  customerContactListUrl: string;
  productManagementUrl: string;
  proofEndpointUrlTemplate: string;
  flushSyncUrl: string;
  shippingReportUrl: string;
  proofUrlResolverUrl: string;
};

export type ApiLiftProduct = {
  productId: number | null;
  productName: string;
  catalogId: number | null;
  catalogName: string;
  unitNumbers: string[];
  status: string;
  productType: string;
  parentProductId: number | null;
  accountingItemCode: string;
  productDescription: string;
  additionalFields: Record<string, string | number | boolean | null>;
  components: ApiLiftProduct[];
};

export type ApiLiftProductLookupResponse = {
  products: ApiLiftProduct[];
  catalogs: Array<{ catalogId: number | null; catalogName: string }>;
  query: Record<string, string>;
  activeEnvironment: "prod" | "qa1";
  durationMs: number;
  urlHost: string | null;
  hasMore: boolean;
};

export type NotificationEventType =
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

export type NotificationRule = {
  id: string;
  label: string;
  eventTypes: NotificationEventType[];
  recipients: string;
  deliveryMode: "instant" | "digest";
  isActive: boolean;
};

export type CustomerStatus = "active" | "suspended" | "inactive";

export type ApiLiftCustomerContact = {
  customerId: string;
  customerName: string;
  customerNumber: string;
  customerType: string;
  customerStatus: string;
  salesRep: string;
  defaultInvoiceEmailAddress: string;
  createdDate: string;
};

export type ApiCustomerSettings = {
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
  workflowPolicies: {
    productionApprovalMode: "direct" | "hold_for_release";
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

export type ApiCustomerVendor = {
  id: string;
  customerId: string;
  vendorAccountId?: string;
  name: string;
  contactName: string;
  email: string;
  phone: string;
  notes: string;
  isActive: boolean;
  updatedAt: string;
  updatedByName: string;
};

export type ApiShippingDestination = {
  configured: boolean;
  source: "venue_override" | "market_default" | "not_configured";
  sourceLabel: string;
  label?: string;
  company?: string;
  attention?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
  phone?: string;
  email?: string;
  instructions?: string;
};

export type ApiCustomerAccount = {
  id: string;
  name: string;
  status: CustomerStatus;
  isActive: boolean;
  isInternalSandbox?: boolean;
  liftCustomerId?: string;
  logoUrl?: string | null;
  marketCount: number;
  venueCount: number;
  projectCount: number;
  updatedAt: string;
};

export type ApiAdminSettingsResponse = {
  settings: ApiAdminSettings;
  viewer: {
    isPlatformAdmin: boolean;
    role: "platform_admin" | "customer_admin";
    customerIds: string[];
  };
  users: Array<{
    id: string;
    displayName: string;
    email: string;
    role: "platform_admin" | "customer_admin" | "vendor_admin" | "vendor_user";
    customerIds: string[];
    vendorAccountIds?: string[];
    isActive: boolean;
    updatedAt: string;
  }>;
  customers: Array<{
    id: string;
    name: string;
    status: CustomerStatus;
    isActive: boolean;
    isInternalSandbox?: boolean;
    liftCustomerId?: string;
    logoUrl?: string | null;
  }>;
};

export type ApiAdminBrandingResponse = {
  viewer: {
    isPlatformAdmin: boolean;
    role: "platform_admin" | "customer_admin" | "vendor_admin" | "vendor_user";
    customerIds: string[];
    vendorAccountIds?: string[];
    displayName?: string | null;
    email?: string | null;
  };
  brand: {
    name: string;
    logoUrl?: string | null;
    alt: string;
    companyName: string;
  };
};

export type ApiAdminUser = ApiAdminSettingsResponse["users"][number];

export type ApiCustomerSettingsResponse = {
  customer: {
    id: string;
    name: string;
    status: CustomerStatus;
    isActive: boolean;
    isInternalSandbox?: boolean;
    liftCustomerId?: string;
    logoUrl?: string | null;
  };
  viewer: {
    isPlatformAdmin: boolean;
    role: "platform_admin" | "customer_admin" | "vendor_admin" | "vendor_user";
    customerIds: string[];
  };
  settings: ApiCustomerSettings;
  users: ApiAdminSettingsResponse["users"];
  vendors: ApiCustomerVendor[];
};

export type ApiNotificationPreviewResponse = {
  customer: {
    id: string;
    name: string;
  };
  eventType: NotificationEventType;
  sent: boolean;
  sentCount: number;
  defaultTestRecipient?: string | null;
  projectSample: {
    id?: string | null;
    title: string;
    venueName: string;
    source: "existing" | "synthetic";
    projectMode: "live" | "internal_sandbox";
  };
  previews: Array<{
    ruleId: string;
    ruleLabel: string;
    deliveryMode: "instant" | "digest";
    configuredRecipients: string[];
    effectiveRecipients: string[];
    subject: string;
    html: string;
    text: string;
  }>;
};

export type ApiRecentWorkflowIssue = {
  projectId: string;
  projectTitle: string;
  projectMode: "live" | "internal_sandbox";
  customerId: string;
  customerName: string;
  sourceCustomerName?: string | null;
  venueName: string;
  createdAt: string;
  actorName: string;
  severity: "info" | "warning" | "error";
  errorCode: string;
  message: string;
  surface: string;
  metadata?: Record<string, unknown>;
  isDrill?: boolean;
};

export type ApiAdminHealthStatus = "good" | "watch" | "degraded" | "blocked";
export type ApiAdminHealthSeverity = "info" | "warning" | "error" | "blocked";
export type ApiAdminHealthIncidentStatus = "active" | "acknowledged" | "resolved" | "suppressed";
export type ApiAdminHealthIncidentActionHistoryItem = {
  action: string;
  actorName: string;
  at: string;
  reason?: string;
  note?: string;
  verificationStatus?: "cleared" | "active" | "not_checked";
};
export type ApiAdminHealthRunbookSafety = "read_only" | "guarded_write" | "external_review";
export type ApiAdminHealthSystemId =
  | "app_api"
  | "aws_foundation"
  | "lift"
  | "customer_access"
  | "customer_data"
  | "proof_ops"
  | "vendor_ops"
  | "notifications"
  | "realtime";

export type ApiAdminHealthIssue = {
  id: string;
  systemId: ApiAdminHealthSystemId;
  severity: ApiAdminHealthSeverity;
  title: string;
  message: string;
  scope?: {
    customerId?: string;
    customerName?: string;
    projectId?: string;
    projectTitle?: string;
    orderName?: string;
    orderNumber?: string;
    liftOrderId?: string;
    vendorAccountId?: string;
    vendorName?: string;
    orderId?: string;
    lineNumber?: number;
    filename?: string;
  };
  detectedAt: string;
  source: string;
  recommendedAction: string;
  runbookActionId?: string;
  dependency?: {
    issueId: string;
    title: string;
    message: string;
  };
  incident?: {
    id: string;
    fingerprint: string;
    status: ApiAdminHealthIncidentStatus;
    firstSeenAt: string;
    lastSeenAt: string;
    lastCheckedAt: string;
    occurrenceCount: number;
    acknowledgedBy?: string;
    acknowledgedAt?: string;
    resolvedAt?: string;
    suppressedUntil?: string;
    lastOperatorAction?: string;
    lastOperatorActionAt?: string;
    lastOperatorName?: string;
    lastOperatorReason?: string;
    lastOperatorNote?: string;
    lastVerificationStatus?: "cleared" | "active" | "not_checked";
    actionHistory?: ApiAdminHealthIncidentActionHistoryItem[];
  };
  incidentPacket: {
    systemId: ApiAdminHealthSystemId;
    severity: ApiAdminHealthSeverity;
    evidence: Record<string, unknown>;
    relatedEvents: string[];
    allowedRunbookIds: string[];
  };
};

export type ApiAdminHealthRunbook = {
  id: string;
  systemId: ApiAdminHealthSystemId;
  label: string;
  safety: ApiAdminHealthRunbookSafety;
  summary: string;
  operatorSteps: string[];
  actionLabel?: string;
  appPath?: string;
  evidenceHints: string[];
};

export type ApiAdminHealthIncident = {
  id: string;
  fingerprint: string;
  systemId: ApiAdminHealthSystemId;
  severity: ApiAdminHealthSeverity;
  status: ApiAdminHealthIncidentStatus;
  title: string;
  message: string;
  source: string;
  scope?: ApiAdminHealthIssue["scope"];
  firstSeenAt: string;
  lastSeenAt: string;
  lastCheckedAt: string;
  occurrenceCount: number;
  acknowledgedBy?: string;
  acknowledgedAt?: string;
  resolvedAt?: string;
  suppressedUntil?: string;
  lastOperatorAction?: string;
  lastOperatorActionAt?: string;
  lastOperatorName?: string;
  lastOperatorReason?: string;
  lastOperatorNote?: string;
  lastVerificationStatus?: "cleared" | "active" | "not_checked";
  actionHistory?: ApiAdminHealthIncidentActionHistoryItem[];
};

export type ApiAdminHealthSystem = {
  id: ApiAdminHealthSystemId;
  label: string;
  status: ApiAdminHealthStatus;
  lastCheckedAt: string;
  issueCount: number;
  summary: string;
  details: Record<string, unknown>;
};

export type ApiAdminHealthSnapshot = {
  overallStatus: ApiAdminHealthStatus;
  checkedAt: string;
  systems: ApiAdminHealthSystem[];
  issues: ApiAdminHealthIssue[];
  runbooks?: ApiAdminHealthRunbook[];
  recentIncidents: ApiAdminHealthIncident[];
  incidentSummary: {
    active: number;
    acknowledged: number;
    suppressed: number;
    resolvedRecently: number;
    newIncidents: number;
    recurring: number;
  };
  summaryCounts: {
    systemsGood: number;
    systemsWatch: number;
    systemsDegraded: number;
    systemsBlocked: number;
    activeIssues: number;
    warnings: number;
    errors: number;
    blocked: number;
  };
  nextRecommendedChecks: string[];
};

export type ApiLiftSmokeEndpointResult = {
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

export type ApiLiftReadinessSmokeResponse = {
  orderNumber: string;
  activeEnvironment: "prod" | "qa1";
  testedAt: string;
  enabled: boolean;
  endpoints: {
    orderSync: ApiLiftSmokeEndpointResult;
    proofReport: ApiLiftSmokeEndpointResult;
    orderUrl: ApiLiftSmokeEndpointResult;
    shippingReport: ApiLiftSmokeEndpointResult;
  };
};

export type ApiErrorDrillResponse = {
  ok: true;
  customer: {
    id: string;
    name: string;
  };
  project: {
    id: string;
    title: string;
    venueName: string;
    projectMode: "live" | "internal_sandbox";
  };
  issue: {
    drillType: string;
    severity: "warning" | "error";
    errorCode: string;
    message: string;
    surface: string;
  };
};

export type ProjectErrorEventPayload = {
  actionType?: string;
  severity?: "info" | "warning" | "error";
  errorCode?: string;
  message: string;
  surface: string;
  workspace?: "hub" | "artwork" | "assignment" | "proofs" | "transit";
  metadata?: Record<string, unknown>;
};

export type CustomerBranding = {
  id: string;
  name: string;
  logoUrl?: string | null;
};

export type ApiVenueInventoryPreset = {
  id: string;
  venueId: string;
  name: string;
  description?: string;
  includedIds: string[];
  rawIncludedIds?: string[];
  status: "active" | "archived";
  isDefault?: boolean;
  readOnly?: boolean;
  createdAt?: string;
  createdByName?: string;
  updatedAt?: string;
  updatedByName?: string;
  validation: {
    activeInventoryCount: number;
    includedActiveCount: number;
    excludedActiveCount: number;
    unavailableIncludedCount: number;
    unavailableIncludedIds: string[];
    newActiveCount: number;
    newActiveInventoryIds: string[];
  };
};

export type ApiVenueDetailResponse = {
  venue: {
    id: string;
    name: string;
    customerId?: string;
    customerName?: string;
    marketId?: string;
    marketName?: string;
  };
  viewer?: {
    isPlatformAdmin: boolean;
    role: "platform_admin" | "customer_admin";
    canEditVenueInventory: boolean;
  };
  maps: Array<{ id: string; name: string; mapUrl?: string | null; imageUrl?: string | null; inventoryCount?: number; unpinnedCount?: number }>;
  variants: Array<Record<string, unknown>>;
  inventory: Array<{
    id: string;
    inventoryId: string;
    locationId: string;
    locationDetail?: string | null;
    mapName?: string | null;
    mediaVariantKey: string;
    mediaType?: string | null;
    unitNumber?: string | null;
    productionRoutingOverride?: "primary" | "external" | null;
    externalVendorIdOverride?: string | null;
    trimHeight?: number | null;
    trimWidth?: number | null;
    safeHeight?: number | null;
    safeWidth?: number | null;
    notes?: string | null;
    x?: number | null;
    y?: number | null;
    isActive?: boolean;
  }>;
  presets?: ApiVenueInventoryPreset[];
};

type CacheEntry<T> = {
  value?: T;
  fetchedAt: number;
  inflight?: Promise<T>;
};

const WORKSPACE_CACHE_TTL_MS = 30_000;
const PROOFS_CACHE_TTL_MS = 15_000;
const ADMIN_SETTINGS_CACHE_TTL_MS = 60_000;

const workspaceCache = new Map<string, CacheEntry<ApiProjectWorkspaceResponse>>();
const proofsCache = new Map<string, CacheEntry<ApiProjectProofsResponse>>();
let adminSettingsCache: CacheEntry<ApiAdminSettingsResponse> | null = null;
let adminBrandingCache: CacheEntry<ApiAdminBrandingResponse> | null = null;

function projectCacheKey(projectId: string, shareMode = false) {
  return `${shareMode ? "share" : "auth"}:${projectId}`;
}

function readFreshCache<T>(entry: CacheEntry<T> | null | undefined, ttlMs: number) {
  if (!entry?.value) return null;
  if (Date.now() - entry.fetchedAt > ttlMs) return null;
  return entry.value;
}

export function peekProjectWorkspaceCache(projectId: string, shareMode = false) {
  return readFreshCache(workspaceCache.get(projectCacheKey(projectId, shareMode)), WORKSPACE_CACHE_TTL_MS);
}

export function peekProjectProofsCache(projectId: string, shareMode = false) {
  return readFreshCache(proofsCache.get(projectCacheKey(projectId, shareMode)), PROOFS_CACHE_TTL_MS);
}

export function peekAdminSettingsCache() {
  return readFreshCache(adminSettingsCache, ADMIN_SETTINGS_CACHE_TTL_MS);
}

export function invalidateProjectWorkspaceCache(projectId: string, shareMode = false) {
  workspaceCache.delete(projectCacheKey(projectId, shareMode));
}

export function invalidateProjectProofsCache(projectId: string, shareMode = false) {
  proofsCache.delete(projectCacheKey(projectId, shareMode));
}

export function invalidateAdminSettingsCache() {
  adminSettingsCache = null;
  adminBrandingCache = null;
}

function projectPath(projectId: string, suffix: string, shareMode = false) {
  return `${shareMode ? "/api/share/projects" : "/api/projects"}/${projectId}${suffix}`;
}

export async function fetchProjectWorkspace(api: ApiClientLike, projectId: string, shareMode = false) {
  const key = projectCacheKey(projectId, shareMode);
  const cached = readFreshCache(workspaceCache.get(key), WORKSPACE_CACHE_TTL_MS);
  if (cached) return cached;

  const inflight = workspaceCache.get(key)?.inflight;
  if (inflight) return inflight;

  const previous = workspaceCache.get(key);
  const request = api
    .request<ApiProjectWorkspaceResponse>(projectPath(projectId, "/workspace", shareMode))
    .then((response) => {
      workspaceCache.set(key, { value: response, fetchedAt: Date.now() });
      return response;
    })
    .catch((error) => {
      if (previous?.value) {
        workspaceCache.set(key, { value: previous.value, fetchedAt: previous.fetchedAt });
      } else {
        workspaceCache.delete(key);
      }
      throw error;
    });

  workspaceCache.set(key, {
    value: previous?.value,
    fetchedAt: previous?.fetchedAt || 0,
    inflight: request,
  });

  return request;
}

export async function fetchRealtimeConfig(api: ApiClientLike, shareMode = false) {
  return api.request<ApiRealtimeConfigResponse>(shareMode ? "/api/share/realtime/config" : "/api/realtime/config");
}

export async function fetchProjectHubBootstrap(api: ApiClientLike, projectId: string) {
  const response = await api.request<ApiProjectHubBootstrapResponse>(`/api/projects/${projectId}?hub=1`);
  workspaceCache.set(projectCacheKey(projectId, false), {
    value: {
      project: response.project,
      scope: response.scope,
      workspace: response.workspace,
    },
    fetchedAt: Date.now(),
  });
  return response;
}

export async function fetchVenueDetail(api: ApiClientLike, venueId: string) {
  return api.request<ApiVenueDetailResponse>(`/api/venues/${venueId}`);
}

export async function fetchVenueInventoryPresets(api: ApiClientLike, venueId: string) {
  const response = await fetchVenueDetail(api, venueId);
  return response.presets || [];
}

export async function fetchLiftProducts(
  api: ApiClientLike,
  filters: {
    catalogId?: string;
    catalogName?: string;
    productId?: string;
    productName?: string;
    accountingItemCode?: string;
    parentProductId?: string;
    productType?: "KIT" | "REGULAR" | "SERVICE" | "";
    status?: "A" | "I";
    fetchSize?: number;
    fetchOffset?: number;
  }
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  return api.request<ApiLiftProductLookupResponse>(`/api/admin/lift/products?${params.toString()}`);
}

export async function createVenueInventoryPreset(
  api: ApiClientLike,
  venueId: string,
  payload: { name: string; description?: string; includedIds: string[] }
) {
  return api.request<{ preset: ApiVenueInventoryPreset }>(`/api/venues/${venueId}/inventory-presets`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateVenueInventoryPreset(
  api: ApiClientLike,
  venueId: string,
  presetId: string,
  payload: { name?: string; description?: string; includedIds?: string[] }
) {
  return api.request<{ preset: ApiVenueInventoryPreset }>(`/api/venues/${venueId}/inventory-presets/${presetId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function archiveVenueInventoryPreset(api: ApiClientLike, venueId: string, presetId: string) {
  return api.request<{ preset: ApiVenueInventoryPreset }>(`/api/venues/${venueId}/inventory-presets/${presetId}`, {
    method: "DELETE",
  });
}

export async function fetchProjectLiftOrderUrl(api: ApiClientLike, projectId: string) {
  return api.request<{ url: string }>(projectPath(projectId, "/lift-order-url", false));
}

export async function fetchProjectAllocationOverride(api: ApiClientLike, projectId: string) {
  return api.request<ApiAllocationOverrideResponse>(`/api/projects/${projectId}?allocationOverride=1`);
}

export async function createProjectAllocationOverrideRow(
  api: ApiClientLike,
  projectId: string,
  payload: AllocationOverrideRowInput
) {
  const response = await api.request<{ row: ApiAllocationOverrideRow }>(`/api/projects/${projectId}`, {
    method: "PATCH",
    body: JSON.stringify({ ...payload, action: "allocation_override_create" }),
  });
  invalidateProjectWorkspaceCache(projectId, false);
  invalidateProjectProofsCache(projectId, false);
  return response;
}

export async function updateProjectAllocationOverrideRow(
  api: ApiClientLike,
  projectId: string,
  rowId: string,
  payload: AllocationOverrideRowInput
) {
  const response = await api.request<{ row: ApiAllocationOverrideRow }>(`/api/projects/${projectId}`, {
    method: "PATCH",
    body: JSON.stringify({ ...payload, action: "allocation_override_update", rowId }),
  });
  invalidateProjectWorkspaceCache(projectId, false);
  invalidateProjectProofsCache(projectId, false);
  return response;
}

export async function removeProjectAllocationOverrideRow(
  api: ApiClientLike,
  projectId: string,
  rowId: string,
  adminNote: string
) {
  const response = await api.request<{ row: ApiAllocationOverrideRow }>(`/api/projects/${projectId}`, {
    method: "PATCH",
    body: JSON.stringify({ action: "allocation_override_remove", rowId, adminNote }),
  });
  invalidateProjectWorkspaceCache(projectId, false);
  invalidateProjectProofsCache(projectId, false);
  return response;
}

export async function requestArtworkUploadUrl(
  api: ApiClientLike,
  args: {
    projectId?: string;
    filename: string;
    contentType?: string;
    customerId?: string;
    venueId?: string;
    assetKind?: ProjectAssetKind;
    shareMode?: boolean;
  }
) {
  return api.request<ApiSignedUploadResponse>(args.shareMode ? "/api/share/uploads/sign" : "/api/uploads/sign", {
    method: "POST",
    body: JSON.stringify({
      assetKind: args.assetKind || "artwork",
      projectId: args.projectId,
      venueId: args.venueId,
      customerId: args.customerId,
      filename: args.filename,
      contentType: args.contentType || "application/octet-stream",
    }),
  });
}

export async function requestCustomerBrandUploadUrl(
  api: ApiClientLike,
  args: {
    customerId: string;
    filename: string;
    contentType?: string;
  }
) {
  return requestArtworkUploadUrl(api, {
    customerId: args.customerId,
    filename: args.filename,
    contentType: args.contentType,
    assetKind: "customerBranding",
  });
}

export async function updateProjectCreativeAsset(
  api: ApiClientLike,
  projectId: string,
  creativeId: string,
  payload: {
    bucketName: string;
    objectKey: string;
    thumbObjectKey?: string;
    filename?: string;
    fileMeta?: string;
    contentType?: string;
    thumbContentType?: string;
    sizeBytes?: number;
  },
  shareMode = false
) {
  const response = await api.request<{ creative: ApiProjectWorkspaceResponse["workspace"]["creatives"][number] }>(
    projectPath(projectId, `/creatives/${creativeId}`, shareMode),
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    }
  );
  invalidateProjectWorkspaceCache(projectId, shareMode);
  return normalizeCreativeAsset(response.creative);
}

export async function createProjectCreativeAsset(
  api: ApiClientLike,
  projectId: string,
  payload: {
    bucketName: string;
    objectKey: string;
    thumbObjectKey?: string;
    filename: string;
    fileMeta: string;
    mediaVariantKey: string;
    color: string;
    contentType?: string;
    thumbContentType?: string;
    sizeBytes?: number;
  },
  shareMode = false
) {
  const response = await api.request<{ creative: ApiProjectWorkspaceResponse["workspace"]["creatives"][number] }>(
    projectPath(projectId, `/creatives`, shareMode),
    {
      method: "POST",
      body: JSON.stringify(payload),
    }
  );
  invalidateProjectWorkspaceCache(projectId, shareMode);
  return normalizeCreativeAsset(response.creative);
}

export async function deleteProjectCreativeAsset(
  api: ApiClientLike,
  projectId: string,
  creativeId: string,
  shareMode = false
) {
  const response = await api.request<{
    deletedCreativeId: string;
    clearedAssignmentIds: string[];
    deletedProofLineIds: string[];
  }>(projectPath(projectId, `/creatives/${creativeId}`, shareMode), {
    method: "DELETE",
  });
  invalidateProjectWorkspaceCache(projectId, shareMode);
  invalidateProjectProofsCache(projectId, shareMode);
  return response;
}

export async function submitProjectOrder(
  api: ApiClientLike,
  projectId: string,
  payload: {
    note?: string;
    payload?: Record<string, unknown>;
  },
  shareMode = false
) {
  const response = await api.request<{
    project: ApiProjectWorkspaceResponse["project"];
    submission: {
      liftOrderId: string;
      submittedAt: string;
      submittedByName: string;
      note?: string | null;
    };
    documents?: ApiProjectDocument[];
  }>(projectPath(projectId, `/submit`, shareMode), {
    method: "POST",
    body: JSON.stringify(payload),
  });
  invalidateProjectWorkspaceCache(projectId, shareMode);
  invalidateProjectProofsCache(projectId, shareMode);
  return response;
}

export async function previewProjectOrderSubmission(
  api: ApiClientLike,
  projectId: string,
  payload: {
    note?: string;
    persistSnapshot?: boolean;
  },
  shareMode = false
) {
  return api.request<{
    project: ApiProjectWorkspaceResponse["project"];
    preview: ApiLiftPayloadPreview;
  }>(projectPath(projectId, "/submit", shareMode), {
    method: "POST",
    body: JSON.stringify({
      ...payload,
      previewOnly: true,
    }),
  });
}

export async function fetchProjectProofs(api: ApiClientLike, projectId: string, shareMode = false, forceRefresh = false) {
  const key = projectCacheKey(projectId, shareMode);
  const cached = readFreshCache(proofsCache.get(key), PROOFS_CACHE_TTL_MS);
  if (!forceRefresh && cached) return cached;

  const inflight = proofsCache.get(key)?.inflight;
  if (!forceRefresh && inflight) return inflight;

  const previous = proofsCache.get(key);
  const request = api
    .request<ApiProjectProofsResponse>(projectPath(projectId, forceRefresh ? "/proofs?refresh=1" : "/proofs", shareMode))
    .then((response) => {
      proofsCache.set(key, { value: response, fetchedAt: Date.now() });
      return response;
    })
    .catch((error) => {
      if (previous?.value) {
        proofsCache.set(key, { value: previous.value, fetchedAt: previous.fetchedAt });
      } else {
        proofsCache.delete(key);
      }
      throw error;
    });

  proofsCache.set(key, {
    value: previous?.value,
    fetchedAt: previous?.fetchedAt || 0,
    inflight: request,
  });

  return request;
}

export async function updateProjectProofLine(
  api: ApiClientLike,
  projectId: string,
  lineItemId: string,
  payload: {
    status?: "waiting" | "pending" | "approved";
    revised?: boolean;
    printTeamFeedback?: string | null;
    proofDecisionComment?: string | null;
    clientFileName?: string | null;
    proofObjectKey?: string | null;
    proofThumbObjectKey?: string | null;
    useClientCreativeAsProof?: boolean;
    expectedUpdatedAt?: string | null;
    clientSessionId?: string | null;
  },
  shareMode = false
) {
  const response = await api.request<{ proof: ApiProjectProofLineResponse }>(projectPath(projectId, `/proofs/${lineItemId}`, shareMode), {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  invalidateProjectProofsCache(projectId, shareMode);
  return response;
}

export async function fetchProjectTransit(api: ApiClientLike, projectId: string, shareMode = false) {
  return api.request<{ transit: ApiProjectTransitResponse }>(projectPath(projectId, "/transit", shareMode));
}

export async function updateProjectTransit(
  api: ApiClientLike,
  projectId: string,
  payload: {
    status?: "not_started" | "pending" | "approved" | "rejected";
    submittedByName?: string | null;
    submittedDate?: string | null;
    comment?: string | null;
    submittedAt?: string | null;
    expectedUpdatedAt?: string | null;
  },
  shareMode = false
) {
  const response = await api.request<{ transit: ApiProjectTransitResponse }>(projectPath(projectId, "/transit", shareMode), {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  invalidateProjectWorkspaceCache(projectId, shareMode);
  return response;
}

export async function updateProjectAssignment(
  api: ApiClientLike,
  projectId: string,
  inventoryRecordId: string,
  creativeId: string | null,
  expectedUpdatedAt?: string | null,
  shareMode = false,
  clientSessionId?: string | null
) {
  const response = await api.request<{
    assignment: {
      id: string;
      projectId: string;
      inventoryId: string;
      inventoryLabel: string;
      creativeId: string | null;
      updatedAt: string;
      updatedByName: string;
    };
  }>(projectPath(projectId, `/assignments/${inventoryRecordId}`, shareMode), {
    method: "PATCH",
    body: JSON.stringify({ creativeId, expectedUpdatedAt: expectedUpdatedAt ?? null, clientSessionId: clientSessionId || null }),
  });
  invalidateProjectWorkspaceCache(projectId, shareMode);
  return response;
}

export async function releaseProjectProduction(
  api: ApiClientLike,
  projectId: string,
  payload?: { note?: string }
) {
  return api.request<{
    project: ApiProjectWorkspaceResponse["project"] & {
      production: {
        policy: "direct" | "hold_for_release";
        ready: boolean;
        awaitingRelease: boolean;
        released: boolean;
      };
    };
    release: {
      releasedAt: string;
      releasedByName: string;
      note?: string | null;
    };
  }>(`/api/projects/${projectId}/release-production`, {
    method: "POST",
    body: JSON.stringify(payload || {}),
  });
}

export async function resolveShareLink(api: ApiClientLike, token: string) {
  return api.request<{
    shareLink: {
      id: string;
      projectId: string;
      label: string;
      customerName?: string;
      customerLogoUrl?: string | null;
      accessType: ApiProjectShareLink["accessType"];
      status: ApiProjectShareLink["status"];
      expiresAt?: string | null;
      shortUrl?: string | null;
    };
  }>(`/api/share-links/resolve?token=${encodeURIComponent(token)}`);
}

export async function identifyShareParticipant(
  api: ApiClientLike,
  payload: { token: string; displayName: string; email: string }
) {
  return api.request<{ participant: ApiShareParticipant }>(`/api/share-links/identify`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function fetchProjectShareLinks(api: ApiClientLike, projectId: string) {
  return api.request<{ shareLinks: ApiProjectShareLink[] }>(`/api/projects/${projectId}/share-links`);
}

export async function createProjectShareLink(
  api: ApiClientLike,
  projectId: string,
  payload: { label: string; accessType: ApiProjectShareLink["accessType"]; expiresAt?: string | null }
) {
  return api.request<{ shareLink: ApiProjectShareLink }>(`/api/projects/${projectId}/share-links`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateProjectShareLink(
  api: ApiClientLike,
  shareLinkId: string,
  payload: { label?: string; status?: ApiProjectShareLink["status"]; regenerate?: boolean }
) {
  return api.request<{ shareLink: ApiProjectShareLink }>(`/api/share-links/${shareLinkId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function fetchProjectActivity(api: ApiClientLike, projectId: string) {
  return api.request<{ events: ApiProjectAuditEvent[] }>(`/api/projects/${projectId}/activity`);
}

export async function fetchProjectDocuments(api: ApiClientLike, projectId: string, shareMode = false) {
  return api.request<{ documents: ApiProjectDocument[] }>(projectPath(projectId, "/documents", shareMode));
}

export async function createProjectDocument(
  api: ApiClientLike,
  projectId: string,
  payload: {
    bucketName: string;
    objectKey: string;
    thumbObjectKey?: string;
    filename: string;
    contentType?: string;
    thumbContentType?: string;
    sizeBytes?: number;
  }
) {
  return api.request<{ document: ApiProjectDocument }>(`/api/projects/${projectId}/documents`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function generateProjectCreativePackage(api: ApiClientLike, projectId: string) {
  return api.request<{
    document: ApiProjectDocument;
    manifestSummary: {
      artworkFileCount: number;
      packagedFileCount: number;
      missingFileCount: number;
      includedInventoryCount: number;
      assignedInventoryCount: number;
      unassignedInventoryCount: number;
      unassignedArtworkCount: number;
    };
  }>(`/api/projects/${projectId}/documents`, {
    method: "POST",
    body: JSON.stringify({ action: "generate_creative_package" }),
  });
}

export async function fetchAdminSettings(api: ApiClientLike) {
  const cached = readFreshCache(adminSettingsCache, ADMIN_SETTINGS_CACHE_TTL_MS);
  if (cached) return cached;

  if (adminSettingsCache?.inflight) return adminSettingsCache.inflight;

  const request = api.request<ApiAdminSettingsResponse>("/api/admin/settings").then((response) => {
    adminSettingsCache = { value: response, fetchedAt: Date.now() };
    return response;
  });

  adminSettingsCache = {
    value: adminSettingsCache?.value,
    fetchedAt: adminSettingsCache?.fetchedAt || 0,
    inflight: request,
  };

  return request;
}

export async function fetchAdminBranding(api: ApiClientLike) {
  const cached = readFreshCache(adminBrandingCache, ADMIN_SETTINGS_CACHE_TTL_MS);
  if (cached) return cached;

  if (adminBrandingCache?.inflight) return adminBrandingCache.inflight;

  const request = api.request<ApiAdminBrandingResponse>("/api/admin/settings?branding=1").then((response) => {
    adminBrandingCache = { value: response, fetchedAt: Date.now() };
    return response;
  });

  adminBrandingCache = {
    value: adminBrandingCache?.value,
    fetchedAt: adminBrandingCache?.fetchedAt || 0,
    inflight: request,
  };

  return request;
}

export async function fetchRecentWorkflowIssues(api: ApiClientLike, limit = 10) {
  return api.request<{ issues: ApiRecentWorkflowIssue[] }>(`/api/admin/settings?recentWorkflowErrors=${encodeURIComponent(String(limit))}`);
}

export async function fetchAdminHealthSnapshot(api: ApiClientLike) {
  return api.request<ApiAdminHealthSnapshot>("/api/admin/health");
}

export async function updateAdminHealthIncident(
  api: ApiClientLike,
  incidentId: string,
  action: "acknowledge" | "resolve" | "suppress" | "reopen",
  options: { note?: string; reason?: string; verificationStatus?: "cleared" | "active" | "not_checked"; hours?: number } = {}
) {
  return api.request<{ incident: ApiAdminHealthIncident }>(`/api/admin/health/incidents/${encodeURIComponent(incidentId)}`, {
    method: "PATCH",
    body: JSON.stringify({ action, ...options }),
  });
}

export async function runLiftReadinessSmokeTest(api: ApiClientLike, orderNumber: string) {
  return api.request<ApiLiftReadinessSmokeResponse>(
    `/api/admin/settings?liftSmokeOrder=${encodeURIComponent(orderNumber)}`
  );
}

export async function fetchCustomers(api: ApiClientLike) {
  return api.request<{ customers: ApiCustomerAccount[] }>("/api/customers");
}

export async function createCustomerAccount(
  api: ApiClientLike,
  payload: {
    id: string;
    name: string;
    liftCustomerId?: string;
    status?: CustomerStatus;
    isActive?: boolean;
  }
) {
  const response = await api.request<{ customer: ApiCustomerAccount }>("/api/customers", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  invalidateAdminSettingsCache();
  return response;
}

export async function updateCustomerAccount(
  api: ApiClientLike,
  customerId: string,
  payload: {
    name?: string;
    liftCustomerId?: string;
    status?: CustomerStatus;
    isActive?: boolean;
    logoBucketName?: string | null;
    logoObjectKey?: string | null;
    logoContentType?: string | null;
  }
) {
  const response = await api.request<{ customer: ApiCustomerAccount }>(`/api/customers/${customerId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  invalidateAdminSettingsCache();
  return response;
}

export async function updateAdminSettings(
  api: ApiClientLike,
  payload: Record<string, unknown>
) {
  const response = await api.request<ApiAdminSettingsResponse>("/api/admin/settings", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  adminSettingsCache = { value: response, fetchedAt: Date.now() };
  return response;
}

export async function previewNotificationTest(
  api: ApiClientLike,
  payload: {
    customerId: string;
    eventType: NotificationEventType;
    recipientsOverride?: string;
  }
) {
  return api.request<ApiNotificationPreviewResponse>("/api/admin/settings", {
    method: "PATCH",
    body: JSON.stringify({
      adminAction: "notification_preview",
      ...payload,
    }),
  });
}

export async function sendNotificationTest(
  api: ApiClientLike,
  payload: {
    customerId: string;
    eventType: NotificationEventType;
    recipientsOverride?: string;
  }
) {
  return api.request<ApiNotificationPreviewResponse>("/api/admin/settings", {
    method: "PATCH",
    body: JSON.stringify({
      adminAction: "notification_test_send",
      ...payload,
    }),
  });
}

export async function runControlledErrorDrill(
  api: ApiClientLike,
  payload: {
    customerId: string;
    projectId?: string;
    drillType: "proof_sync_mismatch" | "missing_proof_url" | "flush_sync_failure" | "notification_delivery_failure";
  }
) {
  return api.request<ApiErrorDrillResponse>("/api/admin/settings", {
    method: "PATCH",
    body: JSON.stringify({
      adminAction: "run_error_drill",
      ...payload,
    }),
  });
}

export async function updateAdminUser(
  api: ApiClientLike,
  payload: {
    userId: string;
    displayName?: string;
    isActive?: boolean;
  }
) {
  return api.request<ApiAdminSettingsResponse>("/api/admin/settings", {
    method: "PATCH",
    body: JSON.stringify({
      userAction: "update_user",
      ...payload,
    }),
  });
}

export async function fetchCustomerSettings(api: ApiClientLike, customerId: string) {
  return api.request<ApiCustomerSettingsResponse>(`/api/admin/settings?customerId=${encodeURIComponent(customerId)}`);
}

export async function fetchLiftCustomerContacts(api: ApiClientLike, search: string) {
  return api.request<{ customers: ApiLiftCustomerContact[] }>(
    `/api/admin/settings?liftCustomerSearch=${encodeURIComponent(search)}`
  );
}

export async function updateCustomerSettings(
  api: ApiClientLike,
  customerId: string,
  payload: Record<string, unknown>
) {
  return api.request<ApiCustomerSettingsResponse>(`/api/admin/settings`, {
    method: "PATCH",
    body: JSON.stringify({
      customerId,
      ...payload,
    }),
  });
}

export async function createCustomerVendor(
  api: ApiClientLike,
  customerId: string,
  payload: {
    name: string;
    contactName?: string;
    email?: string;
    phone?: string;
    notes?: string;
    isActive?: boolean;
  }
) {
  return api.request<{ vendor: ApiCustomerVendor }>(`/api/admin/settings`, {
    method: "PATCH",
    body: JSON.stringify({
      customerId,
      vendorAction: "create_vendor",
      ...payload,
    }),
  });
}

export async function createCustomerVendorUser(
  api: ApiClientLike,
  customerId: string,
  payload: {
    vendorId: string;
    email: string;
    displayName?: string;
    role?: "vendor_admin" | "vendor_user";
    sendInvite?: boolean;
  }
) {
  return api.request<{
    user: ApiAdminUser;
    vendor: {
      id: string;
      customerId: string;
      vendorAccountId: string;
      name: string;
    };
    cognitoUserCreated: boolean;
    temporaryPassword?: string;
  }>(`/api/admin/settings`, {
    method: "PATCH",
    body: JSON.stringify({
      customerId,
      vendorAction: "create_vendor_user",
      ...payload,
    }),
  });
}

export async function updateCustomerVendor(
  api: ApiClientLike,
  customerId: string,
  vendorId: string,
  payload: {
    name?: string;
    contactName?: string;
    email?: string;
    phone?: string;
    notes?: string;
    isActive?: boolean;
  }
) {
  return api.request<{ vendor: ApiCustomerVendor }>(`/api/admin/settings`, {
    method: "PATCH",
    body: JSON.stringify({
      customerId,
      vendorId,
      vendorAction: "update_vendor",
      ...payload,
    }),
  });
}

export async function logProjectErrorEvent(
  api: ApiClientLike,
  projectId: string,
  payload: ProjectErrorEventPayload,
  shareMode = false
) {
  return api.request<{ ok: true }>(projectPath(projectId, "/errors", shareMode), {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export type ApiVendorProductionStatus = "not_started" | "in_production" | "blocked" | "shipped" | "complete";
export type ApiVendorWorkflowStage =
  | "incoming"
  | "needs_proof"
  | "client_review"
  | "client_approved"
  | "production_ready"
  | "in_production"
  | "shipped"
  | "complete"
  | "blocked";

export type ApiVendorWorkflowState = {
  stage: ApiVendorWorkflowStage;
  label: string;
  canSubmitProof?: boolean;
  canGeneratePackage?: boolean;
  canUpdateProduction: boolean;
  canUpdateShipping?: boolean;
  lockReason?: string | null;
};

export type ApiVendorWorkspaceViewer = {
  role: "vendor_admin" | "vendor_user";
  displayName: string;
  email: string;
  accounts: Array<{
    id: string;
    name: string;
    accountType: "primary_print" | "external";
    customerId?: string | null;
    isActive: boolean;
  }>;
};

export type ApiVendorOrderSummary = {
  id: string;
  vendorAccountId: string;
  vendorName: string;
  project: {
    id: string;
    title: string;
    projectMode: "live" | "internal_sandbox";
    customerId: string;
    customerName: string;
    sourceCustomerName?: string | null;
    marketName: string;
    venueName: string;
    adspaceOrderNumber: string;
    liftOrderId?: string | null;
    liftOrderStatus?: string | null;
    liftOrderHealthStatus?: string | null;
    lastLiftOrderSyncAt?: string | null;
    lastLiftProofSyncAt?: string | null;
    liftOrderSnapshot?: ApiLiftOrderSnapshot | null;
    poNumber?: string | null;
    contractNumber?: string | null;
    artworkDueDate?: string | null;
    postDate?: string | null;
    orderSubmittedAt?: string | null;
  };
  summary: {
    lineCount: number;
    inventoryCount: number;
    status: ApiVendorProductionStatus;
    needsAttention: boolean;
    latestActivityAt: string;
    workflow: ApiVendorWorkflowState;
  };
  integrationHealth: {
    route: "primary_print_vendor" | "external_vendor";
    liftOrderId?: string | null;
    liftSync?: ApiProjectWorkspaceResponse["project"]["liftSync"];
    packageScope: "vendor";
    healingAvailableToVendor: boolean;
  };
  shippingDestination: ApiShippingDestination;
};

export type ApiVendorOrderLine = {
  id: string;
  sourceType: "allocation_override" | "proof" | "assignment";
  lineNumber?: number | null;
  proofLineId?: string | null;
  liftOrderLineId?: number | null;
  liftProofingId?: number | null;
  mediaVariantKey: string;
  mediaVariantLabel: string;
  productLabel: string;
  quantity: number;
  inventory: Array<{
    id: string;
    inventoryId: string;
    mapName?: string;
    unitNumber?: string;
  }>;
  creative?: {
    id: string;
    filename: string;
    thumbUrl?: string | null;
    fullUrl?: string | null;
    contentType?: string | null;
    uploadedAt?: string | null;
    uploadedByName?: string | null;
  } | null;
  proof?: {
    status: "waiting" | "pending" | "approved";
    revised?: boolean;
    lineStepNumber?: number | null;
    liftLineSnapshot?: ApiLiftLineSnapshot | null;
    liftProofStatus?: string | null;
    proofSource?: "lift_sync" | "vendor_upload" | "adspace_upload" | null;
    proofApprovedBy?: string | null;
    proofApprovedDate?: string | null;
    thumbUrl?: string | null;
    fullUrl?: string | null;
    printTeamFeedback?: string | null;
    proofComments?: ApiProjectProofComment[];
    proofCommentCount?: number;
    proofCommentAttachmentCount?: number;
    latestProofCommentAt?: string | null;
    proofVersions?: ApiProjectProofVersion[];
    technicalReports?: ApiProjectProofTechnicalReport[];
    vendorSubmittedAt?: string | null;
    vendorSubmittedByName?: string | null;
    vendorAccountId?: string | null;
    vendorFilename?: string | null;
    vendorNote?: string | null;
    sizeBytes?: number | null;
  } | null;
  liftShipping?: ApiLiftShippingSnapshot | null;
  productionStatus: ApiVendorProductionStatus;
  baselineProductionStatus: ApiVendorProductionStatus;
  workflow: ApiVendorWorkflowState & {
    canSubmitProof: boolean;
    canUpdateShipping: boolean;
  };
  vendorReference: string;
  note: string;
  shippingCarrier: string;
  trackingNumber: string;
  shippedAt: string;
  updatedAt: string;
  updatedByName: string;
};

export type ApiVendorOrderDetail = ApiVendorOrderSummary & {
  lines: ApiVendorOrderLine[];
  documents: ApiProjectDocument[];
  activity: ApiProjectAuditEvent[];
};

export type ApiVendorOrdersResponse = {
  vendor: ApiVendorWorkspaceViewer;
  orders: ApiVendorOrderSummary[];
};

export type ApiVendorOrderResponse = {
  vendor: ApiVendorWorkspaceViewer;
  order: ApiVendorOrderDetail;
};

export type VendorLineUpdateInput = {
  productionStatus?: ApiVendorProductionStatus;
  vendorReference?: string;
  note?: string;
  shippingCarrier?: string;
  trackingNumber?: string;
  shippedAt?: string;
};

export type VendorLinesBulkUpdateInput = {
  lineIds: string[];
  update: VendorLineUpdateInput;
};

export async function fetchVendorOrders(api: ApiClientLike) {
  return api.request<ApiVendorOrdersResponse>("/api/vendor/orders");
}

export async function fetchVendorOrder(api: ApiClientLike, vendorOrderId: string, options: { refreshLift?: boolean } = {}) {
  const query = options.refreshLift ? "?refresh=1" : "";
  return api.request<ApiVendorOrderResponse>(`/api/vendor/orders/${encodeURIComponent(vendorOrderId)}${query}`);
}

export async function updateVendorOrder(api: ApiClientLike, vendorOrderId: string, payload: VendorLineUpdateInput) {
  return api.request<ApiVendorOrderResponse>(`/api/vendor/orders/${encodeURIComponent(vendorOrderId)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function updateVendorOrderLine(
  api: ApiClientLike,
  vendorOrderId: string,
  lineId: string,
  payload: VendorLineUpdateInput
) {
  return api.request<ApiVendorOrderResponse>(
    `/api/vendor/orders/${encodeURIComponent(vendorOrderId)}/lines/${encodeURIComponent(lineId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    }
  );
}

export async function updateVendorOrderLines(api: ApiClientLike, vendorOrderId: string, payload: VendorLinesBulkUpdateInput) {
  return api.request<ApiVendorOrderResponse>(`/api/vendor/orders/${encodeURIComponent(vendorOrderId)}/lines`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function submitVendorOrderLineProof(
  api: ApiClientLike,
  vendorOrderId: string,
  lineId: string,
  payload: {
    proofObjectKey: string;
    proofThumbObjectKey?: string;
    filename: string;
    contentType?: string;
    sizeBytes?: number;
    note?: string;
  }
) {
  return api.request<ApiVendorOrderResponse>(
    `/api/vendor/orders/${encodeURIComponent(vendorOrderId)}/lines/${encodeURIComponent(lineId)}/proof`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    }
  );
}

export async function generateVendorOrderPackage(api: ApiClientLike, vendorOrderId: string) {
  return api.request<{ document: ApiProjectDocument; manifestSummary: Record<string, unknown> }>(
    `/api/vendor/orders/${encodeURIComponent(vendorOrderId)}/package`,
    {
      method: "POST",
      body: JSON.stringify({}),
    }
  );
}

export function normalizeCreativeAsset(
  creative: ApiProjectWorkspaceResponse["workspace"]["creatives"][number]
): CreativeAsset {
  const isImage = Boolean(creative.contentType?.startsWith("image/"));
  const fallbackThumb = isImage
    ? creative.fullUrl || ""
    : buildDocumentThumbUrl({ label: creative.contentType === "application/pdf" ? "PDF" : "FILE", accent: creative.color });
  return {
    id: creative.id,
    filename: creative.filename,
    fileMeta: creative.fileMeta,
    mediaVariantKey: creative.mediaVariantKey,
    color: creative.color,
    assignedInventoryIds: creative.assignedInventoryIds || [],
    thumbUrl: creative.thumbUrl || fallbackThumb,
    fullUrl: creative.fullUrl || creative.thumbUrl || fallbackThumb,
  };
}

export function normalizeWorkspaceInventory(
  items: ApiProjectWorkspaceResponse["workspace"]["inventory"]
): InventoryItem[] {
  return items.map((item) => ({
    id: item.id,
    recordId: item.recordId,
    locationName: item.locationName,
    mapId: item.mapId,
    mediaVariantKey: item.mediaVariantKey,
    mediaType: item.mediaType || undefined,
    unitNumber: item.unitNumber || "",
    trimHeight: item.trimHeight ?? null,
    trimWidth: item.trimWidth ?? null,
    safeHeight: item.safeHeight ?? null,
    safeWidth: item.safeWidth ?? null,
    notes: item.notes || "",
    x: item.x,
    y: item.y,
    assignedCreativeId: item.assignedCreativeId ?? null,
    assignmentUpdatedAt: item.assignmentUpdatedAt ?? null,
    isActive: true,
  }));
}

export function normalizeWorkspaceMaps(
  maps: ApiProjectWorkspaceResponse["workspace"]["maps"]
): MapLayer[] {
  return maps.map((map) => ({
    id: map.id,
    name: map.name,
    assigned: map.assigned,
    total: map.total,
    imageUrl: map.imageUrl,
  }));
}

export function normalizeWorkspaceVariants(
  variants: ApiProjectWorkspaceResponse["workspace"]["variants"]
): MediaVariant[] {
  return variants.map((variant) => ({
    key: variant.key,
    mediaName: variant.mediaName,
    w: Number(variant.w || 0),
    h: Number(variant.h || 0),
    shortLabel: variant.shortLabel || variant.mediaName.slice(0, 2).toUpperCase(),
    color: variant.color || "#60a5fa",
  }));
}
