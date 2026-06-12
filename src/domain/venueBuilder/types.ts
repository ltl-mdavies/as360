import type { InventoryMapVisibilityMode } from "../types/inventory";

export type VenueImportCanonicalField =
  | "CustomerName"
  | "VenueName"
  | "MapName"
  | "UnitNumber"
  | "InventoryID"
  | "MediaType"
  | "TrimHeight"
  | "TrimWidth"
  | "SafeHeight"
  | "SafeWidth"
  | "Substrate"
  | "Finishing"
  | "LocationDetail"
  | "Notes"
  | "DPI"
  | "Bleed_Top"
  | "Bleed_Right"
  | "Bleed_Bot"
  | "Bleed_Left"
  | "Active";

export type VenueImportHeaderOverride = VenueImportCanonicalField | "ignore";

export type VenueImportIssueLevel = "error" | "warning";

export type VenueImportIssueCode =
  | "missing_required"
  | "duplicate_inventory_id"
  | "invalid_number"
  | "invalid_active"
  | "unknown_field"
  | "blank_row";

export type VenueImportIssue = {
  level: VenueImportIssueLevel;
  code: VenueImportIssueCode;
  rowNumber: number;
  field?: string;
  message: string;
};

export type InventoryImportDraft = {
  rowNumber: number;
  customerName: string;
  venueName: string;
  mapName: string;
  inventoryId: string;
  recordKey: string;
  mediaType: string;
  mediaVariantKey: string;
  variantLabel: string;
  unitNumber?: string;
  trimHeight: number | null;
  trimWidth: number | null;
  safeHeight: number | null;
  safeWidth: number | null;
  substrate?: string;
  finishing?: string;
  locationDetail?: string;
  notes?: string;
  dpi: number | null;
  bleedTop: number | null;
  bleedRight: number | null;
  bleedBottom: number | null;
  bleedLeft: number | null;
  isActive: boolean;
  mapVisibilityMode: InventoryMapVisibilityMode;
  sourceRow: Record<string, string>;
};

export type InventoryImportSummary = {
  rowCount: number;
  validRowCount: number;
  errorCount: number;
  warningCount: number;
  mapCount: number;
  variantCount: number;
  activeCount: number;
  inactiveCount: number;
};

export type InventoryImportResult = {
  records: InventoryImportDraft[];
  issues: VenueImportIssue[];
  summary: InventoryImportSummary;
  canonicalHeaders: VenueImportCanonicalField[];
};

export type NormalizeInventoryImportOptions = {
  inactiveVisibilityMode?: InventoryMapVisibilityMode;
  allowUnknownFields?: boolean;
  headerOverrides?: Partial<Record<string, VenueImportHeaderOverride>>;
};
