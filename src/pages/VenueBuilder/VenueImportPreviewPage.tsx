import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Download, Link2, LockKeyhole, MapPin, PackageSearch, PencilLine, Search, Settings2, UnlockKeyhole, Upload, X } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import AppShell from "../../app/AppShell";
import { useApiClient } from "../../api/useApiClient";
import {
  fetchAdminSettings,
  fetchCustomerSettings,
  fetchLiftProducts,
  type ApiCustomerVendor,
  type ApiLiftProduct,
  type ApiShippingDestination,
  type ApiVenueDetailResponse,
  type ApiVenueInventoryPreset,
} from "../../api/projects";
import Panel from "../../components/common/Panel";
import PageHeader from "../../components/common/PageHeader";
import InventoryScopeModal from "../../components/projects/InventoryScopeModal";
import { useSharedMapWorkspace } from "../../components/maps/useSharedMapWorkspace";
import { mockMaps } from "../../logic/mockAssignment";
import { triggerBrowserDownload } from "../../logic/downloads";
import {
  isRequiredCanonicalField,
  normalizeInventoryImportRows,
  parseCsvText,
  resolveCanonicalField,
} from "../../domain/venueBuilder/inventoryImport";
import type { InventoryImportDraft, VenueImportCanonicalField, VenueImportHeaderOverride } from "../../domain/venueBuilder/types";
import "../../styles/venueBuilder.css";

type LoadTone = "idle" | "success" | "warning";
type ImportProfile = {
  id: string;
  name: string;
  inactiveVisibilityMode: "hidden" | "show_unavailable";
  headerOverrides: Partial<Record<string, VenueImportHeaderOverride>>;
  updatedAt: string;
};

type VenueRecord = {
  id: string;
  customerId?: string;
  name: string;
  customerName: string;
  marketId?: string;
  marketName: string;
  isActive: boolean;
  documentSourceMode?: "adspace" | "external" | "hybrid";
  documentLibraryUrl: string;
  photoGalleryUrl?: string;
  venueDocumentUrl?: string;
  venueVideoUrl?: string;
  shippingDestinationOverrideEnabled?: boolean;
  shippingDestination?: ShippingDestinationInput;
  updatedAt: string;
  roomCount?: number;
  inventoryCount?: number;
  unpinnedCount?: number;
};

type MarketRecord = {
  id: string;
  customerId?: string;
  customerName: string;
  name: string;
  isActive: boolean;
  shippingDestination?: ShippingDestinationInput;
  updatedAt: string;
  venueCount?: number;
};

type ShippingDestinationInput = Omit<ApiShippingDestination, "configured" | "source" | "sourceLabel">;

type RoomRecord = {
  id: string;
  venueId: string;
  name: string;
  sortOrder?: number;
  mapAssetName?: string;
  mapUrl?: string;
  inventoryCount: number;
  unpinnedCount: number;
  updatedAt: string;
};

type CustomerRecord = {
  id: string;
  name: string;
  status?: "active" | "suspended" | "inactive";
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
};

type DetailTab = "setup" | "inventory" | "placement";
type ImportStep = "source" | "validate" | "review" | "confirm" | "results";
type ImportPlanSnapshot = {
  mode: "merge" | "replace";
  incomingCount: number;
  unknownMapCount: number;
  matchedCount: number;
  updatedCount: number;
  unchangedCount: number;
  addedCount: number;
  retainedMissingCount: number;
  replaceRemovalCount: number;
  rowMappingsPreserved: number;
  variantMappingsPreserved: number;
  existingVariantsReused: number;
  newVariantCount: number;
  orphanedVariantCount: number;
  orphanedVariantKeys: string[];
};
type InventoryImportResponse = {
  importedCount: number;
  variantCount: number;
  importMode: "merge" | "replace";
  replaceExisting: boolean;
  addedCount: number;
  updatedCount: number;
  retainedMissingCount: number;
  preservedInventoryMappingCount: number;
  preservedVariantMappingCount: number;
  orphanedVariantCount: number;
};
type ImportApplyResult = InventoryImportResponse & {
  appliedAt: string;
  sourceLabel: string;
  plan: ImportPlanSnapshot;
  risks: Array<{ title: string; detail: string; tone: "warning" | "info" }>;
};
type VenueInventoryHistoryEvent = {
  eventType: string;
  scopeId?: string;
  actorName?: string;
  createdAt: string;
  detail: Record<string, any>;
};
type VenueReadinessAction =
  | "open_import"
  | "missing_maps"
  | "missing_identifiers"
  | "variant_mapping"
  | "missing_dimensions"
  | "placement_unpinned"
  | "external_vendor_routes"
  | "duplicate_ids";
type VenueReadinessItem = {
  id: string;
  title: string;
  detail: string;
  count: number;
  tone: "ok" | "warning" | "blocked";
  action: string;
  actionId?: VenueReadinessAction;
  actionLabel?: string;
};
type VenueReadinessIssueDetail = {
  actionId: VenueReadinessAction;
  label: string;
  detail: string;
  tone: "warning" | "blocked";
};
type VariantAppearance = {
  color: string;
  abbreviation?: string;
  unitNumber?: string;
  liftProductMapping?: LiftProductMapping | null;
  productionRouting?: "primary" | "external";
  externalVendorId?: string;
};
type LiftProductMapping = {
  liftProductId?: number;
  liftProductName?: string;
  liftCatalogId?: number;
  liftCatalogName?: string;
  liftProductType?: string;
  liftProductStatus?: string;
  liftUnitNumber?: string;
  liftMappedAt?: string;
  liftMappedByName?: string;
};
type LiveVenueVariant = {
  id: string;
  mediaVariantKey: string;
  label: string;
  mediaType?: string;
  color?: string;
  abbreviation?: string;
  unitNumber?: string;
  liftProductMapping?: LiftProductMapping;
  productionRouting?: "primary" | "external";
  externalVendorId?: string;
};
type InventoryRecordOverride = {
  inventoryId?: string;
  locationId?: string;
  locationDetail?: string;
  mapName?: string;
  mediaVariantKey?: string;
  variantLabel?: string;
  mediaType?: string;
  unitNumber?: string;
  liftProductMapping?: LiftProductMapping | null;
  trimHeight?: number | null;
  trimWidth?: number | null;
  safeHeight?: number | null;
  safeWidth?: number | null;
  notes?: string;
  productionRoutingOverride?: "primary" | "external";
  externalVendorIdOverride?: string;
  isActive?: boolean;
  mapVisibilityMode?: "hidden" | "show_unavailable";
  x?: number;
  y?: number;
  deleted?: boolean;
};
type VendorPickerState = {
  recordKeys: string[];
};
type LiftProductMapperState = {
  targetType: "variant" | "inventory";
  variantKey: string;
  variantId?: string;
  variantLabel: string;
  recordKey?: string;
  inventoryItemId?: string | null;
  inventoryId?: string;
  catalogId: string;
  catalogName: string;
  productName: string;
  productId: string;
  productType: "" | "KIT" | "REGULAR" | "SERVICE";
  status: "A" | "I";
  results: ApiLiftProduct[];
  localQuery: string;
  selectedProduct: ApiLiftProduct | null;
  selectedUnitNumber: string;
  loading: boolean;
  error: string;
  hasSearched: boolean;
  hasMore: boolean;
};
type PresetEditorState = {
  mode: "create" | "edit";
  preset?: ApiVenueInventoryPreset;
  name: string;
  description: string;
};
type BulkInventoryField =
  | "availability"
  | "locationId"
  | "locationDetail"
  | "mediaType"
  | "trimHeight"
  | "trimWidth"
  | "safeHeight"
  | "safeWidth"
  | "substrate"
  | "finishing"
  | "dpi"
  | "bleedTop"
  | "bleedRight"
  | "bleedBottom"
  | "bleedLeft"
  | "routing"
  | "unitNumber"
  | "productMapping"
  | "notes";
type BulkInventoryEditDraft = {
  enabled: Partial<Record<BulkInventoryField, boolean>>;
  availability: "active" | "inactive_hidden" | "inactive_unavailable";
  locationId: string;
  locationDetailMode: "replace" | "clear";
  locationDetail: string;
  mediaType: string;
  trimHeight: string;
  trimWidth: string;
  safeHeight: string;
  safeWidth: string;
  substrate: string;
  finishing: string;
  dpi: string;
  bleedTop: string;
  bleedRight: string;
  bleedBottom: string;
  bleedLeft: string;
  routing: "inherit" | "primary" | "external";
  externalVendorId: string;
  unitNumberMode: "replace" | "clear";
  unitNumber: string;
  productMappingMode: "replace" | "clear";
  productId: string;
  productName: string;
  notesMode: "replace" | "append" | "clear";
  notes: string;
};
type BulkInventoryEditorState = {
  recordKeys: string[];
  draft: BulkInventoryEditDraft;
  error: string;
  saving: boolean;
};

const PROFILE_STORAGE_KEY = "adspace360.venue-import-profiles";
const KNOWN_LIFT_CATALOGS = [
  { id: "7146", name: "AS360 Station Dom Master Catalog East" },
  { id: "7147", name: "AS360 Station Dom Master Catalog West" },
  { id: "6338", name: "Penn Station Amtrak - AS360" },
];
const VENUE_INVENTORY_IMPORT_HEADERS = [
  "CustomerName",
  "VenueName",
  "MapName",
  "UnitNumber",
  "InventoryID",
  "MediaType",
  "TrimHeight",
  "TrimWidth",
  "SafeHeight",
  "SafeWidth",
  "Substrate",
  "Finishing",
  "LocationDetail",
  "Notes",
  "DPI",
  "Bleed_Top",
  "Bleed_Right",
  "Bleed_Bot",
  "Bleed_Left",
  "Active",
];
const VENUE_INVENTORY_EXPORT_REFERENCE_HEADERS = [
  "LiftProductID",
  "LiftProductName",
  "LiftCatalogID",
  "LiftCatalogName",
  "LiftUnitNumber",
  "LiftMappingSource",
  "MapVisibilityReference",
];

function escapeCsvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function buildCsvText(headers: string[], rows: Array<Record<string, unknown>>) {
  return [
    headers.map(escapeCsvCell).join(","),
    ...rows.map((row) => headers.map((header) => escapeCsvCell(row[header])).join(",")),
  ].join("\n");
}

function slugifyDownloadName(value: string) {
  return (value || "venue")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "venue";
}

function downloadCsvText(filename: string, csvTextValue: string) {
  const blob = new Blob([`\uFEFF${csvTextValue}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  triggerBrowserDownload(url, filename);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function createBulkInventoryEditDraft(): BulkInventoryEditDraft {
  return {
    enabled: {},
    availability: "active",
    locationId: "",
    locationDetailMode: "replace",
    locationDetail: "",
    mediaType: "",
    trimHeight: "",
    trimWidth: "",
    safeHeight: "",
    safeWidth: "",
    substrate: "",
    finishing: "",
    dpi: "",
    bleedTop: "",
    bleedRight: "",
    bleedBottom: "",
    bleedLeft: "",
    routing: "inherit",
    externalVendorId: "",
    unitNumberMode: "replace",
    unitNumber: "",
    productMappingMode: "replace",
    productId: "",
    productName: "",
    notesMode: "append",
    notes: "",
  };
}
const DEFAULT_PENN_SAMPLE_CSV = `Tenant name,Venue name,Room name,Unit Sku,Ad Space Key,Media,Substrate,Trim Height,Trim Width,Safe Area Height,Safe Area Width,Sq Ft,Location,Finishing,Special Instructions,Addl Info,Active Flag
Intersection,Penn Station,Amtrak Track Level,2SHEET_46x60_48PT,PS-2-001,2-Sheet,48 PT,46.2,60.2,43,57,,Track Level Bay 1,,, ,Y
Intersection,Penn Station,Amtrak Track Level,2SHEET_46x60_48PT,PS-2-002,2-Sheet,48 PT,46.2,60.2,43,57,,Track Level Bay 2,,, ,Y
Intersection,Penn Station,Amtrak Track Level,2SHEET_46x60_48PT,PS-2-003,2-Sheet,48 PT,46.2,60.2,43,57,,Track Level Bay 3,,, ,Y
Intersection,Penn Station,Amtrak Track Level,2SHEET_46x60_48PT,PS-2-004,2-Sheet,48 PT,46.2,60.2,43,57,,Track Level Bay 4,,, ,Y
Intersection,Penn Station,Amtrak Main Level,NYPENN_CW1,PS-CW-001,Column Wrap,Vinyl,105.25,124,95,120,,Main Level Column 1,,, ,Y
Intersection,Penn Station,Amtrak Main Level,NYPENN_CW2,PS-CW-002,Column Wrap,Vinyl,106.5,124,95,120,,Main Level Column 2,,, ,Y
Intersection,Penn Station,Amtrak Main Level,NYPENN_CW3,PS-CW-003,Column Wrap,Vinyl,105.5,134,95,130,,Main Level Column 3,,, ,Y
Intersection,Penn Station,Amtrak Main Level,NYPENN_BN1,PS-BN-001,Banner,Fabric,54.5,485,42.5,477,,Main Level Banner,,, ,Y
Intersection,Penn Station,Hilton Passageway,3SHEET_84x42_48PT,PS-3-001,3-Sheet,48 PT,84.2,42.2,79,37,,Passageway East 1,,, ,Y
Intersection,Penn Station,Hilton Passageway,3SHEET_84x42_48PT,PS-3-002,3-Sheet,48 PT,84.2,42.2,79,37,,Passageway East 2,,, ,Y
Intersection,Penn Station,Hilton Passageway,3SHEET_84x42_48PT,PS-3-003,3-Sheet,48 PT,84.2,42.2,79,37,,Passageway West 1,,, ,Y
Intersection,Penn Station,Hilton Passageway,NYPENN_SRS1,PS-SR-001,Stair Riser,Vinyl,7.5,48,6.75,45,,Passageway Stair 1,,, ,Y
Intersection,Penn Station,Hilton Passageway,NYPENN_SRS1,PS-SR-002,Stair Riser,Vinyl,7.5,48,6.75,45,,Passageway Stair 2,,, ,N
Intersection,Penn Station,Track Stairs,NYPENN_RS1,PS-RB-001,Rotunda Banner,Fabric,144,36,136,30,,Track Stair Banner 1,,, ,Y`;
const DEFAULT_VENUES: VenueRecord[] = [
  {
    id: "venue_penn_station",
    name: "Penn Station",
    customerName: "Intersection",
    marketId: "market_intersection_nyc",
    marketName: "New York City",
    isActive: true,
    documentLibraryUrl: "https://drive.google.com/",
    updatedAt: "2026-04-07",
  },
  {
    id: "venue_wtc",
    name: "World Trade Center",
    customerName: "Intersection",
    marketId: "market_intersection_nyc",
    marketName: "New York City",
    isActive: true,
    documentLibraryUrl: "https://drive.google.com/",
    updatedAt: "2026-04-03",
  },
  {
    id: "venue_30th_street",
    name: "30th Street Station",
    customerName: "Intersection",
    marketId: "market_intersection_phl",
    marketName: "Philadelphia",
    isActive: true,
    documentLibraryUrl: "https://drive.google.com/",
    updatedAt: "2026-03-28",
  },
];
const DEFAULT_MARKETS: MarketRecord[] = [
  { id: "market_intersection_nyc", customerName: "Intersection", name: "New York City", isActive: true, updatedAt: "2026-04-07" },
  { id: "market_intersection_phl", customerName: "Intersection", name: "Philadelphia", isActive: true, updatedAt: "2026-03-28" },
];

const emptyShippingDestination: ShippingDestinationInput = {
  label: "",
  company: "",
  attention: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  region: "",
  postalCode: "",
  country: "US",
  phone: "",
  email: "",
  instructions: "",
};

function normalizeShippingDestination(value?: ShippingDestinationInput | null): ShippingDestinationInput {
  return {
    ...emptyShippingDestination,
    ...(value || {}),
  };
}

function shippingDestinationHasValue(value?: ShippingDestinationInput | null) {
  if (!value) return false;
  return Object.entries(value).some(([key, fieldValue]) => key !== "country" && Boolean(String(fieldValue || "").trim()));
}

function shippingDestinationSummary(value?: ShippingDestinationInput | null) {
  if (!shippingDestinationHasValue(value)) return "Not configured";
  const destination = normalizeShippingDestination(value);
  const cityLine = [destination.city, destination.region, destination.postalCode].filter(Boolean).join(", ");
  return [destination.label || destination.company || destination.addressLine1, cityLine].filter(Boolean).join(" · ");
}

function formatLiftDetailLabel(key: string) {
  if (/^flexField\d+$/i.test(key)) return key.replace(/^flexField/i, "Flex ");
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatLiftDetailValue(value: string | number | boolean | null | undefined) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function liftProductDetailRows(product: ApiLiftProduct | null) {
  if (!product) return [];
  const coreRows: Array<[string, string | number | boolean | null | undefined]> = [
    ["Product ID", product.productId],
    ["Product Name", product.productName],
    ["Catalog ID", product.catalogId],
    ["Catalog Name", product.catalogName],
    ["Product Type", product.productType],
    ["Status", product.status],
    ["Accounting Item", product.accountingItemCode],
    ["Parent Product ID", product.parentProductId],
    ["Description", product.productDescription],
  ];
  const detailRows = Object.entries(product.additionalFields || {}).sort(([a], [b]) => {
    const flexA = a.match(/^flexField(\d+)$/i);
    const flexB = b.match(/^flexField(\d+)$/i);
    if (flexA && flexB) return Number(flexA[1]) - Number(flexB[1]);
    if (flexA) return 1;
    if (flexB) return -1;
    return a.localeCompare(b);
  });
  return [...coreRows, ...detailRows.map(([key, value]) => [formatLiftDetailLabel(key), value] as const)]
    .filter(([, value]) => value !== undefined && value !== "");
}

function normalizeLiftProductSearchText(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[_\-./]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function liftProductSearchFields(product: ApiLiftProduct) {
  const additionalValues = Object.values(product.additionalFields || {})
    .filter((value) => value !== null && value !== undefined && value !== "")
    .slice(0, 24);
  return [
    product.productName,
    product.accountingItemCode,
    product.productId,
    product.catalogName,
    product.catalogId,
    product.productType,
    product.status,
    product.productDescription,
    ...(product.unitNumbers || []),
    ...additionalValues,
  ];
}

function scoreLiftProductSearch(product: ApiLiftProduct, rawQuery: string) {
  const query = normalizeLiftProductSearchText(rawQuery);
  if (!query) return 1;

  const productName = normalizeLiftProductSearchText(product.productName);
  const unitText = normalizeLiftProductSearchText((product.unitNumbers || []).join(" "));
  const allText = normalizeLiftProductSearchText(liftProductSearchFields(product).join(" "));
  const tokens = query.split(" ").filter(Boolean);
  if (!tokens.length) return 1;

  let score = 0;
  if (productName === query) score += 120;
  if (productName.startsWith(query)) score += 90;
  if (productName.includes(query)) score += 70;
  if (unitText.includes(query)) score += 62;
  if (String(product.productId || "") === query) score += 60;
  if (allText.includes(query)) score += 44;

  const matchedTokens = tokens.filter((token) => allText.includes(token));
  score += matchedTokens.length * 12;
  if (matchedTokens.length === tokens.length) score += 25;

  const orderedTokenMatch = tokens.reduce(
    (state, token) => {
      const nextIndex = allText.indexOf(token, state.index + 1);
      return nextIndex >= 0 ? { index: nextIndex, count: state.count + 1 } : state;
    },
    { index: -1, count: 0 }
  );
  score += orderedTokenMatch.count * 5;

  return score;
}

function filterLiftProducts(products: ApiLiftProduct[], rawQuery: string) {
  const query = rawQuery.trim();
  if (!query) return products;
  return products
    .map((product, index) => ({ product, index, score: scoreLiftProductSearch(product, query) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.product);
}

function normalizeImportMatchKey(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeImportCompareValue(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function importRecordMatchesExisting(record: InventoryImportDraft, existing: any) {
  const checks: Array<[unknown, unknown]> = [
    [record.mapName, existing.mapName],
    [record.mediaVariantKey, existing.mediaVariantKey],
    [record.variantLabel, existing.variantLabel],
    [record.mediaType, existing.mediaType],
    [record.unitNumber, existing.unitNumber],
    [record.isActive, existing.isActive],
    [record.mapVisibilityMode, existing.mapVisibilityMode],
    [record.trimHeight, existing.trimHeight],
    [record.trimWidth, existing.trimWidth],
    [record.safeHeight, existing.safeHeight],
    [record.safeWidth, existing.safeWidth],
    [record.substrate, existing.substrate],
    [record.finishing, existing.finishing],
    [record.locationDetail, existing.locationDetail],
    [record.notes, existing.notes],
  ];
  return checks.every(([nextValue, currentValue]) => normalizeImportCompareValue(nextValue) === normalizeImportCompareValue(currentValue));
}

function knownLiftCatalogValue(catalogId: string, catalogName: string) {
  const match = KNOWN_LIFT_CATALOGS.find((catalog) =>
    catalog.id === catalogId.trim() ||
    catalog.name.toLowerCase() === catalogName.trim().toLowerCase()
  );
  return match?.id || "";
}

function ShippingDestinationFields({
  destination,
  onChange,
}: {
  destination: ShippingDestinationInput;
  onChange: (patch: Partial<ShippingDestinationInput>) => void;
}) {
  return (
    <div className="venue-preview-shippingGrid">
      <label className="venue-preview-field">
        <span className="venue-preview-fieldLabel">Label</span>
        <input className="field-input venue-preview-input" value={destination.label || ""} onChange={(e) => onChange({ label: e.target.value })} />
      </label>
      <label className="venue-preview-field">
        <span className="venue-preview-fieldLabel">Company</span>
        <input className="field-input venue-preview-input" value={destination.company || ""} onChange={(e) => onChange({ company: e.target.value })} />
      </label>
      <label className="venue-preview-field">
        <span className="venue-preview-fieldLabel">Attention</span>
        <input className="field-input venue-preview-input" value={destination.attention || ""} onChange={(e) => onChange({ attention: e.target.value })} />
      </label>
      <label className="venue-preview-field">
        <span className="venue-preview-fieldLabel">Address 1</span>
        <input className="field-input venue-preview-input" value={destination.addressLine1 || ""} onChange={(e) => onChange({ addressLine1: e.target.value })} />
      </label>
      <label className="venue-preview-field">
        <span className="venue-preview-fieldLabel">Address 2</span>
        <input className="field-input venue-preview-input" value={destination.addressLine2 || ""} onChange={(e) => onChange({ addressLine2: e.target.value })} />
      </label>
      <label className="venue-preview-field">
        <span className="venue-preview-fieldLabel">City</span>
        <input className="field-input venue-preview-input" value={destination.city || ""} onChange={(e) => onChange({ city: e.target.value })} />
      </label>
      <label className="venue-preview-field">
        <span className="venue-preview-fieldLabel">State / Region</span>
        <input className="field-input venue-preview-input" value={destination.region || ""} onChange={(e) => onChange({ region: e.target.value })} />
      </label>
      <label className="venue-preview-field">
        <span className="venue-preview-fieldLabel">Postal Code</span>
        <input className="field-input venue-preview-input" value={destination.postalCode || ""} onChange={(e) => onChange({ postalCode: e.target.value })} />
      </label>
      <label className="venue-preview-field">
        <span className="venue-preview-fieldLabel">Country</span>
        <input className="field-input venue-preview-input" value={destination.country || ""} onChange={(e) => onChange({ country: e.target.value })} />
      </label>
      <label className="venue-preview-field">
        <span className="venue-preview-fieldLabel">Phone</span>
        <input className="field-input venue-preview-input" value={destination.phone || ""} onChange={(e) => onChange({ phone: e.target.value })} />
      </label>
      <label className="venue-preview-field">
        <span className="venue-preview-fieldLabel">Email</span>
        <input className="field-input venue-preview-input" value={destination.email || ""} onChange={(e) => onChange({ email: e.target.value })} />
      </label>
      <label className="venue-preview-field venue-preview-fieldSpan2">
        <span className="venue-preview-fieldLabel">Instructions</span>
        <textarea className="field-input venue-preview-input" value={destination.instructions || ""} onChange={(e) => onChange({ instructions: e.target.value })} />
      </label>
    </div>
  );
}

const ROOM_MAP_ASSET_LOOKUP: Record<string, { assetName: string; imageUrl: string }> = {
  "Amtrak Main Level": {
    assetName: "Penn-Station-Main-Level.svg",
    imageUrl: mockMaps[0]?.imageUrl || "",
  },
  "Amtrak Track Level": {
    assetName: "Penn-Station-Track-Level.svg",
    imageUrl: mockMaps[2]?.imageUrl || "",
  },
  "Hilton Passageway": {
    assetName: "Penn-Station-Hilton-Passageway.svg",
    imageUrl: mockMaps[1]?.imageUrl || "",
  },
  "Track Stairs": {
    assetName: "Penn-Station-Track-Stairs.svg",
    imageUrl: mockMaps[3]?.imageUrl || "",
  },
};
const DEFAULT_ROOMS: RoomRecord[] = [
  {
    id: "room_penn_track",
    venueId: "venue_penn_station",
    name: "Amtrak Track Level",
    mapAssetName: "Penn-Station-Track-Level.pdf",
    mapUrl: ROOM_MAP_ASSET_LOOKUP["Amtrak Track Level"]?.imageUrl || "",
    inventoryCount: 119,
    unpinnedCount: 0,
    updatedAt: "2026-04-07",
  },
  {
    id: "room_penn_main",
    venueId: "venue_penn_station",
    name: "Amtrak Main Level",
    mapAssetName: "Penn-Station-Main-Level.pdf",
    mapUrl: ROOM_MAP_ASSET_LOOKUP["Amtrak Main Level"]?.imageUrl || "",
    inventoryCount: 15,
    unpinnedCount: 1,
    updatedAt: "2026-04-06",
  },
  {
    id: "room_penn_hilton",
    venueId: "venue_penn_station",
    name: "Hilton Passageway",
    mapAssetName: "Penn-Station-Hilton-Passageway.pdf",
    mapUrl: ROOM_MAP_ASSET_LOOKUP["Hilton Passageway"]?.imageUrl || "",
    inventoryCount: 38,
    unpinnedCount: 4,
    updatedAt: "2026-04-05",
  },
  {
    id: "room_penn_stairs",
    venueId: "venue_penn_station",
    name: "Track Stairs",
    mapAssetName: "Penn-Station-Track-Stairs.pdf",
    mapUrl: ROOM_MAP_ASSET_LOOKUP["Track Stairs"]?.imageUrl || "",
    inventoryCount: 9,
    unpinnedCount: 2,
    updatedAt: "2026-04-05",
  },
  {
    id: "room_wtc_main",
    venueId: "venue_wtc",
    name: "Main Hall",
    mapAssetName: "WTC-Main-Hall.pdf",
    mapUrl: mockMaps[0]?.imageUrl || "",
    inventoryCount: 54,
    unpinnedCount: 0,
    updatedAt: "2026-04-03",
  },
];

export default function VenueImportPreviewPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { request } = useApiClient();
  const params = new URLSearchParams(location.search);
  const isCustomerContext = params.get("mode") === "customer" || location.pathname.startsWith("/customer/");
  const customerScopeName = "Intersection";
  const detailVenueId = params.get("venue");

  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [customerVendors, setCustomerVendors] = useState<ApiCustomerVendor[]>([]);
  const [venues, setVenues] = useState<VenueRecord[]>(DEFAULT_VENUES);
  const [markets, setMarkets] = useState<MarketRecord[]>(DEFAULT_MARKETS);
  const [rooms, setRooms] = useState<RoomRecord[]>(DEFAULT_ROOMS);
  const [liveVenueInventory, setLiveVenueInventory] = useState<any[]>([]);
  const [liveVenueVariants, setLiveVenueVariants] = useState<LiveVenueVariant[]>([]);
  const [venueInventoryHistory, setVenueInventoryHistory] = useState<VenueInventoryHistoryEvent[]>([]);
  const [isInventoryHistoryLoading, setIsInventoryHistoryLoading] = useState(false);
  const [liftProductIdentifierMode, setLiftProductIdentifierMode] = useState<"unit_number" | "product_id">("unit_number");
  const [venueViewer, setVenueViewer] = useState<ApiVenueDetailResponse["viewer"] | null>(null);
  const [venueInventoryPresets, setVenueInventoryPresets] = useState<ApiVenueInventoryPreset[]>([]);
  const [presetEditor, setPresetEditor] = useState<PresetEditorState | null>(null);
  const [presetSaveError, setPresetSaveError] = useState("");
  const [vendorPicker, setVendorPicker] = useState<VendorPickerState | null>(null);
  const [vendorSearch, setVendorSearch] = useState("");
  const [bulkInventoryEditor, setBulkInventoryEditor] = useState<BulkInventoryEditorState | null>(null);
  const [liftProductMapper, setLiftProductMapper] = useState<LiftProductMapperState | null>(null);
  const [apiError, setApiError] = useState("");
  const [, setIsVenueDataLoading] = useState(true);
  const [selectedVenueId, setSelectedVenueId] = useState(DEFAULT_VENUES[0]?.id ?? "");
  const [selectedRoomId, setSelectedRoomId] = useState(DEFAULT_ROOMS[0]?.id ?? "");
  const [draggedRoomId, setDraggedRoomId] = useState<string | null>(null);
  const [selectedInventoryId, setSelectedInventoryId] = useState("");
  const [customerFilter, setCustomerFilter] = useState("all");
  const [marketFilter, setMarketFilter] = useState("all");
  const [venueActivityFilter, setVenueActivityFilter] = useState<"all" | "active" | "inactive">("all");
  const [marketActivityFilter, setMarketActivityFilter] = useState<"all" | "active" | "inactive">("all");
  const [venueSearch, setVenueSearch] = useState("");
  const [showCreateVenue, setShowCreateVenue] = useState(false);
  const [showAddMarketForm, setShowAddMarketForm] = useState(false);
  const [detailTab, setDetailTab] = useState<DetailTab>("setup");
  const [expandedVariantInventoryRefs, setExpandedVariantInventoryRefs] = useState<Set<string>>(() => new Set());
  const [showImportModal, setShowImportModal] = useState(false);
  const [importStep, setImportStep] = useState<ImportStep>("source");
  const [importApplyResult, setImportApplyResult] = useState<ImportApplyResult | null>(null);
  const [inventoryEditMode, setInventoryEditMode] = useState(false);
  const canEditVenueInventory = venueViewer?.canEditVenueInventory ?? true;
  const [newVenueCustomerName, setNewVenueCustomerName] = useState("");
  const activeCustomerVendors = useMemo(
    () => customerVendors.filter((vendor) => vendor.isActive),
    [customerVendors]
  );
  const [newVenueName, setNewVenueName] = useState("");
  const [newVenueMarketId, setNewVenueMarketId] = useState("");
  const [newManagedMarketName, setNewManagedMarketName] = useState("");
  const [marketShippingEditorId, setMarketShippingEditorId] = useState<string | null>(null);
  const [marketShippingDraft, setMarketShippingDraft] = useState<ShippingDestinationInput>(emptyShippingDestination);
  const [newRoomName, setNewRoomName] = useState("");
  const [marketSearch, setMarketSearch] = useState("");
  const [placementSearch, setPlacementSearch] = useState("");
  const [placementVariantFilter, setPlacementVariantFilter] = useState("all");
  const [placementPinFilter, setPlacementPinFilter] = useState<"all" | "pinned" | "awaiting">("all");
  const [mapPreviewRoomId, setMapPreviewRoomId] = useState<string | null>(null);
  const [variantAppearanceOverrides, setVariantAppearanceOverrides] = useState<Record<string, VariantAppearance>>({});
  const [recordOverrides, setRecordOverrides] = useState<Record<string, InventoryRecordOverride>>({});
  const [manualRecords] = useState<any[]>([]);
  const [selectedRecordKeys, setSelectedRecordKeys] = useState<string[]>([]);
  const [pinStateOverrides] = useState<Record<string, boolean>>({});
  const [draggingPinRecordKey, setDraggingPinRecordKey] = useState<string | null>(null);
  const [inventorySaveState, setInventorySaveState] = useState<{ tone: "idle" | "saving" | "saved" | "error"; message: string }>({
    tone: "idle",
    message: "",
  });
  const [numericDrafts, setNumericDrafts] = useState<
    Record<string, Partial<Record<"trimHeight" | "trimWidth" | "safeHeight" | "safeWidth", string>>>
  >({});
  const [csvText, setCsvText] = useState("");
  const [sourceLabel, setSourceLabel] = useState("No file loaded");
  const [loadTone, setLoadTone] = useState<LoadTone>("idle");
  const [inactiveVisibilityMode, setInactiveVisibilityMode] = useState<"hidden" | "show_unavailable">("hidden");
  const [inventoryImportMode, setInventoryImportMode] = useState<"merge" | "replace">("merge");
  const [importDelimiter, setImportDelimiter] = useState<"auto" | "comma" | "tab">("auto");
  const [rowSearch, setRowSearch] = useState("");
  const [mapFilter, setMapFilter] = useState("all");
  const [variantFilter, setVariantFilter] = useState("all");
  const [activityFilter, setActivityFilter] = useState<"all" | "active" | "inactive">("all");
  const [readinessFocus, setReadinessFocus] = useState<{ actionId: VenueReadinessAction; label: string } | null>(null);
  const [headerOverrides, setHeaderOverrides] = useState<Partial<Record<string, VenueImportHeaderOverride>>>({});
  const [profileName, setProfileName] = useState("");
  const [profiles, setProfiles] = useState<ImportProfile[]>([]);
  const variantPalette = ["#3F6ED8", "#0f766e", "#d97706", "#7c3aed", "#dc2626", "#0891b2", "#65a30d", "#ea580c"];

  const canonicalFieldOptions: VenueImportCanonicalField[] = [
    "CustomerName",
    "VenueName",
    "MapName",
    "UnitNumber",
    "InventoryID",
    "MediaType",
    "TrimHeight",
    "TrimWidth",
    "SafeHeight",
    "SafeWidth",
    "Substrate",
    "Finishing",
    "LocationDetail",
    "Notes",
    "DPI",
    "Bleed_Top",
    "Bleed_Right",
    "Bleed_Bot",
    "Bleed_Left",
    "Active",
  ];

  function mapVenueRecordFromApi(venue: any): VenueRecord {
    return {
      id: venue.id,
      customerId: venue.customerId,
      name: venue.name,
      customerName: venue.customerName,
      marketId: venue.marketId,
      marketName: venue.marketName,
      isActive: Boolean(venue.isActive),
      documentSourceMode: venue.documentSourceMode || (venue.documentLibraryUrl ? "hybrid" : "adspace"),
      documentLibraryUrl: venue.documentLibraryUrl || "",
      photoGalleryUrl: venue.photoGalleryUrl || "",
      venueDocumentUrl: venue.venueDocumentUrl || "",
      venueVideoUrl: venue.venueVideoUrl || "",
      shippingDestinationOverrideEnabled: Boolean(venue.shippingDestinationOverrideEnabled),
      shippingDestination: normalizeShippingDestination(venue.shippingDestination),
      updatedAt: (venue.updatedAt || "").slice(0, 10),
      roomCount: venue.roomCount ?? 0,
      inventoryCount: venue.inventoryCount ?? 0,
      unpinnedCount: venue.unpinnedCount ?? 0,
    };
  }

  function deriveMarketRecordsFromVenues(venueRecords: VenueRecord[]): MarketRecord[] {
    const byMarketId = new Map<string, MarketRecord>();
    for (const venue of venueRecords) {
      const id = venue.marketId || `${venue.customerId || venue.customerName}:${venue.marketName}`;
      const existing = byMarketId.get(id);
      if (existing) {
        existing.venueCount = (existing.venueCount || 0) + 1;
        if (venue.updatedAt > existing.updatedAt) existing.updatedAt = venue.updatedAt;
        continue;
      }
      byMarketId.set(id, {
        id,
        customerId: venue.customerId,
        customerName: venue.customerName,
        name: venue.marketName,
        isActive: true,
        shippingDestination: undefined,
        updatedAt: venue.updatedAt,
        venueCount: 1,
      });
    }
    return Array.from(byMarketId.values()).sort(
      (a, b) => a.customerName.localeCompare(b.customerName) || a.name.localeCompare(b.name)
    );
  }

  function mapMarketRecordFromApi(market: any): MarketRecord {
    return {
      id: market.id,
      customerId: market.customerId,
      customerName: market.customerName,
      name: market.name,
      isActive: Boolean(market.isActive),
      shippingDestination: normalizeShippingDestination(market.shippingDestination),
      updatedAt: (market.updatedAt || "").slice(0, 10),
      venueCount: market.venueCount ?? 0,
    };
  }

  function mapRoomRecordFromApi(map: any): RoomRecord {
    return {
      id: map.id,
      venueId: map.venueId,
      name: map.name,
      sortOrder: map.sortOrder ?? 0,
      mapAssetName: map.mapAssetName,
      mapUrl: map.mapUrl,
      inventoryCount: map.inventoryCount ?? 0,
      unpinnedCount: map.unpinnedCount ?? 0,
      updatedAt: (map.updatedAt || "").slice(0, 10),
    };
  }

  function mapBackendInventoryRecord(record: any, index: number) {
    return {
      rowNumber: index + 2,
      id: record.id,
      locationId: record.locationId,
      customerName: activeVenue?.customerName || "",
      venueName: activeVenue?.name || "",
      mapName: record.mapName || "",
      inventoryId: record.inventoryId,
      recordKey: `backend||${record.id}`,
      mediaType: record.mediaType || record.variantLabel || "Inventory",
      mediaVariantKey: record.mediaVariantKey,
      variantLabel: record.variantLabel || record.mediaType || record.mediaVariantKey,
      unitNumber: record.unitNumber,
      liftProductMapping: record.liftProductMapping,
      trimHeight: record.trimHeight ?? null,
      trimWidth: record.trimWidth ?? null,
      safeHeight: record.safeHeight ?? null,
      safeWidth: record.safeWidth ?? null,
      substrate: record.substrate,
      finishing: record.finishing,
      locationDetail: record.locationDetail,
      notes: record.notes,
      productionRoutingOverride: record.productionRoutingOverride,
      externalVendorIdOverride: record.externalVendorIdOverride,
      dpi: record.dpi ?? null,
      bleedTop: record.bleedTop ?? null,
      bleedRight: record.bleedRight ?? null,
      bleedBottom: record.bleedBottom ?? null,
      bleedLeft: record.bleedLeft ?? null,
      isActive: Boolean(record.isActive),
      mapVisibilityMode: record.mapVisibilityMode || "hidden",
      x: typeof record.x === "number" ? record.x : null,
      y: typeof record.y === "number" ? record.y : null,
      sourceRow: {},
    };
  }

  const loadVenueDashboardData = useCallback(async () => {
    setIsVenueDataLoading(true);
    setApiError("");

    try {
      const [customerResponse, venueResponse] = await Promise.all([
        request<{ customers: CustomerRecord[] }>("/api/customers?lite=1"),
        request<{ venues: any[] }>("/api/venues"),
      ]);

      const nextVenues = (venueResponse.venues || []).map(mapVenueRecordFromApi);
      const nextCustomers = customerResponse.customers || [];
      const marketResponses = await Promise.all(
        nextCustomers.map((customer) =>
          request<{ markets: any[] }>(`/api/customers/${customer.id}/markets`).catch(() => ({ markets: [] }))
        )
      );
      const nextMarkets = marketResponses.flatMap((response) => (response.markets || []).map(mapMarketRecordFromApi));
      setCustomers(customerResponse.customers || []);
      setMarkets(nextMarkets.length ? nextMarkets : deriveMarketRecordsFromVenues(nextVenues));
      setVenues(nextVenues);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Unable to load venue data");
    } finally {
      setIsVenueDataLoading(false);
    }
  }, [request]);

  const loadVenueInventoryHistory = useCallback(
    async (venueId: string) => {
      if (!venueId) {
        setVenueInventoryHistory([]);
        return;
      }

      try {
        setIsInventoryHistoryLoading(true);
        const response = await request<{ events: VenueInventoryHistoryEvent[] }>(`/api/venues/${venueId}/inventory/history`);
        setVenueInventoryHistory(response.events || []);
      } catch {
        setVenueInventoryHistory([]);
      } finally {
        setIsInventoryHistoryLoading(false);
      }
    },
    [request]
  );

  const loadVenueDetailData = useCallback(
    async (venueId: string) => {
      if (!venueId) {
        setRooms([]);
        setLiveVenueInventory([]);
        setVenueInventoryPresets([]);
        setVenueViewer(null);
        setVenueInventoryHistory([]);
        return;
      }

      try {
        const response = await request<ApiVenueDetailResponse>(`/api/venues/${venueId}`);

        setRooms((response.maps || []).map(mapRoomRecordFromApi));
        setLiveVenueVariants((response.variants || []) as LiveVenueVariant[]);
        setLiveVenueInventory(response.inventory || []);
        setVenueViewer(response.viewer || null);
        if (response.viewer && !response.viewer.canEditVenueInventory) {
          setInventoryEditMode(false);
        }
        setVenueInventoryPresets(response.presets || []);
        setVariantAppearanceOverrides(() => {
          const next: Record<string, VariantAppearance> = {};
          (response.variants || []).forEach((variant: any) => {
            next[variant.mediaVariantKey] = {
              color: variant.color || variantPalette[0],
              abbreviation: variant.abbreviation || buildVariantAbbreviation(variant.label),
              unitNumber: variant.unitNumber,
              liftProductMapping: variant.liftProductMapping,
              productionRouting: variant.productionRouting || "primary",
              externalVendorId: variant.externalVendorId,
            };
          });
          return next;
        });
        setVenues((current) =>
          current.map((venue) =>
            venue.id === venueId
              ? {
                  ...venue,
                  ...mapVenueRecordFromApi(response.venue),
                  roomCount: response.maps?.length ?? venue.roomCount ?? 0,
                  inventoryCount: response.inventory?.length ?? venue.inventoryCount ?? 0,
                  unpinnedCount:
                    response.inventory?.filter((item: any) => item.x == null || item.y == null).length ??
                    venue.unpinnedCount ??
                    0,
                }
              : venue
          )
        );
        void loadVenueInventoryHistory(venueId);
      } catch (error) {
        setApiError(error instanceof Error ? error.message : "Unable to load venue detail");
      }
    },
    [loadVenueInventoryHistory, request]
  );

  useEffect(() => {
    let active = true;
    void (async () => {
      await loadVenueDashboardData();
      if (!active) return;
    })();
    return () => {
      active = false;
    };
  }, [loadVenueDashboardData]);

  useEffect(() => {
    let active = true;
    void (async () => {
      if (!selectedVenueId) {
        setRooms([]);
        setLiveVenueInventory([]);
        setVenueInventoryPresets([]);
        setVenueViewer(null);
        return;
      }
      await loadVenueDetailData(selectedVenueId);
      if (!active) return;
    })();
    return () => {
      active = false;
    };
  }, [loadVenueDetailData, selectedVenueId]);

  const activeVenue = useMemo(
    () => venues.find((venue) => venue.id === selectedVenueId) ?? venues[0] ?? null,
    [selectedVenueId, venues]
  );

  useEffect(() => {
    if (!activeVenue?.customerId) {
      setCustomerVendors([]);
      return;
    }

    let cancelled = false;
    async function loadCustomerVendors() {
      try {
        const response = await fetchCustomerSettings({ request }, activeVenue.customerId as string);
        if (cancelled) return;
        setCustomerVendors(response.vendors.filter((vendor) => vendor.isActive));
      } catch (error) {
        if (cancelled) return;
        console.error("Failed to load customer vendors for venue detail", error);
        setCustomerVendors([]);
      }
    }

    void loadCustomerVendors();
    return () => {
      cancelled = true;
    };
  }, [activeVenue?.customerId, request]);

  useEffect(() => {
    let cancelled = false;
    async function loadLiftIdentifierMode() {
      try {
        const response = await fetchAdminSettings({ request });
        if (cancelled) return;
        setLiftProductIdentifierMode(
          response.settings.integrations.primaryPrintVendor.productIdentifierMode === "product_id"
            ? "product_id"
            : "unit_number"
        );
      } catch (error) {
        if (cancelled) return;
        console.error("Failed to load Lift product identifier mode", error);
        setLiftProductIdentifierMode("unit_number");
      }
    }

    void loadLiftIdentifierMode();
    return () => {
      cancelled = true;
    };
  }, [request]);

  const isDetailMode = Boolean(detailVenueId && venues.some((venue) => venue.id === detailVenueId));
  const projectsPath = "/customer/projects";
  const filteredLiftProducts = useMemo(
    () => filterLiftProducts(liftProductMapper?.results || [], liftProductMapper?.localQuery || ""),
    [liftProductMapper?.localQuery, liftProductMapper?.results]
  );

  const marketsById = useMemo(
    () => new Map(markets.map((market) => [market.id, market])),
    [markets]
  );
  const activeVenueMarket = activeVenue?.marketId ? marketsById.get(activeVenue.marketId) : undefined;

  const customerOptions = useMemo(
    () =>
      (customers.length ? customers.map((customer) => customer.name) : Array.from(new Set(markets.map((market) => market.customerName))))
        .sort((a, b) => a.localeCompare(b)),
    [customers, markets]
  );

  const scopedCustomerName = isCustomerContext ? customerScopeName : customerFilter;

  const marketOptions = useMemo(
    () =>
      Array.from(
        new Set(
          markets
            .filter((market) => (scopedCustomerName === "all" ? true : market.customerName === scopedCustomerName))
            .map((market) => market.name)
        )
      ).sort((a, b) => a.localeCompare(b)),
    [markets, scopedCustomerName]
  );

  const createVenueCustomerName =
    (isCustomerContext ? customerScopeName : newVenueCustomerName || (customerFilter !== "all" ? customerFilter : "")) || "";

  const createVenueMarketOptions = useMemo(
    () =>
      markets
        .filter((market) => market.customerName === createVenueCustomerName)
        .sort((a, b) => {
          if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
          return a.name.localeCompare(b.name);
        }),
    [createVenueCustomerName, markets]
  );

  const visibleVenues = useMemo(() => {
    const query = venueSearch.trim().toLowerCase();
    const filtered = venues.filter((venue) => {
      const customerMatches = scopedCustomerName === "all" ? true : venue.customerName === scopedCustomerName;
      const marketMatches = marketFilter === "all" ? true : venue.marketName === marketFilter;
      const market = venue.marketId ? marketsById.get(venue.marketId) : null;
      const isEffectivelyActive = venue.isActive && (market?.isActive ?? true);
      if (!customerMatches || !marketMatches) return false;
      if (venueActivityFilter === "active" && !isEffectivelyActive) return false;
      if (venueActivityFilter === "inactive" && isEffectivelyActive) return false;
      if (!query) return true;
      return [venue.name, venue.marketName, venue.customerName].join(" ").toLowerCase().includes(query);
    });

    return [...filtered].sort((a, b) => {
      if (a.customerName !== b.customerName) return a.customerName.localeCompare(b.customerName);
      if (a.marketName !== b.marketName) return a.marketName.localeCompare(b.marketName);
      return a.name.localeCompare(b.name);
    });
  }, [marketFilter, marketsById, scopedCustomerName, venueActivityFilter, venueSearch, venues]);

  useEffect(() => {
    if (!visibleVenues.length) return;
    if (!visibleVenues.some((venue) => venue.id === selectedVenueId)) {
      setSelectedVenueId(visibleVenues[0].id);
    }
  }, [selectedVenueId, visibleVenues]);

  useEffect(() => {
    if (!detailVenueId) return;
    const matched = venues.find((venue) => venue.id === detailVenueId);
    if (matched && matched.id !== selectedVenueId) {
      setSelectedVenueId(matched.id);
    }
  }, [detailVenueId, selectedVenueId, venues]);

  useEffect(() => {
    if (marketFilter === "all") return;
    if (!marketOptions.includes(marketFilter)) {
      setMarketFilter("all");
    }
  }, [marketFilter, marketOptions]);

  useEffect(() => {
    if (!createVenueCustomerName) {
      setNewVenueMarketId("");
      return;
    }
    if (createVenueMarketOptions.some((market) => market.id === newVenueMarketId)) return;
    setNewVenueMarketId(createVenueMarketOptions[0]?.id || "");
  }, [createVenueCustomerName, createVenueMarketOptions, newVenueMarketId]);

  useEffect(() => {
    setDetailTab("setup");
  }, [selectedVenueId]);

  const activeVenueRooms = useMemo(
    () =>
      activeVenue
        ? rooms
            .filter((room) => room.venueId === activeVenue.id)
            .sort(
              (a, b) =>
                (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER) ||
                a.name.localeCompare(b.name)
            )
        : [],
    [activeVenue, rooms]
  );

  const activeVenueMarketOptions = useMemo(
    () =>
      activeVenue
        ? markets
            .filter((market) => market.customerName === activeVenue.customerName)
            .sort((a, b) => {
              if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
              return a.name.localeCompare(b.name);
            })
        : [],
    [activeVenue, markets]
  );

  const selectedRoom = useMemo(
    () => activeVenueRooms.find((room) => room.id === selectedRoomId) ?? activeVenueRooms[0] ?? null,
    [activeVenueRooms, selectedRoomId]
  );
  const roomNameById = useMemo(() => new Map(activeVenueRooms.map((room) => [room.id, room.name])), [activeVenueRooms]);
  const presetScopeMaps = useMemo(
    () =>
      activeVenueRooms.map((room) => ({
        id: room.id,
        name: room.name,
        assigned: 0,
        total: liveVenueInventory.filter((item) => item.locationId === room.id && item.isActive !== false).length,
        imageUrl: room.mapUrl || "",
      })),
    [activeVenueRooms, liveVenueInventory]
  );
  const presetScopeInventory = useMemo(
    () =>
      liveVenueInventory
        .filter((item) => item.isActive !== false)
        .map((item) => ({
          id: item.inventoryId || item.id,
          recordId: item.id,
          locationName: item.locationDetail || item.mapName || roomNameById.get(item.locationId) || "",
          mapId: item.locationId,
          mediaVariantKey: item.mediaVariantKey,
          unitNumber: item.unitNumber || "",
          assignedCreativeId: null,
          assignmentUpdatedAt: null,
          isActive: true,
          x: typeof item.x === "number" ? item.x : 0.5,
          y: typeof item.y === "number" ? item.y : 0.5,
        })),
    [liveVenueInventory, roomNameById]
  );
  const {
    viewportRef: mapViewportRef,
    imageRef: mapImgRef,
    mapFrameStyle,
    zoom,
    pan,
    mapError: mapLoadFailed,
    fitMapToView,
    onImageLoad: onMapImageLoad,
    onImageError: onMapImageError,
    onWheelMap,
    onMouseDownMap,
    onMouseMoveMap,
    onMouseUpMap,
    onTouchStartMap,
    onTouchMoveMap,
    onTouchEndMap,
    clientPointToNormalized,
  } = useSharedMapWorkspace({
    mapSrc: detailTab === "placement" ? selectedRoom?.mapUrl : undefined,
    activeKey: selectedRoom?.id || "",
    enabled: detailTab === "placement",
    interactionLocked: Boolean(draggingPinRecordKey),
  });

  const mapPreviewRoom = useMemo(
    () => rooms.find((room) => room.id === mapPreviewRoomId) ?? null,
    [mapPreviewRoomId, rooms]
  );

  const dashboardStats = useMemo(() => {
    return {
      venues: visibleVenues.length,
      markets: new Set(visibleVenues.map((venue) => venue.marketId).filter(Boolean)).size,
      rooms: visibleVenues.reduce((sum, venue) => sum + (venue.roomCount || 0), 0),
      inventory: visibleVenues.reduce((sum, venue) => sum + (venue.inventoryCount || 0), 0),
      unpinned: visibleVenues.reduce((sum, venue) => sum + (venue.unpinnedCount || 0), 0),
    };
  }, [visibleVenues]);

  const venueValidationSummary = useMemo(() => {
    const validRoomIds = new Set(activeVenueRooms.map((room) => room.id));
    const duplicateInventoryIds = new Map<string, number>();

    liveVenueInventory.forEach((item) => {
      const key = String(item.inventoryId || "").trim().toLowerCase();
      if (!key) return;
      duplicateInventoryIds.set(key, (duplicateInventoryIds.get(key) || 0) + 1);
    });

    const duplicateInventoryCount = Array.from(duplicateInventoryIds.values()).filter((count) => count > 1).length;
    const missingUnitCount = liveVenueInventory.filter((item) => item.isActive && !String(item.unitNumber || "").trim()).length;
    const missingTrimCount = liveVenueInventory.filter((item) => item.isActive && (item.trimHeight == null || item.trimWidth == null)).length;
    const missingSafeCount = liveVenueInventory.filter((item) => item.isActive && (item.safeHeight == null || item.safeWidth == null)).length;
    const unpinnedActiveCount = liveVenueInventory.filter((item) => item.isActive && (item.x == null || item.y == null)).length;
    const invalidMapLinkCount = liveVenueInventory.filter((item) => item.isActive && item.locationId && !validRoomIds.has(item.locationId)).length;

    return {
      missingUnitCount,
      missingTrimCount,
      missingSafeCount,
      unpinnedActiveCount,
      invalidMapLinkCount,
      duplicateInventoryCount,
    };
  }, [activeVenueRooms, liveVenueInventory]);

  const filteredMarkets = useMemo(() => {
    const query = marketSearch.trim().toLowerCase();
    return markets
      .filter((market) =>
        isCustomerContext
          ? market.customerName === customerScopeName
          : scopedCustomerName === "all"
            ? true
            : market.customerName === scopedCustomerName
      )
      .filter((market) => {
        if (marketActivityFilter === "active") return market.isActive;
        if (marketActivityFilter === "inactive") return !market.isActive;
        return true;
      })
      .filter((market) => (!query ? true : `${market.name} ${market.customerName}`.toLowerCase().includes(query)))
      .sort((a, b) => {
        if (a.customerName !== b.customerName) return a.customerName.localeCompare(b.customerName);
        return a.name.localeCompare(b.name);
      });
  }, [customerScopeName, isCustomerContext, marketActivityFilter, marketSearch, markets, scopedCustomerName]);

  useEffect(() => {
    if (!activeVenueRooms.length) {
      setSelectedRoomId("");
      return;
    }
    if (!activeVenueRooms.some((room) => room.id === selectedRoomId)) {
      setSelectedRoomId(activeVenueRooms[0].id);
    }
  }, [activeVenueRooms, selectedRoomId]);

  useEffect(() => {
    setSelectedInventoryId("");
  }, [selectedRoomId, selectedVenueId]);

  useEffect(() => {
    setPlacementSearch("");
    setPlacementVariantFilter("all");
    setPlacementPinFilter("all");
  }, [selectedRoomId]);

  useEffect(() => {
    setRowSearch("");
    setMapFilter("all");
    setVariantFilter("all");
    setActivityFilter("all");
    setReadinessFocus(null);
    setSelectedRecordKeys([]);
  }, [selectedVenueId]);

  useEffect(() => {
    setSelectedRecordKeys([]);
  }, [detailTab]);

  useEffect(() => {
    if (!draggingPinRecordKey) return;
    const recordKey = draggingPinRecordKey;
    let lastPoint: { x: number; y: number } | null = null;

    function updatePinPosition(clientX: number, clientY: number) {
      const nextPoint = clientPointToNormalized(clientX, clientY);
      if (!nextPoint) return;
      lastPoint = nextPoint;
      updateRecordOverride(recordKey, nextPoint);
    }

    function onPointerMove(event: PointerEvent) {
      updatePinPosition(event.clientX, event.clientY);
    }

    function onPointerUp(event: PointerEvent) {
      updatePinPosition(event.clientX, event.clientY);
      setDraggingPinRecordKey(null);
      if (lastPoint) {
        void persistInventoryPlacement(recordKey, lastPoint);
      }
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [clientPointToNormalized, draggingPinRecordKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(PROFILE_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as ImportProfile[];
      if (Array.isArray(parsed)) setProfiles(parsed);
    } catch {
      // ignore malformed local profile storage
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profiles));
  }, [profiles]);

  const effectiveCsvText = useMemo(() => {
    if (csvText.trim()) return csvText;
    if (!liveVenueInventory.length && activeVenue?.id === "venue_penn_station") return DEFAULT_PENN_SAMPLE_CSV;
    return "";
  }, [activeVenue?.id, csvText, liveVenueInventory.length]);

  const isUsingPennSampleInventory = !csvText.trim() && !liveVenueInventory.length && activeVenue?.id === "venue_penn_station";

  const parsedRows = useMemo(() => {
    if (!effectiveCsvText.trim()) return [];
    try {
      return parseCsvText(effectiveCsvText, { delimiter: importDelimiter });
    } catch {
      return [];
    }
  }, [effectiveCsvText, importDelimiter]);

  const result = useMemo(() => {
    if (!parsedRows.length) return null;

    const primaryResult = normalizeInventoryImportRows(parsedRows, {
      inactiveVisibilityMode,
      headerOverrides,
    });

    // Keep the built-in Penn Station sample usable even if stale manual
    // header overrides would otherwise wipe out the preview.
    if (isUsingPennSampleInventory && primaryResult.summary.validRowCount === 0) {
      return normalizeInventoryImportRows(parsedRows, {
        inactiveVisibilityMode,
      });
    }

    return primaryResult;
  }, [headerOverrides, inactiveVisibilityMode, isUsingPennSampleInventory, parsedRows]);
  const hasImportedPreview = showImportModal && Boolean(result?.records?.length);

  const backendBaseRecords = useMemo(
    () => (liveVenueInventory.length ? liveVenueInventory.map(mapBackendInventoryRecord) : []),
    [liveVenueInventory]
  );

  const effectiveRecords = useMemo(() => {
    const baseRecords = hasImportedPreview && result?.records?.length ? result.records : backendBaseRecords;
    const combined = [...baseRecords, ...manualRecords];
    return combined
      .map((record, index) => {
        const persistedVariant = liveVenueVariants.find((variant) => variant.mediaVariantKey === record.mediaVariantKey);
        const variantOverride = variantAppearanceOverrides[record.mediaVariantKey];
        const recordOverride = recordOverrides[record.recordKey] || {};
        const variantDefaultUnit = String(variantOverride?.unitNumber ?? persistedVariant?.unitNumber ?? "").trim();
        const hasUnitOverride = Object.prototype.hasOwnProperty.call(recordOverride, "unitNumber");
        const overrideUnitNumber = hasUnitOverride ? String(recordOverride.unitNumber || "").trim() : "";
        const persistedRowUnitNumber = String(record.unitNumber || "").trim();
        const resolvedUnitNumber = hasUnitOverride
          ? overrideUnitNumber || variantDefaultUnit
          : persistedRowUnitNumber || variantDefaultUnit;
        const unitNumberSource = hasUnitOverride
          ? overrideUnitNumber
            ? "manual"
            : variantDefaultUnit
              ? "variant"
              : "none"
          : persistedRowUnitNumber
            ? "manual"
            : variantDefaultUnit
              ? "variant"
              : "none";

        return {
          ...record,
          inventoryId: recordOverride.inventoryId ?? record.inventoryId,
          locationId: recordOverride.locationId ?? record.locationId,
          locationDetail: recordOverride.locationDetail ?? record.locationDetail,
          mapName: recordOverride.mapName ?? roomNameById.get(recordOverride.locationId ?? record.locationId) ?? record.mapName,
          mediaVariantKey: recordOverride.mediaVariantKey ?? record.mediaVariantKey,
          variantLabel: recordOverride.variantLabel ?? persistedVariant?.label ?? record.variantLabel,
          mediaType: recordOverride.mediaType ?? persistedVariant?.mediaType ?? record.mediaType,
          unitNumber: resolvedUnitNumber,
          liftProductMapping: recordOverride.liftProductMapping ?? record.liftProductMapping,
          unitNumberSource,
          trimHeight: recordOverride.trimHeight ?? record.trimHeight,
          trimWidth: recordOverride.trimWidth ?? record.trimWidth,
          safeHeight: recordOverride.safeHeight ?? record.safeHeight,
          safeWidth: recordOverride.safeWidth ?? record.safeWidth,
          notes: recordOverride.notes ?? record.notes,
          productionRoutingOverride: recordOverride.productionRoutingOverride ?? record.productionRoutingOverride,
          externalVendorIdOverride: recordOverride.externalVendorIdOverride ?? record.externalVendorIdOverride,
          isActive: recordOverride.isActive ?? record.isActive,
          mapVisibilityMode: recordOverride.mapVisibilityMode ?? record.mapVisibilityMode,
          x: recordOverride.x ?? record.x ?? (hasImportedPreview ? mapPinStyle(index).x : null),
          y: recordOverride.y ?? record.y ?? (hasImportedPreview ? mapPinStyle(index).y : null),
        };
      })
      .filter((record) => !recordOverrides[record.recordKey]?.deleted);
  }, [backendBaseRecords, hasImportedPreview, liveVenueVariants, manualRecords, recordOverrides, result, roomNameById, variantAppearanceOverrides]);

  const customerVendorsById = useMemo(
    () => new Map(activeCustomerVendors.map((vendor) => [vendor.id, vendor] as const)),
    [activeCustomerVendors]
  );

  function resolveInventoryVendor(record: {
    mediaVariantKey: string;
    productionRoutingOverride?: "primary" | "external";
    externalVendorIdOverride?: string;
  }) {
    const persistedVariant = liveVenueVariants.find((variant) => variant.mediaVariantKey === record.mediaVariantKey);
    const variantOverride = variantAppearanceOverrides[record.mediaVariantKey];
    const route =
      record.productionRoutingOverride ||
      variantOverride?.productionRouting ||
      persistedVariant?.productionRouting ||
      "primary";

    if (route === "external") {
      const vendorId =
        record.productionRoutingOverride === "external"
          ? record.externalVendorIdOverride || variantOverride?.externalVendorId || persistedVariant?.externalVendorId
          : variantOverride?.externalVendorId || persistedVariant?.externalVendorId;
      const vendor = vendorId ? customerVendorsById.get(vendorId) : undefined;
      return {
        route,
        vendorId: vendorId || "",
        label: vendor?.name || "External vendor",
        source: record.productionRoutingOverride ? "Override" : "Inherited",
        unresolved: !vendor,
      };
    }

    return {
      route,
      vendorId: "",
      label: "LTL",
      source: record.productionRoutingOverride ? "Override" : "Default",
      unresolved: false,
    };
  }

  const groupedMaps = useMemo(() => {
    if (!effectiveRecords.length) return [];
    const counts = new Map<string, { total: number; active: number; inactive: number }>();

    effectiveRecords.forEach((record) => {
      const current = counts.get(record.mapName) || { total: 0, active: 0, inactive: 0 };
      current.total += 1;
      if (record.isActive) current.active += 1;
      else current.inactive += 1;
      counts.set(record.mapName, current);
    });

    return Array.from(counts.entries())
      .map(([mapName, stats]) => ({ mapName, ...stats }))
      .sort((a, b) => a.mapName.localeCompare(b.mapName));
  }, [effectiveRecords]);

  const groupedVariants = useMemo(() => {
    if (!effectiveRecords.length) return [];
    const counts = new Map<string, { key: string; label: string; total: number; trimHeight: number | null; trimWidth: number | null }>();
    effectiveRecords.forEach((record) => {
      const existing = counts.get(record.mediaVariantKey);
      if (existing) {
        existing.total += 1;
        return;
      }
      counts.set(record.mediaVariantKey, {
        key: record.mediaVariantKey,
        label: record.variantLabel,
        total: 1,
        trimHeight: record.trimHeight,
        trimWidth: record.trimWidth,
      });
    });
    return Array.from(counts.entries())
      .map(([, variant]) => variant)
      .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
  }, [effectiveRecords]);

  const validActiveRoomIds = useMemo(
    () => new Set(activeVenueRooms.map((room) => room.id)),
    [activeVenueRooms]
  );

  const duplicateActiveInventoryIds = useMemo(() => {
    const counts = new Map<string, number>();
    effectiveRecords.forEach((record) => {
      if (!record.isActive) return;
      const key = normalizeImportMatchKey(record.inventoryId);
      if (!key) return;
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return new Set(Array.from(counts.entries()).filter(([, count]) => count > 1).map(([key]) => key));
  }, [effectiveRecords]);

  function getReadinessIssueDetailsForRecord(record: any): VenueReadinessIssueDetail[] {
    if (!record.isActive) return [];

    const issues: VenueReadinessIssueDetail[] = [];
    const vendor = resolveInventoryVendor(record);
    const appearance = getVariantAppearance(record.mediaVariantKey, record.variantLabel);
    const isLiftRouted = vendor.route !== "external";
    const hasUnitCoverage = Boolean(String(record.unitNumber || "").trim());
    const hasProductIdCoverage = Boolean(record.liftProductMapping?.liftProductId || appearance.liftProductMapping?.liftProductId);

    if (!record.locationId || !validActiveRoomIds.has(record.locationId)) {
      issues.push({
        actionId: "missing_maps",
        label: "Map",
        detail: "Map link is missing or no longer points to an active venue map.",
        tone: "blocked",
      });
    }

    if (isLiftRouted && liftProductIdentifierMode === "product_id" && !hasProductIdCoverage) {
      issues.push({
        actionId: "missing_identifiers",
        label: "Product ID",
        detail: "Lift submit mode is Product ID, but this row has no row or variant Product ID mapping.",
        tone: "blocked",
      });
    }

    if (isLiftRouted && liftProductIdentifierMode !== "product_id" && !hasUnitCoverage) {
      issues.push({
        actionId: "missing_identifiers",
        label: "Unit #",
        detail: "Lift submit mode is Unit Number, but this row has no unit number coverage.",
        tone: "blocked",
      });
    }

    if (isLiftRouted && !hasUnitCoverage && !hasProductIdCoverage) {
      issues.push({
        actionId: "variant_mapping",
        label: "Variant map",
        detail: "No row-level or variant-level Lift product mapping is available for this inventory row.",
        tone: "warning",
      });
    }

    const missingDimensions = [
      record.trimHeight == null ? "trim height" : "",
      record.trimWidth == null ? "trim width" : "",
      record.safeHeight == null ? "safe height" : "",
      record.safeWidth == null ? "safe width" : "",
    ].filter(Boolean);
    if (missingDimensions.length) {
      issues.push({
        actionId: "missing_dimensions",
        label: "Dimensions",
        detail: `Missing ${missingDimensions.join(", ")}.`,
        tone: "warning",
      });
    }

    if (vendor.route === "external" && vendor.unresolved) {
      issues.push({
        actionId: "external_vendor_routes",
        label: "Vendor",
        detail: "This row routes to an external vendor, but the vendor is missing or inactive.",
        tone: "blocked",
      });
    }

    if (duplicateActiveInventoryIds.has(normalizeImportMatchKey(record.inventoryId))) {
      issues.push({
        actionId: "duplicate_ids",
        label: "Duplicate ID",
        detail: "Another active inventory row uses this same inventory ID.",
        tone: "blocked",
      });
    }

    if (record.x == null || record.y == null) {
      issues.push({
        actionId: "placement_unpinned",
        label: "Map pin",
        detail: "This active row has not been pinned on the map.",
        tone: "warning",
      });
    }

    return issues;
  }

  const filteredRecords = useMemo(() => {
    if (!effectiveRecords.length) return [];
    const query = rowSearch.trim().toLowerCase();

    return effectiveRecords.filter((record) => {
      if (readinessFocus) {
        const readinessIssues = getReadinessIssueDetailsForRecord(record);
        if (!readinessIssues.some((issue) => issue.actionId === readinessFocus.actionId)) return false;
      }
      if (mapFilter !== "all" && record.mapName !== mapFilter) return false;
      if (variantFilter !== "all" && record.mediaVariantKey !== variantFilter) return false;
      if (activityFilter === "active" && !record.isActive) return false;
      if (activityFilter === "inactive" && record.isActive) return false;
      if (!query) return true;

      const vendor = resolveInventoryVendor(record);
      const searchable = [
        record.inventoryId,
        record.mapName,
        record.unitNumber || "",
        record.mediaType,
        record.variantLabel,
        record.locationDetail || "",
        vendor.label,
        vendor.source,
      ]
        .join(" ")
        .toLowerCase();

      return searchable.includes(query);
    });
  }, [
    activityFilter,
    customerVendorsById,
    duplicateActiveInventoryIds,
    effectiveRecords,
    liftProductIdentifierMode,
    liveVenueVariants,
    mapFilter,
    readinessFocus,
    rowSearch,
    validActiveRoomIds,
    variantFilter,
    variantAppearanceOverrides,
  ]);

  const readinessFocusSummary = useMemo(() => {
    if (!readinessFocus) return null;
    const matchesFocus = (record: any) =>
      getReadinessIssueDetailsForRecord(record).some((issue) => issue.actionId === readinessFocus.actionId);
    const affectedRecords = effectiveRecords.filter(matchesFocus);
    const visibleAffectedRecords = filteredRecords.filter(matchesFocus);
    const affectedVariantKeys = new Set(affectedRecords.map((record) => record.mediaVariantKey).filter(Boolean));
    const affectedMapNames = new Set(affectedRecords.map((record) => record.mapName).filter(Boolean));
    return {
      actionId: readinessFocus.actionId,
      label: readinessFocus.label,
      totalCount: affectedRecords.length,
      visibleCount: visibleAffectedRecords.length,
      variantCount: affectedVariantKeys.size,
      mapCount: affectedMapNames.size,
      firstRecord: visibleAffectedRecords[0] || affectedRecords[0] || null,
      visibleRecordKeys: visibleAffectedRecords.map((record) => record.recordKey),
    };
  }, [
    customerVendorsById,
    duplicateActiveInventoryIds,
    effectiveRecords,
    filteredRecords,
    liftProductIdentifierMode,
    liveVenueVariants,
    readinessFocus,
    validActiveRoomIds,
    variantAppearanceOverrides,
  ]);

  const hasInventoryRows = effectiveRecords.length > 0;
  const bulkEditorRecords = useMemo(
    () => bulkInventoryEditor
      ? effectiveRecords.filter((record) => bulkInventoryEditor.recordKeys.includes(record.recordKey))
      : [],
    [bulkInventoryEditor, effectiveRecords]
  );
  const bulkEditorBackendIds = useMemo(
    () => bulkEditorRecords.map((record) => getBackendInventoryId(record.recordKey)).filter(Boolean) as string[],
    [bulkEditorRecords]
  );
  const bulkEditorSummary = useMemo(() => {
    const maps = Array.from(new Set(bulkEditorRecords.map((record) => record.mapName).filter(Boolean))).sort();
    const variants = Array.from(new Set(bulkEditorRecords.map((record) => record.variantLabel).filter(Boolean))).sort();
    const mappedRows = bulkEditorRecords.filter((record) => record.liftProductMapping?.liftProductId).length;
    const inheritedMappings = bulkEditorRecords.filter((record) => {
      const appearance = getVariantAppearance(record.mediaVariantKey, record.variantLabel);
      return !record.liftProductMapping?.liftProductId && Boolean(appearance.liftProductMapping?.liftProductId);
    }).length;
    return {
      maps,
      variants,
      mappedRows,
      inheritedMappings,
      unsavedRows: Math.max(bulkEditorRecords.length - bulkEditorBackendIds.length, 0),
    };
  }, [bulkEditorBackendIds.length, bulkEditorRecords, liveVenueVariants, variantAppearanceOverrides]);

  const mapOptions = useMemo(
    () => activeVenueRooms.map((room) => room.name).filter((name, index, all) => all.indexOf(name) === index),
    [activeVenueRooms]
  );

  const vendorPickerVendors = useMemo(() => {
    const query = vendorSearch.trim().toLowerCase();
    return activeCustomerVendors
      .filter((vendor) => {
        if (!query) return true;
        return [vendor.name, vendor.contactName, vendor.email, vendor.phone, vendor.notes]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(query);
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [activeCustomerVendors, vendorSearch]);

  const fieldMappings = useMemo(() => {
    if (!parsedRows.length) return [];
    const headers = Object.keys(parsedRows[0] || {});
    return headers.map((sourceHeader) => ({
      sourceHeader,
      canonicalField: resolveCanonicalField(sourceHeader, headerOverrides),
      override: headerOverrides[sourceHeader],
    }));
  }, [headerOverrides, parsedRows]);

  const columnAuditRows = useMemo(() => {
    if (!parsedRows.length) return [];

    const headers = Object.keys(parsedRows[0] || {});
    return headers.map((sourceHeader) => {
      const canonicalField = resolveCanonicalField(sourceHeader, headerOverrides);
      const samples = Array.from(
        new Set(
          parsedRows
            .map((row) => (row[sourceHeader] || "").trim())
            .filter(Boolean)
        )
      ).slice(0, 3);

      return {
        sourceHeader,
        canonicalField,
        override: headerOverrides[sourceHeader],
        requirement: canonicalField
          ? (isRequiredCanonicalField(canonicalField) ? "Required" : "Optional")
          : "Unmapped",
        sampleValue: samples.length ? samples.join(" | ") : "No sample values",
      };
    });
  }, [headerOverrides, parsedRows]);

  const importPlan = useMemo(() => {
    const records = result?.records || [];
    const existingInventoryById = new Map(
      liveVenueInventory
        .map((item) => [normalizeImportMatchKey(item.inventoryId), item] as const)
        .filter(([key]) => Boolean(key))
    );
    const validMapNames = new Set(activeVenueRooms.map((room) => normalizeImportMatchKey(room.name)).filter(Boolean));
    const importIds = new Set(records.map((record) => normalizeImportMatchKey(record.inventoryId)).filter(Boolean));
    const existingVariantKeys = new Set(liveVenueVariants.map((variant) => variant.mediaVariantKey));
    const importVariantKeys = new Set(records.map((record) => record.mediaVariantKey).filter(Boolean));
    const existingVariantsByKey = new Map(liveVenueVariants.map((variant) => [variant.mediaVariantKey, variant] as const));

    let matchedCount = 0;
    let addedCount = 0;
    let unchangedCount = 0;
    let rowMappingsPreserved = 0;
    records.forEach((record) => {
      const existing = existingInventoryById.get(normalizeImportMatchKey(record.inventoryId));
      if (!existing) {
        addedCount += 1;
        return;
      }
      matchedCount += 1;
      if (importRecordMatchesExisting(record, existing)) unchangedCount += 1;
      if (existing.liftProductMapping) rowMappingsPreserved += 1;
    });

    let variantMappingsPreserved = 0;
    let existingVariantsReused = 0;
    importVariantKeys.forEach((variantKey) => {
      const variant = existingVariantsByKey.get(variantKey);
      if (!variant) return;
      existingVariantsReused += 1;
      if (variant.liftProductMapping) variantMappingsPreserved += 1;
    });

    const retainedMissingInventory = liveVenueInventory.filter((item) => !importIds.has(normalizeImportMatchKey(item.inventoryId)));
    const retainedMissingCount = retainedMissingInventory.length;
    const nextVariantKeys = new Set(importVariantKeys);
    if (inventoryImportMode === "merge") {
      retainedMissingInventory.forEach((item) => {
        if (item.mediaVariantKey) nextVariantKeys.add(item.mediaVariantKey);
      });
    }
    const orphanedVariantKeys = liveVenueVariants
      .filter((variant) => !nextVariantKeys.has(variant.mediaVariantKey))
      .map((variant) => variant.mediaVariantKey);

    return {
      mode: inventoryImportMode,
      incomingCount: records.length,
      unknownMapCount: records.filter((record) => record.mapName && !validMapNames.has(normalizeImportMatchKey(record.mapName))).length,
      matchedCount,
      updatedCount: Math.max(matchedCount - unchangedCount, 0),
      unchangedCount,
      addedCount,
      retainedMissingCount,
      replaceRemovalCount: inventoryImportMode === "replace" ? retainedMissingCount : 0,
      rowMappingsPreserved: inventoryImportMode === "merge" ? rowMappingsPreserved : 0,
      variantMappingsPreserved: inventoryImportMode === "merge" ? variantMappingsPreserved : 0,
      existingVariantsReused,
      newVariantCount: Array.from(importVariantKeys).filter((variantKey) => !existingVariantKeys.has(variantKey)).length,
      orphanedVariantCount: orphanedVariantKeys.length,
      orphanedVariantKeys,
    };
  }, [activeVenueRooms, inventoryImportMode, liveVenueInventory, liveVenueVariants, result]);

  const importRisks = useMemo(() => {
    if (!result) return [];

    const risks: Array<{ title: string; detail: string; tone: "warning" | "info" }> = [];
    const hiddenInactive = result.records.filter((record) => !record.isActive && record.mapVisibilityMode === "hidden").length;
    const missingTrim = result.records.filter((record) => record.trimHeight == null || record.trimWidth == null).length;
    const missingSafe = result.records.filter((record) => record.safeHeight == null || record.safeWidth == null).length;
    const missingUnitNumbers = result.records.filter((record) => !String(record.unitNumber || "").trim()).length;

    const duplicateUnitNumbers = new Map<string, number>();
    result.records.forEach((record) => {
      if (!record.unitNumber) return;
      const key = `${record.mediaVariantKey}||${record.unitNumber}`.toLowerCase();
      duplicateUnitNumbers.set(key, (duplicateUnitNumbers.get(key) || 0) + 1);
    });
    const duplicateUnitCount = Array.from(duplicateUnitNumbers.values()).filter((count) => count > 1).length;

    const mapsWithInactive = groupedMaps.filter((map) => map.inactive > 0).length;

    if (hiddenInactive > 0) {
      risks.push({
        title: "Hidden inactive inventory",
        detail: `${hiddenInactive} inactive rows would disappear from maps in this preview mode.`,
        tone: "warning",
      });
    }

    if (missingTrim > 0) {
      risks.push({
        title: "Missing trim dimensions",
        detail: `${missingTrim} normalized rows are missing trim height or width, which weakens variant grouping and proof setup.`,
        tone: "warning",
      });
    }

    if (missingSafe > 0) {
      risks.push({
        title: "Missing safe-area dimensions",
        detail: `${missingSafe} normalized rows are missing safe area values that Lift/proofing may depend on later.`,
        tone: "warning",
      });
    }

    if (missingUnitNumbers > 0) {
      risks.push({
        title: "Missing unit numbers",
        detail: `${missingUnitNumbers} normalized rows are missing unit numbers, which can block correct Lift order posting later.`,
        tone: "warning",
      });
    }

    if (duplicateUnitCount > 0) {
      risks.push({
        title: "Repeated unit numbers inside variants",
        detail: `${duplicateUnitCount} variant + unit-number combinations repeat across the import and should be sanity-checked.`,
        tone: "info",
      });
    }

    if (importPlan.unknownMapCount > 0) {
      risks.push({
        title: "Unknown maps",
        detail: `${importPlan.unknownMapCount} rows reference a map name that does not exist on this venue. Add/map the room first or correct the source column before importing.`,
        tone: "warning",
      });
    }

    if (mapsWithInactive > 0) {
      risks.push({
        title: "Maps with mixed availability",
        detail: `${mapsWithInactive} maps contain inactive rows, which may affect pin visibility and total counters.`,
        tone: "info",
      });
    }

    if (importPlan.mode === "merge" && importPlan.retainedMissingCount > 0) {
      risks.push({
        title: "Existing rows not in import",
        detail: `${importPlan.retainedMissingCount} existing rows are not present in this file and will be retained unchanged in merge mode.`,
        tone: "info",
      });
    }

    if (importPlan.mode === "replace" && importPlan.replaceRemovalCount > 0) {
      risks.push({
        title: "Rows removed by replace",
        detail: `${importPlan.replaceRemovalCount} existing rows are not present in this file and will be removed by replace mode.`,
        tone: "warning",
      });
    }

    if (importPlan.orphanedVariantCount > 0) {
      risks.push({
        title: importPlan.mode === "replace" ? "Variants removed by replace" : "Variants retained without incoming rows",
        detail: `${importPlan.orphanedVariantCount} existing variants have no matching rows in this import${importPlan.mode === "merge" ? " and will remain only if retained existing inventory still references them." : " and will be removed."}`,
        tone: importPlan.mode === "replace" ? "warning" : "info",
      });
    }

    return risks;
  }, [groupedMaps, importPlan, result]);

  const selectedRoomImportRecords = useMemo(() => {
    if (!selectedRoom) return [];
    return effectiveRecords.filter((record) => record.locationId === selectedRoom.id || record.mapName === selectedRoom.name);
  }, [effectiveRecords, selectedRoom]);

  const liveVenueVariantByKey = useMemo(
    () => new Map(liveVenueVariants.map((variant) => [variant.mediaVariantKey, variant])),
    [liveVenueVariants]
  );

  const variantRows = useMemo(() => {
    const counts = new Map<
      string,
      {
        key: string;
        label: string;
        variantId?: string;
        total: number;
        unitNumber?: string;
        color: string;
        abbreviation: string;
        productionRouting: "primary" | "external";
        externalVendorId?: string;
        inventoryIds: string[];
      }
    >();
    effectiveRecords.forEach((record, index) => {
      const existing = counts.get(record.mediaVariantKey);
      const inventoryId = String(record.inventoryId || "").trim();
      const override = variantAppearanceOverrides[record.mediaVariantKey];
      const persistedVariant = liveVenueVariantByKey.get(record.mediaVariantKey);
      const fallbackColor = variantPalette[index % variantPalette.length];
      if (!existing) {
        counts.set(record.mediaVariantKey, {
          key: record.mediaVariantKey,
          label: persistedVariant?.label || record.variantLabel,
          variantId: persistedVariant?.id,
          total: 1,
          unitNumber: override?.unitNumber ?? persistedVariant?.unitNumber,
          color: override?.color || persistedVariant?.color || fallbackColor,
          abbreviation: (override?.abbreviation || persistedVariant?.abbreviation || buildVariantAbbreviation(record.variantLabel)).slice(0, 4).toUpperCase(),
          productionRouting: override?.productionRouting || persistedVariant?.productionRouting || "primary",
          externalVendorId: override?.externalVendorId || persistedVariant?.externalVendorId,
          inventoryIds: inventoryId ? [inventoryId] : [],
        });
        return;
      }
      existing.total += 1;
      if (inventoryId) existing.inventoryIds.push(inventoryId);
      if (!existing.unitNumber && (override?.unitNumber || persistedVariant?.unitNumber)) {
        existing.unitNumber = override?.unitNumber ?? persistedVariant?.unitNumber;
      }
      if (existing.productionRouting === "primary" && (override?.productionRouting || persistedVariant?.productionRouting) === "external") {
        existing.productionRouting = "external";
      }
      if (!existing.externalVendorId && (override?.externalVendorId || persistedVariant?.externalVendorId)) {
        existing.externalVendorId = override?.externalVendorId || persistedVariant?.externalVendorId;
      }
    });
    return Array.from(counts.values()).map((variant) => ({
      ...variant,
      inventoryIds: Array.from(new Set(variant.inventoryIds)).sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
      ),
    }));
  }, [effectiveRecords, liveVenueVariantByKey, variantAppearanceOverrides]);

  const venueReadinessChecklist = useMemo(() => {
    const validRoomIds = new Set(activeVenueRooms.map((room) => room.id));
    const activeRecords = effectiveRecords.filter((record) => record.isActive);
    const activePrimaryRecords = activeRecords.filter((record) => resolveInventoryVendor(record).route !== "external");
    const duplicateInventoryIds = new Map<string, number>();
    activeRecords.forEach((record) => {
      const key = String(record.inventoryId || "").trim().toLowerCase();
      if (!key) return;
      duplicateInventoryIds.set(key, (duplicateInventoryIds.get(key) || 0) + 1);
    });

    const missingMapCount = activeRecords.filter((record) => !record.locationId || !validRoomIds.has(record.locationId)).length;
    const duplicateIdCount = Array.from(duplicateInventoryIds.values()).filter((count) => count > 1).length;
    const missingTrimCount = activeRecords.filter((record) => record.trimHeight == null || record.trimWidth == null).length;
    const missingSafeCount = activeRecords.filter((record) => record.safeHeight == null || record.safeWidth == null).length;
    const unpinnedCount = activeRecords.filter((record) => record.x == null || record.y == null).length;
    const externalVendorIssueCount = activeRecords.filter((record) => {
      const route = resolveInventoryVendor(record);
      return route.route === "external" && route.unresolved;
    }).length;
    const missingUnitCount = activePrimaryRecords.filter((record) => !String(record.unitNumber || "").trim()).length;
    const missingProductIdCount = activePrimaryRecords.filter((record) => {
      const appearance = getVariantAppearance(record.mediaVariantKey, record.variantLabel);
      return !record.liftProductMapping?.liftProductId && !appearance.liftProductMapping?.liftProductId;
    }).length;
    const activePrimaryVariantKeys = new Set(activePrimaryRecords.map((record) => record.mediaVariantKey));
    const variantMappingGapCount = variantRows.filter((variant) => {
      if (!activePrimaryVariantKeys.has(variant.key)) return false;
      const appearance = getVariantAppearance(variant.key, variant.label);
      return !variant.unitNumber && !appearance.liftProductMapping?.liftProductId;
    }).length;

    const identifierLabel = liftProductIdentifierMode === "product_id" ? "Product ID" : "Unit Number";
    const mappingGapCount = liftProductIdentifierMode === "product_id" ? missingProductIdCount : missingUnitCount;
    const mappingAction = liftProductIdentifierMode === "product_id"
      ? "Map Lift products on variants or rows before submitting Lift orders."
      : "Add unit numbers directly or map Lift products to populate unit numbers.";

    const items: VenueReadinessItem[] = [
      {
        id: "inventory",
        title: "Inventory loaded",
        detail: `${activeRecords.length} active row${activeRecords.length === 1 ? "" : "s"} available for project scopes.`,
        count: activeRecords.length,
        tone: activeRecords.length ? "ok" : "blocked",
        action: activeRecords.length ? "Ready" : "Import or add active inventory rows.",
        actionId: activeRecords.length ? undefined : "open_import",
        actionLabel: activeRecords.length ? undefined : "Import inventory",
      },
      {
        id: "maps",
        title: "Map links valid",
        detail: missingMapCount
          ? `${missingMapCount} active row${missingMapCount === 1 ? "" : "s"} reference missing maps.`
          : "All active rows point to configured venue maps.",
        count: missingMapCount,
        tone: missingMapCount ? "blocked" : "ok",
        action: missingMapCount ? "Correct the Map column or create the missing room/map." : "Ready",
        actionId: missingMapCount ? "missing_maps" : undefined,
        actionLabel: missingMapCount ? "Review rows" : undefined,
      },
      {
        id: "identifiers",
        title: `${identifierLabel} coverage`,
        detail: mappingGapCount
          ? `${mappingGapCount} Lift-routed active row${mappingGapCount === 1 ? "" : "s"} missing ${identifierLabel.toLowerCase()} coverage.`
          : `Lift-routed active rows have ${identifierLabel.toLowerCase()} coverage.`,
        count: mappingGapCount,
        tone: mappingGapCount ? "blocked" : "ok",
        action: mappingGapCount ? mappingAction : "Ready",
        actionId: mappingGapCount ? "missing_identifiers" : undefined,
        actionLabel: mappingGapCount ? "Review rows" : undefined,
      },
      {
        id: "variant-mapping",
        title: "Variant mapping defaults",
        detail: variantMappingGapCount
          ? `${variantMappingGapCount} active Lift-routed variant${variantMappingGapCount === 1 ? "" : "s"} have no shared unit/product mapping.`
          : "Active Lift-routed variants have shared mapping defaults or row-level coverage.",
        count: variantMappingGapCount,
        tone: variantMappingGapCount ? "warning" : "ok",
        action: variantMappingGapCount ? "Map products at the variant level where possible." : "Ready",
        actionId: variantMappingGapCount ? "variant_mapping" : undefined,
        actionLabel: variantMappingGapCount ? "Review rows" : undefined,
      },
      {
        id: "dimensions",
        title: "Dimensions complete",
        detail: [missingTrimCount ? `${missingTrimCount} missing trim` : "", missingSafeCount ? `${missingSafeCount} missing safe area` : ""]
          .filter(Boolean)
          .join(" · ") || "Trim and safe-area dimensions are complete for active rows.",
        count: missingTrimCount + missingSafeCount,
        tone: missingTrimCount || missingSafeCount ? "warning" : "ok",
        action: missingTrimCount || missingSafeCount ? "Fill dimensions before proofing/order validation." : "Ready",
        actionId: missingTrimCount || missingSafeCount ? "missing_dimensions" : undefined,
        actionLabel: missingTrimCount || missingSafeCount ? "Review rows" : undefined,
      },
      {
        id: "placement",
        title: "Map placement",
        detail: unpinnedCount
          ? `${unpinnedCount} active row${unpinnedCount === 1 ? "" : "s"} still need map pins.`
          : "All active rows have map placement coordinates.",
        count: unpinnedCount,
        tone: unpinnedCount ? "warning" : "ok",
        action: unpinnedCount ? "Use Map Placement to pin active inventory." : "Ready",
        actionId: unpinnedCount ? "placement_unpinned" : undefined,
        actionLabel: unpinnedCount ? "Open placement" : undefined,
      },
      {
        id: "vendors",
        title: "External vendor routes",
        detail: externalVendorIssueCount
          ? `${externalVendorIssueCount} external-routed row${externalVendorIssueCount === 1 ? "" : "s"} need an active vendor.`
          : "External-routed rows have active vendor assignments.",
        count: externalVendorIssueCount,
        tone: externalVendorIssueCount ? "blocked" : "ok",
        action: externalVendorIssueCount ? "Assign an active external vendor or return route to primary." : "Ready",
        actionId: externalVendorIssueCount ? "external_vendor_routes" : undefined,
        actionLabel: externalVendorIssueCount ? "Review rows" : undefined,
      },
      {
        id: "duplicates",
        title: "Inventory IDs unique",
        detail: duplicateIdCount
          ? `${duplicateIdCount} duplicate active inventory ID group${duplicateIdCount === 1 ? "" : "s"} found.`
          : "Active inventory IDs are unique.",
        count: duplicateIdCount,
        tone: duplicateIdCount ? "blocked" : "ok",
        action: duplicateIdCount ? "Resolve duplicate inventory IDs before importing or assigning artwork." : "Ready",
        actionId: duplicateIdCount ? "duplicate_ids" : undefined,
        actionLabel: duplicateIdCount ? "Review rows" : undefined,
      },
    ];

    const blockerCount = items.filter((item) => item.tone === "blocked").length;
    const warningCount = items.filter((item) => item.tone === "warning").length;
    return {
      items,
      blockerCount,
      warningCount,
      readyCount: items.length - blockerCount - warningCount,
      identifierMode: liftProductIdentifierMode,
    };
  }, [activeVenueRooms, effectiveRecords, liftProductIdentifierMode, liveVenueVariants, variantAppearanceOverrides, variantRows]);

  const selectedRoomVariantGroups = useMemo(() => {
    if (!selectedRoom) return [];

    const counts = new Map<
      string,
      {
        total: number;
        active: number;
        inactive: number;
        pinned: number;
        items: Array<{ id: string; unitNumber?: string; isActive: boolean; isPinned: boolean }>;
      }
    >();

    selectedRoomImportRecords.forEach((record) => {
      const current = counts.get(record.variantLabel) || {
        total: 0,
        active: 0,
        inactive: 0,
        pinned: 0,
        items: [],
      };
      const isPinned = pinStateOverrides[record.inventoryId] ?? (record.x != null && record.y != null);
      current.total += 1;
      if (record.isActive) current.active += 1;
      else current.inactive += 1;
      if (isPinned) current.pinned += 1;
      current.items.push({
        id: record.inventoryId,
        unitNumber: record.unitNumber,
        isActive: record.isActive,
        isPinned,
      });
      counts.set(record.variantLabel, current);
    });

    return Array.from(counts.entries())
      .map(([label, stats]) => ({ label, ...stats }))
      .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
  }, [pinStateOverrides, selectedRoom, selectedRoomImportRecords]);

  const pinPrepSummary = useMemo(() => {
    if (!selectedRoom) {
      return { total: 0, pinned: 0, unpinned: 0, variants: 0 };
    }

    const total = selectedRoomImportRecords.length || selectedRoom.inventoryCount;
    const pinned = selectedRoomVariantGroups.reduce((sum, group) => sum + group.pinned, 0);
    const unpinned = Math.max(total - pinned, 0);

    return {
      total,
      pinned,
      unpinned,
      variants: selectedRoomVariantGroups.length,
    };
  }, [selectedRoom, selectedRoomImportRecords.length, selectedRoomVariantGroups.length]);

  const placementVariantOptions = useMemo(
    () => Array.from(new Set(selectedRoomImportRecords.map((record) => record.variantLabel))).sort((a, b) => a.localeCompare(b)),
    [selectedRoomImportRecords]
  );

  const placementRecords = useMemo(() => {
    const query = placementSearch.trim().toLowerCase();

    return [...selectedRoomImportRecords]
      .sort((a, b) => a.inventoryId.localeCompare(b.inventoryId))
      .map((record) => ({
        ...record,
        isPinned: pinStateOverrides[record.inventoryId] ?? (record.x != null && record.y != null),
      }))
      .filter((record) => {
        if (placementVariantFilter !== "all" && record.variantLabel !== placementVariantFilter) return false;
        if (placementPinFilter === "pinned" && !record.isPinned) return false;
        if (placementPinFilter === "awaiting" && record.isPinned) return false;
        if (!query) return true;
        return `${record.inventoryId} ${record.variantLabel} ${record.unitNumber || ""} ${record.locationDetail || ""}`.toLowerCase().includes(query);
      });
  }, [pinStateOverrides, placementPinFilter, placementSearch, placementVariantFilter, selectedRoomImportRecords]);

  const focusedInventoryItem = useMemo(
    () =>
      selectedRoomImportRecords
        .map((record) => ({
          ...record,
          isPinned: pinStateOverrides[record.inventoryId] ?? (record.x != null && record.y != null),
        }))
        .find((item) => item.inventoryId === selectedInventoryId) ?? null,
    [pinStateOverrides, selectedInventoryId, selectedRoomImportRecords]
  );

  const selectedRoomPinnedRecords = useMemo(
    () =>
      selectedRoomImportRecords
        .map((record) => ({
          ...record,
          isPinned: pinStateOverrides[record.inventoryId] ?? (record.x != null && record.y != null),
        }))
        .filter((record) => record.isPinned),
    [pinStateOverrides, selectedRoomImportRecords]
  );

  async function onFileChange(file: File | null) {
    if (!file) return;
    const text = await file.text();
    setCsvText(text);
    setSourceLabel(file.name);
    setLoadTone("success");
    setHeaderOverrides({});
  }

  function formatDimensionPair(height: number | null, width: number | null) {
    if (height == null || width == null) return "Not provided";
    return `${height}"h × ${width}"w`;
  }

  function formatVariantMeta(record: { variantLabel: string; trimHeight: number | null; trimWidth: number | null }) {
    if (record.variantLabel.includes("•")) {
      return record.variantLabel.split("•")[1]?.trim() || formatDimensionPair(record.trimHeight, record.trimWidth);
    }
    return formatDimensionPair(record.trimHeight, record.trimWidth);
  }

  function formatVariantFilterLabel(variant: { label: string; trimHeight: number | null; trimWidth: number | null }) {
    return `${variant.label} · ${formatDimensionPair(variant.trimHeight, variant.trimWidth)}`;
  }

  function parseEditableNumber(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const next = Number(trimmed);
    return Number.isFinite(next) ? next : null;
  }

  function buildVariantAbbreviation(label: string) {
    const source = label.split("•")[0]?.trim() || label.trim();
    const tokens = (source.match(/[A-Za-z0-9]+/g) || []).map((token) => token.toUpperCase());

    if (!tokens.length) return "V";
    if (tokens.length === 1) return tokens[0].slice(0, 4);

    const abbreviation = tokens
      .map((token, index) => {
        if (index === 0 && /^\d+$/.test(token) && tokens[1]) return token;
        return token[0];
      })
      .join("")
      .slice(0, 4);

    return abbreviation || source.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 4) || "V";
  }

  function formatEditableDimensionToken(value: number | null | undefined) {
    if (value == null || Number.isNaN(value)) return "na";
    return String(value).trim().replace(/[^0-9.]+/g, "") || "na";
  }

  function buildDerivedVariantValues({
    mediaType,
    trimHeight,
    trimWidth,
    fallbackKey,
    fallbackLabel,
  }: {
    mediaType?: string | null;
    trimHeight?: number | null;
    trimWidth?: number | null;
    fallbackKey?: string;
    fallbackLabel?: string;
  }) {
    const nextMediaType = String(mediaType || "").trim() || fallbackLabel || "Custom Variant";
    const mediaSlug =
      nextMediaType
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "custom-variant";

    return {
      mediaType: nextMediaType,
      variantLabel:
        trimHeight != null && trimWidth != null
          ? `${nextMediaType} · ${formatEditableDimensionToken(trimHeight)}"h × ${formatEditableDimensionToken(trimWidth)}"w`
          : nextMediaType,
      mediaVariantKey: fallbackKey && mediaSlug === "custom-variant" && trimHeight == null && trimWidth == null
        ? fallbackKey
        : `${nextMediaType}||${formatEditableDimensionToken(trimHeight)}||${formatEditableDimensionToken(trimWidth)}`,
    };
  }

  function buildInventoryVariantPatch(
    record: {
      mediaType?: string | null;
      trimHeight?: number | null;
      trimWidth?: number | null;
      mediaVariantKey?: string;
      variantLabel?: string;
    },
    patch: Partial<Pick<InventoryRecordOverride, "mediaType" | "trimHeight" | "trimWidth">>
  ) {
    const nextMediaType = patch.mediaType ?? record.mediaType ?? "";
    const nextTrimHeight = patch.trimHeight ?? record.trimHeight ?? null;
    const nextTrimWidth = patch.trimWidth ?? record.trimWidth ?? null;
    return {
      ...patch,
      ...buildDerivedVariantValues({
        mediaType: nextMediaType,
        trimHeight: nextTrimHeight,
        trimWidth: nextTrimWidth,
        fallbackKey: record.mediaVariantKey,
        fallbackLabel: record.variantLabel || record.mediaType || "Custom Variant",
      }),
    };
  }

  function saveCurrentProfile() {
    const trimmed = profileName.trim();
    if (!trimmed) return;

    const nextProfile: ImportProfile = {
      id: `${trimmed.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`,
      name: trimmed,
      inactiveVisibilityMode,
      headerOverrides,
      updatedAt: new Date().toISOString(),
    };

    setProfiles((current) => [nextProfile, ...current.filter((profile) => profile.name !== trimmed)]);
    setProfileName("");
  }

  function applyProfile(profile: ImportProfile) {
    setInactiveVisibilityMode(profile.inactiveVisibilityMode);
    setHeaderOverrides(profile.headerOverrides);
  }

  function removeProfile(profileId: string) {
    setProfiles((current) => current.filter((profile) => profile.id !== profileId));
  }

  function resetInventoryImportSource() {
    setCsvText("");
    setSourceLabel("No file loaded");
    setLoadTone("idle");
    setHeaderOverrides({});
    setImportApplyResult(null);
  }

  function openInventoryImportModal() {
    setImportStep("source");
    setImportApplyResult(null);
    setShowImportModal(true);
  }

  function closeInventoryImportModal() {
    setShowImportModal(false);
    if (importStep === "results") {
      resetInventoryImportSource();
      setImportStep("source");
    }
  }

  function applyReadinessItemAction(item: VenueReadinessItem) {
    if (!item.actionId) return;

    setSelectedRecordKeys([]);

    if (item.actionId === "open_import") {
      openInventoryImportModal();
      return;
    }

    if (item.actionId === "placement_unpinned") {
      const firstUnpinned = effectiveRecords.find(
        (record) => record.isActive && (record.x == null || record.y == null) && record.locationId && validActiveRoomIds.has(record.locationId)
      );
      if (firstUnpinned?.locationId) {
        setSelectedRoomId(firstUnpinned.locationId);
      }
      setReadinessFocus(null);
      setDetailTab("placement");
      setPlacementSearch("");
      setPlacementVariantFilter("all");
      setPlacementPinFilter("awaiting");
      return;
    }

    setDetailTab("inventory");
    setReadinessFocus({ actionId: item.actionId, label: item.title });
    setRowSearch("");
    setMapFilter("all");
    setVariantFilter("all");
    setActivityFilter("all");
  }

  function selectFocusedReadinessRows() {
    if (!readinessFocusSummary?.visibleRecordKeys.length) return;
    setSelectedRecordKeys(readinessFocusSummary.visibleRecordKeys);
  }

  function openFocusedReadinessBulkEdit() {
    if (!readinessFocusSummary?.visibleRecordKeys.length || !inventoryEditMode || !canEditVenueInventory) return;
    setSelectedRecordKeys(readinessFocusSummary.visibleRecordKeys);
    setBulkInventoryEditor({
      recordKeys: readinessFocusSummary.visibleRecordKeys,
      draft: createBulkInventoryEditDraft(),
      error: "",
      saving: false,
    });
  }

  function openFocusedReadinessVendorPicker() {
    if (!readinessFocusSummary?.visibleRecordKeys.length || !inventoryEditMode || !canEditVenueInventory) return;
    setSelectedRecordKeys(readinessFocusSummary.visibleRecordKeys);
    setVendorPicker({ recordKeys: readinessFocusSummary.visibleRecordKeys });
  }

  function openFocusedReadinessProductMapper() {
    const record = readinessFocusSummary?.firstRecord;
    if (!record) return;
    const variantIndex = variantRows.findIndex((variant) => variant.key === record.mediaVariantKey);
    const appearance = getVariantAppearance(record.mediaVariantKey, record.variantLabel, Math.max(variantIndex, 0));
    openInventoryLiftProductMapper(record, appearance);
  }

  function openFocusedReadinessPlacement() {
    const record = readinessFocusSummary?.firstRecord;
    if (!record) return;
    if (record.locationId && validActiveRoomIds.has(record.locationId)) {
      setSelectedRoomId(record.locationId);
    }
    setDetailTab("placement");
    setPlacementSearch("");
    setPlacementVariantFilter("all");
    setPlacementPinFilter("awaiting");
  }

  function downloadBlankInventoryTemplate() {
    if (!activeVenue) return;
    const csv = buildCsvText(VENUE_INVENTORY_IMPORT_HEADERS, []);
    const filename = `${slugifyDownloadName(activeVenue.name)}-inventory-template.csv`;
    downloadCsvText(filename, csv);
  }

  function downloadCurrentVenueInventoryCsv() {
    if (!activeVenue) return;
    const headers = [...VENUE_INVENTORY_IMPORT_HEADERS, ...VENUE_INVENTORY_EXPORT_REFERENCE_HEADERS];
    const rows = effectiveRecords.map((record) => {
      const appearance = getVariantAppearance(record.mediaVariantKey, record.variantLabel);
      const rowMapping = record.liftProductMapping;
      const variantMapping = appearance.liftProductMapping;
      const mapping = rowMapping || variantMapping || {};
      const mappingSource = rowMapping?.liftProductId
        ? "Row"
        : variantMapping?.liftProductId
          ? "Variant"
          : "";
      return {
        CustomerName: record.customerName || activeVenue.customerName || "",
        VenueName: record.venueName || activeVenue.name || "",
        MapName: record.mapName || "",
        UnitNumber: record.unitNumber || "",
        InventoryID: record.inventoryId || "",
        MediaType: record.mediaType || "",
        TrimHeight: record.trimHeight ?? "",
        TrimWidth: record.trimWidth ?? "",
        SafeHeight: record.safeHeight ?? "",
        SafeWidth: record.safeWidth ?? "",
        Substrate: record.substrate || "",
        Finishing: record.finishing || "",
        LocationDetail: record.locationDetail || "",
        Notes: record.notes || "",
        DPI: record.dpi ?? "",
        Bleed_Top: record.bleedTop ?? "",
        Bleed_Right: record.bleedRight ?? "",
        Bleed_Bot: record.bleedBottom ?? "",
        Bleed_Left: record.bleedLeft ?? "",
        Active: record.isActive ? "Y" : "N",
        LiftProductID: mapping.liftProductId || "",
        LiftProductName: mapping.liftProductName || "",
        LiftCatalogID: mapping.liftCatalogId || "",
        LiftCatalogName: mapping.liftCatalogName || "",
        LiftUnitNumber: mapping.liftUnitNumber || "",
        LiftMappingSource: mappingSource,
        MapVisibilityReference: record.isActive ? "included" : record.mapVisibilityMode || "hidden",
      };
    });
    const dateToken = new Date().toISOString().slice(0, 10);
    const filename = `${slugifyDownloadName(activeVenue.name)}-current-inventory-${dateToken}.csv`;
    downloadCsvText(filename, buildCsvText(headers, rows));
  }

  function updateActiveVenue(
    patch: Partial<
      Pick<
        VenueRecord,
        | "name"
        | "customerName"
        | "marketId"
        | "marketName"
        | "documentSourceMode"
        | "documentLibraryUrl"
        | "photoGalleryUrl"
        | "venueDocumentUrl"
        | "venueVideoUrl"
        | "shippingDestinationOverrideEnabled"
        | "shippingDestination"
        | "isActive"
      >
    >
  ) {
    if (!activeVenue) return;
    setVenues((current) =>
      current.map((venue) =>
        venue.id === activeVenue.id
          ? {
              ...venue,
              ...patch,
              updatedAt: new Date().toISOString().slice(0, 10),
            }
          : venue
      )
    );
  }

  async function persistVenuePatch(
    venueId: string,
    patch: Partial<
      Pick<
        VenueRecord,
        | "name"
        | "marketId"
        | "documentSourceMode"
        | "documentLibraryUrl"
        | "photoGalleryUrl"
        | "venueDocumentUrl"
        | "venueVideoUrl"
        | "shippingDestinationOverrideEnabled"
        | "shippingDestination"
        | "isActive"
      >
    >
  ) {
    try {
      await request<{ venue: any }>(`/api/venues/${venueId}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      await loadVenueDashboardData();
      await loadVenueDetailData(venueId);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Unable to save venue");
      await loadVenueDashboardData();
      await loadVenueDetailData(venueId);
    }
  }

  function openCreatePreset() {
    if (!activeVenue) return;
    setPresetSaveError("");
    setPresetEditor({
      mode: "create",
      name: "",
      description: "",
    });
  }

  function openEditPreset(preset: ApiVenueInventoryPreset) {
    if (preset.readOnly) return;
    setPresetSaveError("");
    setPresetEditor({
      mode: "edit",
      preset,
      name: preset.name,
      description: preset.description || "",
    });
  }

  async function savePresetFromSelection(includedIds: string[]) {
    if (!activeVenue || !presetEditor) return;
    const name = presetEditor.name.trim();
    if (!name) {
      setPresetSaveError("Preset name is required.");
      throw new Error("Preset name is required.");
    }

    try {
      setPresetSaveError("");
      if (presetEditor.mode === "edit" && presetEditor.preset) {
        await request(`/api/venues/${activeVenue.id}/inventory-presets/${presetEditor.preset.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            name,
            description: presetEditor.description.trim() || undefined,
            includedIds,
          }),
        });
      } else {
        await request(`/api/venues/${activeVenue.id}/inventory-presets`, {
          method: "POST",
          body: JSON.stringify({
            name,
            description: presetEditor.description.trim() || undefined,
            includedIds,
          }),
        });
      }
      setPresetEditor(null);
      await loadVenueDetailData(activeVenue.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save preset.";
      setPresetSaveError(message);
      throw error;
    }
  }

  async function archivePreset(preset: ApiVenueInventoryPreset) {
    if (!activeVenue || preset.readOnly) return;
    const confirmed = window.confirm(`Archive ${preset.name}? Projects already using this preset will keep their current inventory scope.`);
    if (!confirmed) return;
    try {
      await request(`/api/venues/${activeVenue.id}/inventory-presets/${preset.id}`, { method: "DELETE" });
      await loadVenueDetailData(activeVenue.id);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Unable to archive preset");
    }
  }

  async function createVenue() {
    const trimmed = newVenueName.trim();
    const selectedMarket = createVenueMarketOptions.find((market) => market.id === newVenueMarketId) ?? null;
    if (!trimmed || !createVenueCustomerName || !selectedMarket) return;

    try {
      const response = await request<{ venue: any }>("/api/venues", {
        method: "POST",
        body: JSON.stringify({
          customerName: createVenueCustomerName,
          marketId: selectedMarket.id,
          name: trimmed,
          documentLibraryUrl: activeVenue?.documentLibraryUrl || "https://drive.google.com/",
        }),
      });
      const nextVenue = mapVenueRecordFromApi(response.venue);
      await loadVenueDashboardData();
      setSelectedVenueId(nextVenue.id);
      setNewVenueName("");
      setNewVenueMarketId("");
      setNewVenueCustomerName("");
      setShowCreateVenue(false);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Unable to create venue");
    }
  }

  async function createMarket() {
    const trimmed = newManagedMarketName.trim();
    if (!trimmed) return;
    const targetCustomer =
      (isCustomerContext ? customers.find((customer) => customer.name === customerScopeName) : null) ||
      (activeVenue?.customerId ? customers.find((customer) => customer.id === activeVenue.customerId) : null) ||
      (customerFilter !== "all" ? customers.find((customer) => customer.name === customerFilter) : null) ||
      customers.find((customer) => (customer.status || (customer.isActive ? "active" : "inactive")) !== "inactive") ||
      customers[0] ||
      null;

    if (!targetCustomer) {
      setApiError("Choose a customer before creating a market.");
      return;
    }

    try {
      await request<{ market: any }>("/api/markets", {
        method: "POST",
        body: JSON.stringify({
          customerId: targetCustomer.id,
          customerName: targetCustomer.name,
          name: trimmed,
        }),
      });
      await loadVenueDashboardData();
      setNewManagedMarketName("");
      setShowAddMarketForm(false);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Unable to create market");
    }
  }

  async function updateVenueStatus(venueId: string, nextValue: boolean) {
    setVenues((current) =>
      current.map((venue) =>
        venue.id === venueId
          ? {
              ...venue,
              isActive: nextValue,
              updatedAt: new Date().toISOString().slice(0, 10),
            }
          : venue
      )
    );
    await persistVenuePatch(venueId, { isActive: nextValue });
  }

  async function updateMarketStatus(marketId: string, nextValue: boolean) {
    setMarkets((current) =>
      current.map((market) =>
        market.id === marketId
          ? {
              ...market,
              isActive: nextValue,
              updatedAt: new Date().toISOString().slice(0, 10),
            }
          : market
      )
    );

    try {
      await request<{ market: any }>(`/api/markets/${marketId}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: nextValue }),
      });
      await loadVenueDashboardData();
      if (selectedVenueId) await loadVenueDetailData(selectedVenueId);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Unable to update market status");
      await loadVenueDashboardData();
    }
  }

  function openMarketShippingEditor(market: MarketRecord) {
    setMarketShippingEditorId(market.id);
    setMarketShippingDraft(normalizeShippingDestination(market.shippingDestination));
  }

  async function saveMarketShippingDestination(market: MarketRecord, destination = marketShippingDraft) {
    try {
      await request<{ market: any }>(`/api/markets/${market.id}`, {
        method: "PATCH",
        body: JSON.stringify({ shippingDestination: destination }),
      });
      setMarketShippingEditorId(null);
      setMarketShippingDraft(emptyShippingDestination);
      await loadVenueDashboardData();
      if (selectedVenueId) await loadVenueDetailData(selectedVenueId);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Unable to update market shipping destination");
      await loadVenueDashboardData();
    }
  }

  async function saveActiveVenueShippingDestination() {
    if (!activeVenue) return;
    await persistVenuePatch(activeVenue.id, {
      shippingDestinationOverrideEnabled: Boolean(activeVenue.shippingDestinationOverrideEnabled),
      shippingDestination: normalizeShippingDestination(activeVenue.shippingDestination),
    });
  }

  async function createRoom() {
    if (!activeVenue) return;
    const trimmed = newRoomName.trim();
    if (!trimmed) return;

    try {
      const response = await request<{ map: any }>(`/api/venues/${activeVenue.id}/maps`, {
        method: "POST",
        body: JSON.stringify({
          name: trimmed,
          sortOrder: activeVenueRooms.length,
          mapAssetName: `${trimmed.replace(/\s+/g, "-")}.svg`,
          mapUrl: ROOM_MAP_ASSET_LOOKUP[trimmed]?.imageUrl || mockMaps[0]?.imageUrl || "",
        }),
      });
      const nextRoom = mapRoomRecordFromApi(response.map);
      await loadVenueDashboardData();
      await loadVenueDetailData(activeVenue.id);
      setSelectedRoomId(nextRoom.id);
      setNewRoomName("");
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Unable to create room");
    }
  }

  async function persistRoomPatch(
    roomId: string,
    patch: Partial<Pick<RoomRecord, "name" | "sortOrder" | "mapAssetName" | "mapUrl">>
  ) {
    if (!activeVenue) return;
    try {
      await request<{ map: any }>(`/api/venues/${activeVenue.id}/maps/${roomId}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      await loadVenueDashboardData();
      await loadVenueDetailData(activeVenue.id);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Unable to save room map");
      await loadVenueDetailData(activeVenue.id);
    }
  }

  async function persistRoomOrder(nextRooms: RoomRecord[]) {
    if (!activeVenue) return;

    const orderedRooms = nextRooms.map((room, index) => ({
      ...room,
      sortOrder: index,
      updatedAt: new Date().toISOString().slice(0, 10),
    }));

    setRooms((current) =>
      current.map((room) => {
        const ordered = orderedRooms.find((candidate) => candidate.id === room.id);
        return ordered ? { ...room, sortOrder: ordered.sortOrder, updatedAt: ordered.updatedAt } : room;
      })
    );

    try {
      await Promise.all(
        orderedRooms.map((room) =>
          request<{ map: any }>(`/api/venues/${activeVenue.id}/maps/${room.id}`, {
            method: "PATCH",
            body: JSON.stringify({ sortOrder: room.sortOrder }),
          })
        )
      );
      await loadVenueDashboardData();
      await loadVenueDetailData(activeVenue.id);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Unable to save room order");
      await loadVenueDetailData(activeVenue.id);
    }
  }

  function getBackendInventoryId(recordKey: string) {
    return recordKey.startsWith("backend||") ? recordKey.replace("backend||", "") : null;
  }

  async function persistInventoryPatch(recordKey: string, patch: Record<string, unknown>) {
    const inventoryItemId = getBackendInventoryId(recordKey);
    if (!inventoryItemId) return;

    try {
      setInventorySaveState({ tone: "saving", message: "Saving inventory changes…" });
      const response = await request<{ inventoryItem: any }>(`/api/inventory/${inventoryItemId}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      setLiveVenueInventory((current) =>
        current.map((item) => (item.id === inventoryItemId ? { ...item, ...response.inventoryItem } : item))
      );
      setRecordOverrides((current) => {
        if (!current[recordKey]) return current;
        const next = { ...current };
        delete next[recordKey];
        return next;
      });
      await loadVenueDashboardData();
      if (activeVenue) await loadVenueDetailData(activeVenue.id);
      setInventorySaveState({ tone: "saved", message: "Inventory changes saved." });
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Unable to save inventory row");
      setInventorySaveState({ tone: "error", message: "We couldn’t save that inventory change." });
      if (activeVenue) await loadVenueDetailData(activeVenue.id);
    }
  }

  async function persistInventoryPlacement(recordKey: string, point: { x: number; y: number }) {
    const inventoryItemId = getBackendInventoryId(recordKey);
    if (!inventoryItemId) return;

    try {
      setInventorySaveState({ tone: "saving", message: "Saving pin placement…" });
      const response = await request<{ inventoryItem: any }>(`/api/inventory/${inventoryItemId}/placement`, {
        method: "PATCH",
        body: JSON.stringify(point),
      });
      setLiveVenueInventory((current) =>
        current.map((item) => (item.id === inventoryItemId ? { ...item, ...response.inventoryItem } : item))
      );
      setRecordOverrides((current) => {
        if (!current[recordKey]) return current;
        const next = { ...current };
        delete next[recordKey];
        return next;
      });
      await loadVenueDashboardData();
      if (activeVenue) await loadVenueDetailData(activeVenue.id);
      setInventorySaveState({ tone: "saved", message: "Pin placement saved." });
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Unable to save pin placement");
      setInventorySaveState({ tone: "error", message: "We couldn’t save that pin placement." });
      if (activeVenue) await loadVenueDetailData(activeVenue.id);
    }
  }

  async function createInventoryRow() {
    if (!activeVenue || !selectedRoom) return;

    try {
      setInventorySaveState({ tone: "saving", message: "Adding inventory row…" });
      await request(`/api/venues/${activeVenue.id}/inventory/import`, {
        method: "POST",
        body: JSON.stringify({
          replaceExisting: false,
          items: [
            {
              inventoryId: `NEW-${Date.now().toString().slice(-6)}`,
              locationId: selectedRoom.id,
              mapName: selectedRoom.name,
              mediaVariantKey: "custom_variant",
              variantLabel: "Custom Variant",
              mediaType: "Custom Variant",
              unitNumber: "",
              isActive: true,
              mapVisibilityMode: "hidden",
            },
          ],
        }),
      });
      setInventoryEditMode(true);
      await loadVenueDashboardData();
      await loadVenueDetailData(activeVenue.id);
      setInventorySaveState({ tone: "saved", message: "Inventory row added." });
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Unable to add inventory row");
      setInventorySaveState({ tone: "error", message: "We couldn’t add that inventory row." });
    }
  }

  async function deleteInventoryRecord(recordKey: string) {
    const inventoryItemId = getBackendInventoryId(recordKey);
    if (!inventoryItemId || !activeVenue) return;

    try {
      setInventorySaveState({ tone: "saving", message: "Deleting inventory row…" });
      await request<{ ok: boolean }>(`/api/inventory/${inventoryItemId}`, {
        method: "DELETE",
      });
      setSelectedRecordKeys((current) => current.filter((key) => key !== recordKey));
      await loadVenueDashboardData();
      await loadVenueDetailData(activeVenue.id);
      setInventorySaveState({ tone: "saved", message: "Inventory row deleted." });
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Unable to delete inventory row");
      setInventorySaveState({ tone: "error", message: "We couldn’t delete that inventory row." });
      await loadVenueDetailData(activeVenue.id);
    }
  }

  async function confirmImport() {
    if (!activeVenue || !result?.records?.length) return;

    try {
      const response = await request<InventoryImportResponse>(`/api/venues/${activeVenue.id}/inventory/import`, {
        method: "POST",
        body: JSON.stringify({
          importMode: inventoryImportMode,
          replaceExisting: inventoryImportMode === "replace",
          items: result.records.map((record) => ({
            inventoryId: record.inventoryId,
            mapName: record.mapName,
            mediaVariantKey: record.mediaVariantKey,
            variantLabel: record.variantLabel,
            mediaType: record.mediaType,
            unitNumber: record.unitNumber,
            isActive: record.isActive,
            mapVisibilityMode: record.mapVisibilityMode,
            trimHeight: record.trimHeight,
            trimWidth: record.trimWidth,
            safeHeight: record.safeHeight,
            safeWidth: record.safeWidth,
            substrate: record.substrate,
            finishing: record.finishing,
            locationDetail: record.locationDetail,
            notes: record.notes,
            dpi: record.dpi,
            bleedTop: record.bleedTop,
            bleedRight: record.bleedRight,
            bleedBottom: record.bleedBottom,
            bleedLeft: record.bleedLeft,
            color: variantAppearanceOverrides[record.mediaVariantKey]?.color,
            abbreviation: variantAppearanceOverrides[record.mediaVariantKey]?.abbreviation,
          })),
        }),
      });
      setImportApplyResult({
        ...response,
        appliedAt: new Date().toISOString(),
        sourceLabel: isUsingPennSampleInventory ? "Penn Station sample" : sourceLabel,
        plan: { ...importPlan, orphanedVariantKeys: [...importPlan.orphanedVariantKeys] },
        risks: importRisks,
      });
      setImportStep("results");
      setLoadTone("success");
      await loadVenueDashboardData();
      await loadVenueDetailData(activeVenue.id);
      setInventorySaveState({
        tone: "saved",
        message: `${response.importedCount} inventory row${response.importedCount === 1 ? "" : "s"} imported.`,
      });
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Unable to import venue inventory");
    }
  }

  function updateRoom(roomId: string, patch: Partial<Pick<RoomRecord, "name" | "sortOrder" | "mapAssetName" | "mapUrl">>) {
    setRooms((current) =>
      current.map((room) =>
        room.id === roomId
          ? {
              ...room,
              ...patch,
              updatedAt: new Date().toISOString().slice(0, 10),
            }
          : room
      )
    );
  }

  function handleRoomDrop(targetRoomId: string) {
    if (!draggedRoomId || draggedRoomId === targetRoomId) {
      setDraggedRoomId(null);
      return;
    }

    const sourceIndex = activeVenueRooms.findIndex((room) => room.id === draggedRoomId);
    const targetIndex = activeVenueRooms.findIndex((room) => room.id === targetRoomId);
    if (sourceIndex < 0 || targetIndex < 0) {
      setDraggedRoomId(null);
      return;
    }

    const nextRooms = [...activeVenueRooms];
    const [movedRoom] = nextRooms.splice(sourceIndex, 1);
    nextRooms.splice(targetIndex, 0, movedRoom);
    setDraggedRoomId(null);
    void persistRoomOrder(nextRooms);
  }

  async function removeRoom(roomId: string) {
    if (!activeVenue) return;
    const remaining = activeVenueRooms.filter((room) => room.id !== roomId);
    setRooms((current) => current.filter((room) => room.id !== roomId));
    if (selectedRoomId === roomId) {
      setSelectedRoomId(remaining[0]?.id || "");
    }
    try {
      await request<{ ok: boolean }>(`/api/venues/${activeVenue.id}/maps/${roomId}`, {
        method: "DELETE",
      });
      await loadVenueDashboardData();
      await loadVenueDetailData(activeVenue.id);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Unable to remove room");
      await loadVenueDetailData(activeVenue.id);
    }
  }

  async function replaceRoomMap(roomId: string) {
    const room = rooms.find((entry) => entry.id === roomId);
    if (!room) return;
    const nextAsset = ROOM_MAP_ASSET_LOOKUP[room.name] || mockMaps[(Date.now() / 1000) % mockMaps.length | 0];
    const nextPatch = {
      mapAssetName: "Updated-" + (room.mapAssetName || `${room.name}.svg`),
      mapUrl: "imageUrl" in nextAsset ? (nextAsset as any).imageUrl : room.mapUrl,
    };
    updateRoom(roomId, nextPatch);
    await persistRoomPatch(roomId, nextPatch);
  }

  async function deleteSelectedRows() {
    if (!selectedRecordKeys.length) return;
    await Promise.all(selectedRecordKeys.map((recordKey) => deleteInventoryRecord(recordKey)));
  }

  function mapPinStyle(index: number) {
    const positions = [
      { x: 0.18, y: 0.24 },
      { x: 0.32, y: 0.42 },
      { x: 0.46, y: 0.35 },
      { x: 0.61, y: 0.28 },
      { x: 0.74, y: 0.46 },
      { x: 0.26, y: 0.64 },
      { x: 0.43, y: 0.68 },
      { x: 0.68, y: 0.63 },
      { x: 0.81, y: 0.31 },
      { x: 0.56, y: 0.54 },
      { x: 0.37, y: 0.22 },
      { x: 0.14, y: 0.53 },
    ];
    return positions[index % positions.length];
  }

  function openVenueDetail(venueId: string) {
    setSelectedVenueId(venueId);
    const next = new URLSearchParams(location.search);
    next.set("venue", venueId);
    navigate({ pathname: location.pathname, search: next.toString() });
  }

  function closeVenueDetail() {
    const next = new URLSearchParams(location.search);
    next.delete("venue");
    navigate({ pathname: location.pathname, search: next.toString() });
  }

  function goBackToProjects() {
    navigate(projectsPath);
  }

  function getVariantAppearance(variantKey: string, label: string, index = 0) {
    const override = variantAppearanceOverrides[variantKey];
    const persistedVariant = liveVenueVariantByKey.get(variantKey);
    return {
      color: override?.color || persistedVariant?.color || variantPalette[index % variantPalette.length],
      abbreviation: (override?.abbreviation || persistedVariant?.abbreviation || buildVariantAbbreviation(label)).slice(0, 4).toUpperCase(),
      unitNumber: override?.unitNumber ?? persistedVariant?.unitNumber,
      liftProductMapping: override?.liftProductMapping || persistedVariant?.liftProductMapping,
      productionRouting: override?.productionRouting || persistedVariant?.productionRouting || "primary",
      externalVendorId: override?.externalVendorId || persistedVariant?.externalVendorId,
    };
  }

  function updateVariantAppearance(variantKey: string, label: string, patch: Partial<VariantAppearance>) {
    const variantIndex = Math.max(variantRows.findIndex((variant) => variant.key === variantKey), 0);
    const fallbackColor = variantPalette[variantIndex % variantPalette.length];
    setVariantAppearanceOverrides((current) => {
      const existing = current[variantKey];
      return {
        ...current,
        [variantKey]: {
          color: existing?.color || fallbackColor,
          abbreviation: existing?.abbreviation || buildVariantAbbreviation(label),
          unitNumber: existing?.unitNumber,
          liftProductMapping: existing?.liftProductMapping,
          productionRouting: existing?.productionRouting || "primary",
          externalVendorId: existing?.externalVendorId,
          ...patch,
        },
      };
    });
  }

  async function persistVariantAppearance(
    variant: { variantId?: string; label: string },
    patch: Partial<VariantAppearance>
  ) {
    if (!activeVenue || !variant.variantId) return;

    try {
      setInventorySaveState({ tone: "saving", message: "Saving variant settings…" });
      await request<{ variant: any }>(`/api/venues/${activeVenue.id}/variants/${variant.variantId}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      await loadVenueDetailData(activeVenue.id);
      setInventorySaveState({ tone: "saved", message: "Variant settings saved." });
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Unable to save variant settings");
      setInventorySaveState({ tone: "error", message: "We couldn’t save those variant settings." });
      await loadVenueDetailData(activeVenue.id);
    }
  }

  function openLiftProductMapper(variant: { key: string; variantId?: string; label: string }, appearance: VariantAppearance) {
    const mapping = appearance.liftProductMapping || {};
    setLiftProductMapper({
      targetType: "variant",
      variantKey: variant.key,
      variantId: variant.variantId,
      variantLabel: variant.label,
      catalogId: mapping.liftCatalogId == null ? "" : String(mapping.liftCatalogId),
      catalogName: mapping.liftCatalogName || "",
      productName: mapping.liftProductName || "",
      productId: mapping.liftProductId == null ? "" : String(mapping.liftProductId),
      productType: "",
      status: "A",
      results: [],
      localQuery: "",
      selectedProduct: null,
      selectedUnitNumber: mapping.liftUnitNumber || appearance.unitNumber || "",
      loading: false,
      error: "",
      hasSearched: false,
      hasMore: false,
    });
  }

  function openInventoryLiftProductMapper(record: any, appearance: VariantAppearance) {
    const mapping = record.liftProductMapping || appearance.liftProductMapping || {};
    setLiftProductMapper({
      targetType: "inventory",
      variantKey: record.mediaVariantKey,
      variantLabel: record.variantLabel,
      recordKey: record.recordKey,
      inventoryItemId: getBackendInventoryId(record.recordKey),
      inventoryId: record.inventoryId,
      catalogId: mapping.liftCatalogId == null ? "" : String(mapping.liftCatalogId),
      catalogName: mapping.liftCatalogName || "",
      productName: mapping.liftProductName || "",
      productId: mapping.liftProductId == null ? "" : String(mapping.liftProductId),
      productType: "",
      status: "A",
      results: [],
      localQuery: "",
      selectedProduct: null,
      selectedUnitNumber: mapping.liftUnitNumber || record.unitNumber || appearance.unitNumber || "",
      loading: false,
      error: "",
      hasSearched: false,
      hasMore: false,
    });
  }

  function patchLiftProductMapper(patch: Partial<LiftProductMapperState>) {
    setLiftProductMapper((current) => current ? { ...current, ...patch } : current);
  }

  function toggleVariantInventoryRefs(variantKey: string) {
    setExpandedVariantInventoryRefs((current) => {
      const next = new Set(current);
      if (next.has(variantKey)) next.delete(variantKey);
      else next.add(variantKey);
      return next;
    });
  }

  async function runLiftProductSearch() {
    if (!liftProductMapper) return;
    const hasFilter = [
      liftProductMapper.catalogId,
      liftProductMapper.catalogName,
      liftProductMapper.productId,
      liftProductMapper.productName,
    ].some((value) => value.trim());
    if (!hasFilter) {
      patchLiftProductMapper({ error: "Enter a catalog ID/name or product ID/name before searching." });
      return;
    }

    patchLiftProductMapper({ loading: true, error: "", hasSearched: true, selectedProduct: null, selectedUnitNumber: "", localQuery: "" });
    try {
      const response = await fetchLiftProducts(
        { request },
        {
          catalogId: liftProductMapper.catalogId.trim(),
          catalogName: liftProductMapper.catalogName.trim(),
          productId: liftProductMapper.productId.trim(),
          productName: liftProductMapper.productName.trim(),
          productType: liftProductMapper.productType,
          status: liftProductMapper.status,
        }
      );
      setLiftProductMapper((current) =>
        current
          ? {
              ...current,
              results: response.products,
              hasMore: response.hasMore,
              loading: false,
              error: "",
            }
          : current
      );
    } catch (error) {
      patchLiftProductMapper({
        loading: false,
        error: error instanceof Error ? error.message : "Unable to search Lift products.",
      });
    }
  }

  function selectLiftProduct(product: ApiLiftProduct) {
    const unitNumbers = Array.from(new Set((product.unitNumbers || []).filter(Boolean)));
    patchLiftProductMapper({
      selectedProduct: product,
      selectedUnitNumber: unitNumbers.length === 1 ? unitNumbers[0] : "",
      error: "",
    });
  }

  async function saveLiftProductMapping() {
    if (!liftProductMapper?.selectedProduct) return;
    const product = liftProductMapper.selectedProduct;
    const selectedUnitNumber = liftProductMapper.selectedUnitNumber.trim();
    const returnedUnitNumbers = Array.from(new Set((product.unitNumbers || []).filter(Boolean)));
    if (returnedUnitNumbers.length > 1 && !selectedUnitNumber) {
      patchLiftProductMapper({ error: "Choose one unit number to import for this mapping." });
      return;
    }
    if (!product.productId) {
      patchLiftProductMapper({ error: "Lift did not return a product ID for this product." });
      return;
    }
    if (liftProductMapper.targetType === "variant" && !liftProductMapper.variantId) {
      patchLiftProductMapper({ error: "Save/import this venue inventory before mapping Lift products." });
      return;
    }
    if (liftProductMapper.targetType === "inventory" && !liftProductMapper.inventoryItemId) {
      patchLiftProductMapper({ error: "Save/import this inventory row before mapping Lift products." });
      return;
    }
    const mapping: LiftProductMapping = {
      liftProductId: product.productId ?? undefined,
      liftProductName: product.productName || undefined,
      liftCatalogId: product.catalogId ?? undefined,
      liftCatalogName: product.catalogName || undefined,
      liftProductType: product.productType || undefined,
      liftProductStatus: product.status || undefined,
      liftUnitNumber: selectedUnitNumber || undefined,
    };
    if (liftProductMapper.targetType === "inventory") {
      const existingRecord = effectiveRecords.find((record) => record.recordKey === liftProductMapper.recordKey);
      const nextUnitNumber = selectedUnitNumber || existingRecord?.unitNumber || "";
      if (!liftProductMapper.recordKey) {
        patchLiftProductMapper({ error: "This inventory row could not be identified." });
        return;
      }
      updateRecordOverride(liftProductMapper.recordKey, {
        unitNumber: nextUnitNumber,
        liftProductMapping: mapping,
      });
      await persistInventoryPatch(liftProductMapper.recordKey, {
        unitNumber: nextUnitNumber,
        liftProductMapping: mapping,
      });
      setLiftProductMapper(null);
      return;
    }
    const existingUnitNumber =
      variantAppearanceOverrides[liftProductMapper.variantKey]?.unitNumber ??
      liveVenueVariantByKey.get(liftProductMapper.variantKey)?.unitNumber ??
      "";
    const nextUnitNumber = selectedUnitNumber || existingUnitNumber;
    updateVariantAppearance(liftProductMapper.variantKey, liftProductMapper.variantLabel, {
      unitNumber: nextUnitNumber,
      liftProductMapping: mapping,
    });
    await persistVariantAppearance(
      { variantId: liftProductMapper.variantId, label: liftProductMapper.variantLabel },
      { unitNumber: nextUnitNumber, liftProductMapping: mapping }
    );
    setLiftProductMapper(null);
  }

  function updateRecordOverride(recordKey: string, patch: Partial<InventoryRecordOverride>) {
    setRecordOverrides((current) => ({
      ...current,
      [recordKey]: {
        ...current[recordKey],
        ...patch,
      },
    }));
  }

  function getNumericDraftValue(
    recordKey: string,
    field: "trimHeight" | "trimWidth" | "safeHeight" | "safeWidth",
    persisted: number | null | undefined
  ) {
    const draft = numericDrafts[recordKey]?.[field];
    if (draft != null) return draft;
    return persisted == null ? "" : String(persisted);
  }

  function updateNumericDraft(
    recordKey: string,
    field: "trimHeight" | "trimWidth" | "safeHeight" | "safeWidth",
    value: string
  ) {
    setNumericDrafts((current) => ({
      ...current,
      [recordKey]: {
        ...current[recordKey],
        [field]: value,
      },
    }));
  }

  function clearNumericDraft(recordKey: string, field: "trimHeight" | "trimWidth" | "safeHeight" | "safeWidth") {
    setNumericDrafts((current) => {
      const currentRow = current[recordKey];
      if (!currentRow) return current;
      const nextRow = { ...currentRow };
      delete nextRow[field];
      if (Object.keys(nextRow).length === 0) {
        const next = { ...current };
        delete next[recordKey];
        return next;
      }
      return {
        ...current,
        [recordKey]: nextRow,
      };
    });
  }

  function toggleSelectedRecord(recordKey: string) {
    setSelectedRecordKeys((current) =>
      current.includes(recordKey) ? current.filter((key) => key !== recordKey) : [...current, recordKey]
    );
  }

  function openBulkInventoryEditor() {
    if (!selectedRecordKeys.length || !inventoryEditMode || !canEditVenueInventory) return;
    setBulkInventoryEditor({
      recordKeys: selectedRecordKeys,
      draft: createBulkInventoryEditDraft(),
      error: "",
      saving: false,
    });
  }

  function patchBulkInventoryDraft(patch: Partial<BulkInventoryEditDraft>) {
    setBulkInventoryEditor((current) =>
      current
        ? {
            ...current,
            error: "",
            draft: {
              ...current.draft,
              ...patch,
            },
          }
        : current
    );
  }

  function toggleBulkInventoryField(field: BulkInventoryField) {
    setBulkInventoryEditor((current) =>
      current
        ? {
            ...current,
            error: "",
            draft: {
              ...current.draft,
              enabled: {
                ...current.draft.enabled,
                [field]: !current.draft.enabled[field],
              },
            },
          }
        : current
    );
  }

  function bulkNumberValue(value: string, fieldLabel: string) {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const next = Number(trimmed);
    if (!Number.isFinite(next)) throw new Error(`${fieldLabel} must be a number.`);
    return next;
  }

  function buildBulkInventoryPayload(draft: BulkInventoryEditDraft) {
    const patch: Record<string, unknown> = {};
    const clearFields: string[] = [];
    const enabledFields = Object.entries(draft.enabled).filter(([, enabled]) => enabled).map(([field]) => field);
    if (!enabledFields.length) throw new Error("Choose at least one field to update.");

    if (draft.enabled.availability) {
      if (draft.availability === "active") {
        patch.isActive = true;
      } else {
        patch.isActive = false;
        patch.mapVisibilityMode = draft.availability === "inactive_unavailable" ? "show_unavailable" : "hidden";
      }
    }
    if (draft.enabled.locationId) {
      if (!draft.locationId) throw new Error("Choose a map before applying the map change.");
      patch.locationId = draft.locationId;
    }
    if (draft.enabled.locationDetail) {
      if (draft.locationDetailMode === "clear") clearFields.push("locationDetail");
      else {
        if (!draft.locationDetail.trim()) throw new Error("Location detail is required when replacing that field.");
        patch.locationDetail = draft.locationDetail.trim();
      }
    }
    if (draft.enabled.mediaType) {
      if (!draft.mediaType.trim()) throw new Error("Media type is required when that field is selected.");
      patch.mediaType = draft.mediaType.trim();
    }
    if (draft.enabled.trimHeight) patch.trimHeight = bulkNumberValue(draft.trimHeight, "Trim height");
    if (draft.enabled.trimWidth) patch.trimWidth = bulkNumberValue(draft.trimWidth, "Trim width");
    if (draft.enabled.safeHeight) patch.safeHeight = bulkNumberValue(draft.safeHeight, "Safe height");
    if (draft.enabled.safeWidth) patch.safeWidth = bulkNumberValue(draft.safeWidth, "Safe width");
    if (draft.enabled.substrate) {
      if (!draft.substrate.trim()) throw new Error("Substrate is required when that field is selected.");
      patch.substrate = draft.substrate.trim();
    }
    if (draft.enabled.finishing) {
      if (!draft.finishing.trim()) throw new Error("Finishing is required when that field is selected.");
      patch.finishing = draft.finishing.trim();
    }
    if (draft.enabled.dpi) patch.dpi = bulkNumberValue(draft.dpi, "DPI");
    if (draft.enabled.bleedTop) patch.bleedTop = bulkNumberValue(draft.bleedTop, "Bleed top");
    if (draft.enabled.bleedRight) patch.bleedRight = bulkNumberValue(draft.bleedRight, "Bleed right");
    if (draft.enabled.bleedBottom) patch.bleedBottom = bulkNumberValue(draft.bleedBottom, "Bleed bottom");
    if (draft.enabled.bleedLeft) patch.bleedLeft = bulkNumberValue(draft.bleedLeft, "Bleed left");
    if (draft.enabled.routing) {
      if (draft.routing === "inherit") {
        clearFields.push("productionRoutingOverride", "externalVendorIdOverride");
      } else if (draft.routing === "primary") {
        patch.productionRoutingOverride = "primary";
        clearFields.push("externalVendorIdOverride");
      } else {
        if (!draft.externalVendorId) throw new Error("Choose an external vendor before applying that route.");
        patch.productionRoutingOverride = "external";
        patch.externalVendorIdOverride = draft.externalVendorId;
      }
    }
    if (draft.enabled.unitNumber) {
      if (draft.unitNumberMode === "clear") clearFields.push("unitNumber");
      else {
        if (!draft.unitNumber.trim()) throw new Error("Unit number is required when replacing that field.");
        patch.unitNumber = draft.unitNumber.trim();
      }
    }
    if (draft.enabled.productMapping) {
      if (draft.productMappingMode === "clear") {
        clearFields.push("liftProductMapping");
      } else {
        const productId = Number(draft.productId.trim());
        if (!Number.isFinite(productId)) throw new Error("Product ID must be a number.");
        patch.liftProductMapping = {
          liftProductId: productId,
          liftProductName: draft.productName.trim() || undefined,
          liftUnitNumber: draft.unitNumberMode === "replace" && draft.unitNumber.trim() ? draft.unitNumber.trim() : undefined,
        };
      }
    }
    if (draft.enabled.notes) {
      if (draft.notesMode === "clear") clearFields.push("notes");
      else {
        if (!draft.notes.trim()) throw new Error("Note text is required before applying notes.");
        patch.notes = draft.notes.trim();
      }
    }

    return {
      patch,
      clearFields: Array.from(new Set(clearFields)),
      notesMode: draft.enabled.notes ? draft.notesMode : "replace",
      enabledFields,
    };
  }

  function describeBulkInventoryChanges(draft: BulkInventoryEditDraft) {
    const labels: string[] = [];
    if (draft.enabled.availability) labels.push(`Availability: ${draft.availability === "active" ? "Active" : draft.availability === "inactive_unavailable" ? "Inactive, show unavailable" : "Inactive, hidden"}`);
    if (draft.enabled.locationId) labels.push("Map");
    if (draft.enabled.locationDetail) labels.push(draft.locationDetailMode === "clear" ? "Clear location detail" : "Location detail");
    if (draft.enabled.mediaType) labels.push("Media type");
    if (draft.enabled.trimHeight || draft.enabled.trimWidth) labels.push("Trim dimensions");
    if (draft.enabled.safeHeight || draft.enabled.safeWidth) labels.push("Safe dimensions");
    if (draft.enabled.substrate) labels.push("Substrate");
    if (draft.enabled.finishing) labels.push("Finishing");
    if (draft.enabled.dpi) labels.push("DPI");
    if (draft.enabled.bleedTop || draft.enabled.bleedRight || draft.enabled.bleedBottom || draft.enabled.bleedLeft) labels.push("Bleed");
    if (draft.enabled.routing) labels.push(`Routing: ${draft.routing === "inherit" ? "Inherit variant" : draft.routing === "primary" ? "Primary print vendor" : "External vendor"}`);
    if (draft.enabled.unitNumber) labels.push(draft.unitNumberMode === "clear" ? "Clear unit number" : "Unit number");
    if (draft.enabled.productMapping) labels.push(draft.productMappingMode === "clear" ? "Clear row product mapping" : "Row product mapping");
    if (draft.enabled.notes) labels.push(draft.notesMode === "clear" ? "Clear notes" : draft.notesMode === "append" ? "Append notes" : "Replace notes");
    return labels;
  }

  function formatInventoryHistoryEventTitle(event: VenueInventoryHistoryEvent) {
    switch (event.eventType) {
      case "inventory.imported":
        return event.detail?.importMode === "replace" ? "Inventory replaced" : "Inventory merged";
      case "inventory.bulk_updated":
        return "Bulk inventory edit";
      case "inventory.updated":
        return "Inventory row updated";
      case "inventory.deleted":
        return "Inventory row deleted";
      case "variant.updated":
        return "Media variant updated";
      case "inventory_preset.created":
        return "Inventory preset created";
      case "inventory_preset.updated":
        return "Inventory preset updated";
      case "inventory_preset.archived":
        return "Inventory preset archived";
      default:
        return event.eventType.replace(/[._]/g, " ");
    }
  }

  function formatInventoryHistoryMeta(event: VenueInventoryHistoryEvent) {
    const detail = event.detail || {};
    if (event.eventType === "inventory.imported") {
      const pieces = [
        `${detail.importedCount ?? 0} rows`,
        `${detail.addedCount ?? 0} added`,
        `${detail.updatedCount ?? 0} updated`,
        detail.importMode === "merge" ? `${detail.retainedMissingCount ?? 0} retained` : "replace mode",
      ];
      return pieces.join(" · ");
    }
    if (event.eventType === "inventory.bulk_updated") {
      const fields = [...(detail.patchFields || []), ...(detail.clearFields || [])].filter(Boolean);
      return [
        `${detail.updatedCount ?? 0} updated`,
        `${detail.failedCount ?? 0} failed`,
        fields.length ? fields.join(", ") : "No fields listed",
      ].join(" · ");
    }
    if (event.eventType === "variant.updated") {
      const changes = Object.keys(detail.changes || {});
      return changes.length ? changes.join(", ") : "Variant settings changed";
    }
    if (event.eventType.startsWith("inventory_preset.")) {
      return [detail.name, detail.includedCount != null ? `${detail.includedCount} rows` : ""].filter(Boolean).join(" · ") || "Preset changed";
    }
    return [detail.inventoryItemId, detail.locationId].filter(Boolean).join(" · ") || "Inventory changed";
  }

  function inventoryHistoryMetrics(event: VenueInventoryHistoryEvent) {
    const detail = event.detail || {};
    if (event.eventType === "inventory.imported") {
      return [
        ["Rows", detail.importedCount],
        ["Added", detail.addedCount],
        ["Updated", detail.updatedCount],
        ["Mappings", (detail.preservedInventoryMappingCount || 0) + (detail.preservedVariantMappingCount || 0)],
      ].filter(([, value]) => value != null);
    }
    if (event.eventType === "inventory.bulk_updated") {
      return [
        ["Requested", detail.requestedCount],
        ["Updated", detail.updatedCount],
        ["Failed", detail.failedCount],
      ].filter(([, value]) => value != null);
    }
    return [];
  }

  async function applyBulkInventoryEdit() {
    if (!activeVenue || !bulkInventoryEditor) return;
    try {
      const payload = buildBulkInventoryPayload(bulkInventoryEditor.draft);
      if (!bulkEditorBackendIds.length) throw new Error("The selected rows need to be saved before they can be bulk edited.");
      setBulkInventoryEditor((current) => current ? { ...current, saving: true, error: "" } : current);
      setInventorySaveState({ tone: "saving", message: "Applying bulk inventory edits…" });
      const response = await request<{ updated: number; failed: number; failures?: Array<{ inventoryItemId: string; message: string }> }>(
        `/api/venues/${activeVenue.id}/inventory/bulk`,
        {
          method: "PATCH",
          body: JSON.stringify({
            inventoryItemIds: bulkEditorBackendIds,
            patch: payload.patch,
            clearFields: payload.clearFields,
            notesMode: payload.notesMode,
          }),
        }
      );
      await loadVenueDashboardData();
      await loadVenueDetailData(activeVenue.id);
      if (response.failed) {
        setBulkInventoryEditor((current) =>
          current
            ? {
                ...current,
                saving: false,
                error: `${response.updated} row${response.updated === 1 ? "" : "s"} updated; ${response.failed} failed. ${response.failures?.[0]?.message || ""}`,
              }
            : current
        );
        setInventorySaveState({ tone: "error", message: "Some selected rows could not be updated." });
        return;
      }
      setSelectedRecordKeys([]);
      setBulkInventoryEditor(null);
      setInventorySaveState({ tone: "saved", message: `${response.updated} row${response.updated === 1 ? "" : "s"} updated.` });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to apply bulk inventory edits.";
      setBulkInventoryEditor((current) => current ? { ...current, saving: false, error: message } : current);
      setInventorySaveState({ tone: "error", message });
    }
  }

  async function applyBulkRecordPatch(patch: Partial<InventoryRecordOverride>) {
    setRecordOverrides((current) => {
      const next = { ...current };
      selectedRecordKeys.forEach((recordKey) => {
        next[recordKey] = {
          ...next[recordKey],
          ...patch,
        };
      });
      return next;
    });

    const selectedRecords = effectiveRecords.filter((record) => selectedRecordKeys.includes(record.recordKey));
    await Promise.all(
      selectedRecords.map((record) => {
        const nextPatch: Record<string, unknown> = {};
        if (typeof patch.isActive === "boolean") nextPatch.isActive = patch.isActive;
        if (patch.mapVisibilityMode) nextPatch.mapVisibilityMode = patch.mapVisibilityMode;
        return persistInventoryPatch(record.recordKey, nextPatch);
      })
    );
  }

  async function applyVendorRouteToRecords(
    recordKeys: string[],
    route: "inherit" | "primary" | "external",
    externalVendorId?: string
  ) {
    if (!recordKeys.length) return;
    const patch: Partial<InventoryRecordOverride> = route === "external"
      ? { productionRoutingOverride: "external", externalVendorIdOverride: externalVendorId || "" }
      : route === "primary"
        ? { productionRoutingOverride: "primary", externalVendorIdOverride: "" }
        : { productionRoutingOverride: undefined, externalVendorIdOverride: "" };
    setRecordOverrides((current) => {
      const next = { ...current };
      recordKeys.forEach((recordKey) => {
        const nextOverride = {
          ...next[recordKey],
          ...patch,
        };
        if (route === "inherit") {
          delete nextOverride.productionRoutingOverride;
          delete nextOverride.externalVendorIdOverride;
        }
        next[recordKey] = nextOverride;
      });
      return next;
    });

    const selectedRecords = effectiveRecords.filter((record) => recordKeys.includes(record.recordKey));
    await Promise.all(
      selectedRecords.map((record) =>
        persistInventoryPatch(record.recordKey, {
          productionRoutingOverride: route === "inherit" ? "" : route,
          externalVendorIdOverride: route === "external" ? externalVendorId || "" : "",
        })
      )
    );
    setVendorPicker(null);
    setVendorSearch("");
  }

  function getVenueMarketRecord(venue: VenueRecord) {
    return venue.marketId ? marketsById.get(venue.marketId) : undefined;
  }

  function getVenueEffectiveActive(venue: VenueRecord) {
    return venue.isActive && (getVenueMarketRecord(venue)?.isActive ?? true);
  }

  function getVenueStatusNote(venue: VenueRecord) {
    const market = getVenueMarketRecord(venue);
    if (market && !market.isActive) {
      return venue.isActive ? "Hidden by inactive market" : "Venue paused and market inactive";
    }
    if (!venue.isActive) return "Venue paused";
    return "";
  }

  function getMarketStatusNote(market: MarketRecord) {
    if (!market.isActive) return "Overrides venue availability";
    return "";
  }

  useEffect(() => {
    if (inventorySaveState.tone !== "saved" && inventorySaveState.tone !== "error") return;
    const timeout = window.setTimeout(() => {
      setInventorySaveState((current) => (current.tone === "saving" ? current : { tone: "idle", message: "" }));
    }, inventorySaveState.tone === "saved" ? 2200 : 3400);
    return () => window.clearTimeout(timeout);
  }, [inventorySaveState]);

  const inventorySaveStatusClassName = [
    "venue-preview-saveStatus",
    inventorySaveState.tone === "saving" ? "is-saving" : "",
    inventorySaveState.tone === "saved" ? "is-saved" : "",
    inventorySaveState.tone === "error" ? "is-error" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const bulkEditorChangeLabels = bulkInventoryEditor
    ? describeBulkInventoryChanges(bulkInventoryEditor.draft)
    : [];

  return (
    <AppShell pageClassName="wide" showNavTrigger>
      <div className="venue-preview">
        <PageHeader
          backLabel={isDetailMode ? "← Back to Venues" : "← Back to Projects"}
          onBack={isDetailMode ? closeVenueDetail : goBackToProjects}
          title="Venue Management"
          subtitle={
            !isDetailMode
              ? "Scan venue coverage, filter by customer and market, and jump into the right venue workspace."
              : undefined
          }
          meta={
            !isDetailMode ? (
              <div className="venue-preview-pageMeta">
                <span>{isCustomerContext ? "Customer workspace" : "Internal admin workspace"}</span>
                <span className="page-header-dot">•</span>
                <span>
                  {dashboardStats.venues} visible venue{dashboardStats.venues === 1 ? "" : "s"}
                </span>
                <span className="page-header-dot">•</span>
                <span>
                  {dashboardStats.markets} market{dashboardStats.markets === 1 ? "" : "s"}
                </span>
                <span className="page-header-dot">•</span>
                <span>
                  {dashboardStats.rooms} room{dashboardStats.rooms === 1 ? "" : "s"}
                </span>
              </div>
            ) : (
              <div className="venue-preview-pageMeta">
                <span>{activeVenue?.customerName || customerScopeName}</span>
                <span className="page-header-dot">•</span>
                <span>{activeVenue?.name || "Venue detail"}</span>
                <span className="page-header-dot">•</span>
                <span>{activeVenue?.marketName || "No market selected"}</span>
              </div>
            )
          }
          actions={
            !isDetailMode && !isCustomerContext ? (
              <button className="btn btn-primary btn-lg" type="button" onClick={() => setShowCreateVenue(true)}>
                New Venue
              </button>
            ) : null
          }
        />
        {apiError ? <div className="venue-preview-syncState venue-preview-syncState-error">{apiError}</div> : null}
        {!isDetailMode ? (
          <div className="venue-preview-dashboard">
            <div className="hero-summary">
              <div className="hero-summaryCard hero-summaryCard-info">
                <div className="hero-summaryValue">{dashboardStats.venues}</div>
                <div className="hero-summaryLabel">Visible Venues</div>
              </div>
              <div className="hero-summaryCard hero-summaryCard-warning">
                <div className="hero-summaryValue">{dashboardStats.markets}</div>
                <div className="hero-summaryLabel">Markets</div>
              </div>
              <div className="hero-summaryCard hero-summaryCard-success">
                <div className="hero-summaryValue">{dashboardStats.inventory}</div>
                <div className="hero-summaryLabel">Inventory Records</div>
              </div>
              <div className="hero-summaryCard hero-summaryCard-danger">
                <div className="hero-summaryValue">{dashboardStats.unpinned}</div>
                <div className="hero-summaryLabel">Unpinned</div>
              </div>
            </div>

            {!isCustomerContext ? (
              <div className="venue-preview-toolbar venue-preview-toolbar-dashboardScope">
                <div>
                  <div className="venue-preview-title">Customer Scope</div>
                  <div className="venue-preview-sub">
                    Use one customer filter to drive both the venues and markets dashboards.
                  </div>
                </div>
                <select
                  className="select venue-preview-select venue-preview-filterSelect venue-preview-dashboardScopeSelect"
                  value={customerFilter}
                  onChange={(e) => {
                    setCustomerFilter(e.target.value);
                    setMarketFilter("all");
                  }}
                >
                  <option value="all">All customers</option>
                  {customerOptions.map((customer) => (
                    <option key={customer} value={customer}>
                      {customer}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <Panel className="panel-tight venue-preview-panel">
              <div className="venue-preview-head">
                <div>
                  <div className="venue-preview-title">Venues</div>
                  <div className="venue-preview-sub">
                    Search and filter venues, then open one to manage rooms, maps, inventory, and pin placement.
                  </div>
                </div>
                <button className="btn btn-primary" type="button" onClick={() => setShowCreateVenue((current) => !current)}>
                  {showCreateVenue ? "Close Create Venue" : "Create Venue"}
                </button>
              </div>

              <div className="venue-preview-filters venue-preview-filters-dashboard">
                <div className="field-search venue-preview-search">
                  <span aria-hidden="true">◦</span>
                  <input
                    className="field-input"
                    type="search"
                    value={venueSearch}
                    onChange={(e) => setVenueSearch(e.target.value)}
                    placeholder="Search venue, market, or customer"
                  />
                </div>
                <div className="venue-preview-filterCluster">
                  <select
                    className="select venue-preview-select venue-preview-filterSelect"
                    value={marketFilter}
                    onChange={(e) => setMarketFilter(e.target.value)}
                  >
                    <option value="all">All markets</option>
                    {marketOptions.map((market) => (
                      <option key={market} value={market}>
                        {market}
                      </option>
                    ))}
                  </select>

                  <select
                    className="select venue-preview-select venue-preview-filterSelect"
                    value={venueActivityFilter}
                    onChange={(e) => setVenueActivityFilter(e.target.value as "all" | "active" | "inactive")}
                  >
                    <option value="all">All statuses</option>
                    <option value="active">Active venues</option>
                    <option value="inactive">Inactive venues</option>
                  </select>
                </div>
              </div>

              {showCreateVenue ? (
                <div className="venue-preview-form venue-preview-dashboardCreate">
                  {!isCustomerContext ? (
                    <label className="venue-preview-field">
                      <span className="venue-preview-fieldLabel">Customer</span>
                      <select
                        className="select venue-preview-input"
                        value={createVenueCustomerName}
                        onChange={(e) => {
                          setNewVenueCustomerName(e.target.value);
                          setNewVenueMarketId("");
                        }}
                      >
                        <option value="">Select customer</option>
                        {customerOptions.map((customer) => (
                          <option key={customer} value={customer}>
                            {customer}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <label className="venue-preview-field">
                    <span className="venue-preview-fieldLabel">Market</span>
                    <select
                      className="select venue-preview-input"
                      value={newVenueMarketId}
                      onChange={(e) => setNewVenueMarketId(e.target.value)}
                      disabled={!createVenueCustomerName || !createVenueMarketOptions.length}
                    >
                      {!createVenueCustomerName ? <option value="">Select customer first</option> : null}
                      {createVenueCustomerName && !createVenueMarketOptions.length ? (
                        <option value="">Create a market first</option>
                      ) : null}
                      {createVenueMarketOptions.map((market) => (
                        <option key={market.id} value={market.id}>
                          {market.name}{market.isActive ? "" : " (inactive)"}
                        </option>
                      ))}
                    </select>
                    {createVenueCustomerName && !createVenueMarketOptions.length ? (
                      <span className="venue-preview-fieldHint">Create a market for this customer before adding a venue.</span>
                    ) : null}
                  </label>
                  <label className="venue-preview-field">
                    <span className="venue-preview-fieldLabel">Venue Name</span>
                    <input
                      className="field-input venue-preview-input"
                      value={newVenueName}
                      onChange={(e) => setNewVenueName(e.target.value)}
                      placeholder="Penn Station"
                    />
                  </label>
                  <div className="venue-preview-field venue-preview-fieldActions">
                    <span className="venue-preview-fieldLabel">Next</span>
                    <div className="venue-preview-rowActions">
                      <button
                        className="btn btn-primary"
                        type="button"
                        onClick={createVenue}
                        disabled={!newVenueName.trim() || !createVenueCustomerName || !newVenueMarketId}
                      >
                        Create Venue
                      </button>
                      <button className="btn btn-ghost btn-soft" type="button" onClick={() => setShowCreateVenue(false)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

              {!visibleVenues.length ? (
                <div className="venue-preview-empty">No venues match the current filters.</div>
              ) : (
                <div className="table-wrap venue-preview-tableWrap">
                  <table className="data-table venue-preview-table">
                    <thead>
                      <tr>
                        <th>Venue</th>
                        {!isCustomerContext ? <th>Customer</th> : null}
                        <th>Market</th>
                        <th>Status</th>
                        <th>Rooms</th>
                        <th>Inventory</th>
                        <th>Unpinned</th>
                        <th>Updated</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleVenues.map((venue) => {
                        const venueRooms = rooms.filter((room) => room.venueId === venue.id);
                        const totalInventory = venueRooms.reduce((sum, room) => sum + room.inventoryCount, 0);
                        const totalUnpinned = venueRooms.reduce((sum, room) => sum + room.unpinnedCount, 0);
                        const isEffectivelyActive = getVenueEffectiveActive(venue);
                        return (
                          <tr key={venue.id}>
                            <td>
                              <div className="venue-preview-cellStrong">{venue.name}</div>
                              <div className="venue-preview-cellMeta">{venue.documentLibraryUrl ? "Docs linked" : "No docs linked"}</div>
                            </td>
                            {!isCustomerContext ? <td className="venue-preview-cellStrong">{venue.customerName}</td> : null}
                            <td>
                              <div className="venue-preview-cellStrong">{venue.marketName}</div>
                            </td>
                            <td>
                              <div className="venue-preview-statusControlCell">
                                <button
                                  type="button"
                                  className={`venue-preview-statusToggle ${venue.isActive ? "is-active" : "is-inactive"}`}
                                  aria-pressed={venue.isActive}
                                  onClick={() => updateVenueStatus(venue.id, !venue.isActive)}
                                >
                                  <span className="venue-preview-statusToggleDot" aria-hidden="true" />
                                  <span>{venue.isActive ? "Active" : "Inactive"}</span>
                                </button>
                                {getVenueStatusNote(venue) ? (
                                  <div className="venue-preview-cellMeta">{getVenueStatusNote(venue)}</div>
                                ) : !isEffectivelyActive ? (
                                  <div className="venue-preview-cellMeta">Unavailable</div>
                                ) : null}
                              </div>
                            </td>
                            <td className="venue-preview-cellStrong">{venueRooms.length}</td>
                            <td className="venue-preview-cellStrong">{totalInventory}</td>
                            <td>
                              <span className={`venue-preview-status ${totalUnpinned > 0 ? "is-warning" : "is-ok"}`}>
                                {totalUnpinned}
                              </span>
                            </td>
                            <td className="venue-preview-cellMeta">{venue.updatedAt}</td>
                            <td>
                              <button className="btn btn-primary" type="button" onClick={() => openVenueDetail(venue.id)}>
                                Open Venue
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>

            <Panel className="panel-tight venue-preview-panel">
              <div className="venue-preview-head">
                <div>
                  <div className="venue-preview-title">Markets</div>
                  <div className="venue-preview-sub">
                    Manage the market list used by venue setup. Markets stay customer-scoped and feed the venue market selector.
                  </div>
                </div>
                <div className="venue-preview-headActions">
                  <button
                    className={`btn ${showAddMarketForm ? "btn-ghost btn-soft" : "btn-primary"}`.trim()}
                    type="button"
                    onClick={() => {
                      setShowAddMarketForm((current) => !current);
                      setNewManagedMarketName("");
                    }}
                  >
                    {showAddMarketForm ? "Cancel" : "Add Market"}
                  </button>
                </div>
              </div>

              {showAddMarketForm ? (
                <div className="venue-preview-inlineCreate">
                  <input
                    className="field-input venue-preview-input venue-preview-marketInput"
                    value={newManagedMarketName}
                    onChange={(e) => setNewManagedMarketName(e.target.value)}
                    placeholder="Market name"
                  />
                  <button className="btn btn-primary" type="button" onClick={createMarket} disabled={!newManagedMarketName.trim()}>
                    Create Market
                  </button>
                </div>
              ) : null}

              <div className="venue-preview-filters venue-preview-filters-dashboard venue-preview-marketFilters">
                <div className="field-search venue-preview-search">
                  <span aria-hidden="true">◦</span>
                  <input
                    className="field-input"
                    type="search"
                    value={marketSearch}
                    onChange={(e) => setMarketSearch(e.target.value)}
                    placeholder="Search market or customer"
                  />
                </div>
                <div className="venue-preview-filterCluster">
                  <select
                    className="select venue-preview-select venue-preview-filterSelect"
                    value={marketActivityFilter}
                    onChange={(e) => setMarketActivityFilter(e.target.value as "all" | "active" | "inactive")}
                  >
                    <option value="all">All statuses</option>
                    <option value="active">Active markets</option>
                    <option value="inactive">Inactive markets</option>
                  </select>
                </div>
              </div>

              {!filteredMarkets.length ? (
                <div className="venue-preview-empty">No markets match the current filters.</div>
              ) : (
                <div className="table-wrap venue-preview-tableWrap">
                  <table className="data-table venue-preview-table">
                    <thead>
                      <tr>
                        <th>Market</th>
                        {!isCustomerContext ? <th>Customer</th> : null}
                        <th>Venues</th>
                        <th>Default Ship-To</th>
                        <th>Status</th>
                        <th>Updated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredMarkets.map((market) => {
                        const venueCount = venues.filter((venue) => venue.marketId === market.id).length;
                        return (
                          <Fragment key={market.id}>
                            <tr>
                              <td className="venue-preview-cellStrong">{market.name}</td>
                              {!isCustomerContext ? <td className="venue-preview-cellMeta">{market.customerName}</td> : null}
                              <td className="venue-preview-cellStrong">{venueCount}</td>
                              <td>
                                <div className="venue-preview-shipSummary">
                                  <span>{shippingDestinationSummary(market.shippingDestination)}</span>
                                  <button className="btn btn-ghost btn-soft" type="button" onClick={() => openMarketShippingEditor(market)}>
                                    {shippingDestinationHasValue(market.shippingDestination) ? "Edit" : "Configure"}
                                  </button>
                                </div>
                              </td>
                              <td>
                                <div className="venue-preview-statusControlCell">
                                  <button
                                    type="button"
                                    className={`venue-preview-statusToggle ${market.isActive ? "is-active" : "is-inactive"}`}
                                    aria-pressed={market.isActive}
                                    onClick={() => updateMarketStatus(market.id, !market.isActive)}
                                  >
                                    <span className="venue-preview-statusToggleDot" aria-hidden="true" />
                                    <span>{market.isActive ? "Active" : "Inactive"}</span>
                                  </button>
                                  {getMarketStatusNote(market) ? (
                                    <div className="venue-preview-cellMeta">{getMarketStatusNote(market)}</div>
                                  ) : null}
                                </div>
                              </td>
                              <td className="venue-preview-cellMeta">{market.updatedAt}</td>
                            </tr>
                            {marketShippingEditorId === market.id ? (
                              <tr>
                                <td colSpan={isCustomerContext ? 5 : 6}>
                                  <div className="venue-preview-inlineEditor">
                                    <div className="venue-preview-inlineEditorHead">
                                      <div>
                                        <div className="venue-preview-title">Default Ship-To for {market.name}</div>
                                        <div className="venue-preview-sub">Used by vendor orders unless a venue override is enabled.</div>
                                      </div>
                                      <button className="btn btn-ghost btn-soft" type="button" onClick={() => setMarketShippingEditorId(null)}>
                                        Cancel
                                      </button>
                                    </div>
                                    <ShippingDestinationFields
                                      destination={marketShippingDraft}
                                      onChange={(patch) => setMarketShippingDraft((current) => ({ ...current, ...patch }))}
                                    />
                                    <div className="venue-preview-inlineEditorActions">
                                      <button className="btn btn-ghost btn-soft" type="button" onClick={() => void saveMarketShippingDestination(market, emptyShippingDestination)}>
                                        Clear
                                      </button>
                                      <button className="btn btn-primary" type="button" onClick={() => void saveMarketShippingDestination(market)}>
                                        Save Ship-To
                                      </button>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            ) : null}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </div>
        ) : (
          <div className="venue-preview-detail">
            <div className="venue-preview-detailSticky">
              <Panel className="panel-tight venue-preview-panel venue-preview-detailHeaderCard">
                <PageHeader
                  variant="workspace"
                  className="is-embedded venue-preview-pageHeader"
                  title={activeVenue?.name || "Select a venue"}
                  subtitle={
                    isCustomerContext
                      ? `${activeVenue?.marketName || "No market selected"}`
                      : `${activeVenue?.customerName || "No customer selected"} · ${activeVenue?.marketName || "No market selected"}`
                  }
                  actions={
                    <div className="venue-preview-kpiRow venue-preview-detailHeaderKpis">
                      <div className="venue-preview-kpi venue-preview-kpi-info"><span className="venue-preview-kpiLabel">Rooms</span><span className="venue-preview-kpiValue">{activeVenueRooms.length}</span></div>
                      <div className="venue-preview-kpi venue-preview-kpi-warning"><span className="venue-preview-kpiLabel">Inventory</span><span className="venue-preview-kpiValue">{activeVenue?.inventoryCount ?? liveVenueInventory.length}</span></div>
                      <div className="venue-preview-kpi venue-preview-kpi-danger"><span className="venue-preview-kpiLabel">Unpinned</span><span className="venue-preview-kpiValue">{activeVenue?.unpinnedCount ?? liveVenueInventory.filter((item) => item.x == null || item.y == null).length}</span></div>
                      <div className="venue-preview-kpi venue-preview-kpi-success"><span className="venue-preview-kpiLabel">Import Profiles</span><span className="venue-preview-kpiValue">{profiles.length}</span></div>
                    </div>
                  }
                />
                <div className="venue-preview-validationStrip">
                  <div className={`venue-preview-validationCard ${venueValidationSummary.missingUnitCount ? "is-warning" : "is-ok"}`}>
                    <span className="venue-preview-kpiLabel">Missing unit #</span>
                    <span className="venue-preview-kpiValue">{venueValidationSummary.missingUnitCount}</span>
                  </div>
                  <div className={`venue-preview-validationCard ${venueValidationSummary.missingTrimCount ? "is-warning" : "is-ok"}`}>
                    <span className="venue-preview-kpiLabel">Missing trim</span>
                    <span className="venue-preview-kpiValue">{venueValidationSummary.missingTrimCount}</span>
                  </div>
                  <div className={`venue-preview-validationCard ${venueValidationSummary.missingSafeCount ? "is-warning" : "is-ok"}`}>
                    <span className="venue-preview-kpiLabel">Missing safe</span>
                    <span className="venue-preview-kpiValue">{venueValidationSummary.missingSafeCount}</span>
                  </div>
                  <div className={`venue-preview-validationCard ${venueValidationSummary.unpinnedActiveCount ? "is-warning" : "is-ok"}`}>
                    <span className="venue-preview-kpiLabel">Active unpinned</span>
                    <span className="venue-preview-kpiValue">{venueValidationSummary.unpinnedActiveCount}</span>
                  </div>
                  <div className={`venue-preview-validationCard ${venueValidationSummary.invalidMapLinkCount ? "is-warning" : "is-ok"}`}>
                    <span className="venue-preview-kpiLabel">Invalid map links</span>
                    <span className="venue-preview-kpiValue">{venueValidationSummary.invalidMapLinkCount}</span>
                  </div>
                  <div className={`venue-preview-validationCard ${venueValidationSummary.duplicateInventoryCount ? "is-warning" : "is-ok"}`}>
                    <span className="venue-preview-kpiLabel">Duplicate IDs</span>
                    <span className="venue-preview-kpiValue">{venueValidationSummary.duplicateInventoryCount}</span>
                  </div>
                </div>
                <div className="venue-preview-detailTabs" role="tablist" aria-label="Venue management sections">
                  <button
                    type="button"
                    className={`venue-preview-detailTab ${detailTab === "setup" ? "is-active" : ""}`}
                    role="tab"
                    aria-selected={detailTab === "setup"}
                    onClick={() => setDetailTab("setup")}
                  >
                    <span className="venue-preview-detailTabIcon"><Settings2 size={17} /></span>
                    <span className="venue-preview-detailTabText">
                      <strong>Venue Setup</strong>
                      <small>{rooms.length} room{rooms.length === 1 ? "" : "s"}</small>
                    </span>
                  </button>
                  <button
                    type="button"
                    className={`venue-preview-detailTab ${detailTab === "inventory" ? "is-active" : ""}`}
                    role="tab"
                    aria-selected={detailTab === "inventory"}
                    onClick={() => setDetailTab("inventory")}
                  >
                    <span className="venue-preview-detailTabIcon"><PackageSearch size={17} /></span>
                    <span className="venue-preview-detailTabText">
                      <strong>Inventory Management</strong>
                      <small>{effectiveRecords.length} row{effectiveRecords.length === 1 ? "" : "s"}</small>
                    </span>
                  </button>
                  <button
                    type="button"
                    className={`venue-preview-detailTab ${detailTab === "placement" ? "is-active" : ""}`}
                    role="tab"
                    aria-selected={detailTab === "placement"}
                    onClick={() => setDetailTab("placement")}
                  >
                    <span className="venue-preview-detailTabIcon"><MapPin size={17} /></span>
                    <span className="venue-preview-detailTabText">
                      <strong>Map Placement</strong>
                      <small>{venueValidationSummary.unpinnedActiveCount} unpinned</small>
                    </span>
                  </button>
                </div>
              </Panel>
            </div>

            {detailTab === "setup" ? (
            <section className="venue-preview-section">
              <div className="venue-preview-grid venue-preview-grid-setup">
                <Panel className="panel-tight venue-preview-panel">
                  <div className="venue-preview-head">
                    <div>
                      <div className="venue-preview-title">Venue Details</div>
                      <div className="venue-preview-sub">
                        Core venue metadata, market assignment, and shared document references.
                      </div>
                    </div>
                  </div>

                  <div className="venue-preview-form venue-preview-form-setup">
                    <label className="venue-preview-field venue-preview-fieldSpan2">
                      <span className="venue-preview-fieldLabel">Venue Name</span>
                      <input
                        className="field-input venue-preview-input"
                        value={activeVenue?.name || ""}
                        onChange={(e) => updateActiveVenue({ name: e.target.value })}
                        onBlur={(e) => {
                          if (!activeVenue) return;
                          void persistVenuePatch(activeVenue.id, { name: e.target.value });
                        }}
                      />
                    </label>
                    {!isCustomerContext ? (
                      <label className="venue-preview-field">
                        <span className="venue-preview-fieldLabel">Customer</span>
                        <select
                          className="select venue-preview-input"
                          value={activeVenue?.customerName || ""}
                          onChange={(e) => {
                            const nextCustomer = e.target.value;
                            const nextMarket = markets
                              .filter((market) => market.customerName === nextCustomer)
                              .sort((a, b) => {
                                if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
                                return a.name.localeCompare(b.name);
                              })[0];
                            updateActiveVenue({
                              customerName: nextCustomer,
                              marketId: nextMarket?.id,
                              marketName: nextMarket?.name || "",
                            });
                            if (activeVenue && nextMarket) {
                              void persistVenuePatch(activeVenue.id, { marketId: nextMarket.id });
                            }
                          }}
                        >
                          {customerOptions.map((customer) => (
                            <option key={customer} value={customer}>
                              {customer}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : (
                      <div className="venue-preview-field">
                        <span className="venue-preview-fieldLabel">Customer</span>
                        <input className="field-input venue-preview-input" value={activeVenue?.customerName || customerScopeName} readOnly />
                      </div>
                    )}
                    <label className="venue-preview-field">
                      <span className="venue-preview-fieldLabel">Market</span>
                      <select
                        className="select venue-preview-input"
                        value={activeVenue?.marketId || ""}
                        onChange={(e) => {
                          const nextMarket = marketsById.get(e.target.value);
                          if (!nextMarket) return;
                          updateActiveVenue({ marketId: nextMarket.id, marketName: nextMarket.name });
                          if (activeVenue) {
                            void persistVenuePatch(activeVenue.id, { marketId: nextMarket.id });
                          }
                        }}
                      >
                        {activeVenueMarketOptions.map((market) => (
                          <option key={market.id} value={market.id}>
                            {market.name}{market.isActive ? "" : " (inactive)"}
                          </option>
                          ))}
                        </select>
                      </label>
                    <label className="venue-preview-field">
                      <span className="venue-preview-fieldLabel">Document Source</span>
                      <select
                        className="select venue-preview-input"
                        value={activeVenue?.documentSourceMode || (activeVenue?.documentLibraryUrl ? "hybrid" : "adspace")}
                        onChange={(e) => {
                          const nextMode = e.target.value as VenueRecord["documentSourceMode"];
                          updateActiveVenue({ documentSourceMode: nextMode });
                          if (activeVenue) {
                            void persistVenuePatch(activeVenue.id, { documentSourceMode: nextMode });
                          }
                        }}
                      >
                        <option value="adspace">Adspace Repository</option>
                        <option value="external">External Link</option>
                        <option value="hybrid">Hybrid</option>
                      </select>
                      <span className="venue-preview-fieldHint">
                        Adspace stores files here, External opens the customer’s repo, and Hybrid supports both.
                      </span>
                    </label>
                    <label className="venue-preview-field">
                      <span className="venue-preview-fieldLabel">External Document URL</span>
                      <input
                        className="field-input venue-preview-input"
                        value={activeVenue?.documentLibraryUrl || ""}
                        onChange={(e) => updateActiveVenue({ documentLibraryUrl: e.target.value })}
                        onBlur={(e) => {
                          if (!activeVenue) return;
                          void persistVenuePatch(activeVenue.id, { documentLibraryUrl: e.target.value });
                        }}
                        placeholder="https://drive.google.com/..."
                      />
                    </label>
                    <label className="venue-preview-field">
                      <span className="venue-preview-fieldLabel">Photo Gallery URL</span>
                      <input
                        className="field-input venue-preview-input"
                        value={activeVenue?.photoGalleryUrl || ""}
                        onChange={(e) => updateActiveVenue({ photoGalleryUrl: e.target.value })}
                        onBlur={(e) => {
                          if (!activeVenue) return;
                          void persistVenuePatch(activeVenue.id, { photoGalleryUrl: e.target.value });
                        }}
                        placeholder="Google Drive folder, Dropbox, AWS, or public image URL"
                      />
                    </label>
                    <label className="venue-preview-field">
                      <span className="venue-preview-fieldLabel">Venue PDF / Document URL</span>
                      <input
                        className="field-input venue-preview-input"
                        value={activeVenue?.venueDocumentUrl || ""}
                        onChange={(e) => updateActiveVenue({ venueDocumentUrl: e.target.value })}
                        onBlur={(e) => {
                          if (!activeVenue) return;
                          void persistVenuePatch(activeVenue.id, { venueDocumentUrl: e.target.value });
                        }}
                        placeholder="PDF, image, or hosted marketing document URL"
                      />
                    </label>
                    <label className="venue-preview-field">
                      <span className="venue-preview-fieldLabel">Venue Video URL</span>
                      <input
                        className="field-input venue-preview-input"
                        value={activeVenue?.venueVideoUrl || ""}
                        onChange={(e) => updateActiveVenue({ venueVideoUrl: e.target.value })}
                        onBlur={(e) => {
                          if (!activeVenue) return;
                          void persistVenuePatch(activeVenue.id, { venueVideoUrl: e.target.value });
                        }}
                        placeholder="YouTube, Google Drive video, or hosted video URL"
                      />
                    </label>
                    <div className="venue-preview-field venue-preview-fieldSpan2 venue-preview-shippingSection">
                      <div className="venue-preview-inlineEditorHead">
                        <div>
                          <div className="venue-preview-title">Shipping Destination</div>
                          <div className="venue-preview-sub">
                            Market default: {shippingDestinationSummary(activeVenueMarket?.shippingDestination)}
                          </div>
                        </div>
                        <label className="venue-preview-toggleInline">
                          <input
                            type="checkbox"
                            checked={Boolean(activeVenue?.shippingDestinationOverrideEnabled)}
                            onChange={(e) => {
                              updateActiveVenue({ shippingDestinationOverrideEnabled: e.target.checked });
                            }}
                          />
                          Venue override
                        </label>
                      </div>
                      {activeVenue?.shippingDestinationOverrideEnabled ? (
                        <>
                          <ShippingDestinationFields
                            destination={normalizeShippingDestination(activeVenue.shippingDestination)}
                            onChange={(patch) =>
                              updateActiveVenue({
                                shippingDestination: {
                                  ...normalizeShippingDestination(activeVenue.shippingDestination),
                                  ...patch,
                                },
                              })
                            }
                          />
                          <div className="venue-preview-inlineEditorActions">
                            <button
                              className="btn btn-ghost btn-soft"
                              type="button"
                              onClick={() => updateActiveVenue({ shippingDestination: emptyShippingDestination })}
                            >
                              Clear
                            </button>
                            <button className="btn btn-primary" type="button" onClick={() => void saveActiveVenueShippingDestination()}>
                              Save Ship-To
                            </button>
                          </div>
                        </>
                      ) : (
                        <div className="venue-preview-inheritedShipTo">
                          This venue uses the market default destination unless an override is enabled.
                          <button className="btn btn-primary" type="button" onClick={() => void saveActiveVenueShippingDestination()}>
                            Save Market Default Use
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </Panel>

                <Panel className="panel-tight venue-preview-panel">
                  <div className="venue-preview-head">
                    <div>
                      <div className="venue-preview-title">Rooms & Maps</div>
                      <div className="venue-preview-sub">
                        Manage room names, map assets, and placement readiness in one compact workspace.
                      </div>
                    </div>
                    <div className="venue-preview-headActions">
                      <input
                        className="field-input venue-preview-input venue-preview-profileInput"
                        value={newRoomName}
                        onChange={(e) => setNewRoomName(e.target.value)}
                        placeholder="New room"
                      />
                      <button className="btn btn-primary" type="button" onClick={createRoom} disabled={!newRoomName.trim() || !activeVenue}>
                        Add Room
                      </button>
                    </div>
                  </div>

                  {!activeVenue ? (
                    <div className="venue-preview-empty">Select a venue to manage its maps.</div>
                  ) : !activeVenueRooms.length ? (
                    <div className="venue-preview-empty">No rooms yet for this venue.</div>
                  ) : (
                    <div className="table-wrap venue-preview-tableWrap">
                      <table className="data-table venue-preview-table">
                        <thead>
                          <tr>
                            <th>Order</th>
                            <th>Room / Map</th>
                            <th>Map Asset</th>
                            <th>Inventory</th>
                            <th>Unpinned</th>
                            <th>Updated</th>
                            <th>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {activeVenueRooms.map((room) => (
                            <tr
                              key={room.id}
                              className={`${room.id === selectedRoom?.id ? "venue-preview-rowSelected" : ""} ${draggedRoomId === room.id ? "venue-preview-rowDragging" : ""}`}
                              draggable
                              onDragStart={() => setDraggedRoomId(room.id)}
                              onDragOver={(event) => event.preventDefault()}
                              onDrop={() => handleRoomDrop(room.id)}
                              onDragEnd={() => setDraggedRoomId(null)}
                            >
                              <td>
                                <button
                                  type="button"
                                  className="venue-preview-dragHandle"
                                  aria-label={`Reorder ${room.name}`}
                                  title="Drag to reorder rooms and maps"
                                >
                                  ⋮⋮
                                </button>
                              </td>
                              <td>
                                <input
                                  className="field-input venue-preview-input"
                                  value={room.name}
                                  onChange={(e) => updateRoom(room.id, { name: e.target.value })}
                                  onBlur={(e) => {
                                    void persistRoomPatch(room.id, { name: e.target.value });
                                  }}
                                />
                              </td>
                              <td>
                                <div className="venue-preview-mapAssetCell">
                                  {room.mapUrl ? (
                                    <button
                                      className="venue-preview-mapThumbButton"
                                      type="button"
                                      onClick={() => setMapPreviewRoomId(room.id)}
                                      aria-label={`Preview ${room.name} map`}
                                    >
                                      <img src={room.mapUrl} alt="" className="venue-preview-mapThumb" />
                                    </button>
                                  ) : null}
                                  <div>
                                    <div className="venue-preview-cellStrong">{room.mapAssetName || "No map asset"}</div>
                                    <div className="venue-preview-cellMeta">{room.mapUrl ? "Map preview linked" : "Upload or replace a map asset"}</div>
                                  </div>
                                </div>
                              </td>
                              <td>
                                <div className="venue-preview-cellStrong">{room.inventoryCount} records</div>
                              </td>
                              <td>
                                <span className={`venue-preview-status ${room.unpinnedCount > 0 ? "is-warning" : "is-ok"}`}>
                                  {room.unpinnedCount}
                                </span>
                              </td>
                              <td className="venue-preview-cellMeta">{room.updatedAt}</td>
                              <td>
                                <div className="venue-preview-rowActions venue-preview-rowActions-wrap venue-preview-roomActions">
                                  <button className="btn btn-ghost btn-soft venue-preview-roomAction venue-preview-roomAction-inspect" type="button" onClick={() => setMapPreviewRoomId(room.id)}>
                                    View Map
                                  </button>
                                  <button className="btn btn-ghost btn-soft venue-preview-roomAction" type="button" onClick={() => replaceRoomMap(room.id)}>
                                    {room.mapUrl ? "Replace Map" : "Upload Map"}
                                  </button>
                                  <button className="btn btn-ghost btn-soft venue-preview-roomAction venue-preview-roomAction-workflow" type="button" onClick={() => { setSelectedRoomId(room.id); setDetailTab("placement"); }}>
                                    Open Placement
                                  </button>
                                  <button className="btn btn-ghost btn-soft venue-preview-roomAction venue-preview-roomAction-destructive" type="button" onClick={() => removeRoom(room.id)}>
                                    Remove Room
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Panel>

                <Panel className="panel-tight venue-preview-panel venue-preview-presetsPanel">
                  <div className="venue-preview-head">
                    <div>
                      <div className="venue-preview-title">Presets / Templates</div>
                      <div className="venue-preview-sub">
                        Save reusable inventory selections for seasonal or curated project scopes.
                      </div>
                    </div>
                    <div className="venue-preview-headActions">
                      <button className="btn btn-primary" type="button" onClick={openCreatePreset} disabled={!activeVenue || !presetScopeInventory.length}>
                        Add Preset
                      </button>
                    </div>
                  </div>

                  {!activeVenue ? (
                    <div className="venue-preview-empty">Select a venue to manage inventory presets.</div>
                  ) : !venueInventoryPresets.length ? (
                    <div className="venue-preview-empty">Full Venue will appear after venue inventory loads.</div>
                  ) : (
                    <div className="table-wrap venue-preview-tableWrap">
                      <table className="data-table venue-preview-table venue-preview-presetTable">
                        <thead>
                          <tr>
                            <th>Preset</th>
                            <th>Included</th>
                            <th>Excluded</th>
                            <th>Status</th>
                            <th>Updated</th>
                            <th>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {venueInventoryPresets.map((preset) => (
                            <tr key={preset.id}>
                              <td>
                                <div className="venue-preview-cellStrong">{preset.name}</div>
                                <div className="venue-preview-cellMeta">
                                  {preset.isDefault ? "Auto generated default" : preset.description || "Custom inventory preset"}
                                </div>
                              </td>
                              <td>
                                <div className="venue-preview-cellStrong">
                                  {preset.validation.includedActiveCount}/{preset.validation.activeInventoryCount}
                                </div>
                              </td>
                              <td>
                                <div className="venue-preview-cellStrong">{preset.validation.excludedActiveCount}</div>
                              </td>
                              <td>
                                <div className="venue-preview-presetStatusStack">
                                  <span className={`venue-preview-status ${preset.validation.newActiveCount || preset.validation.unavailableIncludedCount ? "is-warning" : "is-ok"}`}>
                                    {preset.validation.newActiveCount
                                      ? `${preset.validation.newActiveCount} new`
                                      : preset.validation.unavailableIncludedCount
                                        ? `${preset.validation.unavailableIncludedCount} unavailable`
                                        : "Ready"}
                                  </span>
                                  {preset.readOnly ? <span className="venue-preview-cellMeta">Read only</span> : null}
                                </div>
                              </td>
                              <td className="venue-preview-cellMeta">{(preset.updatedAt || "").slice(0, 10) || "—"}</td>
                              <td>
                                <div className="venue-preview-rowActions venue-preview-rowActions-wrap">
                                  <button
                                    className="btn btn-ghost btn-soft"
                                    type="button"
                                    onClick={() => openEditPreset(preset)}
                                    disabled={preset.readOnly}
                                  >
                                    Edit
                                  </button>
                                  <button
                                    className="btn btn-ghost btn-soft venue-preview-roomAction-destructive"
                                    type="button"
                                    onClick={() => void archivePreset(preset)}
                                    disabled={preset.readOnly}
                                  >
                                    Archive
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Panel>
              </div>
            </section>
            ) : null}

            {detailTab === "placement" ? (
            <section className="venue-preview-section venue-preview-section-placement">
              <div className="venue-preview-grid venue-preview-grid-placementWide venue-preview-grid-placementViewport">
                <Panel className="panel-tight venue-preview-panel venue-preview-placementRailPanel">
                  <div className="venue-preview-head">
                    <div>
                      <div className="venue-preview-title">Inventory List</div>
                      <div className="venue-preview-sub">
                        Filter the current room inventory, then place and inspect pins on the map.
                      </div>
                    </div>
                  </div>

                  {!activeVenueRooms.length ? (
                    <div className="venue-preview-empty">Create a room to start preparing pin placement.</div>
                  ) : (
                    <>
                      <div className="venue-preview-filters venue-preview-placementFilters">
                        <div className="venue-preview-placementFilterRow venue-preview-placementFilterRow-full">
                          <select className="select venue-preview-select venue-preview-filterSelect venue-preview-placementRoomSelect" value={selectedRoom?.id || ""} onChange={(e) => setSelectedRoomId(e.target.value)}>
                            {activeVenueRooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
                          </select>
                        </div>
                        <div className="venue-preview-placementFilterRow venue-preview-placementFilterRow-full">
                          <div className="field-search venue-preview-search venue-preview-searchCompact">
                            <span aria-hidden="true">◦</span>
                            <input className="field-input" type="search" value={placementSearch} onChange={(e) => setPlacementSearch(e.target.value)} placeholder="Search inventory ID or location" />
                          </div>
                        </div>
                        <div className="venue-preview-placementFilterRow venue-preview-placementFilterRow-split">
                          <select className="select venue-preview-select venue-preview-filterSelect" value={placementVariantFilter} onChange={(e) => setPlacementVariantFilter(e.target.value)}>
                            <option value="all">All variants</option>
                            {placementVariantOptions.map((variant) => <option key={variant} value={variant}>{variant}</option>)}
                          </select>
                          <select className="select venue-preview-select venue-preview-filterSelect" value={placementPinFilter} onChange={(e) => setPlacementPinFilter(e.target.value as "all" | "pinned" | "awaiting")}>
                            <option value="all">All inventory</option>
                            <option value="pinned">Pinned</option>
                            <option value="awaiting">Awaiting pin</option>
                          </select>
                        </div>
                      </div>

                      {!placementRecords.length ? (
                        <div className="venue-preview-empty">No inventory on this room matches the current filters.</div>
                      ) : (
                        <div className="venue-preview-placementList">
                          {placementRecords.map((record) => {
                            const variantIndex = variantRows.findIndex((variant) => variant.key === record.mediaVariantKey);
                            const appearance = getVariantAppearance(record.mediaVariantKey, record.variantLabel, Math.max(variantIndex, 0));
                            return (
                              <button
                                key={record.recordKey}
                                type="button"
                                className={`venue-preview-placementSimpleItem ${selectedInventoryId === record.inventoryId ? "is-selected" : ""} ${record.isPinned ? "is-pinned" : "is-waiting"}`}
                                onClick={() => setSelectedInventoryId(record.inventoryId)}
                                onPointerDown={(event) => {
                                  if (record.isPinned) return;
                                  event.preventDefault();
                                  event.stopPropagation();
                                  setSelectedInventoryId(record.inventoryId);
                                  setDraggingPinRecordKey(record.recordKey);
                                }}
                              >
                                <span className="venue-preview-variantGlyph" style={{ background: appearance.color }}>{appearance.abbreviation}</span>
                                <div className="venue-preview-placementSimpleBody">
                                  <div className="venue-preview-cellStrong">{record.inventoryId}</div>
                                  <div className="venue-preview-cellMeta">{record.variantLabel}</div>
                                </div>
                                <span className={`venue-preview-status venue-preview-placementStatus ${record.isPinned ? "is-ok" : "is-warning"}`}>{record.isPinned ? "Pinned" : "Awaiting"}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}
                </Panel>

                <Panel className="panel-tight venue-preview-panel">
                  <div className="venue-preview-head">
                    <div>
                      <div className="venue-preview-title">Map Canvas</div>
                      <div className="venue-preview-sub">
                        Place and adjust pins on the real room map.
                      </div>
                    </div>
                    {inventorySaveState.tone !== "idle" ? (
                      <div className={`${inventorySaveStatusClassName} venue-preview-saveStatus-inline`} aria-live="polite">
                        <span className="venue-preview-saveStatusDot" aria-hidden="true" />
                        <span>{inventorySaveState.message}</span>
                      </div>
                    ) : null}
                  </div>

                  {!selectedRoom ? (
                    <div className="venue-preview-empty">Select a room to preview its map workspace.</div>
                  ) : (
                    <div className="venue-preview-mapWorkspace">
                    <div className="venue-preview-mapMain">
                    <div className="venue-preview-mapStage">
                    <div className="venue-preview-mapCard">
                        <div className="venue-preview-mapMeta">
                          <div>
                            <div className="venue-preview-rowTitle">{selectedRoom.name}</div>
                            <div className="venue-preview-rowSub">
                              {activeVenue?.customerName} · {activeVenue?.marketName} · {activeVenue?.name}
                            </div>
                          </div>
                          <div className="venue-preview-mapMetaRight">
                            <span className="venue-preview-status is-neutral">
                              {selectedRoom.mapAssetName || "No map asset yet"}
                            </span>
                          </div>
                        </div>

                        <div
                          ref={mapViewportRef}
                          className="assign-mapCanvas venue-preview-mapCanvas"
                          onWheel={onWheelMap}
                          onMouseDown={onMouseDownMap}
                          onMouseMove={onMouseMoveMap}
                          onMouseUp={onMouseUpMap}
                          onMouseLeave={onMouseUpMap}
                          onTouchStart={onTouchStartMap}
                          onTouchMove={onTouchMoveMap}
                          onTouchEnd={onTouchEndMap}
                          onTouchCancel={onTouchEndMap}
                        >
                          <div
                            className="map-transform"
                            style={{ ...mapFrameStyle, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
                          >
                          {selectedRoom.mapUrl ? (
                            <img
                              key={`${selectedRoom.id}-${selectedRoom.mapUrl || "no-map"}`}
                              ref={mapImgRef}
                              className="map-image venue-preview-mapImage"
                              src={selectedRoom.mapUrl}
                              alt=""
                              draggable={false}
                              onLoad={onMapImageLoad}
                              onError={onMapImageError}
                            />
                          ) : (
                            <div className="assign-mapPlaceholder venue-preview-mapPlaceholder">No map image configured for this room.</div>
                          )}
                          <div className="pin-layer">
                          {selectedRoomPinnedRecords.map((item) => {
                            const variantIndex = variantRows.findIndex((variant) => variant.key === item.mediaVariantKey);
                            const appearance = getVariantAppearance(item.mediaVariantKey, item.variantLabel, Math.max(variantIndex, 0));
                            return (
                              <button
                                key={item.recordKey}
                                type="button"
                                className={`pin venue-preview-mapPin ${selectedInventoryId === item.inventoryId ? "is-selected" : ""}`}
                                style={{
                                  left: `${item.x * 100}%`,
                                  top: `${item.y * 100}%`,
                                  ["--pinColor" as any]: appearance.color,
                                  ["--haloColor" as any]: "transparent",
                                  ["--pinInvScale" as any]: String(1 / zoom),
                                  ["--pinJx" as any]: "0px",
                                  ["--pinJy" as any]: "0px",
                                }}
                                onPointerDown={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setSelectedInventoryId(item.inventoryId);
                                  setDraggingPinRecordKey(item.recordKey);
                                }}
                                onClick={() => setSelectedInventoryId(item.inventoryId)}
                                title={`${item.inventoryId} · ${item.variantLabel}`}
                              >
                                <span className="pin-halo" />
                                <span className="pin-core">{appearance.abbreviation}</span>
                              </button>
                            );
                          })}
                          </div>
                          </div>
                          {mapLoadFailed ? <div className="venue-preview-mapPlaceholder">We could not load this map asset.</div> : null}
                          <div className="map-hint">
                            {Math.round(zoom * 100)}%
                            <button className="map-hint-btn" type="button" onClick={() => fitMapToView()}>
                              Fit
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                    </div>
                    <div className="venue-preview-placementInspector">
                      <div className="venue-preview-placementInspectorCard"><span className="venue-preview-kpiLabel">Total</span><span className="venue-preview-kpiValue">{pinPrepSummary.total}</span></div>
                      <div className="venue-preview-placementInspectorCard"><span className="venue-preview-kpiLabel">Pinned</span><span className="venue-preview-kpiValue">{pinPrepSummary.pinned}</span></div>
                      <div className="venue-preview-placementInspectorCard"><span className="venue-preview-kpiLabel">Awaiting</span><span className="venue-preview-kpiValue">{pinPrepSummary.unpinned}</span></div>
                      <div className="venue-preview-mapInventoryList venue-preview-placementInspectorCard">
                        <div className="venue-preview-rowTitle">Focused Inventory</div>
                        {focusedInventoryItem ? (
                          <div className="venue-preview-pinSpecs">
                            <div className="venue-preview-pinSpecPrimary">{focusedInventoryItem.inventoryId}</div>
                            <div className="venue-preview-pinSpecMuted">{focusedInventoryItem.variantLabel}</div>
                            <div className="venue-preview-pinSpecGrid">
                              <span>Location</span>
                              <strong>{focusedInventoryItem.locationDetail || "No location note"}</strong>
                              <span>Map</span>
                              <strong>{focusedInventoryItem.mapName || "Unmapped"}</strong>
                              <span>Unit #</span>
                              <strong>{focusedInventoryItem.unitNumber || "—"}</strong>
                              <span>Status</span>
                              <strong>{focusedInventoryItem.isPinned ? "Pinned" : "Awaiting pin"}</strong>
                            </div>
                          </div>
                        ) : (
                          <div className="venue-preview-rowSub">Select a pin or inventory row to inspect it.</div>
                        )}
                      </div>
                    </div>
                    </div>
                  )}
                </Panel>
              </div>
            </section>
            ) : null}

            {detailTab === "inventory" ? (
            <section className="venue-preview-section">
              <div className="venue-preview-toolbar venue-preview-toolbar-spread venue-preview-toolbar-inventoryIntro">
                <div className="venue-preview-kpiRow venue-preview-inventorySummary">
                  <div className="venue-preview-kpi venue-preview-kpi-info"><span className="venue-preview-kpiLabel">Inventory Rows</span><span className="venue-preview-kpiValue">{effectiveRecords.length}</span></div>
                  <div className="venue-preview-kpi venue-preview-kpi-warning"><span className="venue-preview-kpiLabel">Media Variants</span><span className="venue-preview-kpiValue">{variantRows.length}</span></div>
                  <div className="venue-preview-kpi venue-preview-kpi-success"><span className="venue-preview-kpiLabel">Source</span><span className="venue-preview-kpiValue">{isUsingPennSampleInventory ? "Penn sample" : "Uploaded"}</span></div>
                </div>
                <div className="venue-preview-rowActions venue-preview-inventoryTopActions">
                  <button className="btn btn-primary venue-preview-importCta" type="button" onClick={openInventoryImportModal}>
                    <Upload size={16} />
                    Import Venue Inventory
                  </button>
                  <button
                    className="btn btn-ghost btn-soft"
                    type="button"
                    onClick={downloadCurrentVenueInventoryCsv}
                    disabled={!hasInventoryRows}
                  >
                    <Download size={16} />
                    Current CSV
                  </button>
                  <button
                    className="btn btn-ghost btn-soft"
                    type="button"
                    onClick={downloadBlankInventoryTemplate}
                    disabled={!activeVenue}
                  >
                    <Download size={16} />
                    Blank Template
                  </button>
                  {canEditVenueInventory ? (
                    <button
                      className={`btn venue-preview-editLockBtn ${inventoryEditMode ? "btn-primary is-unlocked" : "btn-ghost btn-soft is-locked"}`}
                      type="button"
                      onClick={() => setInventoryEditMode((current) => !current)}
                      aria-pressed={inventoryEditMode}
                    >
                      {inventoryEditMode ? <UnlockKeyhole size={16} /> : <LockKeyhole size={16} />}
                      {inventoryEditMode ? "Editing Unlocked" : "Editing Locked"}
                    </button>
                  ) : (
                    <span className="venue-preview-editLockBtn venue-preview-editLockStatus is-restricted">
                      <LockKeyhole size={16} />
                      Editing Restricted
                    </span>
                  )}
                </div>
              </div>

              <Panel className="panel-tight venue-preview-panel venue-preview-readinessPanel">
                <div className="venue-preview-head">
                  <div>
                    <div className="venue-preview-title">Import Readiness Checklist</div>
                    <div className="venue-preview-sub">
                      Pre-flight checks for large inventory loads, Lift submit mapping, placement, and routing.
                    </div>
                  </div>
                  <div className="venue-preview-readinessSummary">
                    <span className={`venue-preview-status ${venueReadinessChecklist.blockerCount ? "is-warning" : "is-ok"}`}>
                      {venueReadinessChecklist.blockerCount ? `${venueReadinessChecklist.blockerCount} blocker${venueReadinessChecklist.blockerCount === 1 ? "" : "s"}` : "No blockers"}
                    </span>
                    <span className="venue-preview-status is-neutral">
                      {venueReadinessChecklist.identifierMode === "product_id" ? "Product ID mode" : "Unit # mode"}
                    </span>
                  </div>
                </div>
                <div className="venue-preview-readinessGrid">
                  {venueReadinessChecklist.items.map((item) => (
                    <div key={item.id} className={`venue-preview-readinessCard is-${item.tone}`}>
                      <div className="venue-preview-readinessCardHead">
                        <span className="venue-preview-readinessIcon" aria-hidden="true" />
                        <span className="venue-preview-readinessTitle">{item.title}</span>
                        <strong>{item.tone === "ok" ? "OK" : item.count}</strong>
                      </div>
                      <div className="venue-preview-readinessDetail">{item.detail}</div>
                      <div className="venue-preview-readinessAction">
                        <span>{item.action}</span>
                        {item.actionId ? (
                          <button
                            className="btn btn-ghost btn-soft venue-preview-readinessButton"
                            type="button"
                            onClick={() => applyReadinessItemAction(item)}
                          >
                            {item.actionLabel || "Review"}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>

              <Panel className="panel-tight venue-preview-panel">
                <div className="venue-preview-head">
                  <div>
                    <div className="venue-preview-title">Inventory List</div>
                    <div className="venue-preview-sub">
                      Review inventory rows, override unit mappings when needed, and use bulk actions for common updates.
                    </div>
                  </div>
                  {inventorySaveState.tone !== "idle" ? (
                    <div className={`${inventorySaveStatusClassName} venue-preview-saveStatus-inline`} aria-live="polite">
                      <span className="venue-preview-saveStatusDot" aria-hidden="true" />
                      <span>{inventorySaveState.message}</span>
                    </div>
                  ) : null}
                </div>

                {!hasInventoryRows ? (
                  <div className="venue-preview-empty">Import venue inventory or add a row to start managing inventory.</div>
                ) : (
                  <>
                    <div className="venue-preview-actions venue-preview-bulkActions">
                      <span className="venue-preview-cellMeta">
                        {selectedRecordKeys.length} row{selectedRecordKeys.length === 1 ? "" : "s"} selected
                      </span>
                      <button className="btn btn-ghost btn-soft" type="button" onClick={() => applyBulkRecordPatch({ isActive: true })} disabled={!selectedRecordKeys.length || !inventoryEditMode}>
                        Mark Active
                      </button>
                      <button className="btn btn-ghost btn-soft" type="button" onClick={() => applyBulkRecordPatch({ isActive: false })} disabled={!selectedRecordKeys.length || !inventoryEditMode}>
                        Mark Inactive
                      </button>
                      <button className="btn btn-ghost btn-soft" type="button" onClick={() => applyBulkRecordPatch({ mapVisibilityMode: "show_unavailable" })} disabled={!selectedRecordKeys.length || !inventoryEditMode}>
                        Show Unavailable
                      </button>
                      <button className="btn btn-ghost btn-soft" type="button" onClick={() => applyBulkRecordPatch({ mapVisibilityMode: "hidden" })} disabled={!selectedRecordKeys.length || !inventoryEditMode}>
                        Hide on Map
                      </button>
                      <button
                        className="btn btn-primary btn-soft"
                        type="button"
                        onClick={openBulkInventoryEditor}
                        disabled={!selectedRecordKeys.length || !inventoryEditMode || !canEditVenueInventory}
                      >
                        <PencilLine size={16} />
                        Edit Selected
                      </button>
                      <button
                        className="btn btn-ghost btn-soft"
                        type="button"
                        onClick={() => setVendorPicker({ recordKeys: selectedRecordKeys })}
                        disabled={!selectedRecordKeys.length || !inventoryEditMode}
                      >
                        Set Vendor
                      </button>
                      <div className="venue-preview-bulkActionsRight">
                        <button className="btn btn-ghost btn-soft" type="button" onClick={() => void createInventoryRow()}>
                          Add Inventory Row
                        </button>
                        <button className="btn btn-ghost btn-soft" type="button" onClick={() => void deleteSelectedRows()} disabled={!selectedRecordKeys.length || !inventoryEditMode}>
                          Delete Selected
                        </button>
                      </div>
                    </div>

                    <div className="venue-preview-filters venue-preview-filters-inventory">
                      <div className="field-search venue-preview-search">
                        <span aria-hidden="true">◦</span>
                        <input
                          className="field-input"
                          type="search"
                          value={rowSearch}
                          onChange={(e) => setRowSearch(e.target.value)}
                          placeholder="Search inventory ID, location, unit number, map, media, variant, or vendor"
                        />
                      </div>

                      <select
                        className="select venue-preview-select venue-preview-filterSelect"
                        value={mapFilter}
                        onChange={(e) => setMapFilter(e.target.value)}
                      >
                        <option value="all">All maps</option>
                        {mapOptions.map((mapName) => (
                          <option key={mapName} value={mapName}>
                            {mapName}
                          </option>
                        ))}
                      </select>

                      <select
                        className="select venue-preview-select venue-preview-filterSelect"
                        value={variantFilter}
                        onChange={(e) => setVariantFilter(e.target.value)}
                      >
                        <option value="all">All variants</option>
                        {groupedVariants.map((variant) => (
                          <option key={variant.key} value={variant.key}>
                            {formatVariantFilterLabel(variant)}
                          </option>
                        ))}
                      </select>

                      <select
                        className="select venue-preview-select venue-preview-filterSelect"
                        value={activityFilter}
                        onChange={(e) => setActivityFilter(e.target.value as "all" | "active" | "inactive")}
                      >
                        <option value="all">All rows</option>
                        <option value="active">Active only</option>
                        <option value="inactive">Inactive only</option>
                        </select>
                      </div>

                      {readinessFocus ? (
                        <div className="venue-preview-focusBanner">
                          <div className="venue-preview-focusSummary">
                            <div className="venue-preview-focusSummaryTitle">
                              <span>Focused review</span>
                              <strong>{readinessFocus.label}</strong>
                            </div>
                            {readinessFocusSummary ? (
                              <div className="venue-preview-focusMeta">
                                <span>
                                  Showing {readinessFocusSummary.visibleCount} of {readinessFocusSummary.totalCount} affected row{readinessFocusSummary.totalCount === 1 ? "" : "s"}
                                </span>
                                <span>{readinessFocusSummary.variantCount} variant{readinessFocusSummary.variantCount === 1 ? "" : "s"}</span>
                                <span>{readinessFocusSummary.mapCount} map{readinessFocusSummary.mapCount === 1 ? "" : "s"}</span>
                              </div>
                            ) : null}
                          </div>
                          <div className="venue-preview-focusActions">
                            {readinessFocusSummary?.visibleRecordKeys.length ? (
                              <button className="btn btn-ghost btn-soft" type="button" onClick={selectFocusedReadinessRows}>
                                Select visible
                              </button>
                            ) : null}
                            {readinessFocusSummary?.actionId === "missing_identifiers" || readinessFocusSummary?.actionId === "variant_mapping" ? (
                              <button className="btn btn-primary btn-soft" type="button" onClick={openFocusedReadinessProductMapper} disabled={!readinessFocusSummary?.firstRecord}>
                                Map first row
                              </button>
                            ) : null}
                            {readinessFocusSummary?.actionId === "missing_maps" || readinessFocusSummary?.actionId === "missing_dimensions" ? (
                              <button
                                className="btn btn-primary btn-soft"
                                type="button"
                                onClick={openFocusedReadinessBulkEdit}
                                disabled={!readinessFocusSummary?.visibleRecordKeys.length || !inventoryEditMode || !canEditVenueInventory}
                              >
                                Bulk edit rows
                              </button>
                            ) : null}
                            {readinessFocusSummary?.actionId === "external_vendor_routes" ? (
                              <button
                                className="btn btn-primary btn-soft"
                                type="button"
                                onClick={openFocusedReadinessVendorPicker}
                                disabled={!readinessFocusSummary?.visibleRecordKeys.length || !inventoryEditMode || !canEditVenueInventory}
                              >
                                Set vendor
                              </button>
                            ) : null}
                            {readinessFocusSummary?.actionId === "placement_unpinned" ? (
                              <button className="btn btn-primary btn-soft" type="button" onClick={openFocusedReadinessPlacement} disabled={!readinessFocusSummary?.firstRecord}>
                                Open placement
                              </button>
                            ) : null}
                            <button className="btn btn-ghost btn-soft" type="button" onClick={() => setReadinessFocus(null)}>
                              Clear focus
                            </button>
                          </div>
                        </div>
                      ) : null}

                    {!filteredRecords.length ? (
                      <div className="venue-preview-empty">No inventory rows match the current filters.</div>
                    ) : (
                      <>
                        <div className="table-wrap venue-preview-tableWrap">
                          <table className="data-table venue-preview-table venue-preview-inventoryTable">
                            <thead>
                              <tr>
                                <th>Select</th>
                                <th>Inventory ID</th>
                                <th>Map</th>
                                <th>Media</th>
                                <th>Unit #</th>
                                <th>Product ID</th>
                                <th>Variant</th>
                                <th>Vendor</th>
                                <th>Trim H</th>
                                <th>Trim W</th>
                                <th>Safe H</th>
                                <th>Safe W</th>
                                <th>Notes</th>
                                <th>Location</th>
                                <th>Status</th>
                                <th>Map Visibility</th>
                                <th>Actions</th>
                                <th>Issues</th>
                              </tr>
                            </thead>
                            <tbody>
                              {filteredRecords.map((record) => {
                                const importIssueMessages =
                                  result?.issues
                                    .filter((issue) => issue.rowNumber === record.rowNumber)
                                    .map((issue) => issue.message) || [];
                                const readinessIssues = getReadinessIssueDetailsForRecord(record);
                                const sortedReadinessIssues = readinessFocus
                                  ? [
                                      ...readinessIssues.filter((issue) => issue.actionId === readinessFocus.actionId),
                                      ...readinessIssues.filter((issue) => issue.actionId !== readinessFocus.actionId),
                                    ]
                                  : readinessIssues;
                                const issueCount = importIssueMessages.length + readinessIssues.length;
                                const variantIndex = variantRows.findIndex((variant) => variant.key === record.mediaVariantKey);
                                const appearance = getVariantAppearance(record.mediaVariantKey, record.variantLabel, Math.max(variantIndex, 0));
                                const vendorRoute = resolveInventoryVendor(record);
                                return (
                                  <tr key={record.recordKey}>
                                    <td>
                                      <input
                                        type="checkbox"
                                        checked={selectedRecordKeys.includes(record.recordKey)}
                                        onChange={() => toggleSelectedRecord(record.recordKey)}
                                      />
                                    </td>
                                    <td>
                                      <input
                                        className="field-input venue-preview-input"
                                        value={record.inventoryId}
                                        onChange={(e) => updateRecordOverride(record.recordKey, { inventoryId: e.target.value })}
                                        onBlur={(e) => void persistInventoryPatch(record.recordKey, { inventoryId: e.target.value })}
                                        disabled={!inventoryEditMode}
                                      />
                                    </td>
                                    <td>
                                      <select
                                        className="select venue-preview-inlineSelect"
                                        value={record.locationId || activeVenueRooms.find((room) => room.name === record.mapName)?.id || ""}
                                        onChange={(e) => {
                                          const nextRoomId = e.target.value;
                                          const nextRoom = activeVenueRooms.find((room) => room.id === nextRoomId);
                                          updateRecordOverride(record.recordKey, {
                                            locationId: nextRoomId,
                                            mapName: nextRoom?.name || "",
                                          });
                                          if (nextRoomId) {
                                            void persistInventoryPatch(record.recordKey, {
                                              locationId: nextRoomId,
                                            });
                                          }
                                        }}
                                        disabled={!inventoryEditMode}
                                      >
                                        {!record.locationId ? <option value="">Select map</option> : null}
                                        {activeVenueRooms.map((room) => (
                                          <option key={room.id} value={room.id}>
                                            {room.name}
                                          </option>
                                        ))}
                                      </select>
                                      <div className="venue-preview-cellMeta">{record.customerName} / {record.venueName}</div>
                                    </td>
                                    <td className="venue-preview-cell-media">
                                      <input
                                        className="field-input venue-preview-input"
                                        value={record.mediaType || ""}
                                        onChange={(e) => updateRecordOverride(record.recordKey, buildInventoryVariantPatch(record, { mediaType: e.target.value }))}
                                        onBlur={(e) => {
                                          const nextPatch = buildInventoryVariantPatch(record, { mediaType: e.target.value });
                                          updateRecordOverride(record.recordKey, nextPatch);
                                          void persistInventoryPatch(record.recordKey, nextPatch);
                                        }}
                                        placeholder="Media"
                                        disabled={!inventoryEditMode}
                                      />
                                    </td>
                                    <td>
                                      <div className="venue-preview-unitMap venue-preview-unitMap-compact">
                                        <input
                                          className="field-input venue-preview-input"
                                          value={record.unitNumber || ""}
                                          onChange={(e) => updateRecordOverride(record.recordKey, { unitNumber: e.target.value })}
                                          onBlur={(e) => void persistInventoryPatch(record.recordKey, { unitNumber: e.target.value })}
                                          placeholder="Unit number"
                                          disabled={!inventoryEditMode}
                                        />
                                        <button
                                          className="btn btn-ghost btn-soft venue-preview-mapProductBtn"
                                          type="button"
                                          onClick={() => openInventoryLiftProductMapper(record, appearance)}
                                        >
                                          <Link2 size={15} /> Map Product
                                        </button>
                                      </div>
                                      {record.unitNumberSource === "variant" ? (
                                        <div className="venue-preview-cellMeta venue-preview-cellMeta-inline">
                                          <span className="venue-preview-inlineBadge">Inherited</span>
                                        </div>
                                      ) : null}
                                    </td>
                                    <td className="venue-preview-cellMeta">
                                      {record.liftProductMapping?.liftProductId || appearance.liftProductMapping?.liftProductId ? (
                                        <div className="venue-preview-productIdStack">
                                          <span className="venue-preview-productIdPill">
                                            {record.liftProductMapping?.liftProductId || appearance.liftProductMapping?.liftProductId}
                                          </span>
                                          <small>{record.liftProductMapping?.liftProductId ? "Row" : "Inherited"}</small>
                                        </div>
                                      ) : "—"}
                                    </td>
                                    <td>
                                      <div className="venue-preview-variantCell">
                                        <span
                                          className="venue-preview-variantGlyph"
                                          style={{ background: appearance.color }}
                                        >
                                          {appearance.abbreviation}
                                        </span>
                                        <div>
                                          <div className="venue-preview-cellStrong">{record.variantLabel}</div>
                                          <div className="venue-preview-cellMeta">{formatVariantMeta(record)}</div>
                                        </div>
                                      </div>
                                    </td>
                                    <td>
                                      <div className="venue-preview-vendorCell">
                                        <span
                                          className={`venue-preview-vendorChip ${
                                            vendorRoute.route === "external" ? "is-external" : "is-primary"
                                          } ${vendorRoute.unresolved ? "is-warning" : ""}`}
                                        >
                                          {vendorRoute.label}
                                        </span>
                                        <div className="venue-preview-cellMeta">{vendorRoute.source}</div>
                                        <button
                                          className="btn btn-ghost btn-soft venue-preview-vendorButton"
                                          type="button"
                                          onClick={() => setVendorPicker({ recordKeys: [record.recordKey] })}
                                          disabled={!inventoryEditMode}
                                        >
                                          Change
                                        </button>
                                      </div>
                                    </td>
                                    <td><input className="field-input venue-preview-input" value={getNumericDraftValue(record.recordKey, "trimHeight", record.trimHeight)} onChange={(e) => updateNumericDraft(record.recordKey, "trimHeight", e.target.value)} onBlur={(e) => { const nextValue = parseEditableNumber(e.target.value); const nextPatch = buildInventoryVariantPatch(record, { trimHeight: nextValue }); updateRecordOverride(record.recordKey, nextPatch); clearNumericDraft(record.recordKey, "trimHeight"); void persistInventoryPatch(record.recordKey, nextPatch); }} placeholder="H" disabled={!inventoryEditMode} inputMode="decimal" /></td>
                                    <td><input className="field-input venue-preview-input" value={getNumericDraftValue(record.recordKey, "trimWidth", record.trimWidth)} onChange={(e) => updateNumericDraft(record.recordKey, "trimWidth", e.target.value)} onBlur={(e) => { const nextValue = parseEditableNumber(e.target.value); const nextPatch = buildInventoryVariantPatch(record, { trimWidth: nextValue }); updateRecordOverride(record.recordKey, nextPatch); clearNumericDraft(record.recordKey, "trimWidth"); void persistInventoryPatch(record.recordKey, nextPatch); }} placeholder="W" disabled={!inventoryEditMode} inputMode="decimal" /></td>
                                    <td><input className="field-input venue-preview-input" value={getNumericDraftValue(record.recordKey, "safeHeight", record.safeHeight)} onChange={(e) => updateNumericDraft(record.recordKey, "safeHeight", e.target.value)} onBlur={(e) => { const nextValue = parseEditableNumber(e.target.value); updateRecordOverride(record.recordKey, { safeHeight: nextValue }); clearNumericDraft(record.recordKey, "safeHeight"); void persistInventoryPatch(record.recordKey, { safeHeight: nextValue }); }} placeholder="H" disabled={!inventoryEditMode} inputMode="decimal" /></td>
                                    <td><input className="field-input venue-preview-input" value={getNumericDraftValue(record.recordKey, "safeWidth", record.safeWidth)} onChange={(e) => updateNumericDraft(record.recordKey, "safeWidth", e.target.value)} onBlur={(e) => { const nextValue = parseEditableNumber(e.target.value); updateRecordOverride(record.recordKey, { safeWidth: nextValue }); clearNumericDraft(record.recordKey, "safeWidth"); void persistInventoryPatch(record.recordKey, { safeWidth: nextValue }); }} placeholder="W" disabled={!inventoryEditMode} inputMode="decimal" /></td>
                                    <td>
                                      <textarea
                                        className="field-input venue-preview-input venue-preview-notesInput"
                                        value={record.notes || ""}
                                        onChange={(e) => updateRecordOverride(record.recordKey, { notes: e.target.value })}
                                        onBlur={(e) => void persistInventoryPatch(record.recordKey, { notes: e.target.value })}
                                        placeholder="Add notes"
                                        disabled={!inventoryEditMode}
                                      />
                                    </td>
                                    <td>
                                      <textarea
                                        className="field-input venue-preview-input venue-preview-locationInput"
                                        value={record.locationDetail || ""}
                                        onChange={(e) => updateRecordOverride(record.recordKey, { locationDetail: e.target.value })}
                                        onBlur={(e) => void persistInventoryPatch(record.recordKey, { locationDetail: e.target.value })}
                                        placeholder="Add location"
                                        disabled={!inventoryEditMode}
                                      />
                                    </td>
                                    <td>
                                      <select
                                        className="select venue-preview-inlineSelect venue-preview-inlineSelect-compact"
                                        value={record.isActive ? "active" : "inactive"}
                                        onChange={(e) => {
                                          const isActive = e.target.value === "active";
                                          updateRecordOverride(record.recordKey, { isActive });
                                          void persistInventoryPatch(record.recordKey, { isActive });
                                        }}
                                        disabled={!inventoryEditMode}
                                      >
                                        <option value="active">Active</option>
                                        <option value="inactive">Inactive</option>
                                      </select>
                                    </td>
                                    <td>
                                      <select
                                        className="select venue-preview-inlineSelect venue-preview-inlineSelect-visibility"
                                        value={record.isActive ? "included" : record.mapVisibilityMode}
                                        onChange={(e) => {
                                          const next = e.target.value;
                                          if (next === "included") {
                                            updateRecordOverride(record.recordKey, { isActive: true });
                                            void persistInventoryPatch(record.recordKey, { isActive: true });
                                          } else {
                                            updateRecordOverride(record.recordKey, {
                                              isActive: false,
                                              mapVisibilityMode: next as "hidden" | "show_unavailable",
                                            });
                                            void persistInventoryPatch(record.recordKey, {
                                              isActive: false,
                                              mapVisibilityMode: next,
                                            });
                                          }
                                        }}
                                        disabled={!inventoryEditMode}
                                      >
                                        <option value="included">Included</option>
                                        <option value="show_unavailable">Unavailable</option>
                                        <option value="hidden">Hidden</option>
                                      </select>
                                    </td>
                                    <td>
                                      <button
                                        className="btn btn-ghost btn-soft"
                                        type="button"
                                        onClick={() => void deleteInventoryRecord(record.recordKey)}
                                        disabled={!inventoryEditMode}
                                      >
                                        Delete
                                      </button>
                                    </td>
                                    <td>
                                      {issueCount > 0 ? (
                                        <div
                                          className="venue-preview-rowIssueStack"
                                          title={[
                                            ...sortedReadinessIssues.map((issue) => issue.detail),
                                            ...importIssueMessages,
                                          ].join(" • ")}
                                        >
                                          <span className="venue-preview-status is-warning">
                                            {issueCount} issue{issueCount === 1 ? "" : "s"}
                                          </span>
                                          <div className="venue-preview-rowIssuePills">
                                            {sortedReadinessIssues.slice(0, 3).map((issue) => (
                                              <span
                                                key={`${issue.actionId}-${issue.label}`}
                                                className={`venue-preview-rowIssuePill is-${issue.tone} ${
                                                  readinessFocus?.actionId === issue.actionId ? "is-focused" : ""
                                                }`}
                                              >
                                                {issue.label}
                                              </span>
                                            ))}
                                            {sortedReadinessIssues.length > 3 ? (
                                              <span className="venue-preview-rowIssueMore">+{sortedReadinessIssues.length - 3}</span>
                                            ) : null}
                                            {importIssueMessages.length ? (
                                              <span className="venue-preview-rowIssuePill is-warning">Import x{importIssueMessages.length}</span>
                                            ) : null}
                                          </div>
                                          {readinessFocus ? (
                                            <div className="venue-preview-rowIssueDetail">
                                              {sortedReadinessIssues.find((issue) => issue.actionId === readinessFocus.actionId)?.detail || "Review this row before continuing."}
                                            </div>
                                          ) : null}
                                        </div>
                                      ) : (
                                        <span className="venue-preview-status is-ok">Clean</span>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>

                        <div className="table-footer">
                          <span>
                            Showing {filteredRecords.length} of {effectiveRecords.length} inventory rows
                          </span>
                        </div>
                      </>
                    )}
                  </>
                )}
              </Panel>

              <Panel className="panel-tight venue-preview-panel">
                <div className="venue-preview-head">
                  <div>
                    <div className="venue-preview-title">Inventory History</div>
                    <div className="venue-preview-sub">
                      Recent imports, bulk edits, row changes, and variant mapping updates for this venue.
                    </div>
                  </div>
                  <button
                    className="btn btn-ghost btn-soft"
                    type="button"
                    onClick={() => activeVenue && void loadVenueInventoryHistory(activeVenue.id)}
                    disabled={!activeVenue || isInventoryHistoryLoading}
                  >
                    {isInventoryHistoryLoading ? "Refreshing..." : "Refresh"}
                  </button>
                </div>

                {isInventoryHistoryLoading && !venueInventoryHistory.length ? (
                  <div className="venue-preview-empty">Loading inventory history…</div>
                ) : !venueInventoryHistory.length ? (
                  <div className="venue-preview-empty">
                    No inventory history yet. Imports, bulk edits, variant changes, and row edits will appear here.
                  </div>
                ) : (
                  <div className="venue-preview-historyList">
                    {venueInventoryHistory.slice(0, 8).map((event) => {
                      const metrics = inventoryHistoryMetrics(event);
                      return (
                        <div key={`${event.eventType}-${event.createdAt}`} className="venue-preview-historyItem">
                          <div className="venue-preview-historyMarker" aria-hidden="true" />
                          <div className="venue-preview-historyMain">
                            <div className="venue-preview-historyTitle">{formatInventoryHistoryEventTitle(event)}</div>
                            <div className="venue-preview-historyMeta">{formatInventoryHistoryMeta(event)}</div>
                            {metrics.length ? (
                              <div className="venue-preview-historyMetrics">
                                {metrics.map(([label, value]) => (
                                  <span key={String(label)}>
                                    {label} <strong>{String(value)}</strong>
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </div>
                          <div className="venue-preview-historySide">
                            <span>{event.actorName || "System"}</span>
                            <strong>{event.createdAt ? new Date(event.createdAt).toLocaleString() : "Unknown time"}</strong>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Panel>

              <Panel className="panel-tight venue-preview-panel">
                <div className="venue-preview-head">
                  <div>
                    <div className="venue-preview-title">Media Variants</div>
                    <div className="venue-preview-sub">
                      Tune shared variant settings after inventory is loaded: unit mapping, color, map abbreviation, and whether the media routes to the primary print vendor or an external vendor.
                    </div>
                  </div>
                </div>

                {!variantRows.length ? (
                  <div className="venue-preview-empty">No variants yet. Load or use inventory to generate them.</div>
                ) : (
                  <div className="table-wrap venue-preview-tableWrap">
                    <table className="data-table venue-preview-table">
                      <thead>
                        <tr>
                          <th>Variant</th>
                          <th>Count</th>
                          <th>Unit Mapping</th>
                          <th>Product ID</th>
                          <th>Color</th>
                          <th>Abbrev.</th>
                          <th>Routing</th>
                          <th>External Vendor</th>
                        </tr>
                      </thead>
                      <tbody>
                        {variantRows.map((variant, index) => {
                          const appearance = getVariantAppearance(variant.key, variant.label, index);
                          const visibleInventoryIds = variant.inventoryIds.slice(0, 4);
                          const hiddenInventoryCount = Math.max(variant.inventoryIds.length - visibleInventoryIds.length, 0);
                          const isInventoryRefsExpanded = expandedVariantInventoryRefs.has(variant.key);
                          return (
                            <tr key={variant.key}>
                              <td>
                                <div className="venue-preview-variantCell">
                                  <span
                                    className="venue-preview-variantGlyph"
                                    style={{ background: appearance.color }}
                                  >
                                    {appearance.abbreviation}
                                  </span>
                                  <div>
                                    <div className="venue-preview-cellStrong">{variant.label}</div>
                                    {variant.inventoryIds.length ? (
                                      <div className="venue-preview-variantRefs" aria-label={`Inventory IDs for ${variant.label}`}>
                                        <div className="venue-preview-variantRefLine">
                                          {visibleInventoryIds.map((inventoryId) => (
                                            <span key={inventoryId}>{inventoryId}</span>
                                          ))}
                                          {hiddenInventoryCount > 0 ? (
                                            <button
                                              className="venue-preview-variantRefToggle"
                                              type="button"
                                              onClick={() => toggleVariantInventoryRefs(variant.key)}
                                            >
                                              {isInventoryRefsExpanded ? "Hide" : `+${hiddenInventoryCount} Show all`}
                                            </button>
                                          ) : null}
                                        </div>
                                        {isInventoryRefsExpanded && hiddenInventoryCount > 0 ? (
                                          <div className="venue-preview-variantRefPanel">
                                            {variant.inventoryIds.map((inventoryId) => (
                                              <span key={inventoryId}>{inventoryId}</span>
                                            ))}
                                          </div>
                                        ) : null}
                                      </div>
                                    ) : null}
                                  </div>
                                </div>
                              </td>
                              <td className="venue-preview-cellStrong">{variant.total}</td>
                              <td>
                                <div className="venue-preview-unitMap">
                                  <input
                                    className="field-input venue-preview-input"
                                    value={appearance.unitNumber || ""}
                                    onChange={(e) => updateVariantAppearance(variant.key, variant.label, { unitNumber: e.target.value })}
                                    onBlur={(e) => {
                                      const nextMapping = appearance.liftProductMapping
                                        ? { ...appearance.liftProductMapping, liftUnitNumber: e.target.value || undefined }
                                        : undefined;
                                      const manualPatch: Partial<VariantAppearance> = nextMapping
                                        ? { unitNumber: e.target.value, liftProductMapping: nextMapping }
                                        : { unitNumber: e.target.value };
                                      void persistVariantAppearance(variant, manualPatch);
                                    }}
                                    placeholder="Applies to all matching inventoryIDs"
                                    disabled={!inventoryEditMode}
                                  />
                                  <button
                                    className="btn btn-ghost btn-soft venue-preview-mapProductBtn"
                                    type="button"
                                    onClick={() => openLiftProductMapper(variant, appearance)}
                                  >
                                    <Link2 size={15} /> Map Product
                                  </button>
                                  {appearance.liftProductMapping ? (
                                    <div className="venue-preview-liftMapMeta">
                                      <span>Lift</span>
                                      <strong>{appearance.liftProductMapping.liftProductName || `Product ${appearance.liftProductMapping.liftProductId || ""}`}</strong>
                                      {appearance.liftProductMapping.liftCatalogName ? <em>{appearance.liftProductMapping.liftCatalogName}</em> : null}
                                    </div>
                                  ) : null}
                                </div>
                              </td>
                              <td className="venue-preview-cellMeta">
                                {appearance.liftProductMapping?.liftProductId ? (
                                  <div className="venue-preview-productIdStack">
                                    <span className="venue-preview-productIdPill">{appearance.liftProductMapping.liftProductId}</span>
                                    {appearance.liftProductMapping.liftProductStatus ? <small>Status {appearance.liftProductMapping.liftProductStatus}</small> : null}
                                  </div>
                                ) : "—"}
                              </td>
                              <td>
                                <input
                                  type="color"
                                  value={appearance.color}
                                  onChange={(e) => {
                                    updateVariantAppearance(variant.key, variant.label, { color: e.target.value });
                                    void persistVariantAppearance(variant, { color: e.target.value });
                                  }}
                                  disabled={!inventoryEditMode}
                                />
                              </td>
                              <td>
                                <input
                                  className="field-input venue-preview-input"
                                  value={appearance.abbreviation || ""}
                                  onChange={(e) =>
                                    updateVariantAppearance(variant.key, variant.label, {
                                      abbreviation: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4),
                                    })
                                  }
                                  onBlur={(e) =>
                                    void persistVariantAppearance(variant, {
                                      abbreviation: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4),
                                    })
                                  }
                                  placeholder="Auto"
                                  maxLength={4}
                                  disabled={!inventoryEditMode}
                                />
                              </td>
                              <td>
                                <select
                                  className="select venue-preview-inlineSelect"
                                  value={appearance.productionRouting || variant.productionRouting || "primary"}
                                  onChange={(e) => {
                                    const nextRouting = e.target.value as "primary" | "external";
                                    const nextVendorId =
                                      nextRouting === "external"
                                        ? (appearance.externalVendorId || variant.externalVendorId || activeCustomerVendors[0]?.id || "")
                                        : "";
                                    updateVariantAppearance(variant.key, variant.label, {
                                      productionRouting: nextRouting,
                                      externalVendorId: nextRouting === "external" ? nextVendorId || undefined : undefined,
                                    });
                                    void persistVariantAppearance(variant, {
                                      productionRouting: nextRouting,
                                      externalVendorId: nextRouting === "external" ? nextVendorId || undefined : "",
                                    });
                                  }}
                                  disabled={!inventoryEditMode}
                                >
                                  <option value="primary">Primary print vendor</option>
                                  <option value="external" disabled={!activeCustomerVendors.length}>External vendor</option>
                                </select>
                              </td>
                              <td>
                                <select
                                  className="select venue-preview-inlineSelect"
                                  value={appearance.externalVendorId || variant.externalVendorId || ""}
                                  onChange={(e) => {
                                    const nextVendorId = e.target.value;
                                    updateVariantAppearance(variant.key, variant.label, { externalVendorId: nextVendorId || undefined });
                                    void persistVariantAppearance(variant, {
                                      productionRouting: "external",
                                      externalVendorId: nextVendorId || "",
                                    });
                                  }}
                                  disabled={!inventoryEditMode || (appearance.productionRouting || variant.productionRouting || "primary") !== "external"}
                                >
                                  <option value="">
                                    {activeCustomerVendors.length ? "Select active vendor" : "Add an active vendor in Customer Admin Settings"}
                                  </option>
                                  {activeCustomerVendors.map((vendor) => (
                                    <option key={vendor.id} value={vendor.id}>
                                      {vendor.name}
                                    </option>
                                  ))}
                                </select>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
            </section>
            ) : null}
          </div>
        )}

        {mapPreviewRoom ? (
          <div className="venue-preview-modalScrim" onClick={() => setMapPreviewRoomId(null)}>
            <div className="venue-preview-modal venue-preview-modal-map" onClick={(e) => e.stopPropagation()}>
              <div className="venue-preview-modalHead">
                <div>
                  <div className="venue-preview-sectionEyebrow">Map Preview</div>
                  <div className="venue-preview-sectionTitle">{mapPreviewRoom.name}</div>
                  <div className="venue-preview-sectionSub">{mapPreviewRoom.mapAssetName || "No map uploaded yet"}</div>
                </div>
                <button className="btn btn-ghost btn-soft" type="button" onClick={() => setMapPreviewRoomId(null)}>
                  Close
                </button>
              </div>
              <div className="venue-preview-modalBody">
                <div className="venue-preview-mapLightbox">
                  {mapPreviewRoom.mapUrl ? (
                    <img src={mapPreviewRoom.mapUrl} alt={`${mapPreviewRoom.name} map`} />
                  ) : (
                    <div className="venue-preview-empty">No map uploaded for this room yet.</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {bulkInventoryEditor ? (
          <div className="venue-preview-modalScrim" onClick={() => setBulkInventoryEditor(null)}>
            <div className="venue-preview-modal venue-preview-modal-bulkEdit" onClick={(e) => e.stopPropagation()}>
              <div className="venue-preview-modalHead">
                <div>
                  <div className="venue-preview-sectionEyebrow">Inventory Bulk Edit</div>
                  <div className="venue-preview-sectionTitle">Edit selected inventory</div>
                  <div className="venue-preview-sectionSub">
                    Applies to {bulkInventoryEditor.recordKeys.length} selected row{bulkInventoryEditor.recordKeys.length === 1 ? "" : "s"}.
                  </div>
                </div>
                <button
                  className="btn btn-ghost btn-soft"
                  type="button"
                  onClick={() => setBulkInventoryEditor(null)}
                  disabled={bulkInventoryEditor.saving}
                >
                  Close
                </button>
              </div>

              <div className="venue-preview-modalBody venue-preview-bulkEditBody">
                <div className="venue-preview-bulkEditForm">
                  <div className="venue-preview-bulkEditGroup">
                    <div className="venue-preview-bulkEditGroupHead">
                      <span>Status & visibility</span>
                      <small>Controls whether rows participate in venue/order scope.</small>
                    </div>
                    <label className="venue-preview-bulkEditField">
                      <input
                        type="checkbox"
                        checked={Boolean(bulkInventoryEditor.draft.enabled.availability)}
                        onChange={() => toggleBulkInventoryField("availability")}
                      />
                      <span>Availability</span>
                      <select
                        className="select venue-preview-select"
                        value={bulkInventoryEditor.draft.availability}
                        onChange={(e) => patchBulkInventoryDraft({ availability: e.target.value as BulkInventoryEditDraft["availability"] })}
                        disabled={!bulkInventoryEditor.draft.enabled.availability}
                      >
                        <option value="active">Active / included</option>
                        <option value="inactive_unavailable">Inactive / show unavailable</option>
                        <option value="inactive_hidden">Inactive / hidden from map</option>
                      </select>
                    </label>
                  </div>

                  <div className="venue-preview-bulkEditGroup">
                    <div className="venue-preview-bulkEditGroupHead">
                      <span>Location</span>
                      <small>Move rows to a map or replace/clear the location note.</small>
                    </div>
                    <label className="venue-preview-bulkEditField">
                      <input
                        type="checkbox"
                        checked={Boolean(bulkInventoryEditor.draft.enabled.locationId)}
                        onChange={() => toggleBulkInventoryField("locationId")}
                      />
                      <span>Map</span>
                      <select
                        className="select venue-preview-select"
                        value={bulkInventoryEditor.draft.locationId}
                        onChange={(e) => patchBulkInventoryDraft({ locationId: e.target.value })}
                        disabled={!bulkInventoryEditor.draft.enabled.locationId}
                      >
                        <option value="">Choose map</option>
                        {activeVenueRooms.map((room) => (
                          <option key={room.id} value={room.id}>{room.name}</option>
                        ))}
                      </select>
                    </label>
                    <label className="venue-preview-bulkEditField venue-preview-bulkEditField-tall">
                      <input
                        type="checkbox"
                        checked={Boolean(bulkInventoryEditor.draft.enabled.locationDetail)}
                        onChange={() => toggleBulkInventoryField("locationDetail")}
                      />
                      <span>Location detail</span>
                      <div className="venue-preview-bulkEditStack">
                        <select
                          className="select venue-preview-select"
                          value={bulkInventoryEditor.draft.locationDetailMode}
                          onChange={(e) => patchBulkInventoryDraft({ locationDetailMode: e.target.value as "replace" | "clear" })}
                          disabled={!bulkInventoryEditor.draft.enabled.locationDetail}
                        >
                          <option value="replace">Replace</option>
                          <option value="clear">Clear value</option>
                        </select>
                        {bulkInventoryEditor.draft.locationDetailMode === "replace" ? (
                          <textarea
                            className="field-input venue-preview-bulkTextarea"
                            value={bulkInventoryEditor.draft.locationDetail}
                            onChange={(e) => patchBulkInventoryDraft({ locationDetail: e.target.value })}
                            disabled={!bulkInventoryEditor.draft.enabled.locationDetail}
                            placeholder="New location detail"
                          />
                        ) : null}
                      </div>
                    </label>
                  </div>

                  <div className="venue-preview-bulkEditGroup">
                    <div className="venue-preview-bulkEditGroupHead">
                      <span>Media specs</span>
                      <small>Trim/media changes may move rows into a different media variant.</small>
                    </div>
                    <div className="venue-preview-bulkEditGrid">
                      {([
                        ["mediaType", "Media type", "text"],
                        ["trimHeight", "Trim H", "decimal"],
                        ["trimWidth", "Trim W", "decimal"],
                        ["safeHeight", "Safe H", "decimal"],
                        ["safeWidth", "Safe W", "decimal"],
                        ["substrate", "Substrate", "text"],
                        ["finishing", "Finishing", "text"],
                        ["dpi", "DPI", "numeric"],
                        ["bleedTop", "Bleed top", "decimal"],
                        ["bleedRight", "Bleed right", "decimal"],
                        ["bleedBottom", "Bleed bottom", "decimal"],
                        ["bleedLeft", "Bleed left", "decimal"],
                      ] as Array<[BulkInventoryField, string, string]>).map(([field, label, inputMode]) => (
                        <label className="venue-preview-bulkEditField venue-preview-bulkEditField-compact" key={field}>
                          <input
                            type="checkbox"
                            checked={Boolean(bulkInventoryEditor.draft.enabled[field])}
                            onChange={() => toggleBulkInventoryField(field)}
                          />
                          <span>{label}</span>
                          <input
                            className="field-input"
                            value={String(bulkInventoryEditor.draft[field as keyof BulkInventoryEditDraft] || "")}
                            onChange={(e) => patchBulkInventoryDraft({ [field]: e.target.value } as Partial<BulkInventoryEditDraft>)}
                            disabled={!bulkInventoryEditor.draft.enabled[field]}
                            inputMode={inputMode as any}
                          />
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="venue-preview-bulkEditGroup">
                    <div className="venue-preview-bulkEditGroupHead">
                      <span>Production routing</span>
                      <small>Row-level overrides only. Variant defaults are not changed.</small>
                    </div>
                    <label className="venue-preview-bulkEditField">
                      <input
                        type="checkbox"
                        checked={Boolean(bulkInventoryEditor.draft.enabled.routing)}
                        onChange={() => toggleBulkInventoryField("routing")}
                      />
                      <span>Routing</span>
                      <select
                        className="select venue-preview-select"
                        value={bulkInventoryEditor.draft.routing}
                        onChange={(e) => patchBulkInventoryDraft({ routing: e.target.value as BulkInventoryEditDraft["routing"] })}
                        disabled={!bulkInventoryEditor.draft.enabled.routing}
                      >
                        <option value="inherit">Inherit variant default</option>
                        <option value="primary">Primary print vendor</option>
                        <option value="external">External vendor</option>
                      </select>
                    </label>
                    {bulkInventoryEditor.draft.routing === "external" ? (
                      <label className="venue-preview-bulkEditField">
                        <i className="venue-preview-bulkEditSpacer" aria-hidden="true" />
                        <span>Vendor</span>
                        <select
                          className="select venue-preview-select"
                          value={bulkInventoryEditor.draft.externalVendorId}
                          onChange={(e) => patchBulkInventoryDraft({ externalVendorId: e.target.value })}
                          disabled={!bulkInventoryEditor.draft.enabled.routing}
                        >
                          <option value="">Choose vendor</option>
                          {activeCustomerVendors.map((vendor) => (
                            <option key={vendor.id} value={vendor.id}>{vendor.name}</option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                  </div>

                  <div className="venue-preview-bulkEditGroup">
                    <div className="venue-preview-bulkEditGroupHead">
                      <span>Lift mapping</span>
                      <small>Preserved unless one of these fields is selected.</small>
                    </div>
                    <label className="venue-preview-bulkEditField">
                      <input
                        type="checkbox"
                        checked={Boolean(bulkInventoryEditor.draft.enabled.unitNumber)}
                        onChange={() => toggleBulkInventoryField("unitNumber")}
                      />
                      <span>Unit number</span>
                      <div className="venue-preview-bulkEditInline">
                        <select
                          className="select venue-preview-select"
                          value={bulkInventoryEditor.draft.unitNumberMode}
                          onChange={(e) => patchBulkInventoryDraft({ unitNumberMode: e.target.value as "replace" | "clear" })}
                          disabled={!bulkInventoryEditor.draft.enabled.unitNumber}
                        >
                          <option value="replace">Replace</option>
                          <option value="clear">Clear value</option>
                        </select>
                        {bulkInventoryEditor.draft.unitNumberMode === "replace" ? (
                          <input
                            className="field-input"
                            value={bulkInventoryEditor.draft.unitNumber}
                            onChange={(e) => patchBulkInventoryDraft({ unitNumber: e.target.value })}
                            disabled={!bulkInventoryEditor.draft.enabled.unitNumber}
                            placeholder="Unit number"
                          />
                        ) : null}
                      </div>
                    </label>
                    <label className="venue-preview-bulkEditField">
                      <input
                        type="checkbox"
                        checked={Boolean(bulkInventoryEditor.draft.enabled.productMapping)}
                        onChange={() => toggleBulkInventoryField("productMapping")}
                      />
                      <span>Product mapping</span>
                      <div className="venue-preview-bulkEditStack">
                        <select
                          className="select venue-preview-select"
                          value={bulkInventoryEditor.draft.productMappingMode}
                          onChange={(e) => patchBulkInventoryDraft({ productMappingMode: e.target.value as "replace" | "clear" })}
                          disabled={!bulkInventoryEditor.draft.enabled.productMapping}
                        >
                          <option value="replace">Set Product ID</option>
                          <option value="clear">Clear row mapping</option>
                        </select>
                        {bulkInventoryEditor.draft.productMappingMode === "replace" ? (
                          <div className="venue-preview-bulkEditInline">
                            <input
                              className="field-input"
                              value={bulkInventoryEditor.draft.productId}
                              onChange={(e) => patchBulkInventoryDraft({ productId: e.target.value })}
                              disabled={!bulkInventoryEditor.draft.enabled.productMapping}
                              placeholder="Product ID"
                              inputMode="numeric"
                            />
                            <input
                              className="field-input"
                              value={bulkInventoryEditor.draft.productName}
                              onChange={(e) => patchBulkInventoryDraft({ productName: e.target.value })}
                              disabled={!bulkInventoryEditor.draft.enabled.productMapping}
                              placeholder="Product name optional"
                            />
                          </div>
                        ) : null}
                      </div>
                    </label>
                  </div>

                  <div className="venue-preview-bulkEditGroup">
                    <div className="venue-preview-bulkEditGroupHead">
                      <span>Notes</span>
                      <small>Append is safest when preserving existing row notes matters.</small>
                    </div>
                    <label className="venue-preview-bulkEditField venue-preview-bulkEditField-tall">
                      <input
                        type="checkbox"
                        checked={Boolean(bulkInventoryEditor.draft.enabled.notes)}
                        onChange={() => toggleBulkInventoryField("notes")}
                      />
                      <span>Notes</span>
                      <div className="venue-preview-bulkEditStack">
                        <select
                          className="select venue-preview-select"
                          value={bulkInventoryEditor.draft.notesMode}
                          onChange={(e) => patchBulkInventoryDraft({ notesMode: e.target.value as BulkInventoryEditDraft["notesMode"] })}
                          disabled={!bulkInventoryEditor.draft.enabled.notes}
                        >
                          <option value="append">Append</option>
                          <option value="replace">Replace</option>
                          <option value="clear">Clear value</option>
                        </select>
                        {bulkInventoryEditor.draft.notesMode !== "clear" ? (
                          <textarea
                            className="field-input venue-preview-bulkTextarea"
                            value={bulkInventoryEditor.draft.notes}
                            onChange={(e) => patchBulkInventoryDraft({ notes: e.target.value })}
                            disabled={!bulkInventoryEditor.draft.enabled.notes}
                            placeholder="Note text"
                          />
                        ) : null}
                      </div>
                    </label>
                  </div>
                </div>

                <aside className="venue-preview-bulkEditSummary">
                  <div className="venue-preview-bulkEditSummaryCard">
                    <div className="venue-preview-kpiLabel">Rows selected</div>
                    <div className="venue-preview-kpiValue">{bulkInventoryEditor.recordKeys.length}</div>
                    {bulkEditorSummary.unsavedRows ? (
                      <div className="venue-preview-alert venue-preview-alert-warning">
                        {bulkEditorSummary.unsavedRows} selected row{bulkEditorSummary.unsavedRows === 1 ? "" : "s"} must be saved before bulk edit can apply.
                      </div>
                    ) : null}
                  </div>
                  <div className="venue-preview-bulkEditSummaryCard">
                    <div className="venue-preview-kpiLabel">Maps affected</div>
                    <div className="venue-preview-bulkEditChips">
                      {(bulkEditorSummary.maps.length ? bulkEditorSummary.maps : ["No map"]).slice(0, 4).map((item) => <span key={item}>{item}</span>)}
                      {bulkEditorSummary.maps.length > 4 ? <span>+{bulkEditorSummary.maps.length - 4}</span> : null}
                    </div>
                  </div>
                  <div className="venue-preview-bulkEditSummaryCard">
                    <div className="venue-preview-kpiLabel">Variants affected</div>
                    <div className="venue-preview-bulkEditChips">
                      {(bulkEditorSummary.variants.length ? bulkEditorSummary.variants : ["No variant"]).slice(0, 4).map((item) => <span key={item}>{item}</span>)}
                      {bulkEditorSummary.variants.length > 4 ? <span>+{bulkEditorSummary.variants.length - 4}</span> : null}
                    </div>
                  </div>
                  <div className="venue-preview-bulkEditSummaryCard">
                    <div className="venue-preview-kpiLabel">Mapping posture</div>
                    <div className="venue-preview-bulkEditMetaLine">{bulkEditorSummary.mappedRows} row-level mappings</div>
                    <div className="venue-preview-bulkEditMetaLine">{bulkEditorSummary.inheritedMappings} inherited variant mappings</div>
                    <div className="venue-preview-bulkEditNote">Mappings are preserved unless Unit number or Product mapping is selected.</div>
                  </div>
                  <div className="venue-preview-bulkEditSummaryCard">
                    <div className="venue-preview-kpiLabel">Fields changing</div>
                    {bulkEditorChangeLabels.length ? (
                      <div className="venue-preview-bulkEditChangeList">
                        {bulkEditorChangeLabels.map((label) => <span key={label}>{label}</span>)}
                      </div>
                    ) : (
                      <div className="venue-preview-bulkEditNote">Select one or more fields to preview the change.</div>
                    )}
                  </div>
                  {bulkInventoryEditor.error ? (
                    <div className="venue-preview-alert venue-preview-alert-danger">{bulkInventoryEditor.error}</div>
                  ) : null}
                </aside>
              </div>

              <div className="venue-preview-modalFoot">
                <span className="venue-preview-cellMeta">Inventory IDs, pin placement, and variant defaults are protected from this bulk editor.</span>
                <button className="btn btn-ghost btn-soft" type="button" onClick={() => setBulkInventoryEditor(null)} disabled={bulkInventoryEditor.saving}>
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={() => void applyBulkInventoryEdit()}
                  disabled={bulkInventoryEditor.saving || !bulkEditorChangeLabels.length || !bulkEditorBackendIds.length}
                >
                  {bulkInventoryEditor.saving ? "Applying..." : "Apply Bulk Edit"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {vendorPicker ? (
          <div className="venue-preview-modalScrim" onClick={() => { setVendorPicker(null); setVendorSearch(""); }}>
            <div className="venue-preview-modal venue-preview-modal-vendor" onClick={(e) => e.stopPropagation()}>
              <div className="venue-preview-modalHead">
                <div>
                  <div className="venue-preview-sectionEyebrow">Production Routing</div>
                  <div className="venue-preview-sectionTitle">Set inventory vendor</div>
                  <div className="venue-preview-sectionSub">
                    Applies to {vendorPicker.recordKeys.length} selected row{vendorPicker.recordKeys.length === 1 ? "" : "s"}.
                  </div>
                </div>
                <button
                  className="btn btn-ghost btn-soft"
                  type="button"
                  onClick={() => {
                    setVendorPicker(null);
                    setVendorSearch("");
                  }}
                >
                  Close
                </button>
              </div>

              <div className="venue-preview-modalBody">
                <div className="venue-preview-vendorRouteGrid">
                  <button
                    className="venue-preview-vendorRouteOption"
                    type="button"
                    onClick={() => void applyVendorRouteToRecords(vendorPicker.recordKeys, "inherit")}
                  >
                    <span className="venue-preview-vendorRouteTitle">Inherit default</span>
                    <span className="venue-preview-vendorRouteMeta">Use the media variant vendor. Falls back to LTL when no variant vendor is set.</span>
                  </button>
                  <button
                    className="venue-preview-vendorRouteOption"
                    type="button"
                    onClick={() => void applyVendorRouteToRecords(vendorPicker.recordKeys, "primary")}
                  >
                    <span className="venue-preview-vendorRouteTitle">Force LTL</span>
                    <span className="venue-preview-vendorRouteMeta">Override the row to the primary Lift-backed print route.</span>
                  </button>
                </div>

                <div className="venue-preview-head venue-preview-vendorPickerHead">
                  <div>
                    <div className="venue-preview-title">External Vendors</div>
                    <div className="venue-preview-sub">Route specialty rows away from Lift to an Adspace-managed vendor.</div>
                  </div>
                  <div className="field-search venue-preview-search venue-preview-vendorSearch">
                    <span aria-hidden="true">◦</span>
                    <input
                      className="field-input"
                      type="search"
                      value={vendorSearch}
                      onChange={(e) => setVendorSearch(e.target.value)}
                      placeholder="Search vendors"
                    />
                  </div>
                </div>

                {!activeCustomerVendors.length ? (
                  <div className="venue-preview-empty">
                    No active customer vendors are configured yet. Add vendors in customer settings before assigning external routes.
                  </div>
                ) : !vendorPickerVendors.length ? (
                  <div className="venue-preview-empty">No vendors match the current search.</div>
                ) : (
                  <div className="venue-preview-vendorList">
                    {vendorPickerVendors.map((vendor) => (
                      <div
                        key={vendor.id}
                        className="venue-preview-vendorListItem"
                      >
                        <span>
                          <span className="venue-preview-vendorRouteTitle">{vendor.name}</span>
                          <span className="venue-preview-vendorRouteMeta">
                            {[vendor.contactName, vendor.email, vendor.phone].filter(Boolean).join(" · ") || "External vendor"}
                          </span>
                        </span>
                        <button
                          className="btn btn-ghost btn-soft venue-preview-vendorSelectButton"
                          type="button"
                          onClick={() => void applyVendorRouteToRecords(vendorPicker.recordKeys, "external", vendor.id)}
                        >
                          Select
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {liftProductMapper ? (
          <div className="venue-preview-modalScrim" onClick={() => setLiftProductMapper(null)}>
            <div
              className="venue-preview-modal venue-preview-modal-liftProduct"
              role="dialog"
              aria-modal="true"
              aria-labelledby="lift-product-map-title"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="venue-preview-modalHead">
                <div>
                  <div className="venue-preview-sectionEyebrow">Lift Catalog</div>
                  <div className="venue-preview-sectionTitle" id="lift-product-map-title">Map Product</div>
                  <div className="venue-preview-sectionSub">
                    {liftProductMapper.targetType === "inventory"
                      ? `${liftProductMapper.inventoryId || "This inventory item"} will store the selected Lift product ID and, when available, one unit number.`
                      : `${liftProductMapper.variantLabel} will store the selected Lift product ID and, when available, one unit number for matching inventory.`}
                  </div>
                </div>
                <button className="btn btn-ghost btn-soft" type="button" onClick={() => setLiftProductMapper(null)}>
                  <X size={16} /> Close
                </button>
              </div>

              <div className="venue-preview-modalBody">
                {!inventoryEditMode ? (
                  <div className="venue-preview-alert venue-preview-alert-warning venue-preview-alertAction">
                    <span>
                      {canEditVenueInventory
                        ? "Inventory editing is locked. You can keep searching Lift products, then unlock editing here before saving this mapping."
                        : "Inventory editing is restricted for your role. You can search Lift products, but cannot save this mapping."}
                    </span>
                    {canEditVenueInventory ? (
                      <button className="btn btn-ghost btn-soft venue-preview-alertButton" type="button" onClick={() => setInventoryEditMode(true)}>
                        <UnlockKeyhole size={15} /> Unlock Editing
                      </button>
                    ) : null}
                  </div>
                ) : null}

                <div className="venue-preview-liftFilterPanel">
                  <div className="venue-preview-liftFilterSection is-primary">
                    <div>
                      <div className="venue-preview-title">Catalog Scope</div>
                      <div className="venue-preview-sub">Start here to narrow Lift’s product catalog.</div>
                    </div>
                    <label className="venue-preview-liftField venue-preview-liftField-wide">
                      <span>Known Catalog</span>
                      <select
                        className="select"
                        value={knownLiftCatalogValue(liftProductMapper.catalogId, liftProductMapper.catalogName)}
                        onChange={(e) => {
                          const catalog = KNOWN_LIFT_CATALOGS.find((item) => item.id === e.target.value);
                          patchLiftProductMapper({
                            catalogId: catalog?.id || "",
                            catalogName: catalog?.name || "",
                            results: [],
                            localQuery: "",
                            selectedProduct: null,
                            selectedUnitNumber: "",
                            hasSearched: false,
                            hasMore: false,
                            error: "",
                          });
                        }}
                      >
                        <option value="">Manual catalog</option>
                        {KNOWN_LIFT_CATALOGS.map((catalog) => (
                          <option key={catalog.id} value={catalog.id}>
                            {catalog.name} · {catalog.id}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="venue-preview-liftFilterGrid">
                      <label className="venue-preview-liftField">
                        <span>Catalog ID</span>
                        <input
                          className="field-input venue-preview-input"
                          value={liftProductMapper.catalogId}
                          onChange={(e) => patchLiftProductMapper({ catalogId: e.target.value })}
                          placeholder="7146"
                        />
                      </label>
                      <label className="venue-preview-liftField">
                        <span>Catalog Name</span>
                        <input
                          className="field-input venue-preview-input"
                          value={liftProductMapper.catalogName}
                          onChange={(e) => patchLiftProductMapper({ catalogName: e.target.value })}
                          placeholder="Exact catalog name"
                        />
                      </label>
                    </div>
                  </div>

                  <div className="venue-preview-liftFilterSection">
                    <div>
                      <div className="venue-preview-title">Product Filters</div>
                      <div className="venue-preview-sub">Optional exact-match filters for faster lookup.</div>
                    </div>
                    <div className="venue-preview-liftFilterGrid">
                      <label className="venue-preview-liftField">
                        <span>Product ID</span>
                        <input
                          className="field-input venue-preview-input"
                          value={liftProductMapper.productId}
                          onChange={(e) => patchLiftProductMapper({ productId: e.target.value })}
                          placeholder="Optional"
                        />
                      </label>
                      <label className="venue-preview-liftField">
                        <span>Product Name</span>
                        <input
                          className="field-input venue-preview-input"
                          value={liftProductMapper.productName}
                          onChange={(e) => patchLiftProductMapper({ productName: e.target.value })}
                          placeholder="Optional exact name"
                        />
                      </label>
                      <label className="venue-preview-liftField">
                        <span>Product Type</span>
                        <select
                          className="select"
                          value={liftProductMapper.productType}
                          onChange={(e) => patchLiftProductMapper({ productType: e.target.value as LiftProductMapperState["productType"] })}
                        >
                          <option value="">All types</option>
                          <option value="REGULAR">Regular</option>
                          <option value="KIT">Kit</option>
                          <option value="SERVICE">Service</option>
                        </select>
                      </label>
                      <label className="venue-preview-liftField">
                        <span>Status</span>
                        <select
                          className="select"
                          value={liftProductMapper.status}
                          onChange={(e) => patchLiftProductMapper({ status: e.target.value as "A" | "I" })}
                        >
                          <option value="A">Active</option>
                          <option value="I">Inactive</option>
                        </select>
                      </label>
                    </div>
                  </div>
                </div>

                <div className="venue-preview-liftSearchActions">
                  <button
                    className="btn btn-primary"
                    type="button"
                    onClick={() => void runLiftProductSearch()}
                    disabled={liftProductMapper.loading}
                  >
                    <Search size={16} /> {liftProductMapper.loading ? "Loading..." : "Load Lift Products"}
                  </button>
                  {liftProductMapper.hasSearched ? (
                    <span className="venue-preview-resultCount">
                      {liftProductMapper.results.length === filteredLiftProducts.length ? (
                        <>
                          <strong>{liftProductMapper.results.length}</strong> loaded
                        </>
                      ) : (
                        <>
                          <strong>{filteredLiftProducts.length}</strong> shown of {liftProductMapper.results.length} loaded
                        </>
                      )}
                    </span>
                  ) : null}
                  {liftProductMapper.hasMore ? (
                    <span className="venue-preview-cellMeta">Showing first 250 products. Narrow the catalog or product filter for more precision.</span>
                  ) : null}
                </div>

                {liftProductMapper.error ? (
                  <div className="venue-preview-alert venue-preview-alert-danger">{liftProductMapper.error}</div>
                ) : null}

                <div className="venue-preview-liftBrowser">
                  <div className="venue-preview-liftResultsPane">
                    <div className="venue-preview-liftPaneHead">
                      <div>
                        <div className="venue-preview-title">Products</div>
                        <div className="venue-preview-sub">
                          {liftProductMapper.hasSearched
                            ? `${liftProductMapper.results.length} loaded from Lift`
                            : "Load a catalog to browse products."}
                        </div>
                      </div>
                      <label className="venue-preview-liftLocalSearch">
                        <Search size={15} />
                        <input
                          type="search"
                          value={liftProductMapper.localQuery}
                          onChange={(e) => patchLiftProductMapper({ localQuery: e.target.value })}
                          placeholder="Filter loaded products"
                          disabled={!liftProductMapper.results.length}
                        />
                      </label>
                    </div>
                    <div className="venue-preview-liftResults">
                      {!liftProductMapper.hasSearched ? (
                        <div className="venue-preview-empty">Start with a Lift catalog ID or catalog name, then load products from Lift.</div>
                      ) : liftProductMapper.loading ? (
                        <div className="venue-preview-empty">Loading Lift products...</div>
                      ) : !liftProductMapper.results.length ? (
                        <div className="venue-preview-empty">No Lift products matched these filters.</div>
                      ) : !filteredLiftProducts.length ? (
                        <div className="venue-preview-empty">No loaded products match this filter.</div>
                      ) : (
                        filteredLiftProducts.map((product) => {
                          const isSelected = liftProductMapper.selectedProduct?.productId === product.productId;
                          const unitNumbers = product.unitNumbers || [];
                          const unitLabel = unitNumbers.length
                            ? unitNumbers.join(", ")
                            : "No unit numbers returned";
                          return (
                            <button
                              key={`${product.productId || product.productName}-${product.catalogId || product.catalogName}`}
                              className={`venue-preview-liftProductRow${isSelected ? " is-selected" : ""}`}
                              type="button"
                              onClick={() => selectLiftProduct(product)}
                            >
                              <span>
                                <strong>{product.productName || `Product ${product.productId || ""}`}</strong>
                                <small>
                                  {[product.productId ? `ID ${product.productId}` : "", product.catalogName || (product.catalogId ? `Catalog ${product.catalogId}` : ""), product.productType, product.status ? `Status ${product.status}` : ""].filter(Boolean).join(" · ")}
                                </small>
                              </span>
                              <span className={unitNumbers.length ? "venue-preview-unitBadge" : "venue-preview-unitBadge is-empty"}>
                                {unitLabel}
                              </span>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>

                  <aside className="venue-preview-liftDetailRail" aria-label="Selected Lift product details">
                    {!liftProductMapper.selectedProduct ? (
                      <div className="venue-preview-liftDetailEmpty">
                        <div className="venue-preview-title">Product Details</div>
                        <div className="venue-preview-sub">Select a product to inspect payload fields and choose the unit number to import.</div>
                      </div>
                    ) : (
                      <>
                        <div className="venue-preview-liftDetailHead">
                          <div>
                            <div className="venue-preview-title">{liftProductMapper.selectedProduct.productName || "Lift Product"}</div>
                            <div className="venue-preview-sub">
                              {[liftProductMapper.selectedProduct.productId ? `ID ${liftProductMapper.selectedProduct.productId}` : "", liftProductMapper.selectedProduct.catalogName].filter(Boolean).join(" · ")}
                            </div>
                          </div>
                          <span className="venue-preview-status is-neutral">{liftProductMapper.selectedProduct.status || "—"}</span>
                        </div>

                        {(liftProductMapper.selectedProduct.unitNumbers || []).length ? (
                          <label className="venue-preview-liftField venue-preview-unitSelect">
                            <span>Unit number to import</span>
                            <select
                              className="select"
                              value={liftProductMapper.selectedUnitNumber}
                              onChange={(e) => patchLiftProductMapper({ selectedUnitNumber: e.target.value })}
                            >
                              <option value="">Choose one unit number</option>
                              {liftProductMapper.selectedProduct.unitNumbers.map((unitNumber) => (
                                <option key={unitNumber} value={unitNumber}>{unitNumber}</option>
                              ))}
                            </select>
                          </label>
                        ) : (
                          <div className="venue-preview-alert venue-preview-alert-warning">
                            Lift returned this product without unit numbers. You can still save the Product ID mapping for the future Product ID interface.
                          </div>
                        )}

                        <dl className="venue-preview-liftDetailsList">
                          {liftProductDetailRows(liftProductMapper.selectedProduct).map(([label, value]) => (
                            <div key={label} className="venue-preview-liftDetailRow">
                              <dt>{label}</dt>
                              <dd>{formatLiftDetailValue(value)}</dd>
                            </div>
                          ))}
                        </dl>
                      </>
                    )}
                  </aside>
                </div>
              </div>

              <div className="venue-preview-modalFoot">
                <span className="venue-preview-cellMeta">Product ID is stored for the future Lift interface. Unit Number remains available for today’s Lift setup.</span>
                <div className="venue-preview-actions">
                  <button className="btn btn-ghost btn-soft" type="button" onClick={() => setLiftProductMapper(null)}>
                    Cancel
                  </button>
                  <button
                    className="btn btn-primary"
                    type="button"
                    onClick={() => void saveLiftProductMapping()}
                    disabled={
                      !inventoryEditMode ||
                      !liftProductMapper.selectedProduct ||
                      !liftProductMapper.selectedProduct.productId ||
                      ((liftProductMapper.selectedProduct.unitNumbers || []).length > 1 && !liftProductMapper.selectedUnitNumber.trim())
                    }
                  >
                    Save Mapping
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {showImportModal ? (
          <div className="venue-preview-modalScrim" onClick={closeInventoryImportModal}>
            <div className="venue-preview-modal" onClick={(e) => e.stopPropagation()}>
              <div className="venue-preview-modalHead">
                <div>
                  <div className="venue-preview-sectionEyebrow">Inventory Import</div>
                  <div className="venue-preview-sectionTitle">Bring inventory into {activeVenue?.name || "this venue"}</div>
                  <div className="venue-preview-sectionSub">
                    Upload or paste a sheet, validate translation, then confirm the import results before placement.
                  </div>
                </div>
                <button className="btn btn-ghost btn-soft" type="button" onClick={closeInventoryImportModal}>
                  Close
                </button>
              </div>

              <div className="venue-preview-modalSteps">
                {[
                  ["source", "1. Source"],
                  ["validate", "2. Validation"],
                  ["review", "3. Review"],
                  ["confirm", "4. Confirm"],
                  ["results", "5. Results"],
                ].map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className={`btn ${importStep === id ? "btn-primary" : "btn-ghost btn-soft"}`}
                    disabled={id === "results" && !importApplyResult}
                    onClick={() => setImportStep(id as ImportStep)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="venue-preview-modalBody">
                {importStep === "source" ? (
                  <div className="venue-preview-grid venue-preview-grid-importTop">
                    <Panel className="panel-tight venue-preview-panel">
                      <div className="venue-preview-head">
                        <div>
                          <div className="venue-preview-title">Load Inventory Sheet</div>
                          <div className="venue-preview-sub">
                            Paste CSV text or upload a `.csv` export for this venue.
                          </div>
                        </div>
                        <div className={`venue-preview-source tone-${loadTone}`}>
                          {isUsingPennSampleInventory ? "Using Penn Station sample" : sourceLabel}
                        </div>
                      </div>

                      <div className="venue-preview-actions">
                        <label className="btn btn-primary">
                          Upload CSV
                          <input
                            type="file"
                            accept=".csv,text/csv"
                            onChange={(e) => onFileChange(e.target.files?.[0] || null)}
                            style={{ display: "none" }}
                          />
                        </label>
                        <select
                          className="select venue-preview-select"
                          value={inactiveVisibilityMode}
                          onChange={(e) => setInactiveVisibilityMode(e.target.value as "hidden" | "show_unavailable")}
                        >
                          <option value="hidden">Inactive imports hidden on maps</option>
                          <option value="show_unavailable">Inactive imports visible as unavailable</option>
                        </select>
                        <select
                          className="select venue-preview-select"
                          value={importDelimiter}
                          onChange={(e) => setImportDelimiter(e.target.value as "auto" | "comma" | "tab")}
                        >
                          <option value="auto">Delimiter: Auto</option>
                          <option value="comma">Delimiter: Comma CSV</option>
                          <option value="tab">Delimiter: Tab / pasted table</option>
                        </select>
                        <button
                          className="btn btn-ghost btn-soft"
                          type="button"
                          onClick={resetInventoryImportSource}
                        >
                          Clear
                        </button>
                      </div>

                      <div className="venue-preview-importMode" role="radiogroup" aria-label="Inventory import behavior">
                        <label className={`venue-preview-importModeOption ${inventoryImportMode === "merge" ? "is-selected" : ""}`}>
                          <input
                            type="radio"
                            name="inventoryImportMode"
                            value="merge"
                            checked={inventoryImportMode === "merge"}
                            onChange={() => setInventoryImportMode("merge")}
                          />
                          <span>
                            <strong>Merge update/add</strong>
                            <small>Update matching inventory IDs, add new rows, keep existing rows that are missing from this file, and preserve product mappings.</small>
                          </span>
                        </label>
                        <label className={`venue-preview-importModeOption is-danger ${inventoryImportMode === "replace" ? "is-selected" : ""}`}>
                          <input
                            type="radio"
                            name="inventoryImportMode"
                            value="replace"
                            checked={inventoryImportMode === "replace"}
                            onChange={() => setInventoryImportMode("replace")}
                          />
                          <span>
                            <strong>Replace current inventory</strong>
                            <small>Remove rows and variants not present in this file. Use only for a deliberate full reset.</small>
                          </span>
                        </label>
                      </div>

                      <div className="venue-preview-editor">
                        <textarea
                          className="venue-preview-textarea"
                          value={csvText}
                          onChange={(e) => {
                            setCsvText(e.target.value);
                            setSourceLabel("Pasted CSV");
                            setLoadTone(e.target.value.trim() ? "warning" : "idle");
                          }}
                          placeholder="Paste venue inventory CSV here…"
                          rows={14}
                        />
                      </div>
                    </Panel>

                    <Panel className="panel-tight venue-preview-panel">
                      <div className="venue-preview-head">
                        <div>
                          <div className="venue-preview-title">Import Profiles</div>
                          <div className="venue-preview-sub">Save and reuse customer-specific mapping rules.</div>
                        </div>
                      </div>
                      <div className="venue-preview-actions">
                        <input
                          className="field-input venue-preview-input venue-preview-profileInput"
                          value={profileName}
                          onChange={(e) => setProfileName(e.target.value)}
                          placeholder="Profile name, like Intersection CSV v1"
                        />
                        <button className="btn btn-primary" type="button" onClick={saveCurrentProfile} disabled={!profileName.trim()}>
                          Save Profile
                        </button>
                      </div>
                      {!profiles.length ? (
                        <div className="venue-preview-empty">No saved import profiles yet.</div>
                      ) : (
                        <div className="venue-preview-list">
                          {profiles.map((profile) => (
                            <div key={profile.id} className="venue-preview-row venue-preview-profileRow">
                              <div>
                                <div className="venue-preview-rowTitle">{profile.name}</div>
                                <div className="venue-preview-rowSub">
                                  {profile.inactiveVisibilityMode === "show_unavailable" ? "Unavailable pins visible" : "Inactive pins hidden"} · {Object.keys(profile.headerOverrides).length} overrides
                                </div>
                              </div>
                              <div className="venue-preview-rowActions">
                                <button className="btn btn-ghost btn-soft" type="button" onClick={() => applyProfile(profile)}>
                                  Apply
                                </button>
                                <button className="btn btn-ghost btn-soft" type="button" onClick={() => removeProfile(profile.id)}>
                                  Delete
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </Panel>
                  </div>
                ) : null}

                {importStep === "validate" ? (
                  <div className="venue-preview-grid venue-preview-grid-importAudit">
                    <Panel className="panel-tight venue-preview-panel">
                      <div className="venue-preview-head">
                        <div>
                          <div className="venue-preview-title">Column Import Audit</div>
                          <div className="venue-preview-sub">Review mapping and override misidentified columns before import.</div>
                        </div>
                      </div>
                      {!columnAuditRows.length ? (
                        <div className="venue-preview-empty">Load a CSV to inspect column audit details.</div>
                      ) : (
                        <div className="table-wrap venue-preview-tableWrap">
                          <table className="data-table venue-preview-table venue-preview-auditTable">
                            <thead>
                              <tr>
                                <th>Source Column</th>
                                <th>Canonical Field</th>
                                <th>Requirement</th>
                                <th>Override</th>
                                <th>Sample Values</th>
                              </tr>
                            </thead>
                            <tbody>
                              {columnAuditRows.map((row) => (
                                <tr key={row.sourceHeader}>
                                  <td className="venue-preview-cellStrong">{row.sourceHeader}</td>
                                  <td>{row.canonicalField ? <span className="venue-preview-status is-ok">{row.canonicalField}</span> : <span className="venue-preview-status is-neutral">Unmapped</span>}</td>
                                  <td>
                                    <span className={`venue-preview-status ${row.requirement === "Required" ? "is-warning" : row.requirement === "Optional" ? "is-neutral" : "is-inactive"}`}>
                                      {row.requirement}
                                    </span>
                                  </td>
                                  <td>
                                    <select
                                      className="select venue-preview-inlineSelect"
                                      value={row.override || "__auto__"}
                                      onChange={(e) => {
                                        const next = e.target.value;
                                        setHeaderOverrides((current) => {
                                          const updated = { ...current };
                                          if (next === "__auto__") delete updated[row.sourceHeader];
                                          else updated[row.sourceHeader] = next as VenueImportHeaderOverride;
                                          return updated;
                                        });
                                      }}
                                    >
                                      <option value="__auto__">Auto-detect</option>
                                      <option value="ignore">Ignore column</option>
                                      {canonicalFieldOptions.map((field) => (
                                        <option key={field} value={field}>{field}</option>
                                      ))}
                                    </select>
                                  </td>
                                  <td className="venue-preview-cellMeta">{row.sampleValue}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </Panel>
                    <Panel className="panel-tight venue-preview-panel">
                      <div className="venue-preview-head">
                        <div>
                          <div className="venue-preview-title">Validation Issues</div>
                          <div className="venue-preview-sub">Resolve row-level issues before importing records.</div>
                        </div>
                      </div>
                      {!result ? (
                        <div className="venue-preview-empty">Load a CSV to inspect validation issues.</div>
                      ) : result.issues.length === 0 ? (
                        <div className="venue-preview-empty venue-preview-empty-ok">No issues detected in this import preview.</div>
                      ) : (
                        <div className="venue-preview-issues">
                          {result.issues.map((issue, idx) => (
                            <div key={`${issue.rowNumber}_${issue.field || "general"}_${idx}`} className={`venue-preview-issue is-${issue.level}`}>
                              <div className="venue-preview-issueMeta">
                                <span className="venue-preview-issueLevel">{issue.level}</span>
                                <span className="venue-preview-issueRow">Row {issue.rowNumber}</span>
                                {issue.field ? <span className="venue-preview-issueField">{issue.field}</span> : null}
                              </div>
                              <div className="venue-preview-issueText">{issue.message}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </Panel>
                    <Panel className="panel-tight venue-preview-panel">
                      <div className="venue-preview-head">
                        <div>
                          <div className="venue-preview-title">Field Translation Layer</div>
                          <div className="venue-preview-sub">Review how source columns are being translated into the canonical inventory model.</div>
                        </div>
                      </div>
                      {!fieldMappings.length ? (
                        <div className="venue-preview-empty">Load a CSV to inspect header translation.</div>
                      ) : (
                        <div className="venue-preview-list">
                          {fieldMappings.map((mapping) => (
                            <div key={mapping.sourceHeader} className="venue-preview-row venue-preview-rowMapping">
                              <div>
                                <div className="venue-preview-rowTitle">{mapping.sourceHeader}</div>
                                <div className="venue-preview-rowSub">{mapping.override ? "Manual override applied" : "Source column"}</div>
                              </div>
                              <div className={`venue-preview-status ${mapping.canonicalField ? "is-ok" : "is-neutral"}`}>
                                {mapping.canonicalField || "Unmapped"}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </Panel>
                  </div>
                ) : null}

                {importStep === "review" ? (
                  <div className="venue-preview-reviewFlow">
                    <Panel className="panel-tight venue-preview-panel">
                      <div className="venue-preview-head">
                        <div>
                          <div className="venue-preview-title">Import Summary</div>
                          <div className="venue-preview-sub">Review the normalized inventory that will feed the venue.</div>
                        </div>
                      </div>
                      {result ? (
                        <div className="venue-preview-summary">
                          <div className="hero-summary">
                            <div className="hero-summaryCard hero-summaryCard-info"><div className="hero-summaryValue">{result.summary.validRowCount}</div><div className="hero-summaryLabel">Valid Rows</div></div>
                            <div className="hero-summaryCard hero-summaryCard-warning"><div className="hero-summaryValue">{result.summary.warningCount}</div><div className="hero-summaryLabel">Warnings</div></div>
                            <div className="hero-summaryCard hero-summaryCard-danger"><div className="hero-summaryValue">{result.summary.errorCount}</div><div className="hero-summaryLabel">Errors</div></div>
                            <div className="hero-summaryCard hero-summaryCard-success"><div className="hero-summaryValue">{result.summary.variantCount}</div><div className="hero-summaryLabel">Variants</div></div>
                          </div>
                        </div>
                      ) : (
                        <div className="venue-preview-empty">Load a CSV to generate a preview.</div>
                      )}
                    </Panel>
                    <Panel className="panel-tight venue-preview-panel">
                      <div className="venue-preview-head">
                        <div>
                          <div className="venue-preview-title">Normalized Rows</div>
                          <div className="venue-preview-sub">Inspect the parsed rows that will become venue inventory.</div>
                        </div>
                      </div>
                      {!filteredRecords.length ? (
                        <div className="venue-preview-empty">No normalized rows available yet.</div>
                      ) : (
                        <div className="table-wrap venue-preview-tableWrap">
                          <table className="data-table venue-preview-table">
                            <thead>
                              <tr>
                                <th>Inventory ID</th>
                                <th>Map</th>
                                <th>Variant</th>
                                <th>Unit #</th>
                                <th>Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {filteredRecords.slice(0, 12).map((record) => (
                                <tr key={record.recordKey}>
                                  <td className="venue-preview-cellStrong">{record.inventoryId}</td>
                                  <td className="venue-preview-cellMeta">{record.mapName}</td>
                                  <td className="venue-preview-cellMeta">{record.variantLabel}</td>
                                  <td className="venue-preview-cellMeta">{record.unitNumber || "—"}</td>
                                  <td><span className={`venue-preview-status ${record.isActive ? "is-ok" : "is-inactive"}`}>{record.isActive ? "Active" : "Inactive"}</span></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </Panel>
                    <div className="venue-preview-reviewGrid">
                      <Panel className="panel-tight venue-preview-panel">
                        <div className="venue-preview-head">
                          <div>
                            <div className="venue-preview-title">Detected Variants</div>
                            <div className="venue-preview-sub">Preview the grouped media variants produced by the import.</div>
                          </div>
                        </div>
                        {!groupedVariants.length ? (
                          <div className="venue-preview-empty">No variants detected yet.</div>
                        ) : (
                          <div className="venue-preview-list">
                            {groupedVariants.map((item) => (
                              <div key={item.label} className="venue-preview-row">
                                <div className="venue-preview-rowTitle">{item.label}</div>
                                <div className="venue-preview-rowStat">{item.total}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </Panel>
                      <Panel className="panel-tight venue-preview-panel">
                        <div className="venue-preview-head">
                          <div>
                            <div className="venue-preview-title">Import Risk Review</div>
                            <div className="venue-preview-sub">Catch patterns that may need operator attention before import.</div>
                          </div>
                        </div>
                        {!result ? (
                          <div className="venue-preview-empty">Load a CSV to inspect import risks.</div>
                        ) : importRisks.length === 0 ? (
                          <div className="venue-preview-empty venue-preview-empty-ok">No import-risk patterns detected in this preview.</div>
                        ) : (
                          <div className="venue-preview-issues">
                            {importRisks.map((risk) => (
                              <div key={risk.title} className={`venue-preview-issue is-${risk.tone}`}>
                                <div className="venue-preview-issueMeta">
                                  <span className="venue-preview-issueLevel">{risk.tone}</span>
                                </div>
                                <div className="venue-preview-issueText">
                                  <strong>{risk.title}.</strong> {risk.detail}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </Panel>
                    </div>
                  </div>
                ) : null}

                {importStep === "confirm" ? (
                  <div className="venue-preview-grid venue-preview-grid-importTop">
                    <Panel className="panel-tight venue-preview-panel">
                      <div className="venue-preview-head">
                        <div>
                          <div className="venue-preview-title">Ready to Import</div>
                          <div className="venue-preview-sub">Confirm the source, validation results, and normalized output before bringing data into the venue.</div>
                        </div>
                      </div>
                      <div className="venue-preview-summary">
                        <div className="venue-preview-kpiRow">
                          <div className="venue-preview-kpi"><span className="venue-preview-kpiLabel">Rows</span><span className="venue-preview-kpiValue">{result?.summary.validRowCount || 0}</span></div>
                          <div className="venue-preview-kpi"><span className="venue-preview-kpiLabel">Variants</span><span className="venue-preview-kpiValue">{result?.summary.variantCount || 0}</span></div>
                          <div className="venue-preview-kpi"><span className="venue-preview-kpiLabel">Maps</span><span className="venue-preview-kpiValue">{result?.summary.mapCount || 0}</span></div>
                        </div>
                        <div className="venue-preview-importPlan">
                          <div className="venue-preview-importPlanHead">
                            <div>
                              <div className="venue-preview-title">
                                {inventoryImportMode === "merge" ? "Merge import plan" : "Replace import plan"}
                              </div>
                              <div className="venue-preview-sub">
                                {inventoryImportMode === "merge"
                                  ? "Existing inventory IDs are updated, new IDs are added, and missing existing rows are retained."
                                  : "Current inventory and variants are replaced with the normalized rows from this file."}
                              </div>
                            </div>
                            <span className={`venue-preview-status ${inventoryImportMode === "merge" ? "is-ok" : "is-warning"}`}>
                              {inventoryImportMode === "merge" ? "Safe merge" : "Destructive replace"}
                            </span>
                          </div>
                          <div className="venue-preview-importPlanGrid">
                            <div><span>Updated</span><strong>{importPlan.updatedCount}</strong></div>
                            <div><span>Unchanged</span><strong>{importPlan.unchangedCount}</strong></div>
                            <div><span>Added</span><strong>{importPlan.addedCount}</strong></div>
                            <div><span>{inventoryImportMode === "merge" ? "Retained" : "Removed"}</span><strong>{inventoryImportMode === "merge" ? importPlan.retainedMissingCount : importPlan.replaceRemovalCount}</strong></div>
                            <div><span>Row mappings preserved</span><strong>{importPlan.rowMappingsPreserved}</strong></div>
                            <div><span>Variant mappings preserved</span><strong>{importPlan.variantMappingsPreserved}</strong></div>
                            <div><span>New variants</span><strong>{importPlan.newVariantCount}</strong></div>
                            <div><span>Orphan risk</span><strong>{importPlan.orphanedVariantCount}</strong></div>
                            <div><span>Unknown maps</span><strong>{importPlan.unknownMapCount}</strong></div>
                          </div>
                        </div>
                      </div>
                    </Panel>
                  </div>
                ) : null}

                {importStep === "results" ? (
                  <div className="venue-preview-reviewFlow">
                    {!importApplyResult ? (
                      <div className="venue-preview-empty">No completed import result is available yet.</div>
                    ) : (
                      <>
                        <Panel className="panel-tight venue-preview-panel venue-preview-importResultHero">
                          <div className="venue-preview-head">
                            <div>
                              <div className="venue-preview-title">Import Applied</div>
                              <div className="venue-preview-sub">
                                {importApplyResult.sourceLabel} · {new Date(importApplyResult.appliedAt).toLocaleString()} · {importApplyResult.importMode === "merge" ? "Merge update/add" : "Replace current inventory"}
                              </div>
                            </div>
                            <span className="venue-preview-status is-ok">Complete</span>
                          </div>
                          <div className="venue-preview-importPlanGrid venue-preview-importResultGrid">
                            <div><span>Rows processed</span><strong>{importApplyResult.importedCount}</strong></div>
                            <div><span>Added</span><strong>{importApplyResult.addedCount}</strong></div>
                            <div><span>Updated</span><strong>{importApplyResult.updatedCount}</strong></div>
                            <div><span>{importApplyResult.importMode === "merge" ? "Retained" : "Removed"}</span><strong>{importApplyResult.importMode === "merge" ? importApplyResult.retainedMissingCount : importApplyResult.plan.replaceRemovalCount}</strong></div>
                            <div><span>Variants active</span><strong>{importApplyResult.variantCount}</strong></div>
                            <div><span>New variants planned</span><strong>{importApplyResult.plan.newVariantCount}</strong></div>
                          </div>
                        </Panel>

                        <div className="venue-preview-reviewGrid">
                          <Panel className="panel-tight venue-preview-panel">
                            <div className="venue-preview-head">
                              <div>
                                <div className="venue-preview-title">Mapping Preservation</div>
                                <div className="venue-preview-sub">Product mappings remain untouched unless an import explicitly replaces them.</div>
                              </div>
                            </div>
                            <div className="venue-preview-importResultList">
                              <div>
                                <span>Row product mappings preserved</span>
                                <strong>{importApplyResult.preservedInventoryMappingCount}</strong>
                              </div>
                              <div>
                                <span>Variant product mappings preserved</span>
                                <strong>{importApplyResult.preservedVariantMappingCount}</strong>
                              </div>
                              <div>
                                <span>Existing variants reused</span>
                                <strong>{importApplyResult.plan.existingVariantsReused}</strong>
                              </div>
                              <div>
                                <span>Rows unchanged by merge plan</span>
                                <strong>{importApplyResult.plan.unchangedCount}</strong>
                              </div>
                            </div>
                          </Panel>

                          <Panel className="panel-tight venue-preview-panel">
                            <div className="venue-preview-head">
                              <div>
                                <div className="venue-preview-title">Follow-up Review</div>
                                <div className="venue-preview-sub">Items worth checking before using this inventory in production orders.</div>
                              </div>
                            </div>
                            {importApplyResult.risks.length || importApplyResult.orphanedVariantCount ? (
                              <div className="venue-preview-issues">
                                {importApplyResult.orphanedVariantCount ? (
                                  <div className="venue-preview-issue is-warning">
                                    <div className="venue-preview-issueMeta">
                                      <span className="venue-preview-issueLevel">warning</span>
                                    </div>
                                    <div className="venue-preview-issueText">
                                      <strong>Variant orphan check.</strong> {importApplyResult.orphanedVariantCount} existing variant{importApplyResult.orphanedVariantCount === 1 ? "" : "s"} no longer matched the resulting inventory set.
                                    </div>
                                  </div>
                                ) : null}
                                {importApplyResult.risks.map((risk) => (
                                  <div key={risk.title} className={`venue-preview-issue is-${risk.tone}`}>
                                    <div className="venue-preview-issueMeta">
                                      <span className="venue-preview-issueLevel">{risk.tone}</span>
                                    </div>
                                    <div className="venue-preview-issueText">
                                      <strong>{risk.title}.</strong> {risk.detail}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="venue-preview-empty venue-preview-empty-ok">No follow-up warnings were detected for this import.</div>
                            )}
                          </Panel>
                        </div>

                        <Panel className="panel-tight venue-preview-panel">
                          <div className="venue-preview-head">
                            <div>
                              <div className="venue-preview-title">Before / After Plan</div>
                              <div className="venue-preview-sub">The import used the reviewed plan below, then reconciled inventory and media variants.</div>
                            </div>
                          </div>
                          <div className="venue-preview-importPlanGrid">
                            <div><span>Incoming rows</span><strong>{importApplyResult.plan.incomingCount}</strong></div>
                            <div><span>Matched existing</span><strong>{importApplyResult.plan.matchedCount}</strong></div>
                            <div><span>Planned updates</span><strong>{importApplyResult.plan.updatedCount}</strong></div>
                            <div><span>Planned adds</span><strong>{importApplyResult.plan.addedCount}</strong></div>
                            <div><span>Missing existing retained</span><strong>{importApplyResult.plan.retainedMissingCount}</strong></div>
                            <div><span>Unknown maps blocked</span><strong>{importApplyResult.plan.unknownMapCount}</strong></div>
                          </div>
                        </Panel>
                      </>
                    )}
                  </div>
                ) : null}
              </div>

              <div className="venue-preview-modalFoot">
                {importStep === "results" ? (
                  <>
                    <span className="venue-preview-cellMeta">Inventory has been reloaded from the backend.</span>
                    <div className="venue-preview-rowActions">
                      <button className="btn btn-ghost btn-soft" type="button" onClick={() => {
                        resetInventoryImportSource();
                        setImportStep("source");
                      }}>
                        Import Another
                      </button>
                      <button className="btn btn-primary" type="button" onClick={closeInventoryImportModal}>
                        Back to Inventory
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="venue-preview-rowActions">
                      <button className="btn btn-ghost btn-soft" type="button" onClick={closeInventoryImportModal}>
                        Close
                      </button>
                      {importStep !== "source" ? (
                        <button
                          className="btn btn-ghost btn-soft"
                          type="button"
                          onClick={() =>
                            setImportStep(importStep === "validate" ? "source" : importStep === "review" ? "validate" : "review")
                          }
                        >
                          Back
                        </button>
                      ) : null}
                    </div>
                    <button
                      className="btn btn-primary"
                      type="button"
                      onClick={() => {
                        if (importStep === "confirm") {
                          void confirmImport();
                          return;
                        }
                        setImportStep(importStep === "source" ? "validate" : importStep === "validate" ? "review" : "confirm");
                      }}
                      disabled={
                        importStep === "confirm"
                          ? !result?.records.length || result.summary.errorCount > 0 || importPlan.unknownMapCount > 0
                          : !parsedRows.length
                      }
                    >
                      {importStep === "confirm"
                        ? inventoryImportMode === "merge"
                          ? "Confirm Merge"
                          : "Confirm Replace"
                        : "Next"}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        ) : null}
        {presetEditor && activeVenue ? (
          <InventoryScopeModal
            isOpen={!!presetEditor}
            onClose={() => {
              setPresetEditor(null);
              setPresetSaveError("");
            }}
            title={presetEditor.mode === "edit" ? "Edit Inventory Preset" : "New Inventory Preset"}
            subtitle={`${activeVenue.name} · ${presetEditor.mode === "edit" ? "Update reusable inventory selection" : "Create reusable inventory selection"}`}
            inventoryLabel="Preset Inventory"
            confirmLabel={presetEditor.mode === "edit" ? "Save Preset" : "Create Preset"}
            savingLabel="Saving Preset..."
            projectTitle={presetEditor.name || "Inventory preset"}
            venueName={activeVenue.name}
            maps={presetScopeMaps as any}
            inventory={presetScopeInventory as any}
            initialIncludedIds={
              presetEditor.preset?.includedIds ||
              presetScopeInventory.map((item) => item.recordId || item.id)
            }
            canConfirm={Boolean(presetEditor.name.trim())}
            validationMessage={presetSaveError}
            headerAddon={
              <div className="scope-addonGrid">
                <label className="venue-preview-field">
                  <span className="venue-preview-fieldLabel">Preset Name</span>
                  <input
                    className="field-input venue-preview-input"
                    value={presetEditor.name}
                    onChange={(event) => setPresetEditor((current) => current ? { ...current, name: event.target.value } : current)}
                    placeholder="Winter Inventory"
                  />
                </label>
                <label className="venue-preview-field">
                  <span className="venue-preview-fieldLabel">Description</span>
                  <input
                    className="field-input venue-preview-input"
                    value={presetEditor.description}
                    onChange={(event) => setPresetEditor((current) => current ? { ...current, description: event.target.value } : current)}
                    placeholder="Optional internal/customer note"
                  />
                </label>
              </div>
            }
            onConfirm={savePresetFromSelection}
          />
        ) : null}
      </div>
    </AppShell>
  );
}
