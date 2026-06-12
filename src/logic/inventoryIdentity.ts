import type { InventoryItem as DomainInventoryItem } from "../domain/types";
import type { InventoryItem as LegacyInventoryItem } from "./mockAssignment";

export function getInventoryStableId(item: Pick<LegacyInventoryItem, "id" | "recordId">) {
  return item.recordId || item.id;
}

export function getInventoryDisplayId(item: Pick<LegacyInventoryItem, "id"> & { displayId?: string }) {
  return item.displayId || item.id;
}

export function getInventoryLocationName(
  item: Pick<LegacyInventoryItem, "mapId" | "locationName">,
  locationNameById?: Record<string, string>
) {
  return item.locationName || locationNameById?.[item.mapId] || item.mapId;
}

export function toDomainInventoryFromLegacy(
  inventory: LegacyInventoryItem[],
  venueId = "venue_unknown"
): DomainInventoryItem[] {
  return inventory.map((item) => ({
    id: getInventoryStableId(item),
    venueId,
    locationId: item.mapId,
    mediaVariantKey: item.mediaVariantKey,
    unitNumber: item.unitNumber || "",
    x: item.x,
    y: item.y,
    isActive: item.isActive !== false,
  }));
}

export function buildInventoryDisplayIdMap(inventory: LegacyInventoryItem[]) {
  return new Map(inventory.map((item) => [getInventoryStableId(item), getInventoryDisplayId(item)]));
}
