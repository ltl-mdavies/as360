import type { InventoryItem, ProjectScope } from "../types";

export function getProjectScopedInventory(args: {
  inventory: InventoryItem[];
  scope: ProjectScope;
  showInactivePins?: boolean; // Intersection toggle later
}) {
  const { inventory, scope } = args;

  const included = new Set(scope.includedIds);

  const activeItems = inventory.filter((i) => i.isActive);
  const scopedActive = activeItems.filter((i) => included.has(i.id));

  // UI: optionally show inactive pins/list items (but never count them)
  const visibleForMap = args.showInactivePins
    ? inventory
    : activeItems;

  return { scopedActive, visibleForMap };
}