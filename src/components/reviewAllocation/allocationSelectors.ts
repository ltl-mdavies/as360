// src/components/reviewAllocation/allocationSelectors.ts
// ------------------------------------------------------
// UI selector layer (pre-store).
// Keeps the modal & TA page working with current mock state
// (CreativeAsset + InventoryItem from logic/mockAssignment).
// Later, in Phase 4.2, UI will read from canonical store and
// switch to domain selectors.
// ------------------------------------------------------

import type { CreativeAsset, InventoryItem, MapLayer } from "../../logic/mockAssignment";
import { mediaLabelFromKey } from "../../logic/mockAssignment";
import { resolveCreativeColor } from "../../logic/creativeColors";

export type AllocationCompleteness = {
  scopeTotal: number;
  scopeAssigned: number;
  isComplete: boolean;
  unassignedIds: string[];
};

export type AllocationCreativeRow = {
  creativeId: string;
  filename: string;
  fileMeta: string;
  color: string;
  mediaVariantKey: string;
  assignedIds: string[];
  assignedCount: number;
  isAssignedToAny: boolean;
};

export type AllocationVariantSection = {
  variantKey: string;
  label: string;
  totalInventoryForVariant: number;
  assignedInventoryForVariant: number;
  creatives: AllocationCreativeRow[];
  hasNoCreatives: boolean;
};

export type MapSummaryRow = {
  mapId: string;
  mapName: string;
  assigned: number;
  total: number;
  isComplete: boolean;
};

export type VariantSummaryRow = {
  variantKey: string;
  label: string;
  assigned: number;
  total: number;
  isComplete: boolean;
};

export function buildAllocationCompleteness(inventory: InventoryItem[]): AllocationCompleteness {
  const unassigned = inventory.filter((i: any) => !i.assignedCreativeId).map((i: any) => i.id);
  const assigned = inventory.length - unassigned.length;

  return {
    scopeTotal: inventory.length,
    scopeAssigned: assigned,
    isComplete: unassigned.length === 0,
    unassignedIds: unassigned,
  };
}

export function buildVariantSections(
  creatives: CreativeAsset[],
  inventory: InventoryItem[],
  labelFromKey: (k: string) => string = mediaLabelFromKey
): AllocationVariantSection[] {
  const invByVariant = new Map<string, InventoryItem[]>();
  for (const inv of inventory as any[]) {
    const arr = invByVariant.get(inv.mediaVariantKey) ?? [];
    arr.push(inv);
    invByVariant.set(inv.mediaVariantKey, arr);
  }

  const creativesByVariant = new Map<string, CreativeAsset[]>();
  for (const c of creatives as any[]) {
    const arr = creativesByVariant.get(c.mediaVariantKey) ?? [];
    arr.push(c);
    creativesByVariant.set(c.mediaVariantKey, arr);
  }

  const allVariantKeys = Array.from(new Set([...invByVariant.keys(), ...creativesByVariant.keys()])).sort();

  return allVariantKeys.map((vk) => {
    const invList = invByVariant.get(vk) ?? [];
    const assignedInvCount = invList.filter((i: any) => !!i.assignedCreativeId).length;

    const creativeList = (creativesByVariant.get(vk) ?? []).slice().sort((a, b) => a.filename.localeCompare(b.filename));

    const rows: AllocationCreativeRow[] = creativeList.map((c: any) => ({
      creativeId: c.id,
      filename: c.filename,
      fileMeta: c.fileMeta,
      color: resolveCreativeColor(c),
      mediaVariantKey: c.mediaVariantKey,
      assignedIds: (c.assignedInventoryIds ?? []).slice().sort(),
      assignedCount: (c.assignedInventoryIds ?? []).length,
      isAssignedToAny: (c.assignedInventoryIds ?? []).length > 0,
    }));

    return {
      variantKey: vk,
      label: labelFromKey(vk),
      totalInventoryForVariant: invList.length,
      assignedInventoryForVariant: assignedInvCount,
      creatives: rows,
      hasNoCreatives: rows.length === 0,
    };
  });
}

export function buildMapSummary(maps: MapLayer[], inventory: InventoryItem[]): MapSummaryRow[] {
  return maps.map((m: any) => {
    const inv = (inventory as any[]).filter((i) => i.mapId === m.id);
    const assigned = inv.filter((i) => !!i.assignedCreativeId).length;
    const total = inv.length || m.total;

    return {
      mapId: m.id,
      mapName: m.name,
      assigned,
      total,
      isComplete: total > 0 && assigned === total,
    };
  });
}

export function buildVariantSummary(
  inventory: InventoryItem[],
  labelFromKey: (k: string) => string = mediaLabelFromKey
): VariantSummaryRow[] {
  const counts = new Map<string, { total: number; assigned: number }>();

  for (const inv of inventory as any[]) {
    const cur = counts.get(inv.mediaVariantKey) ?? { total: 0, assigned: 0 };
    cur.total += 1;
    if (inv.assignedCreativeId) cur.assigned += 1;
    counts.set(inv.mediaVariantKey, cur);
  }

  return Array.from(counts.entries())
    .map(([variantKey, c]) => ({
      variantKey,
      label: labelFromKey(variantKey),
      assigned: c.assigned,
      total: c.total,
      isComplete: c.total > 0 && c.assigned === c.total,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/* ---------- Inventory List tab rows ---------- */

export type InventoryListRow = {
  inventoryId: string;
  mapId: string;
  mapName?: string;

  mediaVariantKey: string;
  mediaLabel: string;

  isActive: boolean;
  isInScope: boolean;

  assignedCreativeId: string | null;
  assignedFilename?: string;
  assignedFileMeta?: string;
  assignedColor?: string;
};

export function buildInventoryListRows(args: {
  inventory: InventoryItem[];
  creatives: CreativeAsset[];
  mapNameById?: Record<string, string>;
  isActiveById?: Record<string, boolean>;
  isInScopeById?: Record<string, boolean>;
  labelFromKey?: (k: string) => string;
}): InventoryListRow[] {
  const { inventory, creatives, mapNameById, isActiveById, isInScopeById } = args;
  const labelFn = args.labelFromKey ?? mediaLabelFromKey;

  const creativeById = new Map<string, CreativeAsset>();
  (creatives as any[]).forEach((c) => creativeById.set(c.id, c));

  const rows: InventoryListRow[] = (inventory as any[]).map((inv) => {
    const c = inv.assignedCreativeId ? creativeById.get(inv.assignedCreativeId) : undefined;

    const isActive = isActiveById ? !!isActiveById[inv.id] : true;
    const isInScope = isInScopeById ? !!isInScopeById[inv.id] : isActive;

    return {
      inventoryId: inv.id,
      mapId: inv.mapId,
      mapName: mapNameById?.[inv.mapId],

      mediaVariantKey: inv.mediaVariantKey,
      mediaLabel: labelFn(inv.mediaVariantKey),

      isActive,
      isInScope,

      assignedCreativeId: inv.assignedCreativeId || null,
      assignedFilename: c?.filename,
      assignedFileMeta: c?.fileMeta,
      assignedColor: c?.color,
    };
  });

  rows.sort((a, b) => {
    if (a.mapId !== b.mapId) return a.mapId.localeCompare(b.mapId);
    return a.inventoryId.localeCompare(b.inventoryId);
  });

  return rows;
}
