import type {
  ApiAllocationOverrideInventoryItem,
  ApiAllocationOverrideResponse,
  ApiAllocationOverrideRow,
} from "../api/projects";
import type { Creative as DomainCreative, Assignment as DomainAssignment, InventoryItem as DomainInventoryItem, ProjectScope } from "../domain/types";

export function hasActiveAllocationOverrides(response: ApiAllocationOverrideResponse | null | undefined) {
  return !!response && response.override.rows.some((row) => !row.hidden);
}

export function getActiveAllocationOverrideRows(response: ApiAllocationOverrideResponse | null | undefined) {
  return (response?.override.rows || []).filter((row) => !row.hidden);
}

export function buildAllocationOverrideDomain(response: ApiAllocationOverrideResponse): {
  rows: ApiAllocationOverrideRow[];
  inventory: DomainInventoryItem[];
  creatives: DomainCreative[];
  assignments: DomainAssignment[];
  scope: ProjectScope;
  inventoryDisplayIdById: Map<string, string>;
} {
  const rows = getActiveAllocationOverrideRows(response);
  const assignedIds = new Set(rows.flatMap((row) => row.assignedInventoryIds || []));
  const sourceInventory = response.workspace.inventory.filter((item) => assignedIds.has(item.recordId || item.id));
  const inventoryDisplayIdById = new Map<string, string>();

  const inventory: DomainInventoryItem[] = sourceInventory.map((item: ApiAllocationOverrideInventoryItem) => {
    const recordId = item.recordId || item.id;
    inventoryDisplayIdById.set(recordId, item.id);
    return {
      id: recordId,
      venueId: response.project.venueId,
      locationId: item.mapId,
      mediaVariantKey: item.mediaVariantKey,
      unitNumber: item.unitNumber || "",
      x: item.x,
      y: item.y,
      isActive: item.isActive !== false,
    };
  });

  const creatives: DomainCreative[] = rows.map((row) => ({
    id: row.id,
    projectId: response.project.id,
    filename: row.asset.filename,
    fileMeta: `${row.productLabel}${row.dimensionsLabel ? ` · ${row.dimensionsLabel}` : ""}`,
    mediaVariantKey: row.mediaVariantKey,
    color: "#2563eb",
    thumbUrl: row.asset.thumbUrl || row.asset.fullUrl || "",
    fullUrl: row.asset.fullUrl || row.asset.thumbUrl || "",
    createdAt: row.createdAt,
  }));

  const assignments: DomainAssignment[] = [];
  rows.forEach((row) => {
    row.assignedInventoryIds.forEach((inventoryId) => {
      assignments.push({
        projectId: response.project.id,
        inventoryId,
        creativeId: row.id,
        updatedAt: row.updatedAt,
      });
    });
  });

  return {
    rows,
    inventory,
    creatives,
    assignments,
    scope: { includedIds: inventory.map((item) => item.id) },
    inventoryDisplayIdById,
  };
}
