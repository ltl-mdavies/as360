// src/domain/adapters/uiShapes.ts
import type { ProjectContext } from "../selectors/projectContext";
import type { CreativeAsset, InventoryItem } from "../../logic/mockAssignment";

/**
 * Convert canonical scoped+active inventory into the legacy UI inventory shape used by CreativeAssignmentPage + modals.
 */
export function toLegacyInventory(ctx: ProjectContext): InventoryItem[] {
  return (ctx.scopedActiveInventory as any[]).map((i) => ({
    id: i.id,
    mapId: i.locationId,
    mediaVariantKey: i.mediaVariantKey,
    unitNumber: i.unitNumber || "",
    x: i.x,
    y: i.y,
    assignedCreativeId: ctx.assignmentMap.get(i.id) ?? null,
  })) as any;
}

/**
 * Build creativeId -> assigned inventoryIds list from legacy inventory.
 */
export function buildAssignedInvIdsByCreative(legacyInventory: InventoryItem[]) {
  const m = new Map<string, string[]>();
  for (const inv of legacyInventory as any[]) {
    if (!inv.assignedCreativeId) continue;
    const arr = m.get(inv.assignedCreativeId) || [];
    arr.push(inv.id);
    m.set(inv.assignedCreativeId, arr);
  }
  for (const arr of m.values()) arr.sort();
  return m;
}

/**
 * Convert canonical creatives into legacy UI creative cards.
 * Optionally merges in demoStore creative objects to preserve thumbUrl/fullUrl produced by the uploader.
 */
export function toLegacyCreatives(args: {
  ctx: ProjectContext;
  legacyInventory: InventoryItem[];
  demoCreativesAll?: any[]; // optional: demoStore.creatives
}): CreativeAsset[] {
  const { ctx, legacyInventory, demoCreativesAll } = args;

  const assignedIds = buildAssignedInvIdsByCreative(legacyInventory);

  const demoById = new Map<string, any>();
  (demoCreativesAll || []).forEach((c) => demoById.set(c.id, c));

  return (ctx.creatives as any[]).map((c) => {
    const raw = demoById.get(c.id) || c;
    return {
      id: c.id,
      filename: c.filename,
      fileMeta: c.fileMeta,
      mediaVariantKey: c.mediaVariantKey,
      color: c.color,
      assignedInventoryIds: assignedIds.get(c.id) || [],
      thumbUrl: raw.thumbUrl,
      fullUrl: raw.fullUrl,
    };
  }) as any;
}
