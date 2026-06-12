import type {
  InventoryImportDraft,
  InventoryImportResult,
  NormalizeInventoryImportOptions,
  VenueImportCanonicalField,
  VenueImportHeaderOverride,
  VenueImportIssue,
} from "./types";

const CANONICAL_FIELD_ALIASES: Record<string, VenueImportCanonicalField> = {
  customername: "CustomerName",
  tenantname: "CustomerName",
  "tenant name": "CustomerName",
  venuename: "VenueName",
  "venue name": "VenueName",
  roomname: "MapName",
  "room name": "MapName",
  mapname: "MapName",
  "map name": "MapName",
  unitsku: "UnitNumber",
  "unit sku": "UnitNumber",
  unitnumber: "UnitNumber",
  "unit number": "UnitNumber",
  adspacekey: "InventoryID",
  "ad space key": "InventoryID",
  inventoryid: "InventoryID",
  "inventory id": "InventoryID",
  media: "MediaType",
  mediatype: "MediaType",
  "media type": "MediaType",
  trimheight: "TrimHeight",
  "trim height": "TrimHeight",
  trimwidth: "TrimWidth",
  "trim width": "TrimWidth",
  safeareaheight: "SafeHeight",
  "safe area height": "SafeHeight",
  safeheight: "SafeHeight",
  "safe height": "SafeHeight",
  safeareawidth: "SafeWidth",
  "safe area width": "SafeWidth",
  safewidth: "SafeWidth",
  "safe width": "SafeWidth",
  substrate: "Substrate",
  finishing: "Finishing",
  location: "LocationDetail",
  locationdetail: "LocationDetail",
  "location detail": "LocationDetail",
  specialinstructions: "Notes",
  "special instructions": "Notes",
  addlinfo: "Notes",
  "addl info": "Notes",
  notes: "Notes",
  dpi: "DPI",
  bleed_top: "Bleed_Top",
  bleedright: "Bleed_Right",
  bleed_right: "Bleed_Right",
  bleedbot: "Bleed_Bot",
  bleed_bot: "Bleed_Bot",
  bleedleft: "Bleed_Left",
  bleed_left: "Bleed_Left",
  active: "Active",
  activeflag: "Active",
  "active flag": "Active",
};

export const REQUIRED_FIELDS: VenueImportCanonicalField[] = [
  "CustomerName",
  "VenueName",
  "MapName",
  "InventoryID",
  "MediaType",
  "Active",
];

const CANONICAL_HEADERS: VenueImportCanonicalField[] = [
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

function normalizeHeader(value: string) {
  return (value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, " ");
}

export function resolveCanonicalField(
  header: string,
  headerOverrides?: Partial<Record<string, VenueImportHeaderOverride>>
): VenueImportCanonicalField | null {
  const override = headerOverrides?.[header];
  if (override === "ignore") return null;
  if (override) return override;

  const normalizedKey = normalizeHeader(header);
  return CANONICAL_FIELD_ALIASES[normalizedKey.replace(/\s+/g, "")] || CANONICAL_FIELD_ALIASES[normalizedKey] || null;
}

export function isRequiredCanonicalField(field: VenueImportCanonicalField) {
  return REQUIRED_FIELDS.includes(field);
}

function parseMaybeNumber(raw: string, args: { rowNumber: number; field: string; issues: VenueImportIssue[] }) {
  const value = (raw || "").trim();
  if (!value) return null;
  const num = Number(value);
  if (Number.isFinite(num)) return num;
  args.issues.push({
    level: "error",
    code: "invalid_number",
    rowNumber: args.rowNumber,
    field: args.field,
    message: `${args.field} must be numeric when provided.`,
  });
  return null;
}

function parseActive(raw: string, rowNumber: number, issues: VenueImportIssue[]) {
  const value = (raw || "").trim().toLowerCase();
  if (!value) {
    issues.push({
      level: "error",
      code: "invalid_active",
      rowNumber,
      field: "Active",
      message: "Active is required and must be Y/N, TRUE/FALSE, or 1/0.",
    });
    return false;
  }

  if (["y", "yes", "true", "1", "active"].includes(value)) return true;
  if (["n", "no", "false", "0", "inactive"].includes(value)) return false;

  issues.push({
    level: "error",
    code: "invalid_active",
    rowNumber,
    field: "Active",
    message: `Active value "${raw}" is not supported.`,
  });
  return false;
}

function buildVariantKey(mediaType: string, trimHeight: number | null, trimWidth: number | null) {
  const h = trimHeight == null ? "" : trimHeight;
  const w = trimWidth == null ? "" : trimWidth;
  return `${mediaType}||${h}||${w}`;
}

function buildVariantLabel(mediaType: string, trimHeight: number | null, trimWidth: number | null) {
  if (trimHeight == null || trimWidth == null) return mediaType;
  return `${mediaType} • ${trimHeight}"h × ${trimWidth}"w`;
}

function canonicalizeRow(
  row: Record<string, string>,
  rowNumber: number,
  issues: VenueImportIssue[],
  allowUnknownFields: boolean,
  headerOverrides?: Partial<Record<string, VenueImportHeaderOverride>>
) {
  const canonical: Partial<Record<VenueImportCanonicalField, string>> = {};

  for (const [key, value] of Object.entries(row)) {
    const canonicalKey = resolveCanonicalField(key, headerOverrides);

    if (!canonicalKey) {
      if (!allowUnknownFields && (value || "").trim()) {
        issues.push({
          level: "warning",
          code: "unknown_field",
          rowNumber,
          field: key,
          message: `Field "${key}" is not part of the current canonical import model.`,
        });
      }
      continue;
    }

    canonical[canonicalKey] = (value || "").trim();
  }

  return canonical;
}

export function parseCsvText(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let current = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "," && !inQuotes) {
      row.push(current);
      current = "";
      continue;
    }

    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && next === "\n") i += 1;
      row.push(current);
      rows.push(row);
      row = [];
      current = "";
      continue;
    }

    current += ch;
  }

  if (current.length > 0 || row.length > 0) {
    row.push(current);
    rows.push(row);
  }

  if (rows.length === 0) return [];

  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((values) => {
    const out: Record<string, string> = {};
    headers.forEach((header, idx) => {
      out[header] = values[idx] ?? "";
    });
    return out;
  });
}

export function normalizeInventoryImportRows(
  rows: Record<string, string>[],
  options: NormalizeInventoryImportOptions = {}
): InventoryImportResult {
  const issues: VenueImportIssue[] = [];
  const records: InventoryImportDraft[] = [];
  const inactiveVisibilityMode = options.inactiveVisibilityMode ?? "hidden";
  const allowUnknownFields = options.allowUnknownFields ?? false;
  const headerOverrides = options.headerOverrides;
  const seenRecordKeys = new Set<string>();

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const rawValues = Object.values(row).map((v) => (v || "").trim());

    if (rawValues.every((v) => !v)) {
      issues.push({
        level: "warning",
        code: "blank_row",
        rowNumber,
        message: "Blank row ignored.",
      });
      return;
    }

    const canonical = canonicalizeRow(row, rowNumber, issues, allowUnknownFields, headerOverrides);

    const missing = REQUIRED_FIELDS.filter((field) => !(canonical[field] || "").trim());
    if (missing.length > 0) {
      missing.forEach((field) => {
        issues.push({
          level: "error",
          code: "missing_required",
          rowNumber,
          field,
          message: `${field} is required.`,
        });
      });
      return;
    }

    const customerName = canonical.CustomerName!.trim();
    const venueName = canonical.VenueName!.trim();
    const mapName = canonical.MapName!.trim();
    const inventoryId = canonical.InventoryID!.trim();
    const mediaType = canonical.MediaType!.trim();
    const recordKey = `${customerName}||${venueName}||${inventoryId}`.toLowerCase();

    if (seenRecordKeys.has(recordKey)) {
      issues.push({
        level: "error",
        code: "duplicate_inventory_id",
        rowNumber,
        field: "InventoryID",
        message: `InventoryID "${inventoryId}" is duplicated within this venue import.`,
      });
      return;
    }
    seenRecordKeys.add(recordKey);

    const trimHeight = parseMaybeNumber(canonical.TrimHeight || "", { rowNumber, field: "TrimHeight", issues });
    const trimWidth = parseMaybeNumber(canonical.TrimWidth || "", { rowNumber, field: "TrimWidth", issues });
    const safeHeight = parseMaybeNumber(canonical.SafeHeight || "", { rowNumber, field: "SafeHeight", issues });
    const safeWidth = parseMaybeNumber(canonical.SafeWidth || "", { rowNumber, field: "SafeWidth", issues });
    const dpi = parseMaybeNumber(canonical.DPI || "", { rowNumber, field: "DPI", issues });
    const bleedTop = parseMaybeNumber(canonical.Bleed_Top || "", { rowNumber, field: "Bleed_Top", issues });
    const bleedRight = parseMaybeNumber(canonical.Bleed_Right || "", { rowNumber, field: "Bleed_Right", issues });
    const bleedBottom = parseMaybeNumber(canonical.Bleed_Bot || "", { rowNumber, field: "Bleed_Bot", issues });
    const bleedLeft = parseMaybeNumber(canonical.Bleed_Left || "", { rowNumber, field: "Bleed_Left", issues });
    const isActive = parseActive(canonical.Active || "", rowNumber, issues);

    const hasRowErrors = issues.some((issue) => issue.level === "error" && issue.rowNumber === rowNumber);
    if (hasRowErrors) return;

    records.push({
      rowNumber,
      customerName,
      venueName,
      mapName,
      inventoryId,
      recordKey,
      mediaType,
      mediaVariantKey: buildVariantKey(mediaType, trimHeight, trimWidth),
      variantLabel: buildVariantLabel(mediaType, trimHeight, trimWidth),
      unitNumber: (canonical.UnitNumber || "").trim() || undefined,
      trimHeight,
      trimWidth,
      safeHeight,
      safeWidth,
      substrate: (canonical.Substrate || "").trim() || undefined,
      finishing: (canonical.Finishing || "").trim() || undefined,
      locationDetail: (canonical.LocationDetail || "").trim() || undefined,
      notes: (canonical.Notes || "").trim() || undefined,
      dpi,
      bleedTop,
      bleedRight,
      bleedBottom,
      bleedLeft,
      isActive,
      mapVisibilityMode: isActive ? "hidden" : inactiveVisibilityMode,
      sourceRow: row,
    });
  });

  const mapCount = new Set(records.map((r) => r.mapName)).size;
  const variantCount = new Set(records.map((r) => r.mediaVariantKey)).size;
  const activeCount = records.filter((r) => r.isActive).length;
  const inactiveCount = records.length - activeCount;

  return {
    records,
    issues,
    canonicalHeaders: CANONICAL_HEADERS,
    summary: {
      rowCount: rows.length,
      validRowCount: records.length,
      errorCount: issues.filter((i) => i.level === "error").length,
      warningCount: issues.filter((i) => i.level === "warning").length,
      mapCount,
      variantCount,
      activeCount,
      inactiveCount,
    },
  };
}
