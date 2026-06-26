import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppShell from "../../app/AppShell";
import Panel from "../../components/common/Panel";
import PageHeader from "../../components/common/PageHeader";
import { useApiClient } from "../../api/useApiClient";
import {
  createCustomerAccount,
  createCustomerVendor,
  createCustomerVendorUser,
  fetchAdminSettings,
  fetchCustomers,
  fetchCustomerSettings,
  fetchLiftCustomerContacts,
  previewNotificationTest,
  requestCustomerBrandUploadUrl,
  runControlledErrorDrill,
  sendNotificationTest,
  updateAdminSettings,
  updateAdminUser,
  updateCustomerAccount,
  updateCustomerSettings,
  updateCustomerVendor,
  type ApiCustomerAccount,
  type ApiAdminSettings,
  type ApiAdminUser,
  type ApiAdminSettingsResponse,
  type ApiCustomerSettings,
  type ApiCustomerSettingsResponse,
  type ApiCustomerVendor,
  type ApiErrorDrillResponse,
  type ApiLiftCustomerContact,
  type ApiNotificationPreviewResponse,
  type CustomerStatus,
  type NotificationEventType,
  type NotificationRule,
} from "../../api/projects";
import "../../styles/settings.css";

type InternalDraftSettings = {
  shareCollaborationEnabled: boolean;
  shareCollaborationExpiresInDays: string;
  shareArtworkUploadEnabled: boolean;
  shareArtworkUploadExpiresInDays: string;
  shareTransitApprovalEnabled: boolean;
  shareTransitApprovalExpiresInDays: string;
  shareViewOnlyEnabled: boolean;
  shareViewOnlyExpiresInDays: string;
  requireParticipantIdentity: boolean;
  notifyProofApproved: boolean;
  notifyTransitDecision: boolean;
  notifyProductionReleased: boolean;
  notifyWorkflowErrors: boolean;
  notificationEmailRecipients: string;
  transitRunsInParallel: boolean;
  lockProofUndoAfterRelease: boolean;
  inactiveInventoryVisibilityDefault: "hidden" | "show_unavailable";
  respectVenueMapSortOrder: boolean;
  previewPdfInLightbox: boolean;
  replaceFilePreservesAssignments: boolean;
  projectDocumentRetentionDays: string;
  generatedDocumentRetentionDays: string;
  liftOrderIntegrationEnabled: boolean;
  liftProofSyncEnabled: boolean;
  retryOnTransientLiftFailure: boolean;
  primaryPrintVendorEnabled: boolean;
  primaryPrintVendorName: string;
  primaryPrintPlatformLabel: string;
  primaryPrintActiveEnvironment: LiftEnvironmentKey;
  primaryPrintEnvironments: Record<LiftEnvironmentKey, LiftEnvironmentDraft>;
  primaryPrintCompanyId: string;
  primaryPrintCreateOrderUsername: string;
  primaryPrintCreateOrderPassword: string;
  primaryPrintProofClientId: string;
  primaryPrintProofClientSecret: string;
  primaryPrintDefaultHeaders: string;
  primaryPrintPayloadNotes: string;
};

type CustomerDraftSettings = {
  notifyProofApproved: boolean;
  notifyTransitDecision: boolean;
  notifyProductionReleased: boolean;
  notifyWorkflowErrors: boolean;
  notificationEmailRecipients: string;
  notificationRules: NotificationRuleDraft[];
  productionApprovalMode: "direct" | "hold_for_release";
  transitApprovalDefaultMode: "enabled_all_orders" | "manual_per_project";
  allowTransitProjectOverride: boolean;
  customerShareCollaborationEnabled: boolean;
  customerShareArtworkUploadEnabled: boolean;
  customerShareTransitApprovalEnabled: boolean;
  customerShareViewOnlyEnabled: boolean;
  customerRequireParticipantIdentity: boolean;
};

type VendorDraft = {
  name: string;
  contactName: string;
  email: string;
  phone: string;
  notes: string;
  isActive: boolean;
};

type VendorUserDraft = {
  displayName: string;
  email: string;
  role: "vendor_user" | "vendor_admin";
  sendInvite: boolean;
};

type CustomerAccountDraft = {
  name: string;
  liftCustomerId: string;
  status: CustomerStatus;
};

type UserDraft = {
  displayName: string;
  isActive: boolean;
};

type NotificationRuleDraft = NotificationRule;

type LiftEnvironmentKey = "prod" | "qa1";

type LiftEnvironmentDraft = {
  baseUrl: string;
  orderEndpointUrl: string;
  fallbackOrderLookupUrl: string;
  orderUrlResolverUrl: string;
  customerContactListUrl: string;
  proofEndpointUrlTemplate: string;
  flushSyncUrl: string;
  proofUrlResolverUrl: string;
};

type NewCustomerDraft = {
  id: string;
  name: string;
  liftCustomerId: string;
  status: CustomerStatus;
};

type LiftCustomerImportDraft = {
  search: string;
  results: ApiLiftCustomerContact[];
  selectedCustomerId: string;
  loading: boolean;
  error: string | null;
};

type NotificationToolDraft = {
  eventType: NotificationEventType;
  recipientsOverride: string;
  loading: boolean;
  sending: boolean;
  error: string | null;
  feedback: string | null;
  result: ApiNotificationPreviewResponse | null;
};

type ErrorDrillDraft = {
  customerId: string;
  drillType: "proof_sync_mismatch" | "missing_proof_url" | "flush_sync_failure" | "notification_delivery_failure";
  loading: boolean;
  error: string | null;
  result: ApiErrorDrillResponse | null;
};

const NOTIFICATION_EVENT_OPTIONS: Array<{ id: NotificationEventType; label: string; summary: string }> = [
  { id: "artwork_uploaded", label: "Artwork Uploaded", summary: "Digest of uploaded files, filenames, and who uploaded them." },
  { id: "creatives_assigned", label: "Creatives Assigned", summary: "Which files were assigned to which inventory items." },
  { id: "all_inventory_assigned", label: "All Inventory Assigned", summary: "Confirmation that all scoped inventory has artwork assigned." },
  { id: "order_submitted", label: "Order Submitted", summary: "Campaign submitted for production ordering." },
  { id: "proofs_ready", label: "Proofs Ready", summary: "Proofs are available for review." },
  { id: "revised_art_uploaded", label: "Revised Art Uploaded", summary: "New art was uploaded during proofing." },
  { id: "all_proofs_approved", label: "All Proofs Approved", summary: "All proofs were approved for the project." },
  { id: "transit_accepted", label: "Transit Accepted", summary: "Transit approval has been accepted." },
  { id: "transit_rejected", label: "Transit Rejected", summary: "Transit approval has been rejected." },
  { id: "production_release_ready", label: "Production Release Ready", summary: "Project is fully approved and ready for release." },
  { id: "workflow_errors", label: "Workflow Errors", summary: "Errors surfaced from uploads, proofing, submission, or integrations." },
];

const ERROR_DRILL_OPTIONS: Array<{ id: ErrorDrillDraft["drillType"]; label: string; summary: string }> = [
  { id: "proof_sync_mismatch", label: "Proof Sync Mismatch", summary: "Line identity mismatch between expected unit grouping and returned Lift proof data." },
  { id: "missing_proof_url", label: "Missing Proof URL", summary: "Proof line exists, but the current proof URL is not yet available." },
  { id: "flush_sync_failure", label: "Flush Sync Failure", summary: "Lift flush sync request failed and needs operator follow-up." },
  { id: "notification_delivery_failure", label: "Notification Delivery Failure", summary: "A workflow notification could not be delivered." },
];

function notificationEventLabel(eventType: NotificationEventType) {
  return NOTIFICATION_EVENT_OPTIONS.find((option) => option.id === eventType)?.label || eventType;
}

function customerStatusMeta(status: CustomerStatus) {
  switch (status) {
    case "active":
      return {
        tone: "tone-success",
        label: "Active",
        detail: "Fully operational for projects, collaboration, and order routing.",
      };
    case "suspended":
      return {
        tone: "tone-warning",
        label: "Suspended",
        detail: "Login and read access remain available, but workflow-changing actions are blocked.",
      };
    default:
      return {
        tone: "tone-neutral",
        label: "Inactive",
        detail: "Hidden from normal operational selectors until reactivated.",
      };
  }
}

function toNullableNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function toCustomerSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

function internalDraftFromSettings(settings: ApiAdminSettings): InternalDraftSettings {
  return {
    shareCollaborationEnabled: settings.shareDefaults.collaboration.enabled,
    shareCollaborationExpiresInDays: settings.shareDefaults.collaboration.defaultExpiresInDays?.toString() || "",
    shareArtworkUploadEnabled: settings.shareDefaults.artworkUpload.enabled,
    shareArtworkUploadExpiresInDays: settings.shareDefaults.artworkUpload.defaultExpiresInDays?.toString() || "",
    shareTransitApprovalEnabled: settings.shareDefaults.transitApproval.enabled,
    shareTransitApprovalExpiresInDays: settings.shareDefaults.transitApproval.defaultExpiresInDays?.toString() || "",
    shareViewOnlyEnabled: settings.shareDefaults.viewOnly.enabled,
    shareViewOnlyExpiresInDays: settings.shareDefaults.viewOnly.defaultExpiresInDays?.toString() || "",
    requireParticipantIdentity: settings.shareDefaults.requireParticipantIdentity,
    notifyProofApproved: settings.notifications.proofApproved,
    notifyTransitDecision: settings.notifications.transitDecision,
    notifyProductionReleased: settings.notifications.productionReleased,
    notifyWorkflowErrors: settings.notifications.workflowErrors,
    notificationEmailRecipients: settings.notifications.emailRecipients,
    transitRunsInParallel: settings.workflowPolicies.transitRunsInParallel,
    lockProofUndoAfterRelease: settings.workflowPolicies.lockProofUndoAfterRelease,
    inactiveInventoryVisibilityDefault: settings.dataDefaults.inactiveInventoryVisibilityDefault,
    respectVenueMapSortOrder: settings.dataDefaults.respectVenueMapSortOrder,
    previewPdfInLightbox: settings.files.previewPdfInLightbox,
    replaceFilePreservesAssignments: settings.files.replaceFilePreservesAssignments,
    projectDocumentRetentionDays: String(settings.files.projectDocumentRetentionDays),
    generatedDocumentRetentionDays: String(settings.files.generatedDocumentRetentionDays),
    liftOrderIntegrationEnabled: settings.integrations.liftOrderIntegrationEnabled,
    liftProofSyncEnabled: settings.integrations.liftProofSyncEnabled,
    retryOnTransientLiftFailure: settings.integrations.retryOnTransientLiftFailure,
    primaryPrintVendorEnabled: settings.integrations.primaryPrintVendor.enabled,
    primaryPrintVendorName: settings.integrations.primaryPrintVendor.vendorName,
    primaryPrintPlatformLabel: settings.integrations.primaryPrintVendor.platformLabel,
    primaryPrintActiveEnvironment: settings.integrations.primaryPrintVendor.activeEnvironment,
    primaryPrintEnvironments: {
      prod: { ...settings.integrations.primaryPrintVendor.environments.prod },
      qa1: { ...settings.integrations.primaryPrintVendor.environments.qa1 },
    },
    primaryPrintCompanyId: settings.integrations.primaryPrintVendor.companyId,
    primaryPrintCreateOrderUsername: settings.integrations.primaryPrintVendor.createOrderUsername,
    primaryPrintCreateOrderPassword: settings.integrations.primaryPrintVendor.createOrderPassword,
    primaryPrintProofClientId: settings.integrations.primaryPrintVendor.proofClientId,
    primaryPrintProofClientSecret: settings.integrations.primaryPrintVendor.proofClientSecret,
    primaryPrintDefaultHeaders: settings.integrations.primaryPrintVendor.defaultHeaders,
    primaryPrintPayloadNotes: settings.integrations.primaryPrintVendor.payloadNotes,
  };
}

function customerDraftFromSettings(settings: ApiCustomerSettings): CustomerDraftSettings {
  return {
    notifyProofApproved: settings.notifications.proofApproved,
    notifyTransitDecision: settings.notifications.transitDecision,
    notifyProductionReleased: settings.notifications.productionReleased,
    notifyWorkflowErrors: settings.notifications.workflowErrors,
    notificationEmailRecipients: settings.notifications.emailRecipients,
    notificationRules: settings.notifications.rules || [],
    productionApprovalMode: settings.workflowPolicies.productionApprovalMode,
    transitApprovalDefaultMode: settings.transitApproval.defaultMode,
    allowTransitProjectOverride: settings.transitApproval.allowProjectOverride,
    customerShareCollaborationEnabled: settings.collaboration.collaborationLinksEnabled,
    customerShareArtworkUploadEnabled: settings.collaboration.artworkUploadLinksEnabled,
    customerShareTransitApprovalEnabled: settings.collaboration.transitApprovalLinksEnabled,
    customerShareViewOnlyEnabled: settings.collaboration.viewOnlyLinksEnabled,
    customerRequireParticipantIdentity: settings.collaboration.requireParticipantIdentity,
  };
}

function vendorDraftFromVendor(vendor: ApiCustomerVendor): VendorDraft {
  return {
    name: vendor.name,
    contactName: vendor.contactName,
    email: vendor.email,
    phone: vendor.phone,
    notes: vendor.notes,
    isActive: vendor.isActive,
  };
}

function vendorUserDraftFromVendor(vendor: ApiCustomerVendor): VendorUserDraft {
  return {
    displayName: vendor.contactName || vendor.name,
    email: vendor.email || "",
    role: "vendor_user",
    sendInvite: false,
  };
}

function customerAccountDraftFromCustomer(customer: ApiCustomerAccount): CustomerAccountDraft {
  return {
    name: customer.name,
    liftCustomerId: customer.liftCustomerId || "",
    status: customer.status,
  };
}

function userDraftFromUser(user: ApiAdminUser): UserDraft {
  return {
    displayName: user.displayName,
    isActive: user.isActive,
  };
}

function derivePrimaryVendorStatus(settings: ApiAdminSettings) {
  const vendor = settings.integrations.primaryPrintVendor;
  if (!vendor.enabled) return { label: "Disabled", tone: "tone-neutral" };
  const activeEnvironment = vendor.environments[vendor.activeEnvironment];
  const requiredEndpointUrls = [
    activeEnvironment.orderEndpointUrl,
    activeEnvironment.fallbackOrderLookupUrl,
    activeEnvironment.flushSyncUrl,
    activeEnvironment.proofEndpointUrlTemplate,
  ];
  const hasRequiredEndpointUrls = requiredEndpointUrls.every((value) => {
    const trimmed = value.trim();
    return trimmed.startsWith("http://") || trimmed.startsWith("https://") || (trimmed.length > 0 && activeEnvironment.baseUrl.trim().length > 0);
  });
  const requiredPieces = [
    vendor.vendorName,
    vendor.platformLabel,
    vendor.companyId,
    vendor.createOrderUsername,
    vendor.createOrderPassword,
    vendor.proofClientId,
    vendor.proofClientSecret,
  ];
  const hasSharedCredentials = requiredPieces.every((value) => value.trim().length > 0);
  if (!hasSharedCredentials) return { label: "Missing Shared Credentials", tone: "tone-warning" };
  return hasRequiredEndpointUrls
    ? { label: "Configured", tone: "tone-success" }
    : { label: "Missing Required Endpoint URLs", tone: "tone-warning" };
}

export default function SettingsAdminPage() {
  const api = useApiClient();
  const navigate = useNavigate();
  const [snapshot, setSnapshot] = useState<ApiAdminSettingsResponse | null>(null);
  const [draft, setDraft] = useState<InternalDraftSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<"internal" | "customer">("internal");
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [customerSnapshot, setCustomerSnapshot] = useState<ApiCustomerSettingsResponse | null>(null);
  const [customerDraft, setCustomerDraft] = useState<CustomerDraftSettings | null>(null);
  const [customerLoading, setCustomerLoading] = useState(false);
  const [customerSaving, setCustomerSaving] = useState(false);
  const [customerError, setCustomerError] = useState<string | null>(null);
  const [customerSaveMessage, setCustomerSaveMessage] = useState<string | null>(null);
  const [vendorDrafts, setVendorDrafts] = useState<Record<string, VendorDraft>>({});
  const [vendorSavingId, setVendorSavingId] = useState<string | null>(null);
  const [vendorUserDrafts, setVendorUserDrafts] = useState<Record<string, VendorUserDraft>>({});
  const [vendorUserSavingId, setVendorUserSavingId] = useState<string | null>(null);
  const [vendorUserCreated, setVendorUserCreated] = useState<{
    vendorId: string;
    email: string;
    temporaryPassword?: string;
    cognitoUserCreated: boolean;
  } | null>(null);
  const [customerAccounts, setCustomerAccounts] = useState<ApiCustomerAccount[]>([]);
  const [customerAccountsLoading, setCustomerAccountsLoading] = useState(false);
  const [customerAccountDrafts, setCustomerAccountDrafts] = useState<Record<string, CustomerAccountDraft>>({});
  const [customerAccountSavingId, setCustomerAccountSavingId] = useState<string | null>(null);
  const [customerLogoUploadingId, setCustomerLogoUploadingId] = useState<string | null>(null);
  const [userDrafts, setUserDrafts] = useState<Record<string, UserDraft>>({});
  const [userSavingId, setUserSavingId] = useState<string | null>(null);
  const [newCustomerDraft, setNewCustomerDraft] = useState<NewCustomerDraft>({
    id: "",
    name: "",
    liftCustomerId: "",
    status: "active",
  });
  const [liftCustomerImport, setLiftCustomerImport] = useState<LiftCustomerImportDraft>({
    search: "",
    results: [],
    selectedCustomerId: "",
    loading: false,
    error: null,
  });
  const [showCreateOrderPassword, setShowCreateOrderPassword] = useState(false);
  const [showProofClientSecret, setShowProofClientSecret] = useState(false);
  const [notificationTool, setNotificationTool] = useState<NotificationToolDraft>({
    eventType: "order_submitted",
    recipientsOverride: "",
    loading: false,
    sending: false,
    error: null,
    feedback: null,
    result: null,
  });
  const [errorDrill, setErrorDrill] = useState<ErrorDrillDraft>({
    customerId: "",
    drillType: "proof_sync_mismatch",
    loading: false,
    error: null,
    result: null,
  });
  const [newVendorDraft, setNewVendorDraft] = useState<VendorDraft>({
    name: "",
    contactName: "",
    email: "",
    phone: "",
    notes: "",
    isActive: true,
  });
  const [newVendorSaving, setNewVendorSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetchAdminSettings(api);
        if (cancelled) return;
        setSnapshot(response);
        setDraft(internalDraftFromSettings(response.settings));
        if (response.viewer.isPlatformAdmin) {
          setActiveTab((current) => current || "internal");
        } else {
          setActiveTab("customer");
        }
        const defaultCustomerId =
          response.viewer.customerIds[0] || response.customers.find((customer) => !customer.isInternalSandbox)?.id || response.customers[0]?.id || "";
        setSelectedCustomerId((current) => current || defaultCustomerId);
      } catch (loadError) {
        if (cancelled) return;
        console.error("Failed to load admin settings", loadError);
        setError("We couldn’t load Admin Setup right now.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    if (!snapshot?.viewer.isPlatformAdmin) {
      setCustomerAccounts([]);
      setCustomerAccountDrafts({});
      return;
    }
    let cancelled = false;
    async function loadCustomerAccounts() {
      setCustomerAccountsLoading(true);
      try {
        const response = await fetchCustomers(api);
        if (cancelled) return;
        setCustomerAccounts(response.customers);
        setCustomerAccountDrafts(
          Object.fromEntries(response.customers.map((customer) => [customer.id, customerAccountDraftFromCustomer(customer)]))
        );
      } catch (loadError) {
        if (cancelled) return;
        console.error("Failed to load customer accounts", loadError);
        setError("We couldn’t load customer accounts right now.");
      } finally {
        if (!cancelled) setCustomerAccountsLoading(false);
      }
    }
    void loadCustomerAccounts();
    return () => {
      cancelled = true;
    };
  }, [api, snapshot?.viewer.isPlatformAdmin]);

  useEffect(() => {
    if (!selectedCustomerId) {
      setCustomerSnapshot(null);
      setCustomerDraft(null);
      return;
    }
    let cancelled = false;
    async function loadCustomer() {
      setCustomerLoading(true);
      setCustomerError(null);
      try {
        const response = await fetchCustomerSettings(api, selectedCustomerId);
        if (cancelled) return;
        setCustomerSnapshot(response);
        setCustomerDraft(customerDraftFromSettings(response.settings));
        setVendorDrafts(
          Object.fromEntries(response.vendors.map((vendor) => [vendor.id, vendorDraftFromVendor(vendor)]))
        );
      } catch (loadError) {
        if (cancelled) return;
        console.error("Failed to load customer settings", loadError);
        setCustomerError("We couldn’t load that customer’s admin settings.");
      } finally {
        if (!cancelled) setCustomerLoading(false);
      }
    }
    void loadCustomer();
    return () => {
      cancelled = true;
    };
  }, [api, selectedCustomerId]);

  useEffect(() => {
    setNotificationTool((current) => ({
      ...current,
      error: null,
      feedback: null,
      result: null,
    }));
    setErrorDrill((current) => ({
      ...current,
      customerId: current.customerId || selectedCustomerId,
      error: null,
      result: null,
    }));
  }, [selectedCustomerId]);

  useEffect(() => {
    const visibleUsers = [
      ...(snapshot?.users || []),
      ...(customerSnapshot?.users || []),
    ];
    if (!visibleUsers.length) return;
    setUserDrafts((current) => {
      const next = { ...current };
      for (const user of visibleUsers) {
        next[user.id] = current[user.id] || userDraftFromUser(user);
      }
      return next;
    });
  }, [snapshot?.users, customerSnapshot?.users]);

  useEffect(() => {
    const vendors = customerSnapshot?.vendors || [];
    if (!vendors.length) return;
    setVendorUserDrafts((current) => {
      const next = { ...current };
      for (const vendor of vendors) {
        next[vendor.id] = current[vendor.id] || vendorUserDraftFromVendor(vendor);
      }
      return next;
    });
  }, [customerSnapshot?.vendors]);

  const hasChanges = useMemo(() => {
    if (!snapshot || !draft) return false;
    return JSON.stringify(draft) !== JSON.stringify(internalDraftFromSettings(snapshot.settings));
  }, [draft, snapshot]);

  const customerHasChanges = useMemo(() => {
    if (!customerSnapshot || !customerDraft) return false;
    return JSON.stringify(customerDraft) !== JSON.stringify(customerDraftFromSettings(customerSnapshot.settings));
  }, [customerDraft, customerSnapshot]);

  const canSeeInternalTab = snapshot?.viewer.isPlatformAdmin ?? false;
  const visibleCustomers = snapshot?.customers || [];
  const sandboxCustomerAccount = customerAccounts.find((customer) => customer.isInternalSandbox);
  const selectedCustomer = customerSnapshot?.customer || visibleCustomers.find((customer) => customer.id === selectedCustomerId) || null;
  const selectedLiftImportCustomer =
    liftCustomerImport.results.find((customer) => customer.customerId === liftCustomerImport.selectedCustomerId) || null;
  const selectedNotificationEvent =
    NOTIFICATION_EVENT_OPTIONS.find((option) => option.id === notificationTool.eventType) || NOTIFICATION_EVENT_OPTIONS[0];
  const activeExternalVendorCount = customerSnapshot?.vendors.filter((vendor) => vendor.isActive).length || 0;
  const primaryVendorStatus = snapshot ? derivePrimaryVendorStatus(snapshot.settings) : { label: "Loading…", tone: "tone-neutral" };
  const activeLiftEnvironment = draft?.primaryPrintActiveEnvironment || "prod";
  const activeLiftEnvironmentDraft = draft?.primaryPrintEnvironments[activeLiftEnvironment] || null;

  function patchDraft(patch: Partial<InternalDraftSettings>) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
    setSaveMessage(null);
  }

  function patchLiftEnvironment(environment: LiftEnvironmentKey, patch: Partial<LiftEnvironmentDraft>) {
    setDraft((current) =>
      current
        ? {
            ...current,
            primaryPrintEnvironments: {
              ...current.primaryPrintEnvironments,
              [environment]: {
                ...current.primaryPrintEnvironments[environment],
                ...patch,
              },
            },
          }
        : current
    );
    setSaveMessage(null);
  }

  function patchCustomerDraft(patch: Partial<CustomerDraftSettings>) {
    setCustomerDraft((current) => (current ? { ...current, ...patch } : current));
    setCustomerSaveMessage(null);
  }

  function patchVendorDraft(vendorId: string, patch: Partial<VendorDraft>) {
    setVendorDrafts((current) => ({
      ...current,
      [vendorId]: {
        ...(current[vendorId] || vendorDraftFromVendor(customerSnapshot?.vendors.find((vendor) => vendor.id === vendorId) || {
          id: vendorId,
          customerId: selectedCustomerId,
          name: "",
          contactName: "",
          email: "",
          phone: "",
          notes: "",
          isActive: true,
          updatedAt: "",
          updatedByName: "",
        })),
        ...patch,
      },
    }));
  }

  function patchVendorUserDraft(vendorId: string, patch: Partial<VendorUserDraft>) {
    setVendorUserDrafts((current) => ({
      ...current,
      [vendorId]: {
        ...(current[vendorId] || vendorUserDraftFromVendor(customerSnapshot?.vendors.find((vendor) => vendor.id === vendorId) || {
          id: vendorId,
          customerId: selectedCustomerId,
          name: "",
          contactName: "",
          email: "",
          phone: "",
          notes: "",
          isActive: true,
          updatedAt: "",
          updatedByName: "",
        })),
        ...patch,
      },
    }));
    setVendorUserCreated(null);
  }

  function patchCustomerAccountDraft(customerId: string, patch: Partial<CustomerAccountDraft>) {
    setCustomerAccountDrafts((current) => ({
      ...current,
      [customerId]: {
        ...(current[customerId] || { name: "", liftCustomerId: "", status: "active" as CustomerStatus }),
        ...patch,
      },
    }));
    setSaveMessage(null);
  }

  function patchUserDraft(userId: string, patch: Partial<UserDraft>) {
    setUserDrafts((current) => ({
      ...current,
      [userId]: {
        ...(current[userId] || { displayName: "", isActive: true }),
        ...patch,
      },
    }));
    setSaveMessage(null);
    setCustomerSaveMessage(null);
  }

  function patchNotificationRule(ruleId: string, patch: Partial<NotificationRuleDraft>) {
    setCustomerDraft((current) =>
      current
        ? {
            ...current,
            notificationRules: current.notificationRules.map((rule) =>
              rule.id === ruleId ? { ...rule, ...patch } : rule
            ),
          }
        : current
    );
    setCustomerSaveMessage(null);
  }

  function toggleNotificationEvent(ruleId: string, eventType: NotificationEventType) {
    setCustomerDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        notificationRules: current.notificationRules.map((rule) => {
          if (rule.id !== ruleId) return rule;
          const hasEvent = rule.eventTypes.includes(eventType);
          return {
            ...rule,
            eventTypes: hasEvent
              ? rule.eventTypes.filter((candidate) => candidate !== eventType)
              : [...rule.eventTypes, eventType],
          };
        }),
      };
    });
    setCustomerSaveMessage(null);
  }

  function addNotificationRule() {
    const id = `rule_${Date.now().toString(36)}`;
    setCustomerDraft((current) =>
      current
        ? {
            ...current,
            notificationRules: [
              ...current.notificationRules,
              {
                id,
                label: "New notification rule",
                eventTypes: [],
                recipients: "",
                deliveryMode: "instant",
                isActive: true,
              },
            ],
          }
        : current
    );
    setCustomerSaveMessage(null);
  }

  function removeNotificationRule(ruleId: string) {
    setCustomerDraft((current) =>
      current
        ? {
            ...current,
            notificationRules: current.notificationRules.filter((rule) => rule.id !== ruleId),
          }
        : current
    );
    setCustomerSaveMessage(null);
  }

  async function refreshAdminData(targetCustomerId?: string) {
    const [customersResponse, settingsResponse] = await Promise.all([fetchCustomers(api), fetchAdminSettings(api)]);
    setCustomerAccounts(customersResponse.customers);
    setCustomerAccountDrafts(
      Object.fromEntries(customersResponse.customers.map((customer) => [customer.id, customerAccountDraftFromCustomer(customer)]))
    );
    setSnapshot(settingsResponse);
    if (targetCustomerId) {
      const customerResponse = await fetchCustomerSettings(api, targetCustomerId);
      setCustomerSnapshot(customerResponse);
      setCustomerDraft(customerDraftFromSettings(customerResponse.settings));
      setVendorDrafts(
        Object.fromEntries(customerResponse.vendors.map((vendor) => [vendor.id, vendorDraftFromVendor(vendor)]))
      );
    }
  }

  async function saveUser(user: ApiAdminUser) {
    const draftValue = userDrafts[user.id];
    if (!draftValue) return;
    setUserSavingId(user.id);
    setError(null);
    setCustomerError(null);
    try {
      const response = await updateAdminUser(api, {
        userId: user.id,
        displayName: draftValue.displayName.trim(),
        isActive: draftValue.isActive,
      });
      setSnapshot(response);
      setDraft(internalDraftFromSettings(response.settings));
      setUserDrafts((current) => ({
        ...current,
        [user.id]: {
          displayName: draftValue.displayName.trim(),
          isActive: draftValue.isActive,
        },
      }));
      if (selectedCustomerId) {
        const customerResponse = await fetchCustomerSettings(api, selectedCustomerId);
        setCustomerSnapshot(customerResponse);
        setCustomerDraft(customerDraftFromSettings(customerResponse.settings));
        setVendorDrafts(
          Object.fromEntries(customerResponse.vendors.map((vendor) => [vendor.id, vendorDraftFromVendor(vendor)]))
        );
      }
      const successMessage = `Saved user profile for ${draftValue.displayName.trim() || user.email}.`;
      setSaveMessage(successMessage);
      setCustomerSaveMessage(successMessage);
    } catch (saveError) {
      console.error("Failed to save user profile", saveError);
      setError("We couldn’t save that user profile.");
      setCustomerError("We couldn’t save that user profile.");
    } finally {
      setUserSavingId(null);
    }
  }

  async function saveSettings() {
    if (!draft || !snapshot) return;
    setSaving(true);
    setError(null);
    setSaveMessage(null);
    try {
      const response = await updateAdminSettings(api, {
        shareCollaborationEnabled: draft.shareCollaborationEnabled,
        shareCollaborationExpiresInDays: toNullableNumber(draft.shareCollaborationExpiresInDays),
        shareArtworkUploadEnabled: draft.shareArtworkUploadEnabled,
        shareArtworkUploadExpiresInDays: toNullableNumber(draft.shareArtworkUploadExpiresInDays),
        shareTransitApprovalEnabled: draft.shareTransitApprovalEnabled,
        shareTransitApprovalExpiresInDays: toNullableNumber(draft.shareTransitApprovalExpiresInDays),
        shareViewOnlyEnabled: draft.shareViewOnlyEnabled,
        shareViewOnlyExpiresInDays: toNullableNumber(draft.shareViewOnlyExpiresInDays),
        requireParticipantIdentity: draft.requireParticipantIdentity,
        notifyProofApproved: draft.notifyProofApproved,
        notifyTransitDecision: draft.notifyTransitDecision,
        notifyProductionReleased: draft.notifyProductionReleased,
        notifyWorkflowErrors: draft.notifyWorkflowErrors,
        notificationEmailRecipients: draft.notificationEmailRecipients.trim(),
        transitRunsInParallel: draft.transitRunsInParallel,
        lockProofUndoAfterRelease: draft.lockProofUndoAfterRelease,
        inactiveInventoryVisibilityDefault: draft.inactiveInventoryVisibilityDefault,
        respectVenueMapSortOrder: draft.respectVenueMapSortOrder,
        previewPdfInLightbox: draft.previewPdfInLightbox,
        replaceFilePreservesAssignments: draft.replaceFilePreservesAssignments,
        projectDocumentRetentionDays:
          toNullableNumber(draft.projectDocumentRetentionDays) ?? snapshot.settings.files.projectDocumentRetentionDays,
        generatedDocumentRetentionDays:
          toNullableNumber(draft.generatedDocumentRetentionDays) ?? snapshot.settings.files.generatedDocumentRetentionDays,
        liftOrderIntegrationEnabled: draft.liftOrderIntegrationEnabled,
        liftProofSyncEnabled: draft.liftProofSyncEnabled,
        retryOnTransientLiftFailure: draft.retryOnTransientLiftFailure,
        primaryPrintVendorEnabled: draft.primaryPrintVendorEnabled,
        primaryPrintVendorName: draft.primaryPrintVendorName,
        primaryPrintPlatformLabel: draft.primaryPrintPlatformLabel,
        primaryPrintActiveEnvironment: draft.primaryPrintActiveEnvironment,
        primaryPrintProdBaseUrl: draft.primaryPrintEnvironments.prod.baseUrl,
        primaryPrintProdOrderEndpointUrl: draft.primaryPrintEnvironments.prod.orderEndpointUrl,
        primaryPrintProdFallbackOrderLookupUrl: draft.primaryPrintEnvironments.prod.fallbackOrderLookupUrl,
        primaryPrintProdOrderUrlResolverUrl: draft.primaryPrintEnvironments.prod.orderUrlResolverUrl,
        primaryPrintProdCustomerContactListUrl: draft.primaryPrintEnvironments.prod.customerContactListUrl,
        primaryPrintProdProofEndpointUrlTemplate: draft.primaryPrintEnvironments.prod.proofEndpointUrlTemplate,
        primaryPrintProdFlushSyncUrl: draft.primaryPrintEnvironments.prod.flushSyncUrl,
        primaryPrintProdProofUrlResolverUrl: draft.primaryPrintEnvironments.prod.proofUrlResolverUrl,
        primaryPrintQa1BaseUrl: draft.primaryPrintEnvironments.qa1.baseUrl,
        primaryPrintQa1OrderEndpointUrl: draft.primaryPrintEnvironments.qa1.orderEndpointUrl,
        primaryPrintQa1FallbackOrderLookupUrl: draft.primaryPrintEnvironments.qa1.fallbackOrderLookupUrl,
        primaryPrintQa1OrderUrlResolverUrl: draft.primaryPrintEnvironments.qa1.orderUrlResolverUrl,
        primaryPrintQa1CustomerContactListUrl: draft.primaryPrintEnvironments.qa1.customerContactListUrl,
        primaryPrintQa1ProofEndpointUrlTemplate: draft.primaryPrintEnvironments.qa1.proofEndpointUrlTemplate,
        primaryPrintQa1FlushSyncUrl: draft.primaryPrintEnvironments.qa1.flushSyncUrl,
        primaryPrintQa1ProofUrlResolverUrl: draft.primaryPrintEnvironments.qa1.proofUrlResolverUrl,
        primaryPrintCompanyId: draft.primaryPrintCompanyId,
        primaryPrintCreateOrderUsername: draft.primaryPrintCreateOrderUsername,
        primaryPrintCreateOrderPassword: draft.primaryPrintCreateOrderPassword,
        primaryPrintProofClientId: draft.primaryPrintProofClientId,
        primaryPrintProofClientSecret: draft.primaryPrintProofClientSecret,
        primaryPrintDefaultHeaders: draft.primaryPrintDefaultHeaders,
        primaryPrintPayloadNotes: draft.primaryPrintPayloadNotes,
      });
      setSnapshot(response);
      setDraft(internalDraftFromSettings(response.settings));
      setSaveMessage(`Saved ${new Date(response.settings.updatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`);
    } catch (saveError) {
      console.error("Failed to save admin settings", saveError);
      setError("We couldn’t save those setup changes.");
    } finally {
      setSaving(false);
    }
  }

  async function saveCustomerSettingsHandler() {
    if (!customerDraft || !selectedCustomerId || !customerSnapshot) return;
    setCustomerSaving(true);
    setCustomerError(null);
    setCustomerSaveMessage(null);
    try {
      const response = await updateCustomerSettings(api, selectedCustomerId, {
        notifyProofApproved: customerDraft.notifyProofApproved,
        notifyTransitDecision: customerDraft.notifyTransitDecision,
        notifyProductionReleased: customerDraft.notifyProductionReleased,
        notifyWorkflowErrors: customerDraft.notifyWorkflowErrors,
        notificationEmailRecipients: customerDraft.notificationEmailRecipients.trim(),
        notificationRules: customerDraft.notificationRules,
        productionApprovalMode: customerDraft.productionApprovalMode,
        transitApprovalDefaultMode: customerDraft.transitApprovalDefaultMode,
        allowTransitProjectOverride: customerDraft.allowTransitProjectOverride,
        customerShareCollaborationEnabled: customerDraft.customerShareCollaborationEnabled,
        customerShareArtworkUploadEnabled: customerDraft.customerShareArtworkUploadEnabled,
        customerShareTransitApprovalEnabled: customerDraft.customerShareTransitApprovalEnabled,
        customerShareViewOnlyEnabled: customerDraft.customerShareViewOnlyEnabled,
        customerRequireParticipantIdentity: customerDraft.customerRequireParticipantIdentity,
      });
      setCustomerSnapshot(response);
      setCustomerDraft(customerDraftFromSettings(response.settings));
      setVendorDrafts(
        Object.fromEntries(response.vendors.map((vendor) => [vendor.id, vendorDraftFromVendor(vendor)]))
      );
      setCustomerSaveMessage(`Saved ${new Date(response.settings.updatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`);
    } catch (saveError) {
      console.error("Failed to save customer settings", saveError);
      setCustomerError("We couldn’t save those customer settings.");
    } finally {
      setCustomerSaving(false);
    }
  }

  async function saveVendor(vendor: ApiCustomerVendor) {
    const draftValue = vendorDrafts[vendor.id];
    if (!draftValue || !selectedCustomerId) return;
    setVendorSavingId(vendor.id);
    setCustomerError(null);
    try {
      await updateCustomerVendor(api, selectedCustomerId, vendor.id, draftValue);
      const response = await fetchCustomerSettings(api, selectedCustomerId);
      setCustomerSnapshot(response);
      setCustomerDraft(customerDraftFromSettings(response.settings));
      setVendorDrafts(
        Object.fromEntries(response.vendors.map((nextVendor) => [nextVendor.id, vendorDraftFromVendor(nextVendor)]))
      );
      setCustomerSaveMessage(`Vendor settings saved for ${response.customer.name}.`);
    } catch (saveError) {
      console.error("Failed to save customer vendor", saveError);
      setCustomerError("We couldn’t save that vendor.");
    } finally {
      setVendorSavingId(null);
    }
  }

  async function addVendor() {
    if (!selectedCustomerId || !newVendorDraft.name.trim()) return;
    setNewVendorSaving(true);
    setCustomerError(null);
    try {
      await createCustomerVendor(api, selectedCustomerId, newVendorDraft);
      const response = await fetchCustomerSettings(api, selectedCustomerId);
      setCustomerSnapshot(response);
      setCustomerDraft(customerDraftFromSettings(response.settings));
      setVendorDrafts(
        Object.fromEntries(response.vendors.map((vendor) => [vendor.id, vendorDraftFromVendor(vendor)]))
      );
      setNewVendorDraft({
        name: "",
        contactName: "",
        email: "",
        phone: "",
        notes: "",
        isActive: true,
      });
      setCustomerSaveMessage(`Vendor added to ${response.customer.name}.`);
    } catch (saveError) {
      console.error("Failed to add customer vendor", saveError);
      setCustomerError("We couldn’t add that vendor yet.");
    } finally {
      setNewVendorSaving(false);
    }
  }

  async function addVendorUser(vendor: ApiCustomerVendor) {
    if (!selectedCustomerId) return;
    const draftValue = vendorUserDrafts[vendor.id] || vendorUserDraftFromVendor(vendor);
    if (!draftValue.email.trim()) return;
    setVendorUserSavingId(vendor.id);
    setCustomerError(null);
    setVendorUserCreated(null);
    try {
      const result = await createCustomerVendorUser(api, selectedCustomerId, {
        vendorId: vendor.id,
        email: draftValue.email.trim(),
        displayName: draftValue.displayName.trim() || draftValue.email.trim(),
        role: draftValue.role,
        sendInvite: draftValue.sendInvite,
      });
      await refreshAdminData(selectedCustomerId);
      setVendorUserDrafts((current) => ({
        ...current,
        [vendor.id]: vendorUserDraftFromVendor(vendor),
      }));
      setVendorUserCreated({
        vendorId: vendor.id,
        email: result.user.email,
        temporaryPassword: result.temporaryPassword,
        cognitoUserCreated: result.cognitoUserCreated,
      });
      setCustomerSaveMessage(`Vendor user ${result.user.email} is linked to ${vendor.name}.`);
    } catch (saveError) {
      console.error("Failed to add vendor user", saveError);
      setCustomerError("We couldn’t create that vendor user.");
    } finally {
      setVendorUserSavingId(null);
    }
  }

  async function saveCustomerAccount(customer: ApiCustomerAccount) {
    const draftValue = customerAccountDrafts[customer.id];
    if (!draftValue) return;
    setCustomerAccountSavingId(customer.id);
    setError(null);
    setSaveMessage(null);
    try {
      await updateCustomerAccount(api, customer.id, {
        name: draftValue.name,
        liftCustomerId: draftValue.liftCustomerId || "",
        status: draftValue.status,
      });
      await refreshAdminData(selectedCustomerId === customer.id ? customer.id : undefined);
      setSaveMessage(`Saved customer account ${draftValue.name}.`);
    } catch (saveError) {
      console.error("Failed to save customer account", saveError);
      setError("We couldn’t save that customer account.");
    } finally {
      setCustomerAccountSavingId(null);
    }
  }

  async function addCustomerAccount() {
    if (!newCustomerDraft.id.trim() || !newCustomerDraft.name.trim()) return;
    setCustomerAccountSavingId("new");
    setError(null);
    setSaveMessage(null);
    try {
      const nextCustomerId = newCustomerDraft.id.trim();
      const nextCustomerName = newCustomerDraft.name.trim();
      await createCustomerAccount(api, {
        id: nextCustomerId,
        name: nextCustomerName,
        liftCustomerId: newCustomerDraft.liftCustomerId.trim() || undefined,
        status: newCustomerDraft.status,
      });
      await refreshAdminData(nextCustomerId);
      setSelectedCustomerId((current) => current || nextCustomerId);
      setNewCustomerDraft({
        id: "",
        name: "",
        liftCustomerId: "",
        status: "active",
      });
      setLiftCustomerImport((current) => ({
        ...current,
        selectedCustomerId: "",
      }));
      setSaveMessage(`Added customer account ${nextCustomerName}.`);
    } catch (saveError) {
      console.error("Failed to create customer account", saveError);
      setError("We couldn’t add that customer account.");
    } finally {
      setCustomerAccountSavingId(null);
    }
  }

  async function searchLiftCustomers() {
    setLiftCustomerImport((current) => ({
      ...current,
      loading: true,
      error: null,
    }));
    try {
      const response = await fetchLiftCustomerContacts(api, liftCustomerImport.search.trim());
      setLiftCustomerImport((current) => ({
        ...current,
        loading: false,
        error: null,
        results: response.customers,
        selectedCustomerId:
          current.selectedCustomerId && response.customers.some((item) => item.customerId === current.selectedCustomerId)
            ? current.selectedCustomerId
            : response.customers[0]?.customerId || "",
      }));
    } catch (loadError) {
      console.error("Failed to search Lift customers", loadError);
      setLiftCustomerImport((current) => ({
        ...current,
        loading: false,
        error: "We couldn’t load Lift customers right now.",
      }));
    }
  }

  function applyLiftCustomerToDraft(customer: ApiLiftCustomerContact) {
    const baseSlug = toCustomerSlug(customer.customerName) || `customer_${customer.customerId}`;
    const existingIds = new Set(customerAccounts.map((account) => account.id));
    let nextId = baseSlug;
    if (existingIds.has(nextId)) {
      nextId = `${baseSlug}_${customer.customerId}`;
    }
    setNewCustomerDraft({
      id: nextId,
      name: customer.customerName,
      liftCustomerId: customer.customerId,
      status: "active",
    });
    setLiftCustomerImport((current) => ({
      ...current,
      selectedCustomerId: customer.customerId,
    }));
  }

  async function previewNotificationRuleDelivery() {
    if (!selectedCustomerId) return;
    setNotificationTool((current) => ({
      ...current,
      loading: true,
      error: null,
      feedback: null,
    }));
    try {
      const result = await previewNotificationTest(api, {
        customerId: selectedCustomerId,
        eventType: notificationTool.eventType,
        recipientsOverride: notificationTool.recipientsOverride.trim() || undefined,
      });
      setNotificationTool((current) => ({
        ...current,
        loading: false,
        result,
        feedback:
          result.previews.length > 0
            ? `Preview ready for ${notificationEventLabel(result.eventType)}.`
            : `No active customer notification rules are currently listening for ${notificationEventLabel(result.eventType)}.`,
      }));
    } catch (previewError) {
      console.error("Failed to preview notification delivery", previewError);
      setNotificationTool((current) => ({
        ...current,
        loading: false,
        error: "We couldn’t build that notification preview.",
      }));
    }
  }

  async function sendNotificationRuleTest() {
    if (!selectedCustomerId) return;
    setNotificationTool((current) => ({
      ...current,
      sending: true,
      error: null,
      feedback: null,
    }));
    try {
      const result = await sendNotificationTest(api, {
        customerId: selectedCustomerId,
        eventType: notificationTool.eventType,
        recipientsOverride: notificationTool.recipientsOverride.trim() || undefined,
      });
      setNotificationTool((current) => ({
        ...current,
        sending: false,
        result,
        feedback:
          result.sentCount > 0
            ? `Sent ${result.sentCount} test notification${result.sentCount === 1 ? "" : "s"} for ${notificationEventLabel(result.eventType)}.`
            : `No test emails were sent because no active rules matched ${notificationEventLabel(result.eventType)}.`,
      }));
    } catch (sendError) {
      console.error("Failed to send notification test", sendError);
      setNotificationTool((current) => ({
        ...current,
        sending: false,
        error: "We couldn’t send that test notification.",
      }));
    }
  }

  async function runErrorDrillHandler() {
    if (!errorDrill.customerId) return;
    setErrorDrill((current) => ({
      ...current,
      loading: true,
      error: null,
      result: null,
    }));
    try {
      const result = await runControlledErrorDrill(api, {
        customerId: errorDrill.customerId,
        drillType: errorDrill.drillType,
      });
      setErrorDrill((current) => ({
        ...current,
        loading: false,
        result,
      }));
      setSaveMessage(`Recorded a ${ERROR_DRILL_OPTIONS.find((option) => option.id === result.issue.drillType)?.label || "workflow error"} drill on ${result.project.title}.`);
    } catch (drillError) {
      console.error("Failed to run controlled error drill", drillError);
      setErrorDrill((current) => ({
        ...current,
        loading: false,
        error: "We couldn’t run that error drill.",
      }));
    }
  }

  async function uploadCustomerLogo(customer: ApiCustomerAccount, file: File) {
    setCustomerLogoUploadingId(customer.id);
    setError(null);
    setSaveMessage(null);
    try {
      const signed = await requestCustomerBrandUploadUrl(api, {
        customerId: customer.id,
        filename: file.name,
        contentType: file.type || "application/octet-stream",
      });
      const uploadResponse = await fetch(signed.uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": file.type || "application/octet-stream",
        },
        body: file,
      });
      if (!uploadResponse.ok) {
        throw new Error(`Logo upload failed with status ${uploadResponse.status}`);
      }

      await updateCustomerAccount(api, customer.id, {
        logoBucketName: signed.bucket,
        logoObjectKey: signed.key,
        logoContentType: file.type || "application/octet-stream",
      });
      await refreshAdminData(selectedCustomerId === customer.id ? customer.id : undefined);
      setSaveMessage(`Updated logo for ${customer.name}.`);
    } catch (uploadError) {
      console.error("Failed to upload customer logo", uploadError);
      setError("We couldn’t upload that customer logo.");
    } finally {
      setCustomerLogoUploadingId(null);
    }
  }

  async function clearCustomerLogo(customer: ApiCustomerAccount) {
    setCustomerLogoUploadingId(customer.id);
    setError(null);
    setSaveMessage(null);
    try {
      await updateCustomerAccount(api, customer.id, {
        logoBucketName: null,
        logoObjectKey: null,
        logoContentType: null,
      });
      await refreshAdminData(selectedCustomerId === customer.id ? customer.id : undefined);
      setSaveMessage(`Removed logo for ${customer.name}.`);
    } catch (clearError) {
      console.error("Failed to clear customer logo", clearError);
      setError("We couldn’t remove that customer logo.");
    } finally {
      setCustomerLogoUploadingId(null);
    }
  }

  return (
    <AppShell pageClassName="wide" showNavTrigger>
      <PageHeader
        className="settings-pageHeader"
        title="Admin Setup"
        subtitle="Configure product rules and customer-specific controls for account behavior."
        backLabel="← Projects"
        onBack={() => navigate("/customer/projects")}
        meta={
          <div className="settings-headerMeta">
            <span>{canSeeInternalTab ? "Platform Admin" : "Customer Admin"}</span>
            <span>{selectedCustomer?.name || "No customer selected"}</span>
          </div>
        }
        actions={
          <div className="settings-actions">
            <button className="btn btn-ghost btn-soft" type="button" onClick={() => navigate("/admin/health")}>
              Open Health Dashboard
            </button>
            {activeTab === "internal" ? (
              <button className="btn btn-primary" type="button" disabled={!hasChanges || saving || loading} onClick={() => void saveSettings()}>
                {saving ? "Saving…" : hasChanges ? "Save Internal Setup" : "Up to Date"}
              </button>
            ) : (
              <button
                className="btn btn-primary"
                type="button"
                disabled={!customerHasChanges || customerSaving || customerLoading || !selectedCustomerId}
                onClick={() => void saveCustomerSettingsHandler()}
              >
                {customerSaving ? "Saving…" : customerHasChanges ? "Save Customer Settings" : "Up to Date"}
              </button>
            )}
          </div>
        }
      />

      {activeTab === "internal" ? (
        <>
          {error ? <div className="settings-feedback settings-feedback-error">{error}</div> : null}
          {saveMessage ? <div className="settings-feedback settings-feedback-success">{saveMessage}</div> : null}
        </>
      ) : (
        <>
          {customerError ? <div className="settings-feedback settings-feedback-error">{customerError}</div> : null}
          {customerSaveMessage ? <div className="settings-feedback settings-feedback-success">{customerSaveMessage}</div> : null}
        </>
      )}

      <div className="settings-grid">
        <Panel className="settings-panel settings-panel-hero">
          <div className="settings-hero">
            <div>
              <div className="settings-sectionEyebrow">Setup Focus</div>
              <h2 className="settings-title">Global controls and customer controls now live side by side.</h2>
              <p className="settings-copy">
                Internal Admin Settings stay app-wide. Customer Admin Settings let us step into a single customer account and manage recipients, transit defaults, collaboration posture, and outsourced vendor setup without blurring the two scopes.
              </p>
              <div className="settings-tabBar">
                {canSeeInternalTab ? (
                  <button
                    className={`btn btn-ghost btn-soft settings-tabBtn ${activeTab === "internal" ? "is-active" : ""}`.trim()}
                    type="button"
                    onClick={() => setActiveTab("internal")}
                  >
                    Internal Admin Settings
                  </button>
                ) : null}
                <button
                  className={`btn btn-ghost btn-soft settings-tabBtn ${activeTab === "customer" ? "is-active" : ""}`.trim()}
                  type="button"
                  onClick={() => setActiveTab("customer")}
                >
                  Customer Admin Settings
                </button>
              </div>
            </div>
            <div className="settings-sessionCard">
              <div className="settings-sessionLabel">{activeTab === "internal" ? "Settings Scope" : "Customer Scope"}</div>
              <div className="settings-sessionValue">
                {activeTab === "internal" ? "Global" : selectedCustomer?.name || "Select customer"}
              </div>
              <div className="settings-sessionMeta">
                {activeTab === "internal"
                  ? loading || !snapshot
                    ? "Loading current configuration…"
                    : `Updated by ${snapshot.settings.updatedByName}`
                  : customerLoading || !customerSnapshot
                    ? "Loading customer configuration…"
                    : `Updated by ${customerSnapshot.settings.updatedByName}`}
              </div>
            </div>
          </div>
        </Panel>

        {activeTab === "internal" ? (
          <>
            <Panel className="settings-panel settings-panel-wide">
              <div className="settings-cardHead">
                <div>
                  <div className="settings-sectionEyebrow">Customer Accounts</div>
                  <h3 className="settings-cardTitle">Adspace customers, Lift mapping, and account status</h3>
                </div>
                <span className="chip tone-info">{customerAccounts.length} customers</span>
              </div>
              {customerAccountsLoading ? (
                <div className="settings-empty">Loading customer accounts…</div>
              ) : (
                <div className="settings-formGrid">
                  <div className="settings-note">
                    Customer accounts are the source of truth for Lift mapping, branding, and lifecycle posture. Keep the sandbox customer separate from real customer accounts so internal testing never leaks into customer-facing work.
                  </div>
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Logo</th>
                          <th>Customer Name</th>
                          <th>Adspace ID</th>
                          <th>Lift Customer ID</th>
                          <th>Status</th>
                          <th>Markets</th>
                          <th>Venues</th>
                          <th>Projects</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {customerAccounts.map((customer) => {
                          const draftValue = customerAccountDrafts[customer.id] || customerAccountDraftFromCustomer(customer);
                          const isDirty =
                            JSON.stringify(draftValue) !== JSON.stringify(customerAccountDraftFromCustomer(customer));
                          return (
                            <tr key={customer.id}>
                              <td>
                                <div className="settings-logoCell">
                                  {customer.logoUrl ? (
                                    <img className="settings-logoPreview" src={customer.logoUrl} alt={`${customer.name} logo`} />
                                  ) : (
                                    <div className="settings-logoFallback">{customer.name.slice(0, 2).toUpperCase()}</div>
                                  )}
                                  <div className="settings-logoActions">
                                    <label className="btn btn-ghost btn-soft settings-uploadBtn">
                                      <input
                                        type="file"
                                        accept="image/*,.svg"
                                        hidden
                                        onChange={(e) => {
                                          const file = e.target.files?.[0];
                                          e.currentTarget.value = "";
                                          if (file) void uploadCustomerLogo(customer, file);
                                        }}
                                      />
                                      {customerLogoUploadingId === customer.id ? "Uploading…" : customer.logoUrl ? "Replace" : "Upload"}
                                    </label>
                                    {customer.logoUrl ? (
                                      <button
                                        className="btn btn-ghost btn-soft"
                                        type="button"
                                        disabled={customerLogoUploadingId === customer.id}
                                        onClick={() => void clearCustomerLogo(customer)}
                                      >
                                        Remove
                                      </button>
                                    ) : null}
                                  </div>
                                </div>
                              </td>
                              <td>
                                <div className="settings-inline">
                                  <input
                                    className="field-input settings-input"
                                    value={draftValue.name}
                                    onChange={(e) => patchCustomerAccountDraft(customer.id, { name: e.target.value })}
                                  />
                                  {customer.isInternalSandbox ? <span className="chip tone-warning">Sandbox</span> : null}
                                </div>
                              </td>
                              <td>
                                <div className="settings-cellStrong">{customer.id}</div>
                              </td>
                              <td>
                                <div className="settings-field">
                                  <input
                                    className="field-input settings-input"
                                    value={draftValue.liftCustomerId}
                                    onChange={(e) => patchCustomerAccountDraft(customer.id, { liftCustomerId: e.target.value })}
                                    placeholder="Lift account id"
                                  />
                                  <span className={`settings-fieldMeta ${draftValue.liftCustomerId.trim() ? "" : "is-warning"}`}>
                                    {customer.isInternalSandbox
                                      ? "Demo Lift account used for internal sandbox orders."
                                      : draftValue.liftCustomerId.trim()
                                        ? "Mapped and ready for Lift routing."
                                        : "Required before live Lift submission."}
                                  </span>
                                </div>
                              </td>
                              <td>
                                <div className="settings-field">
                                  <select
                                    className="select settings-input"
                                    value={draftValue.status}
                                    onChange={(e) =>
                                      patchCustomerAccountDraft(customer.id, {
                                        status: e.target.value as CustomerStatus,
                                      })
                                    }
                                  >
                                    <option value="active">Active</option>
                                    <option value="suspended">Suspended</option>
                                    <option value="inactive">Inactive</option>
                                  </select>
                                  <span className="settings-fieldMeta">{customerStatusMeta(draftValue.status).detail}</span>
                                </div>
                              </td>
                              <td>{customer.marketCount}</td>
                              <td>{customer.venueCount}</td>
                              <td>{customer.projectCount}</td>
                              <td>
                                <button
                                  className="btn btn-ghost btn-soft"
                                  type="button"
                                  disabled={!isDirty || customerAccountSavingId === customer.id}
                                  onClick={() => void saveCustomerAccount(customer)}
                                >
                                  {customerAccountSavingId === customer.id ? "Saving…" : isDirty ? "Save" : "Saved"}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="settings-listItem">
                    <div className="settings-listTitle">Import from Lift customer contacts</div>
                    <div className="settings-listMeta">
                      Search the Lift customer contact list, select the right account, and we’ll prefill the new Adspace customer record with the matching Lift customer id.
                    </div>
                    <div className="settings-note">
                      Recommended path: find the customer in Lift first, confirm the Lift customer id, then create the Adspace customer record from that selection.
                    </div>
                    <div className="settings-actions">
                      <input
                        className="field-input settings-input"
                        value={liftCustomerImport.search}
                        onChange={(e) =>
                          setLiftCustomerImport((current) => ({
                            ...current,
                            search: e.target.value,
                            error: null,
                          }))
                        }
                        placeholder="Search Lift customer name, id, number, or rep"
                      />
                      <button
                        className="btn btn-ghost btn-soft"
                        type="button"
                        disabled={liftCustomerImport.loading}
                        onClick={() => void searchLiftCustomers()}
                      >
                        {liftCustomerImport.loading ? "Searching…" : "Search Lift"}
                      </button>
                    </div>
                    {liftCustomerImport.error ? (
                      <div className="settings-feedback settings-feedback-error">{liftCustomerImport.error}</div>
                    ) : null}
                    {liftCustomerImport.results.length ? (
                      <div className="table-wrap">
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>Lift ID</th>
                              <th>Name</th>
                              <th>Number</th>
                              <th>Status</th>
                              <th>Sales Rep</th>
                              <th>Invoice Email</th>
                              <th>Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {liftCustomerImport.results.map((customer) => {
                              const isSelected = liftCustomerImport.selectedCustomerId === customer.customerId;
                              return (
                                <tr key={customer.customerId}>
                                  <td>{customer.customerId}</td>
                                  <td>{customer.customerName}</td>
                                  <td>{customer.customerNumber || "—"}</td>
                                  <td>{customer.customerStatus || "—"}</td>
                                  <td>{customer.salesRep || "—"}</td>
                                  <td>{customer.defaultInvoiceEmailAddress || "—"}</td>
                                  <td>
                                    <button
                                      className={`btn ${isSelected ? "btn-primary" : "btn-ghost btn-soft"}`.trim()}
                                      type="button"
                                      onClick={() => applyLiftCustomerToDraft(customer)}
                                    >
                                      {isSelected ? "Selected" : "Use"}
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                    {selectedLiftImportCustomer ? (
                      <div className="settings-importCard">
                        <div className="settings-cardHead">
                          <div>
                            <div className="settings-listTitle">Selected Lift customer</div>
                            <div className="settings-listMeta">
                              This record will prefill the new Adspace customer draft so we keep Lift id mapping clean from the start.
                            </div>
                          </div>
                          <span className="chip tone-info">Lift import ready</span>
                        </div>
                        <div className="settings-fieldGrid settings-fieldGrid-3">
                          <div className="settings-kvCard">
                            <span className="settings-k">Lift customer id</span>
                            <span className="settings-v settings-v-left">{selectedLiftImportCustomer.customerId}</span>
                          </div>
                          <div className="settings-kvCard">
                            <span className="settings-k">Customer number</span>
                            <span className="settings-v settings-v-left">{selectedLiftImportCustomer.customerNumber || "—"}</span>
                          </div>
                          <div className="settings-kvCard">
                            <span className="settings-k">Status</span>
                            <span className="settings-v settings-v-left">{selectedLiftImportCustomer.customerStatus || "—"}</span>
                          </div>
                        </div>
                        <div className="settings-fieldGrid settings-fieldGrid-2">
                          <div className="settings-kvCard">
                            <span className="settings-k">Sales rep</span>
                            <span className="settings-v settings-v-left">{selectedLiftImportCustomer.salesRep || "—"}</span>
                          </div>
                          <div className="settings-kvCard">
                            <span className="settings-k">Invoice email</span>
                            <span className="settings-v settings-v-left">{selectedLiftImportCustomer.defaultInvoiceEmailAddress || "—"}</span>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="settings-listItem">
                    <div className="settings-listTitle">Add customer account</div>
                    <div className="settings-listMeta">
                      Create manually, or start from a Lift import above and adjust the Adspace customer id before saving.
                    </div>
                    {selectedLiftImportCustomer ? (
                      <div className="settings-note">
                        Draft prefilled from <strong>{selectedLiftImportCustomer.customerName}</strong> with Lift customer id{" "}
                        <strong>{selectedLiftImportCustomer.customerId}</strong>. Adjust the Adspace customer id only if you want a different internal slug.
                      </div>
                    ) : null}
                    <div className="settings-fieldGrid settings-fieldGrid-3">
                      <label className="settings-field">
                        <span className="settings-fieldLabel">Customer name</span>
                        <input
                          className="field-input settings-input"
                          value={newCustomerDraft.name}
                          onChange={(e) => setNewCustomerDraft((current) => ({ ...current, name: e.target.value }))}
                          placeholder="Intersection"
                        />
                      </label>
                      <label className="settings-field">
                        <span className="settings-fieldLabel">Adspace customer id</span>
                        <input
                          className="field-input settings-input"
                          value={newCustomerDraft.id}
                          onChange={(e) =>
                            setNewCustomerDraft((current) => ({
                              ...current,
                              id: e.target.value.toLowerCase().replace(/[^a-z0-9_:-]/g, "_"),
                            }))
                          }
                          placeholder="intersection"
                        />
                      </label>
                      <label className="settings-field">
                        <span className="settings-fieldLabel">Lift customer id</span>
                        <input
                          className="field-input settings-input"
                          value={newCustomerDraft.liftCustomerId}
                          onChange={(e) => setNewCustomerDraft((current) => ({ ...current, liftCustomerId: e.target.value }))}
                          placeholder="Lift account id"
                        />
                      </label>
                    </div>
                    <div className="settings-actions">
                      <label className="settings-field">
                        <span className="settings-fieldLabel">Customer status</span>
                        <select
                          className="select settings-input"
                          value={newCustomerDraft.status}
                          onChange={(e) =>
                            setNewCustomerDraft((current) => ({
                              ...current,
                              status: e.target.value as CustomerStatus,
                            }))
                          }
                        >
                          <option value="active">Active</option>
                          <option value="suspended">Suspended</option>
                          <option value="inactive">Inactive</option>
                        </select>
                      </label>
                      <button
                        className="btn btn-primary"
                        type="button"
                        disabled={!newCustomerDraft.id.trim() || !newCustomerDraft.name.trim() || customerAccountSavingId === "new"}
                        onClick={() => void addCustomerAccount()}
                      >
                        {customerAccountSavingId === "new" ? "Adding…" : "Add Customer"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </Panel>

            {sandboxCustomerAccount ? (
              <Panel className="settings-panel">
                <div className="settings-cardHead">
                  <div>
                    <div className="settings-sectionEyebrow">Internal Sandbox Customer</div>
                    <h3 className="settings-cardTitle">Safe Lift demo routing for cross-customer venue testing</h3>
                  </div>
                  <span className="chip tone-warning">Internal-only</span>
                </div>
                <div className="settings-formGrid">
                  <div className="settings-note">
                    Sandbox projects route to the Lift demo customer instead of the venue owner’s real customer id, and they stay off customer dashboards and shared access.
                  </div>
                  <div className="settings-fieldGrid settings-fieldGrid-3">
                    <div className="settings-listItem">
                      <div className="settings-listTitle">Customer name</div>
                      <div className="settings-listMeta">{sandboxCustomerAccount.name}</div>
                    </div>
                    <div className="settings-listItem">
                      <div className="settings-listTitle">Adspace customer id</div>
                      <div className="settings-listMeta">{sandboxCustomerAccount.id}</div>
                    </div>
                    <div className="settings-listItem">
                      <div className="settings-listTitle">Lift customer id</div>
                      <div className="settings-listMeta">{sandboxCustomerAccount.liftCustomerId || "Missing"}</div>
                    </div>
                  </div>
                </div>
              </Panel>
            ) : null}

            <Panel className="settings-panel settings-panel-wide">
              <div className="settings-cardHead">
                <div>
                  <div className="settings-sectionEyebrow">Users & Access</div>
                  <h3 className="settings-cardTitle">Roles, customer reach, and share defaults</h3>
                </div>
                <span className="chip tone-info">App-wide</span>
              </div>
              {!draft ? (
                <div className="settings-empty">Loading setup…</div>
              ) : (
                <div className="settings-formGrid">
                  <div className="settings-subsection">
                    <div className="settings-subsectionHead">
                      <div className="settings-subsectionTitle">Share defaults</div>
                      <div className="settings-subsectionMeta">App-wide defaults for collaborator links, upload links, transit links, and view-only access.</div>
                    </div>
                    <label className="settings-toggleRow"><input type="checkbox" checked={draft.requireParticipantIdentity} onChange={(e) => patchDraft({ requireParticipantIdentity: e.target.checked })} /><span>Require participant identification before shared edits</span></label>
                    <div className="settings-fieldGrid">
                      <label className="settings-field"><span className="settings-fieldLabel">Collaboration links</span><div className="settings-inline"><label className="settings-toggleMini"><input type="checkbox" checked={draft.shareCollaborationEnabled} onChange={(e) => patchDraft({ shareCollaborationEnabled: e.target.checked })} /> Enabled</label><input className="field-input settings-input" value={draft.shareCollaborationExpiresInDays} onChange={(e) => patchDraft({ shareCollaborationExpiresInDays: e.target.value })} placeholder="No default expiry" inputMode="numeric" /></div></label>
                      <label className="settings-field"><span className="settings-fieldLabel">Artwork upload links</span><div className="settings-inline"><label className="settings-toggleMini"><input type="checkbox" checked={draft.shareArtworkUploadEnabled} onChange={(e) => patchDraft({ shareArtworkUploadEnabled: e.target.checked })} /> Enabled</label><input className="field-input settings-input" value={draft.shareArtworkUploadExpiresInDays} onChange={(e) => patchDraft({ shareArtworkUploadExpiresInDays: e.target.value })} placeholder="No default expiry" inputMode="numeric" /></div></label>
                      <label className="settings-field"><span className="settings-fieldLabel">Transit approval links</span><div className="settings-inline"><label className="settings-toggleMini"><input type="checkbox" checked={draft.shareTransitApprovalEnabled} onChange={(e) => patchDraft({ shareTransitApprovalEnabled: e.target.checked })} /> Enabled</label><input className="field-input settings-input" value={draft.shareTransitApprovalExpiresInDays} onChange={(e) => patchDraft({ shareTransitApprovalExpiresInDays: e.target.value })} placeholder="No default expiry" inputMode="numeric" /></div></label>
                      <label className="settings-field"><span className="settings-fieldLabel">View-only links</span><div className="settings-inline"><label className="settings-toggleMini"><input type="checkbox" checked={draft.shareViewOnlyEnabled} onChange={(e) => patchDraft({ shareViewOnlyEnabled: e.target.checked })} /> Enabled</label><input className="field-input settings-input" value={draft.shareViewOnlyExpiresInDays} onChange={(e) => patchDraft({ shareViewOnlyExpiresInDays: e.target.value })} placeholder="No default expiry" inputMode="numeric" /></div></label>
                    </div>
                  </div>
                  <div className="settings-subsection">
                    <div className="settings-subsectionHead">
                      <div className="settings-subsectionTitle">Internal users</div>
                      <div className="settings-subsectionMeta">This table is limited to true internal platform users. Customer admins are managed from the Customer Admin side of this page.</div>
                    </div>
                    <div className="settings-listItem">
                      <div className="table-wrap">
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>Name</th>
                              <th>Email</th>
                              <th>Role</th>
                              <th>Customer Scope</th>
                              <th>Status</th>
                              <th>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {snapshot?.users.filter((user) => user.role === "platform_admin").map((user) => {
                              const draftValue = userDrafts[user.id] || userDraftFromUser(user);
                              const isDirty = JSON.stringify(draftValue) !== JSON.stringify(userDraftFromUser(user));
                              const customerScope = user.customerIds.length
                                ? user.customerIds
                                    .map((customerId) => snapshot?.customers.find((customer) => customer.id === customerId)?.name || customerId)
                                    .join(", ")
                                : "All customers";
                              return (
                                <tr key={user.id}>
                                  <td>
                                    <input
                                      className="field-input settings-input"
                                      value={draftValue.displayName}
                                      onChange={(e) => patchUserDraft(user.id, { displayName: e.target.value })}
                                    />
                                  </td>
                                  <td>{user.email}</td>
                                  <td>{user.role}</td>
                                  <td>{customerScope}</td>
                                  <td>
                                    <label className="settings-toggleRow settings-toggleRow-inline">
                                      <input
                                        type="checkbox"
                                        checked={draftValue.isActive}
                                        onChange={(e) => patchUserDraft(user.id, { isActive: e.target.checked })}
                                      />
                                      <span>{draftValue.isActive ? "Active" : "Inactive"}</span>
                                    </label>
                                  </td>
                                  <td>
                                    <button
                                      className="btn btn-ghost btn-soft"
                                      type="button"
                                      disabled={!draftValue.displayName.trim() || !isDirty || userSavingId === user.id}
                                      onClick={() => void saveUser(user)}
                                    >
                                      {userSavingId === user.id ? "Saving…" : isDirty ? "Save User" : "Saved"}
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                  <div className="settings-subsection">
                    <div className="settings-subsectionHead">
                      <div className="settings-subsectionTitle">Customer reach</div>
                      <div className="settings-subsectionMeta">Quick visibility into the current customer accounts platform users can reach.</div>
                    </div>
                    <div className="settings-listItem">
                      <div className="settings-listTitle">Customer accounts</div>
                      <div className="settings-pills">{snapshot?.customers.map((customer) => <span key={customer.id} className="chip tone-info">{customer.name}</span>)}</div>
                    </div>
                  </div>
                </div>
              )}
            </Panel>

            <Panel className="settings-panel">
              <div className="settings-cardHead">
                <div>
                  <div className="settings-sectionEyebrow">Notifications</div>
                  <h3 className="settings-cardTitle">Global workflow alerts and delivery posture</h3>
                </div>
                <span className="chip tone-success">Email-first</span>
              </div>
              {!draft ? (
                <div className="settings-empty">Loading setup…</div>
              ) : (
                <div className="settings-formGrid">
                  <div className="settings-note">
                    Sender address is currently fixed to <strong>noreply@adspace360.com</strong>. Immediate rules now send in real time, and digest rules are batched into an hourly summary from the same sender.
                  </div>
                  <label className="settings-toggleRow"><input type="checkbox" checked={draft.notifyProofApproved} onChange={(e) => patchDraft({ notifyProofApproved: e.target.checked })} /><span>Notify when proofs are fully approved</span></label>
                  <label className="settings-toggleRow"><input type="checkbox" checked={draft.notifyTransitDecision} onChange={(e) => patchDraft({ notifyTransitDecision: e.target.checked })} /><span>Notify when transit is accepted or rejected</span></label>
                  <label className="settings-toggleRow"><input type="checkbox" checked={draft.notifyProductionReleased} onChange={(e) => patchDraft({ notifyProductionReleased: e.target.checked })} /><span>Notify when projects are released to production</span></label>
                  <label className="settings-toggleRow"><input type="checkbox" checked={draft.notifyWorkflowErrors} onChange={(e) => patchDraft({ notifyWorkflowErrors: e.target.checked })} /><span>Alert on workflow/system errors</span></label>
                  <label className="settings-field"><span className="settings-fieldLabel">Notification recipients</span><input className="field-input settings-input" value={draft.notificationEmailRecipients} onChange={(e) => patchDraft({ notificationEmailRecipients: e.target.value })} placeholder="support@tlco.com" /></label>
                </div>
              )}
            </Panel>

            <Panel className="settings-panel">
              <div className="settings-cardHead">
                <div>
                  <div className="settings-sectionEyebrow">Workflow Policies</div>
                  <h3 className="settings-cardTitle">Release, transit, and proof locking rules</h3>
                </div>
                <span className="chip tone-warning">Guardrails</span>
              </div>
              {!draft ? (
                <div className="settings-empty">Loading setup…</div>
              ) : (
                <div className="settings-formGrid">
                  <div className="settings-kv"><span className="settings-k">Production approval mode</span><span className="settings-v">Hold for release</span></div>
                  <label className="settings-toggleRow"><input type="checkbox" checked={draft.transitRunsInParallel} onChange={(e) => patchDraft({ transitRunsInParallel: e.target.checked })} /><span>Transit approval runs in parallel with proof approval</span></label>
                  <label className="settings-toggleRow"><input type="checkbox" checked={draft.lockProofUndoAfterRelease} onChange={(e) => patchDraft({ lockProofUndoAfterRelease: e.target.checked })} /><span>Lock proof undo after production release</span></label>
                </div>
              )}
            </Panel>

            <Panel className="settings-panel">
              <div className="settings-cardHead">
                <div>
                  <div className="settings-sectionEyebrow">Data Defaults</div>
                  <h3 className="settings-cardTitle">Inventory scope and map ordering</h3>
                </div>
                <span className="chip tone-neutral">Source of truth</span>
              </div>
              {!draft ? (
                <div className="settings-empty">Loading setup…</div>
              ) : (
                <div className="settings-formGrid">
                  <div className="settings-kv"><span className="settings-k">Project scope default</span><span className="settings-v">All active visible venue inventory</span></div>
                  <label className="settings-field"><span className="settings-fieldLabel">Inactive inventory visibility</span><select className="select settings-input" value={draft.inactiveInventoryVisibilityDefault} onChange={(e) => patchDraft({ inactiveInventoryVisibilityDefault: e.target.value as "hidden" | "show_unavailable" })}><option value="hidden">Hidden</option><option value="show_unavailable">Show unavailable</option></select></label>
                  <label className="settings-toggleRow"><input type="checkbox" checked={draft.respectVenueMapSortOrder} onChange={(e) => patchDraft({ respectVenueMapSortOrder: e.target.checked })} /><span>Respect room / map sort order everywhere</span></label>
                </div>
              )}
            </Panel>

            <Panel className="settings-panel">
              <div className="settings-cardHead">
                <div>
                  <div className="settings-sectionEyebrow">Files & Retention</div>
                  <h3 className="settings-cardTitle">Preview behavior and retention posture</h3>
                </div>
                <span className="chip tone-info">Assets</span>
              </div>
              {!draft ? (
                <div className="settings-empty">Loading setup…</div>
              ) : (
                <div className="settings-formGrid">
                  <label className="settings-toggleRow"><input type="checkbox" checked={draft.previewPdfInLightbox} onChange={(e) => patchDraft({ previewPdfInLightbox: e.target.checked })} /><span>Render PDF previews in lightbox</span></label>
                  <label className="settings-toggleRow"><input type="checkbox" checked={draft.replaceFilePreservesAssignments} onChange={(e) => patchDraft({ replaceFilePreservesAssignments: e.target.checked })} /><span>Preserve assignments when files are replaced</span></label>
                  <div className="settings-fieldGrid">
                    <label className="settings-field"><span className="settings-fieldLabel">Project document retention (days)</span><input className="field-input settings-input" value={draft.projectDocumentRetentionDays} onChange={(e) => patchDraft({ projectDocumentRetentionDays: e.target.value })} inputMode="numeric" /></label>
                    <label className="settings-field"><span className="settings-fieldLabel">Generated record retention (days)</span><input className="field-input settings-input" value={draft.generatedDocumentRetentionDays} onChange={(e) => patchDraft({ generatedDocumentRetentionDays: e.target.value })} inputMode="numeric" /></label>
                  </div>
                </div>
              )}
            </Panel>

            <Panel className="settings-panel settings-panel-wide">
              <div className="settings-cardHead">
                <div>
                  <div className="settings-sectionEyebrow">Primary Print Vendor / Ordering Platform</div>
                  <h3 className="settings-cardTitle">Lift-ready integration configuration</h3>
                </div>
                <span className={`chip ${primaryVendorStatus.tone}`}>{primaryVendorStatus.label}</span>
              </div>
              {!draft ? (
                <div className="settings-empty">Loading setup…</div>
              ) : (
                <div className="settings-formGrid">
                  <label className="settings-toggleRow"><input type="checkbox" checked={draft.primaryPrintVendorEnabled} onChange={(e) => patchDraft({ primaryPrintVendorEnabled: e.target.checked })} /><span>Enable primary print vendor / ordering platform configuration</span></label>
                  <div className="settings-subsection">
                    <div className="settings-subsectionHead">
                      <div className="settings-subsectionTitle">Integration identity</div>
                      <div className="settings-subsectionMeta">Core vendor details and the currently active Lift environment.</div>
                    </div>
                    <div className="settings-fieldGrid settings-fieldGrid-3">
                      <label className="settings-field"><span className="settings-fieldLabel">Vendor name</span><input className="field-input settings-input" value={draft.primaryPrintVendorName} onChange={(e) => patchDraft({ primaryPrintVendorName: e.target.value })} /></label>
                      <label className="settings-field"><span className="settings-fieldLabel">Platform label</span><input className="field-input settings-input" value={draft.primaryPrintPlatformLabel} onChange={(e) => patchDraft({ primaryPrintPlatformLabel: e.target.value })} /></label>
                      <label className="settings-field">
                        <span className="settings-fieldLabel">Active environment</span>
                        <select
                          className="select settings-input"
                          value={draft.primaryPrintActiveEnvironment}
                          onChange={(e) => patchDraft({ primaryPrintActiveEnvironment: e.target.value as LiftEnvironmentKey })}
                        >
                          <option value="prod">Production</option>
                          <option value="qa1">QA1</option>
                        </select>
                      </label>
                    </div>
                  </div>
                  <div className="settings-note">
                    Full endpoint URLs are preferred. Base URL is optional and only needed if you want to use relative endpoint paths or swap to a proxy/gateway later.
                  </div>
                  <div className="settings-subsection">
                    <div className="settings-subsectionHead">
                      <div className="settings-subsectionTitle">Shared credentials</div>
                      <div className="settings-subsectionMeta">These values apply to both Production and QA1 so they only need to be maintained once.</div>
                    </div>
                    <div className="settings-fieldGrid settings-fieldGrid-3">
                      <label className="settings-field"><span className="settings-fieldLabel">Company ID</span><input className="field-input settings-input" value={draft.primaryPrintCompanyId} onChange={(e) => patchDraft({ primaryPrintCompanyId: e.target.value })} placeholder="91" /></label>
                      <label className="settings-field"><span className="settings-fieldLabel">Create-order username</span><input className="field-input settings-input" value={draft.primaryPrintCreateOrderUsername} onChange={(e) => patchDraft({ primaryPrintCreateOrderUsername: e.target.value })} placeholder="Stored once for all environments" /></label>
                      <label className="settings-field">
                        <span className="settings-fieldLabel">Create-order password</span>
                        <div className="settings-secretField">
                          <input
                            className="field-input settings-input settings-secretInput"
                            type={showCreateOrderPassword ? "text" : "password"}
                            value={draft.primaryPrintCreateOrderPassword}
                            onChange={(e) => patchDraft({ primaryPrintCreateOrderPassword: e.target.value })}
                            placeholder="Stored once for all environments"
                          />
                          <button className="btn btn-ghost btn-soft settings-secretToggle" type="button" onClick={() => setShowCreateOrderPassword((current) => !current)}>
                            {showCreateOrderPassword ? "Hide" : "Show"}
                          </button>
                        </div>
                      </label>
                    </div>
                    <div className="settings-fieldGrid settings-fieldGrid-2">
                      <label className="settings-field"><span className="settings-fieldLabel">Proof API client ID</span><input className="field-input settings-input" value={draft.primaryPrintProofClientId} onChange={(e) => patchDraft({ primaryPrintProofClientId: e.target.value })} placeholder="Shared across environments" /></label>
                      <label className="settings-field">
                        <span className="settings-fieldLabel">Proof API client secret</span>
                        <div className="settings-secretField">
                          <input
                            className="field-input settings-input settings-secretInput"
                            type={showProofClientSecret ? "text" : "password"}
                            value={draft.primaryPrintProofClientSecret}
                            onChange={(e) => patchDraft({ primaryPrintProofClientSecret: e.target.value })}
                            placeholder="Shared across environments"
                          />
                          <button className="btn btn-ghost btn-soft settings-secretToggle" type="button" onClick={() => setShowProofClientSecret((current) => !current)}>
                            {showProofClientSecret ? "Hide" : "Show"}
                          </button>
                        </div>
                      </label>
                    </div>
                    <label className="settings-field">
                      <span className="settings-fieldLabel">Default headers</span>
                      <textarea className="field-input settings-textarea" value={draft.primaryPrintDefaultHeaders} onChange={(e) => patchDraft({ primaryPrintDefaultHeaders: e.target.value })} placeholder='{"X-App-Source":"Adspace360"}' />
                    </label>
                  </div>
                  <div className="settings-subsection settings-subsection-endpoints">
                    <div className="settings-subsectionHead">
                      <div className="settings-subsectionTitle">
                        {draft.primaryPrintActiveEnvironment === "prod" ? "Production endpoints" : "QA1 endpoints"}
                      </div>
                      <div className="settings-subsectionMeta">
                      These URLs are used for the currently active Lift environment. AS360Orders is the slim order/line read, and AS360ProofReport is the proof URL/status read.
                      </div>
                    </div>
                    {activeLiftEnvironmentDraft ? (
                      <div className="settings-fieldGrid settings-fieldGrid-2">
                        <label className="settings-field"><span className="settings-fieldLabel">Base URL (optional)</span><input className="field-input settings-input" value={activeLiftEnvironmentDraft.baseUrl} onChange={(e) => patchLiftEnvironment(activeLiftEnvironment, { baseUrl: e.target.value })} placeholder="Optional: https://lift.example.com" /></label>
                        <label className="settings-field"><span className="settings-fieldLabel">Create order URL</span><input className="field-input settings-input" value={activeLiftEnvironmentDraft.orderEndpointUrl} onChange={(e) => patchLiftEnvironment(activeLiftEnvironment, { orderEndpointUrl: e.target.value })} placeholder={draft.primaryPrintActiveEnvironment === "prod" ? "https://ltlco.lifterp.com/ords/api/lift/erp/api/create_order" : "http://devcompute/lifterp-qa1/lifterp/liftqa1/erp/api/create_order"} /></label>
                        <label className="settings-field"><span className="settings-fieldLabel">Fallback order lookup URL</span><input className="field-input settings-input" value={activeLiftEnvironmentDraft.fallbackOrderLookupUrl} onChange={(e) => patchLiftEnvironment(activeLiftEnvironment, { fallbackOrderLookupUrl: e.target.value })} placeholder="Full URL or relative path" /></label>
                        <label className="settings-field"><span className="settings-fieldLabel">AS360Orders / Flush sync URL</span><input className="field-input settings-input" value={activeLiftEnvironmentDraft.flushSyncUrl} onChange={(e) => patchLiftEnvironment(activeLiftEnvironment, { flushSyncUrl: e.target.value })} placeholder="Full URL or relative path" /></label>
                        <label className="settings-field"><span className="settings-fieldLabel">Proof endpoint URL template</span><input className="field-input settings-input" value={activeLiftEnvironmentDraft.proofEndpointUrlTemplate} onChange={(e) => patchLiftEnvironment(activeLiftEnvironment, { proofEndpointUrlTemplate: e.target.value })} placeholder="Use %0 for company id and %1 for proofing id" /></label>
                        <label className="settings-field"><span className="settings-fieldLabel">Order URL resolver URL</span><input className="field-input settings-input" value={activeLiftEnvironmentDraft.orderUrlResolverUrl} onChange={(e) => patchLiftEnvironment(activeLiftEnvironment, { orderUrlResolverUrl: e.target.value })} placeholder="Full URL or relative path" /></label>
                        <label className="settings-field"><span className="settings-fieldLabel">AS360ProofReport URL</span><input className="field-input settings-input" value={activeLiftEnvironmentDraft.proofUrlResolverUrl} onChange={(e) => patchLiftEnvironment(activeLiftEnvironment, { proofUrlResolverUrl: e.target.value })} placeholder="Full URL or relative path" /></label>
                        <label className="settings-field"><span className="settings-fieldLabel">Customer contact list URL</span><input className="field-input settings-input" value={activeLiftEnvironmentDraft.customerContactListUrl} onChange={(e) => patchLiftEnvironment(activeLiftEnvironment, { customerContactListUrl: e.target.value })} placeholder="Full URL or relative path" /></label>
                      </div>
                    ) : null}
                  </div>
                  <label className="settings-field"><span className="settings-fieldLabel">Payload notes / mapping posture</span><textarea className="field-input settings-textarea" value={draft.primaryPrintPayloadNotes} onChange={(e) => patchDraft({ primaryPrintPayloadNotes: e.target.value })} placeholder="Document field mappings, proxy fallback behavior, and any special handling for Lift." /></label>
                </div>
              )}
            </Panel>

            <Panel className="settings-panel">
              <div className="settings-cardHead">
                <div>
                  <div className="settings-sectionEyebrow">Integrations</div>
                  <h3 className="settings-cardTitle">Lift posture and retry behavior</h3>
                </div>
                <span className="chip tone-warning">Backend milestone</span>
              </div>
              {!draft ? (
                <div className="settings-empty">Loading setup…</div>
              ) : (
                <div className="settings-formGrid">
                  <label className="settings-toggleRow"><input type="checkbox" checked={draft.liftOrderIntegrationEnabled} onChange={(e) => patchDraft({ liftOrderIntegrationEnabled: e.target.checked })} /><span>Enable Lift order integration posture</span></label>
                  <label className="settings-toggleRow"><input type="checkbox" checked={draft.liftProofSyncEnabled} onChange={(e) => patchDraft({ liftProofSyncEnabled: e.target.checked })} /><span>Enable Lift proof sync posture</span></label>
                  <label className="settings-toggleRow"><input type="checkbox" checked={draft.retryOnTransientLiftFailure} onChange={(e) => patchDraft({ retryOnTransientLiftFailure: e.target.checked })} /><span>Retry on transient Lift failure</span></label>
                </div>
              )}
            </Panel>

            <Panel className="settings-panel">
              <div className="settings-cardHead">
                <div>
                  <div className="settings-sectionEyebrow">Operational Drills</div>
                  <h3 className="settings-cardTitle">Safe rehearsal tools before the first Lift submit</h3>
                </div>
                <span className="chip tone-warning">Internal only</span>
              </div>
              <div className="settings-formGrid">
                <div className="settings-subsection">
                  <div className="settings-subsectionHead">
                    <div className="settings-subsectionTitle">Controlled workflow-error drill</div>
                    <div className="settings-subsectionMeta">Write a realistic workflow issue into Project Activity, Errors, and Health without changing project state or emailing customer recipients.</div>
                  </div>
                  <div className="settings-fieldGrid settings-fieldGrid-2">
                    <label className="settings-field">
                      <span className="settings-fieldLabel">Customer account</span>
                      <select
                        className="select settings-input"
                        value={errorDrill.customerId || selectedCustomerId}
                        onChange={(e) =>
                          setErrorDrill((current) => ({
                            ...current,
                            customerId: e.target.value,
                            error: null,
                            result: null,
                          }))
                        }
                      >
                        {visibleCustomers.map((customer) => (
                          <option key={customer.id} value={customer.id}>
                            {customer.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="settings-field">
                      <span className="settings-fieldLabel">Drill type</span>
                      <select
                        className="select settings-input"
                        value={errorDrill.drillType}
                        onChange={(e) =>
                          setErrorDrill((current) => ({
                            ...current,
                            drillType: e.target.value as ErrorDrillDraft["drillType"],
                            error: null,
                            result: null,
                          }))
                        }
                      >
                        {ERROR_DRILL_OPTIONS.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="settings-note">
                    {ERROR_DRILL_OPTIONS.find((option) => option.id === errorDrill.drillType)?.summary}
                  </div>
                  <div className="settings-actions">
                    <button
                      className="btn btn-ghost btn-soft"
                      type="button"
                      disabled={!visibleCustomers.length || errorDrill.loading}
                      onClick={() => void runErrorDrillHandler()}
                    >
                      {errorDrill.loading ? "Running drill…" : "Run Controlled Error Drill"}
                    </button>
                  </div>
                  {errorDrill.error ? <div className="settings-feedback settings-feedback-error">{errorDrill.error}</div> : null}
                  {errorDrill.result ? (
                    <div className="settings-note">
                      Logged <strong>{ERROR_DRILL_OPTIONS.find((option) => option.id === errorDrill.result?.issue.drillType)?.label || "workflow drill"}</strong> on <strong>{errorDrill.result.project.title}</strong> in {errorDrill.result.project.venueName}. Check Project Activity, the Errors lane, and Health Dashboard for visibility.
                    </div>
                  ) : null}
                </div>
                <div className="settings-subsection">
                  <div className="settings-subsectionHead">
                    <div className="settings-subsectionTitle">First live sandbox submit checklist</div>
                    <div className="settings-subsectionMeta">Keep the first real Lift validation narrow and repeatable.</div>
                  </div>
                  <div className="settings-stack">
                    <div className="settings-kv"><span className="settings-k">Sandbox lane</span><span className="settings-v">Use one internal sandbox project routed to Lift demo customer 1249.</span></div>
                    <div className="settings-kv"><span className="settings-k">Dry-run proof</span><span className="settings-v">Save a Lift payload preview snapshot in Documents before any real submit.</span></div>
                    <div className="settings-kv"><span className="settings-k">Submission checks</span><span className="settings-v">Confirm ext_id, PO fallback, line ordering, and unit-number splits are all green.</span></div>
                    <div className="settings-kv"><span className="settings-k">Live validation owner</span><span className="settings-v">Be ready to inspect Lift order id, line ids, proof urls, flush shape, and order deep link behavior.</span></div>
                  </div>
                </div>
              </div>
            </Panel>
          </>
        ) : (
          <>
            <Panel className="settings-panel settings-panel-wide">
              <div className="settings-cardHead">
                <div>
                  <div className="settings-sectionEyebrow">Customer Admin Scope</div>
                  <h3 className="settings-cardTitle">Account-level recipients, transit defaults, and collaboration behavior</h3>
                </div>
                <span className="chip tone-info">{selectedCustomer?.name || "Choose customer"}</span>
              </div>
              <div className="settings-formGrid">
                <div className="settings-subsection">
                  <div className="settings-subsectionHead">
                    <div className="settings-subsectionTitle">Customer selection</div>
                    <div className="settings-subsectionMeta">Choose the customer account you want to configure, then the sections below will follow that scope.</div>
                  </div>
                  <label className="settings-field">
                    <span className="settings-fieldLabel">Customer account</span>
                    <select
                      className="select settings-input"
                      value={selectedCustomerId}
                      onChange={(e) => {
                        setSelectedCustomerId(e.target.value);
                        setCustomerSaveMessage(null);
                      }}
                      disabled={!visibleCustomers.length}
                    >
                      {visibleCustomers.map((customer) => (
                        <option key={customer.id} value={customer.id}>
                          {customer.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="settings-listMeta">
                    Update display names for customer users here. Role and customer reach remain visible, while broader identity/bootstrap work can come later.
                  </div>
                </div>
              </div>
            </Panel>

            <Panel className="settings-panel settings-panel-wide">
              <div className="settings-cardHead">
                <div>
                  <div className="settings-sectionEyebrow">Proof Approval</div>
                  <h3 className="settings-cardTitle">Proof approval posture for {selectedCustomer?.name || "this customer"}</h3>
                </div>
                <span className="chip tone-warning">Customer policy</span>
              </div>
              {!customerDraft ? (
                <div className="settings-empty">Select a customer to load proof approval settings.</div>
              ) : (
                <div className="settings-subsection">
                  <div className="settings-subsectionHead">
                    <div className="settings-subsectionTitle">Client approval behavior</div>
                    <div className="settings-subsectionMeta">This setting applies only to the selected customer account above.</div>
                  </div>
                  <div className="settings-formGrid">
                    <label className="settings-field">
                      <span className="settings-fieldLabel">Proof approval mode</span>
                      <select
                        className="select settings-input"
                        value={customerDraft.productionApprovalMode}
                        onChange={(e) => patchCustomerDraft({ productionApprovalMode: e.target.value as CustomerDraftSettings["productionApprovalMode"] })}
                      >
                        <option value="hold_for_release">Production Release queue</option>
                        <option value="direct">Direct proof approvals</option>
                      </select>
                    </label>
                    <div className="settings-miniNote">
                      {customerDraft.productionApprovalMode === "direct"
                        ? "Approved proof lines become production-ready without a separate release step."
                        : "Approved proofs wait for client admin release before production/vendor action."}
                    </div>
                  </div>
                </div>
              )}
            </Panel>

            <Panel className="settings-panel settings-panel-wide">
              <div className="settings-cardHead">
                <div>
                  <div className="settings-sectionEyebrow">Customer Users</div>
                  <h3 className="settings-cardTitle">People attached to this customer account</h3>
                </div>
                <span className="chip tone-info">{customerSnapshot?.users.length || 0} users</span>
              </div>
              {!customerSnapshot ? (
                <div className="settings-empty">Loading customer users…</div>
              ) : (
                <div className="settings-subsection">
                  <div className="settings-subsectionHead">
                    <div className="settings-subsectionTitle">Customer users</div>
                    <div className="settings-subsectionMeta">Manage names and active status for the people attached to this customer account.</div>
                  </div>
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Email</th>
                          <th>Role</th>
                          <th>Status</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {customerSnapshot.users.map((user) => {
                          const draftValue = userDrafts[user.id] || userDraftFromUser(user);
                          const isDirty = JSON.stringify(draftValue) !== JSON.stringify(userDraftFromUser(user));
                          return (
                            <tr key={user.id}>
                              <td>
                                <input
                                  className="field-input settings-input"
                                  value={draftValue.displayName}
                                  onChange={(e) => patchUserDraft(user.id, { displayName: e.target.value })}
                                />
                              </td>
                              <td>{user.email}</td>
                              <td>{user.role}</td>
                              <td>
                                <label className="settings-toggleRow settings-toggleRow-inline">
                                  <input
                                    type="checkbox"
                                    checked={draftValue.isActive}
                                    onChange={(e) => patchUserDraft(user.id, { isActive: e.target.checked })}
                                  />
                                  <span>{draftValue.isActive ? "Active" : "Inactive"}</span>
                                </label>
                              </td>
                              <td>
                                <button
                                  className="btn btn-ghost btn-soft"
                                  type="button"
                                  disabled={!draftValue.displayName.trim() || !isDirty || userSavingId === user.id}
                                  onClick={() => void saveUser(user)}
                                >
                                  {userSavingId === user.id ? "Saving…" : isDirty ? "Save User" : "Saved"}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </Panel>

            <Panel className="settings-panel settings-panel-wide">
              <div className="settings-cardHead">
                <div>
                  <div className="settings-sectionEyebrow">Notifications</div>
                  <h3 className="settings-cardTitle">Customer-specific notification matrix</h3>
                </div>
                <span className="chip tone-success">Scoped</span>
              </div>
              {!customerDraft ? (
                <div className="settings-empty">Loading customer settings…</div>
              ) : (
                <div className="settings-formGrid">
                  <div className="settings-subsection">
                    <div className="settings-subsectionHead">
                      <div className="settings-subsectionTitle">Notification rules</div>
                      <div className="settings-subsectionMeta">Route different workflow updates to different recipient groups. Immediate rules send as events happen, while digest rules roll into the next hourly summary.</div>
                    </div>
                    <div className="settings-note">
                      Uses <strong>noreply@adspace360.com</strong> as the sender for both immediate and digest delivery.
                    </div>
                    <div className="settings-list">
                      {customerDraft.notificationRules.map((rule) => (
                        <div key={rule.id} className="settings-listItem">
                          <div className="settings-cardHead">
                            <div>
                              <div className="settings-listTitle">{rule.label || "Notification rule"}</div>
                              <div className="settings-listMeta">Choose the events, recipients, and delivery cadence for this rule.</div>
                            </div>
                            <div className="settings-inline">
                              <span className={`chip ${rule.isActive ? "tone-success" : "tone-neutral"}`}>{rule.isActive ? "Active" : "Paused"}</span>
                              <button className="btn btn-ghost btn-soft" type="button" onClick={() => removeNotificationRule(rule.id)}>
                                Remove
                              </button>
                            </div>
                          </div>
                          <div className="settings-fieldGrid settings-fieldGrid-3">
                            <label className="settings-field">
                              <span className="settings-fieldLabel">Rule label</span>
                              <input
                                className="field-input settings-input"
                                value={rule.label}
                                onChange={(e) => patchNotificationRule(rule.id, { label: e.target.value })}
                                placeholder="Proofing stakeholders"
                              />
                            </label>
                            <label className="settings-field">
                              <span className="settings-fieldLabel">Delivery</span>
                              <select
                                className="select settings-input"
                                value={rule.deliveryMode}
                                onChange={(e) => patchNotificationRule(rule.id, { deliveryMode: e.target.value as NotificationRule["deliveryMode"] })}
                              >
                                <option value="instant">Immediate</option>
                                <option value="digest">Digest / summary</option>
                              </select>
                            </label>
                            <label className="settings-toggleRow settings-toggleRow-inline">
                              <input
                                type="checkbox"
                                checked={rule.isActive}
                                onChange={(e) => patchNotificationRule(rule.id, { isActive: e.target.checked })}
                              />
                              <span>Rule active</span>
                            </label>
                          </div>
                          <label className="settings-field">
                            <span className="settings-fieldLabel">Recipients</span>
                            <input
                              className="field-input settings-input"
                              value={rule.recipients}
                              onChange={(e) => patchNotificationRule(rule.id, { recipients: e.target.value })}
                              placeholder="ops@customer.com, marketing@customer.com"
                            />
                          </label>
                          <div className="settings-eventGrid">
                            {NOTIFICATION_EVENT_OPTIONS.map((option) => {
                              const checked = rule.eventTypes.includes(option.id);
                              return (
                                <label key={option.id} className="settings-eventOption">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => toggleNotificationEvent(rule.id, option.id)}
                                  />
                                  <span>
                                    <strong>{option.label}</strong>
                                    <small>{option.summary}</small>
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="settings-actions">
                      <button className="btn btn-ghost btn-soft" type="button" onClick={addNotificationRule}>
                        Add Notification Rule
                      </button>
                    </div>
                    {snapshot?.viewer.isPlatformAdmin ? (
                      <div className="settings-subsection">
                        <div className="settings-subsectionHead">
                          <div className="settings-subsectionTitle">Notification preview and test-send</div>
                          <div className="settings-subsectionMeta">Preview the exact email shape for one workflow event, or send a safe test copy without changing project state.</div>
                        </div>
                        <div className="settings-fieldGrid settings-fieldGrid-2">
                          <label className="settings-field">
                            <span className="settings-fieldLabel">Workflow event</span>
                            <select
                              className="select settings-input"
                              value={notificationTool.eventType}
                              onChange={(e) =>
                                setNotificationTool((current) => ({
                                  ...current,
                                  eventType: e.target.value as NotificationEventType,
                                  error: null,
                                  feedback: null,
                                  result: null,
                                }))
                              }
                            >
                              {NOTIFICATION_EVENT_OPTIONS.map((option) => (
                                <option key={option.id} value={option.id}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                            <span className="settings-fieldMeta">{selectedNotificationEvent.summary}</span>
                          </label>
                          <label className="settings-field">
                            <span className="settings-fieldLabel">Override recipients (optional)</span>
                            <input
                              className="field-input settings-input"
                              value={notificationTool.recipientsOverride}
                              onChange={(e) =>
                                setNotificationTool((current) => ({
                                  ...current,
                                  recipientsOverride: e.target.value,
                                  error: null,
                                  feedback: null,
                                }))
                              }
                              placeholder="Defaults to your admin email"
                            />
                            <span className="settings-fieldMeta">
                              Leave blank to keep the test safely internal and route it only to the signed-in admin.
                            </span>
                          </label>
                        </div>
                        <div className="settings-note">
                          Test sends default to your signed-in admin email when override recipients are left blank, so we can validate delivery without notifying customer stakeholders.
                        </div>
                        <div className="settings-actions">
                          <button
                            className="btn btn-ghost btn-soft"
                            type="button"
                            disabled={notificationTool.loading || !selectedCustomerId}
                            onClick={() => void previewNotificationRuleDelivery()}
                          >
                            {notificationTool.loading ? "Building preview…" : "Preview Email"}
                          </button>
                          <button
                            className="btn btn-ghost btn-soft"
                            type="button"
                            disabled={notificationTool.sending || !selectedCustomerId}
                            onClick={() => void sendNotificationRuleTest()}
                          >
                            {notificationTool.sending ? "Sending test…" : "Send Test Email"}
                          </button>
                        </div>
                        {notificationTool.error ? <div className="settings-feedback settings-feedback-error">{notificationTool.error}</div> : null}
                        {notificationTool.feedback ? <div className="settings-feedback settings-feedback-success">{notificationTool.feedback}</div> : null}
                        {notificationTool.result ? (
                          <div className="settings-list">
                            <div className="settings-note">
                              Using an <strong>{notificationTool.result.projectSample.source}</strong> project sample: <strong>{notificationTool.result.projectSample.title}</strong> in {notificationTool.result.projectSample.venueName}. Sender stays fixed at <strong>noreply@adspace360.com</strong>, and this sample is currently in <strong>{notificationTool.result.projectSample.projectMode === "internal_sandbox" ? "Internal Sandbox" : "Live"}</strong> mode.
                            </div>
                            <div className="settings-kvCardGrid">
                              <div className="settings-kvCard">
                                <span className="settings-k">Customer</span>
                                <span className="settings-v settings-v-left">{notificationTool.result.customer.name}</span>
                              </div>
                              <div className="settings-kvCard">
                                <span className="settings-k">Workflow event</span>
                                <span className="settings-v settings-v-left">{notificationEventLabel(notificationTool.result.eventType)}</span>
                              </div>
                              <div className="settings-kvCard">
                                <span className="settings-k">Default test recipient</span>
                                <span className="settings-v settings-v-left">{notificationTool.result.defaultTestRecipient || "Signed-in admin"}</span>
                              </div>
                            </div>
                            {notificationTool.result.previews.map((preview) => (
                              <div key={preview.ruleId} className="settings-listItem">
                                <div className="settings-cardHead">
                                  <div>
                                    <div className="settings-listTitle">{preview.ruleLabel}</div>
                                    <div className="settings-listMeta">{preview.deliveryMode === "digest" ? "Digest summary" : "Immediate email"} for {notificationEventLabel(notificationTool.result?.eventType || notificationTool.eventType)}</div>
                                  </div>
                                  <span className="chip tone-info">{preview.deliveryMode}</span>
                                </div>
                                <div className="settings-stack">
                                  <div className="settings-kv"><span className="settings-k">Configured recipients</span><span className="settings-v">{preview.configuredRecipients.join(", ") || "None"}</span></div>
                                  <div className="settings-kv"><span className="settings-k">Test recipients</span><span className="settings-v">{preview.effectiveRecipients.join(", ") || "None"}</span></div>
                                  <div className="settings-kv"><span className="settings-k">Subject</span><span className="settings-v">{preview.subject}</span></div>
                                </div>
                                <div className="settings-previewGrid">
                                  <label className="settings-field">
                                    <span className="settings-fieldLabel">Email HTML preview</span>
                                    <iframe
                                      className="settings-emailFrame"
                                      title={`${preview.ruleLabel} html preview`}
                                      srcDoc={preview.html}
                                    />
                                  </label>
                                  <label className="settings-field">
                                    <span className="settings-fieldLabel">Email text preview</span>
                                    <textarea className="field-input settings-textarea" value={preview.text} readOnly />
                                  </label>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              )}
            </Panel>

            <Panel className="settings-panel">
              <div className="settings-cardHead">
                <div>
                  <div className="settings-sectionEyebrow">Transit Approval</div>
                  <h3 className="settings-cardTitle">Default TA posture for this customer</h3>
                </div>
                <span className="chip tone-warning">Customer policy</span>
              </div>
              {!customerDraft ? (
                <div className="settings-empty">Loading customer settings…</div>
              ) : (
                <div className="settings-subsection">
                  <div className="settings-subsectionHead">
                    <div className="settings-subsectionTitle">Transit defaults</div>
                    <div className="settings-subsectionMeta">Define how transit approval behaves by default for this customer’s new projects.</div>
                  </div>
                  <div className="settings-formGrid">
                    <label className="settings-field"><span className="settings-fieldLabel">Default transit approval mode</span><select className="select settings-input" value={customerDraft.transitApprovalDefaultMode} onChange={(e) => patchCustomerDraft({ transitApprovalDefaultMode: e.target.value as CustomerDraftSettings["transitApprovalDefaultMode"] })}><option value="enabled_all_orders">On for all orders by default</option><option value="manual_per_project">Manual enablement per project</option></select></label>
                    <label className="settings-toggleRow"><input type="checkbox" checked={customerDraft.allowTransitProjectOverride} onChange={(e) => patchCustomerDraft({ allowTransitProjectOverride: e.target.checked })} /><span>Allow project-level override of the customer TA default</span></label>
                  </div>
                </div>
              )}
            </Panel>

            <Panel className="settings-panel">
              <div className="settings-cardHead">
                <div>
                  <div className="settings-sectionEyebrow">Collaboration</div>
                  <h3 className="settings-cardTitle">Shared-link posture for this customer</h3>
                </div>
                <span className="chip tone-info">Customer defaults</span>
              </div>
              {!customerDraft ? (
                <div className="settings-empty">Loading customer settings…</div>
              ) : (
                <div className="settings-subsection">
                  <div className="settings-subsectionHead">
                    <div className="settings-subsectionTitle">Shared-link defaults</div>
                    <div className="settings-subsectionMeta">These defaults shape how collaboration behaves when new customer projects are created.</div>
                  </div>
                  <div className="settings-formGrid">
                    <label className="settings-toggleRow"><input type="checkbox" checked={customerDraft.customerShareCollaborationEnabled} onChange={(e) => patchCustomerDraft({ customerShareCollaborationEnabled: e.target.checked })} /><span>Enable end-client collaboration links by default</span></label>
                    <label className="settings-toggleRow"><input type="checkbox" checked={customerDraft.customerShareArtworkUploadEnabled} onChange={(e) => patchCustomerDraft({ customerShareArtworkUploadEnabled: e.target.checked })} /><span>Enable artwork-upload links by default</span></label>
                    <label className="settings-toggleRow"><input type="checkbox" checked={customerDraft.customerShareTransitApprovalEnabled} onChange={(e) => patchCustomerDraft({ customerShareTransitApprovalEnabled: e.target.checked })} /><span>Enable transit approval links by default</span></label>
                    <label className="settings-toggleRow"><input type="checkbox" checked={customerDraft.customerShareViewOnlyEnabled} onChange={(e) => patchCustomerDraft({ customerShareViewOnlyEnabled: e.target.checked })} /><span>Enable view-only links by default</span></label>
                    <label className="settings-toggleRow"><input type="checkbox" checked={customerDraft.customerRequireParticipantIdentity} onChange={(e) => patchCustomerDraft({ customerRequireParticipantIdentity: e.target.checked })} /><span>Require participant identification for this customer’s shared edits</span></label>
                  </div>
                </div>
              )}
            </Panel>

            <Panel className="settings-panel settings-panel-wide">
              <div className="settings-cardHead">
                <div>
                  <div className="settings-sectionEyebrow">External Vendors</div>
                  <h3 className="settings-cardTitle">Lightweight customer vendor registry</h3>
                </div>
                <span className="chip tone-neutral">{customerSnapshot?.vendors.length || 0} vendors</span>
              </div>
              {!customerSnapshot ? (
                <div className="settings-empty">Loading vendor registry…</div>
              ) : (
                <div className="settings-formGrid">
                  <div className="settings-kvCardGrid">
                    <div className="settings-kvCard">
                      <span className="settings-k">Active external vendors</span>
                      <span className="settings-v settings-v-left">{activeExternalVendorCount}</span>
                    </div>
                    <div className="settings-kvCard">
                      <span className="settings-k">Routing model</span>
                      <span className="settings-v settings-v-left">Media/product-level routing from Venue Management</span>
                    </div>
                    <div className="settings-kvCard">
                      <span className="settings-k">Default path</span>
                      <span className="settings-v settings-v-left">Primary print vendor unless a variant is routed externally</span>
                    </div>
                  </div>
                  <div className="settings-note">
                    Add only the specialty partners this customer really uses. Venue Management then lets us route specific media variants to one of these vendors without disturbing the primary Lift path.
                  </div>
                  <div className="settings-subsection">
                    <div className="settings-subsectionHead">
                      <div className="settings-subsectionTitle">Vendor registry</div>
                      <div className="settings-subsectionMeta">Keep this list small and product-focused. Venue media variants can route to one of these vendors when they need to move off the primary print vendor.</div>
                    </div>
                    <div className="settings-list">
                      {customerSnapshot.vendors.map((vendor) => {
                        const vendorDraft = vendorDrafts[vendor.id] || vendorDraftFromVendor(vendor);
                        const vendorUserDraft = vendorUserDrafts[vendor.id] || vendorUserDraftFromVendor(vendor);
                        const linkedVendorUsers = (customerSnapshot.users || []).filter((user) =>
                          vendor.vendorAccountId && (user.vendorAccountIds || []).includes(vendor.vendorAccountId)
                        );
                        const isDirty = JSON.stringify(vendorDraft) !== JSON.stringify(vendorDraftFromVendor(vendor));
                        return (
                          <div key={vendor.id} className="settings-listItem">
                            <div className="settings-cardHead">
                              <div>
                                <div className="settings-listTitle">{vendor.name}</div>
                                <div className="settings-listMeta">Used when venue media/products route away from the primary print vendor.</div>
                              </div>
                              <span className={`chip ${vendorDraft.isActive ? "tone-success" : "tone-neutral"}`}>{vendorDraft.isActive ? "Active" : "Inactive"}</span>
                            </div>
                            <div className="settings-fieldGrid settings-fieldGrid-3">
                              <label className="settings-field"><span className="settings-fieldLabel">Vendor name</span><input className="field-input settings-input" value={vendorDraft.name} onChange={(e) => patchVendorDraft(vendor.id, { name: e.target.value })} /></label>
                              <label className="settings-field"><span className="settings-fieldLabel">Contact</span><input className="field-input settings-input" value={vendorDraft.contactName} onChange={(e) => patchVendorDraft(vendor.id, { contactName: e.target.value })} /></label>
                              <label className="settings-field"><span className="settings-fieldLabel">Email</span><input className="field-input settings-input" value={vendorDraft.email} onChange={(e) => patchVendorDraft(vendor.id, { email: e.target.value })} /></label>
                            </div>
                            <div className="settings-fieldGrid settings-fieldGrid-3">
                              <label className="settings-field"><span className="settings-fieldLabel">Phone</span><input className="field-input settings-input" value={vendorDraft.phone} onChange={(e) => patchVendorDraft(vendor.id, { phone: e.target.value })} /></label>
                              <label className="settings-field"><span className="settings-fieldLabel">Notes</span><input className="field-input settings-input" value={vendorDraft.notes} onChange={(e) => patchVendorDraft(vendor.id, { notes: e.target.value })} /></label>
                              <label className="settings-toggleRow settings-toggleRow-inline"><input type="checkbox" checked={vendorDraft.isActive} onChange={(e) => patchVendorDraft(vendor.id, { isActive: e.target.checked })} /><span>Vendor active</span></label>
                            </div>
                            <div className="settings-actions">
                              <button className="btn btn-ghost btn-soft" type="button" disabled={!isDirty || vendorSavingId === vendor.id} onClick={() => void saveVendor(vendor)}>
                                {vendorSavingId === vendor.id ? "Saving…" : isDirty ? "Save Vendor" : "Saved"}
                              </button>
                            </div>
                            <div className="settings-subsection settings-subsectionNested">
                              <div className="settings-subsectionHead">
                                <div>
                                  <div className="settings-subsectionTitle">Vendor users</div>
                                  <div className="settings-subsectionMeta">
                                    Create authenticated workspace users for this vendor account.
                                  </div>
                                </div>
                                <span className="chip tone-neutral">{linkedVendorUsers.length} user{linkedVendorUsers.length === 1 ? "" : "s"}</span>
                              </div>
                              {linkedVendorUsers.length ? (
                                <div className="settings-miniList">
                                  {linkedVendorUsers.map((user) => (
                                    <div key={user.id} className="settings-miniListItem">
                                      <span>{user.displayName || user.email}</span>
                                      <span>{user.email}</span>
                                    </div>
                                  ))}
                                </div>
                              ) : null}
                              <div className="settings-fieldGrid settings-fieldGrid-3">
                                <label className="settings-field">
                                  <span className="settings-fieldLabel">Display name</span>
                                  <input
                                    className="field-input settings-input"
                                    value={vendorUserDraft.displayName}
                                    onChange={(e) => patchVendorUserDraft(vendor.id, { displayName: e.target.value })}
                                    placeholder={vendor.contactName || vendor.name}
                                  />
                                </label>
                                <label className="settings-field">
                                  <span className="settings-fieldLabel">Login email</span>
                                  <input
                                    className="field-input settings-input"
                                    type="email"
                                    value={vendorUserDraft.email}
                                    onChange={(e) => patchVendorUserDraft(vendor.id, { email: e.target.value })}
                                    placeholder={vendor.email || "user@example.com"}
                                  />
                                </label>
                                <label className="settings-field">
                                  <span className="settings-fieldLabel">Role</span>
                                  <select
                                    className="select settings-input"
                                    value={vendorUserDraft.role}
                                    onChange={(e) => patchVendorUserDraft(vendor.id, { role: e.target.value as VendorUserDraft["role"] })}
                                  >
                                    <option value="vendor_user">Vendor user</option>
                                    <option value="vendor_admin">Vendor admin</option>
                                  </select>
                                </label>
                              </div>
                              <div className="settings-actions">
                                <label className="settings-toggleRow settings-toggleRow-inline">
                                  <input
                                    type="checkbox"
                                    checked={vendorUserDraft.sendInvite}
                                    onChange={(e) => patchVendorUserDraft(vendor.id, { sendInvite: e.target.checked })}
                                  />
                                  <span>Send Cognito invite email</span>
                                </label>
                                <button
                                  className="btn btn-primary"
                                  type="button"
                                  disabled={!vendorUserDraft.email.trim() || vendorUserSavingId === vendor.id || !vendorDraft.isActive}
                                  onClick={() => void addVendorUser(vendor)}
                                >
                                  {vendorUserSavingId === vendor.id ? "Creating…" : "Add Vendor User"}
                                </button>
                              </div>
                              {vendorUserCreated?.vendorId === vendor.id ? (
                                <div className="settings-feedback settings-feedback-success settings-vendorUserResult">
                                  <div>{vendorUserCreated.email} is ready for Vendor Workspace.</div>
                                  {vendorUserCreated.temporaryPassword ? (
                                    <div>Temporary password: <strong>{vendorUserCreated.temporaryPassword}</strong></div>
                                  ) : (
                                    <div>Existing Cognito user linked. No password was changed.</div>
                                  )}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="settings-subsection">
                    <div className="settings-subsectionHead">
                      <div className="settings-subsectionTitle">Add external vendor</div>
                      <div className="settings-subsectionMeta">Use this for the small set of specialty partners a customer actually needs, not as a broad CRM list.</div>
                    </div>
                    <div className="settings-fieldGrid settings-fieldGrid-3">
                      <label className="settings-field"><span className="settings-fieldLabel">Vendor name</span><input className="field-input settings-input" value={newVendorDraft.name} onChange={(e) => setNewVendorDraft((current) => ({ ...current, name: e.target.value }))} /></label>
                      <label className="settings-field"><span className="settings-fieldLabel">Contact</span><input className="field-input settings-input" value={newVendorDraft.contactName} onChange={(e) => setNewVendorDraft((current) => ({ ...current, contactName: e.target.value }))} /></label>
                      <label className="settings-field"><span className="settings-fieldLabel">Email</span><input className="field-input settings-input" value={newVendorDraft.email} onChange={(e) => setNewVendorDraft((current) => ({ ...current, email: e.target.value }))} /></label>
                    </div>
                    <div className="settings-fieldGrid settings-fieldGrid-3">
                      <label className="settings-field"><span className="settings-fieldLabel">Phone</span><input className="field-input settings-input" value={newVendorDraft.phone} onChange={(e) => setNewVendorDraft((current) => ({ ...current, phone: e.target.value }))} /></label>
                      <label className="settings-field"><span className="settings-fieldLabel">Notes</span><input className="field-input settings-input" value={newVendorDraft.notes} onChange={(e) => setNewVendorDraft((current) => ({ ...current, notes: e.target.value }))} /></label>
                      <label className="settings-toggleRow settings-toggleRow-inline"><input type="checkbox" checked={newVendorDraft.isActive} onChange={(e) => setNewVendorDraft((current) => ({ ...current, isActive: e.target.checked }))} /><span>Vendor active</span></label>
                    </div>
                    <div className="settings-actions">
                      <button className="btn btn-primary" type="button" disabled={!newVendorDraft.name.trim() || newVendorSaving} onClick={() => void addVendor()}>
                        {newVendorSaving ? "Adding…" : "Add Vendor"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </Panel>
          </>
        )}

        <Panel className="settings-panel settings-panel-wide">
          <div className="settings-cardHead">
            <div>
              <div className="settings-sectionEyebrow">Admin Entry Points</div>
              <h3 className="settings-cardTitle">Configuration and operations surfaces</h3>
            </div>
          </div>
          <div className="settings-subsection">
            <div className="settings-subsectionHead">
              <div className="settings-subsectionTitle">Key admin surfaces</div>
              <div className="settings-subsectionMeta">A quick map of where setup decisions live versus where daily operational monitoring happens.</div>
            </div>
            <div className="settings-list">
              <div className="settings-listItem">
                <div className="settings-listTitle">Venue Management</div>
                <div className="settings-listMeta">Manage markets, venues, maps, inventory records, variant metadata, routing, unit numbers, validation, and room order.</div>
              </div>
              <div className="settings-listItem">
                <div className="settings-listTitle">Project Dashboard</div>
                <div className="settings-listMeta">Review campaigns, workflow state, collaborator access, and release readiness.</div>
              </div>
              <div className="settings-listItem">
                <div className="settings-listTitle">Health Dashboard</div>
                <div className="settings-listMeta">Keep monitoring, counts, and operational posture separate from setup decisions.</div>
              </div>
            </div>
          </div>
        </Panel>
      </div>
    </AppShell>
  );
}
