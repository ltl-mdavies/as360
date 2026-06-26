// src/domain/selectors/allocationSelectors.ts
import type { Assignment, Creative, InventoryItem, ProjectScope } from "../types";
import { resolveCreativeColor } from "../../logic/creativeColors";

/**
 * Build a quick lookup: inventoryId -> creativeId (or null)
 */
export function buildAssignmentMap(assignments: Assignment[]) {
  const map = new Map<string, string | null>();
  for (const a of assignments) map.set(a.inventoryId, a.creativeId ?? null);
  return map;
}

/**
 * Scoped active inventory ids = active AND includedIds
 */
export function getScopedActiveInventoryIds(args: { inventory: InventoryItem[]; scope: ProjectScope }) {
  const included = new Set(args.scope.includedIds);
  return args.inventory.filter((i) => i.isActive && included.has(i.id)).map((i) => i.id);
}

/**
 * Completion: how many scoped-active items are assigned (creativeId != null)
 */
export function getAllocationCompleteness(args: {
  inventory: InventoryItem[];
  scope: ProjectScope;
  assignments: Assignment[];
}) {
  const scopedIds = new Set(getScopedActiveInventoryIds({ inventory: args.inventory, scope: args.scope }));
  const aMap = buildAssignmentMap(args.assignments);

  let required = 0;
  let assigned = 0;

  for (const invId of scopedIds) {
    required += 1;
    if (aMap.get(invId)) assigned += 1;
  }

  return {
    required,
    assigned,
    remaining: Math.max(0, required - assigned),
    isComplete: required > 0 ? assigned === required : true,
  };
}

/**
 * Allocation Details sections (grouped by mediaVariantKey).
 * Powers:
 * - Review Allocation → Allocation Details
 * - Transit Approval list view
 */
export type VariantSection = {
  variantKey: string;
  label: string;

  totalInventoryForVariant: number;     // scoped-active inventory for this variant
  assignedInventoryForVariant: number;  // scoped-active inventory assigned (any creative)

  hasNoCreatives: boolean;

  creatives: Array<{
    creativeId: string;
    filename: string;
    fileMeta: string;
    color: string;
    mediaVariantKey: string;

    assignedIds: string[];
    assignedCount: number;
  }>;
};

export function buildVariantSections(args: {
  creatives: Creative[];
  inventory: InventoryItem[];
  scope: ProjectScope;
  assignments: Assignment[];
  mediaLabelFromKey: (k: string) => string;
}): VariantSection[] {
  const { creatives, inventory, scope, assignments, mediaLabelFromKey } = args;

  const included = new Set(scope.includedIds);
  const aMap = buildAssignmentMap(assignments);

  // Scoped active inventory only counts toward totals
  const scopedActive = inventory.filter((i) => i.isActive && included.has(i.id));

  // Total by variant (scoped active)
  const totalByVariant = new Map<string, number>();
  for (const inv of scopedActive) {
    totalByVariant.set(inv.mediaVariantKey, (totalByVariant.get(inv.mediaVariantKey) || 0) + 1);
  }

  // Assigned by variant (scoped active)
  const assignedByVariant = new Map<string, number>();
  for (const inv of scopedActive) {
    const cid = aMap.get(inv.id);
    if (cid) assignedByVariant.set(inv.mediaVariantKey, (assignedByVariant.get(inv.mediaVariantKey) || 0) + 1);
  }

  // Group creatives by variantKey
  const creativesByVariant = new Map<string, Creative[]>();
  for (const c of creatives) {
    const arr = creativesByVariant.get(c.mediaVariantKey) || [];
    arr.push(c);
    creativesByVariant.set(c.mediaVariantKey, arr);
  }

  // Map creativeId -> assigned inventory IDs (scoped-active only)
  const assignedInvByCreative = new Map<string, string[]>();
  for (const inv of scopedActive) {
    const cid = aMap.get(inv.id);
    if (!cid) continue;
    const arr = assignedInvByCreative.get(cid) || [];
    arr.push(inv.id);
    assignedInvByCreative.set(cid, arr);
  }

  // Variant keys we care about: scoped inventory + uploaded creatives
  const variantKeys = new Set<string>();
  for (const inv of scopedActive) variantKeys.add(inv.mediaVariantKey);
  for (const c of creatives) variantKeys.add(c.mediaVariantKey);

  const sections: VariantSection[] = Array.from(variantKeys).map((vk) => {
    const cList = creativesByVariant.get(vk) || [];
    cList.sort((a, b) => a.filename.localeCompare(b.filename));

    return {
      variantKey: vk,
      label: mediaLabelFromKey(vk),

      totalInventoryForVariant: totalByVariant.get(vk) || 0,
      assignedInventoryForVariant: assignedByVariant.get(vk) || 0,

      hasNoCreatives: cList.length === 0,

      creatives: cList.map((c) => {
        const assignedIds = (assignedInvByCreative.get(c.id) || []).slice().sort();
        return {
          creativeId: c.id,
          filename: c.filename,
          fileMeta: c.fileMeta,
          color: resolveCreativeColor(c),
          mediaVariantKey: c.mediaVariantKey,
          assignedIds,
          assignedCount: assignedIds.length,
        };
      }),
    };
  });

  sections.sort((a, b) => a.label.localeCompare(b.label));
  return sections;
}

/**
 * Map overview (assigned/total per location)
 */
export type MapSummaryRow = {
  mapId: string;      // locationId
  mapName: string;
  assigned: number;   // scoped active assigned
  total: number;      // scoped active total
  isComplete: boolean;
};

export function buildMapSummary(args: {
  maps: Array<{ id: string; name: string }>; // maps here == venue locations
  inventory: InventoryItem[];
  scope: ProjectScope;
  assignments: Assignment[];
}): MapSummaryRow[] {
  const { maps, inventory, scope, assignments } = args;

  const included = new Set(scope.includedIds);
  const aMap = buildAssignmentMap(assignments);

  const byMap = new Map<string, { assigned: number; total: number }>();

  for (const inv of inventory) {
    if (!inv.isActive) continue;
    if (!included.has(inv.id)) continue;

    const cur = byMap.get(inv.locationId) || { assigned: 0, total: 0 };
    cur.total += 1;
    if (aMap.get(inv.id)) cur.assigned += 1;
    byMap.set(inv.locationId, cur);
  }

  return maps.map((m) => {
    const cur = byMap.get(m.id) || { assigned: 0, total: 0 };
    return {
      mapId: m.id,
      mapName: m.name,
      assigned: cur.assigned,
      total: cur.total,
      isComplete: cur.total > 0 ? cur.assigned === cur.total : true,
    };
  });
}

/**
 * Media overview (assigned/total per mediaVariantKey)
 */
export type VariantSummaryRow = {
  variantKey: string;
  label: string;
  assigned: number;
  total: number;
  isComplete: boolean;
};

export function buildVariantSummary(args: {
  inventory: InventoryItem[];
  scope: ProjectScope;
  assignments: Assignment[];
  mediaLabelFromKey: (k: string) => string;
}): VariantSummaryRow[] {
  const { inventory, scope, assignments, mediaLabelFromKey } = args;

  const included = new Set(scope.includedIds);
  const aMap = buildAssignmentMap(assignments);

  const byVar = new Map<string, { assigned: number; total: number }>();

  for (const inv of inventory) {
    if (!inv.isActive) continue;
    if (!included.has(inv.id)) continue;

    const cur = byVar.get(inv.mediaVariantKey) || { assigned: 0, total: 0 };
    cur.total += 1;
    if (aMap.get(inv.id)) cur.assigned += 1;
    byVar.set(inv.mediaVariantKey, cur);
  }

  const out = Array.from(byVar.entries()).map(([key, v]) => ({
    variantKey: key,
    label: mediaLabelFromKey(key),
    assigned: v.assigned,
    total: v.total,
    isComplete: v.total > 0 ? v.assigned === v.total : true,
  }));

  out.sort((a, b) => a.label.localeCompare(b.label));
  return out;
}

/**
 * Inventory List rows (for Review Allocation → Inventory List tab)
 * This is a project-scoped view (active ∩ includedIds), but can optionally include inactive later.
 */
export type InventoryListRow = {
  inventoryId: string;
  locationId: string;
  locationName?: string;

  mediaVariantKey: string;
  mediaLabel: string;

  isActive: boolean;
  isInScope: boolean; // active & included

  assignedCreativeId: string | null;
  assignedFilename?: string;
  assignedFileMeta?: string;
  assignedColor?: string;
};

export function buildInventoryListRows(args: {
  inventory: InventoryItem[];
  scope: ProjectScope;
  assignments: Assignment[];
  creatives: Creative[];

  locationNameById?: Record<string, string>;
  mediaLabelFromKey: (k: string) => string;
}): InventoryListRow[] {
  const { inventory, scope, assignments, creatives, locationNameById, mediaLabelFromKey } = args;

  const included = new Set(scope.includedIds);
  const aMap = buildAssignmentMap(assignments);

  const creativeById = new Map<string, Creative>();
  for (const c of creatives) creativeById.set(c.id, c);

  const rows: InventoryListRow[] = inventory
    .filter((inv) => inv.isActive && included.has(inv.id)) // scoped active only
    .map((inv) => {
      const cid = aMap.get(inv.id) ?? null;
      const c = cid ? creativeById.get(cid) : undefined;

      return {
        inventoryId: inv.id,
        locationId: inv.locationId,
        locationName: locationNameById?.[inv.locationId],

        mediaVariantKey: inv.mediaVariantKey,
        mediaLabel: mediaLabelFromKey(inv.mediaVariantKey),

        isActive: inv.isActive,
        isInScope: inv.isActive && included.has(inv.id),

        assignedCreativeId: cid,
        assignedFilename: c?.filename,
        assignedFileMeta: c?.fileMeta,
        assignedColor: c?.color,
      };
    });

  rows.sort((a, b) => {
    if (a.locationId !== b.locationId) return a.locationId.localeCompare(b.locationId);
    return a.inventoryId.localeCompare(b.inventoryId);
  });

  return rows;
}
