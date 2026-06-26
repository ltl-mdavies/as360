import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import AppShell from "../../app/AppShell";
import { useApiClient } from "../../api/useApiClient";
import { fetchCustomerSettings, type ApiCustomerVendor, type ApiShippingDestination, type ApiVenueInventoryPreset } from "../../api/projects";
import Panel from "../../components/common/Panel";
import PageHeader from "../../components/common/PageHeader";
import InventoryScopeModal from "../../components/projects/InventoryScopeModal";
import { useSharedMapWorkspace } from "../../components/maps/useSharedMapWorkspace";
import { mockMaps } from "../../logic/mockAssignment";
import {
  isRequiredCanonicalField,
  normalizeInventoryImportRows,
  parseCsvText,
  resolveCanonicalField,
} from "../../domain/venueBuilder/inventoryImport";
import type { VenueImportCanonicalField, VenueImportHeaderOverride } from "../../domain/venueBuilder/types";
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
type ImportStep = "source" | "validate" | "review" | "confirm";
type VariantAppearance = {
  color: string;
  abbreviation?: string;
  unitNumber?: string;
  productionRouting?: "primary" | "external";
  externalVendorId?: string;
};
type LiveVenueVariant = {
  id: string;
  mediaVariantKey: string;
  label: string;
  mediaType?: string;
  color?: string;
  abbreviation?: string;
  unitNumber?: string;
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
type PresetEditorState = {
  mode: "create" | "edit";
  preset?: ApiVenueInventoryPreset;
  name: string;
  description: string;
};

const PROFILE_STORAGE_KEY = "adspace360.venue-import-profiles";
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
  const [venueInventoryPresets, setVenueInventoryPresets] = useState<ApiVenueInventoryPreset[]>([]);
  const [presetEditor, setPresetEditor] = useState<PresetEditorState | null>(null);
  const [presetSaveError, setPresetSaveError] = useState("");
  const [vendorPicker, setVendorPicker] = useState<VendorPickerState | null>(null);
  const [vendorSearch, setVendorSearch] = useState("");
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
  const [showImportModal, setShowImportModal] = useState(false);
  const [importStep, setImportStep] = useState<ImportStep>("source");
  const [inventoryEditMode, setInventoryEditMode] = useState(false);
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
  const [rowSearch, setRowSearch] = useState("");
  const [mapFilter, setMapFilter] = useState("all");
  const [variantFilter, setVariantFilter] = useState("all");
  const [activityFilter, setActivityFilter] = useState<"all" | "active" | "inactive">("all");
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

  const loadVenueDetailData = useCallback(
    async (venueId: string) => {
      if (!venueId) {
        setRooms([]);
        setLiveVenueInventory([]);
        setVenueInventoryPresets([]);
        return;
      }

      try {
        const response = await request<{ venue: any; maps: any[]; variants: any[]; inventory: any[]; presets?: ApiVenueInventoryPreset[] }>(`/api/venues/${venueId}`);

        setRooms((response.maps || []).map(mapRoomRecordFromApi));
        setLiveVenueVariants(response.variants || []);
        setLiveVenueInventory(response.inventory || []);
        setVenueInventoryPresets(response.presets || []);
        setVariantAppearanceOverrides(() => {
          const next: Record<string, VariantAppearance> = {};
          (response.variants || []).forEach((variant: any) => {
            next[variant.mediaVariantKey] = {
              color: variant.color || variantPalette[0],
              abbreviation: variant.abbreviation || buildVariantAbbreviation(variant.label),
              unitNumber: variant.unitNumber,
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
      } catch (error) {
        setApiError(error instanceof Error ? error.message : "Unable to load venue detail");
      }
    },
    [request]
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

  const isDetailMode = Boolean(detailVenueId && venues.some((venue) => venue.id === detailVenueId));
  const projectsPath = "/customer/projects";

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
    setSelectedRecordKeys([]);
  }, [selectedVenueId, detailTab]);

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
      return parseCsvText(effectiveCsvText);
    } catch {
      return [];
    }
  }, [effectiveCsvText]);

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

  const rowIssueCounts = useMemo(() => {
    if (!result) return new Map<number, number>();
    const counts = new Map<number, number>();
    result.issues.forEach((issue) => {
      counts.set(issue.rowNumber, (counts.get(issue.rowNumber) || 0) + 1);
    });
    return counts;
  }, [result]);

  const filteredRecords = useMemo(() => {
    if (!effectiveRecords.length) return [];
    const query = rowSearch.trim().toLowerCase();

    return effectiveRecords.filter((record) => {
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
  }, [activityFilter, customerVendorsById, effectiveRecords, mapFilter, rowSearch, variantFilter, liveVenueVariants, variantAppearanceOverrides]);
  const hasInventoryRows = effectiveRecords.length > 0;

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

    if (mapsWithInactive > 0) {
      risks.push({
        title: "Maps with mixed availability",
        detail: `${mapsWithInactive} maps contain inactive rows, which may affect pin visibility and total counters.`,
        tone: "info",
      });
    }

    return risks;
  }, [groupedMaps, result]);

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
      }
    >();
    effectiveRecords.forEach((record, index) => {
      const existing = counts.get(record.mediaVariantKey);
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
        });
        return;
      }
      existing.total += 1;
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
    return Array.from(counts.values());
  }, [effectiveRecords, liveVenueVariantByKey, variantAppearanceOverrides]);

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

  const recordIssueDetailsByKey = useMemo(() => {
    const issues = new Map<string, string[]>();

    effectiveRecords.forEach((record) => {
      const rowIssues: string[] = [];
      if (!String(record.unitNumber || "").trim()) {
        rowIssues.push("Missing unit number. Lift order posting depends on a valid unit number.");
      }
      if (rowIssues.length) issues.set(record.recordKey, rowIssues);
    });

    return issues;
  }, [effectiveRecords]);

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
        "name" | "marketId" | "documentSourceMode" | "documentLibraryUrl" | "shippingDestinationOverrideEnabled" | "shippingDestination" | "isActive"
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
      await request(`/api/venues/${activeVenue.id}/inventory/import`, {
        method: "POST",
        body: JSON.stringify({
          replaceExisting: true,
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
      setCsvText("");
      setSourceLabel("No file loaded");
      setLoadTone("idle");
      setHeaderOverrides({});
      setShowImportModal(false);
      setImportStep("source");
      await loadVenueDashboardData();
      await loadVenueDetailData(activeVenue.id);
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
                <div className="venue-preview-detailTabs">
                  <button
                    type="button"
                    className={`venue-preview-detailTab ${detailTab === "setup" ? "is-active" : ""}`}
                    onClick={() => setDetailTab("setup")}
                  >
                    Venue Setup
                  </button>
                  <button
                    type="button"
                    className={`venue-preview-detailTab ${detailTab === "inventory" ? "is-active" : ""}`}
                    onClick={() => setDetailTab("inventory")}
                  >
                    Inventory Management
                  </button>
                  <button
                    type="button"
                    className={`venue-preview-detailTab ${detailTab === "placement" ? "is-active" : ""}`}
                    onClick={() => setDetailTab("placement")}
                  >
                    Map Placement
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
                  <button className="btn btn-primary venue-preview-importCta" type="button" onClick={() => { setImportStep("source"); setShowImportModal(true); }}>
                    Import Venue Inventory
                  </button>
                  <button
                    className={`btn ${inventoryEditMode ? "btn-primary" : "btn-ghost btn-soft"}`}
                    type="button"
                    onClick={() => setInventoryEditMode((current) => !current)}
                  >
                    {inventoryEditMode ? "Lock Inventory" : "Unlock Inventory"}
                  </button>
                </div>
              </div>

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
                      <button className="btn btn-ghost btn-soft" type="button" onClick={() => applyBulkRecordPatch({ isActive: true })} disabled={!selectedRecordKeys.length}>
                        Mark Active
                      </button>
                      <button className="btn btn-ghost btn-soft" type="button" onClick={() => applyBulkRecordPatch({ isActive: false })} disabled={!selectedRecordKeys.length}>
                        Mark Inactive
                      </button>
                      <button className="btn btn-ghost btn-soft" type="button" onClick={() => applyBulkRecordPatch({ mapVisibilityMode: "show_unavailable" })} disabled={!selectedRecordKeys.length}>
                        Show Unavailable
                      </button>
                      <button className="btn btn-ghost btn-soft" type="button" onClick={() => applyBulkRecordPatch({ mapVisibilityMode: "hidden" })} disabled={!selectedRecordKeys.length}>
                        Hide on Map
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
                        <button className="btn btn-ghost btn-soft" type="button" onClick={() => void deleteSelectedRows()} disabled={!selectedRecordKeys.length}>
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
                                const issueCount =
                                  (rowIssueCounts.get(record.rowNumber) || 0) +
                                  (recordIssueDetailsByKey.get(record.recordKey)?.length || 0);
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
                                      <input
                                        className="field-input venue-preview-input"
                                        value={record.unitNumber || ""}
                                        onChange={(e) => updateRecordOverride(record.recordKey, { unitNumber: e.target.value })}
                                        onBlur={(e) => void persistInventoryPatch(record.recordKey, { unitNumber: e.target.value })}
                                        placeholder="Unit number"
                                        disabled={!inventoryEditMode}
                                      />
                                      {record.unitNumberSource === "variant" ? (
                                        <div className="venue-preview-cellMeta venue-preview-cellMeta-inline">
                                          <span className="venue-preview-inlineBadge">Inherited</span>
                                        </div>
                                      ) : null}
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
                                        <span
                                          className="venue-preview-status is-warning"
                                          title={[
                                            ...(recordIssueDetailsByKey.get(record.recordKey) || []),
                                            ...(result?.issues
                                              .filter((issue) => issue.rowNumber === record.rowNumber)
                                              .map((issue) => issue.message) || []),
                                          ].join(" • ")}
                                        >
                                          {issueCount} issue{issueCount === 1 ? "" : "s"}
                                        </span>
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
                          <th>Color</th>
                          <th>Abbrev.</th>
                          <th>Routing</th>
                          <th>External Vendor</th>
                        </tr>
                      </thead>
                      <tbody>
                        {variantRows.map((variant, index) => {
                          const appearance = getVariantAppearance(variant.key, variant.label, index);
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
                                  </div>
                                </div>
                              </td>
                              <td className="venue-preview-cellStrong">{variant.total}</td>
                              <td>
                                <input
                                  className="field-input venue-preview-input"
                                  value={appearance.unitNumber || ""}
                                  onChange={(e) => updateVariantAppearance(variant.key, variant.label, { unitNumber: e.target.value })}
                                  onBlur={(e) => void persistVariantAppearance(variant, { unitNumber: e.target.value })}
                                  placeholder="Applies to all matching inventoryIDs"
                                  disabled={!inventoryEditMode}
                                />
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

        {showImportModal ? (
          <div className="venue-preview-modalScrim" onClick={() => setShowImportModal(false)}>
            <div className="venue-preview-modal" onClick={(e) => e.stopPropagation()}>
              <div className="venue-preview-modalHead">
                <div>
                  <div className="venue-preview-sectionEyebrow">Inventory Import</div>
                  <div className="venue-preview-sectionTitle">Bring inventory into {activeVenue?.name || "this venue"}</div>
                  <div className="venue-preview-sectionSub">
                    Upload or paste a sheet, validate translation, then confirm the import results before placement.
                  </div>
                </div>
                <button className="btn btn-ghost btn-soft" type="button" onClick={() => setShowImportModal(false)}>
                  Close
                </button>
              </div>

              <div className="venue-preview-modalSteps">
                {[
                  ["source", "1. Source"],
                  ["validate", "2. Validation"],
                  ["review", "3. Review"],
                  ["confirm", "4. Confirm"],
                ].map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className={`btn ${importStep === id ? "btn-primary" : "btn-ghost btn-soft"}`}
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
                        <button
                          className="btn btn-ghost btn-soft"
                          type="button"
                          onClick={() => {
                            setCsvText("");
                            setSourceLabel("No file loaded");
                            setLoadTone("idle");
                          }}
                        >
                          Clear
                        </button>
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
                        <div className="venue-preview-empty">
                          This import will replace the current venue inventory with the normalized rows above.
                        </div>
                      </div>
                    </Panel>
                  </div>
                ) : null}
              </div>

              <div className="venue-preview-modalFoot">
                <div className="venue-preview-rowActions">
                  <button className="btn btn-ghost btn-soft" type="button" onClick={() => setShowImportModal(false)}>
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
                  disabled={importStep !== "confirm" && !parsedRows.length}
                >
                  {importStep === "confirm" ? "Confirm Import" : "Next"}
                </button>
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
