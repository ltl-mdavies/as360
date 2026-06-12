import type { CreativeId } from "./creative";
import type { InventoryId } from "./inventory";

export type ProjectScope = {
  // Explicit list of INCLUDED inventory IDs for this project
  // (Default is "all active" when project is created)
  includedIds: InventoryId[];
};

export type Assignment = {
  projectId: string;
  inventoryId: InventoryId;
  creativeId: CreativeId | null;   // null = unassigned
  updatedAt: string;              // ISO
};