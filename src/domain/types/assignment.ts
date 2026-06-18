import type { CreativeId } from "./creative";
import type { InventoryId } from "./inventory";

export type ProjectScope = {
  // Explicit list of INCLUDED inventory IDs for this project
  // (Default is "all active" when project is created)
  includedIds: InventoryId[];
  sourceType?: "full_venue" | "venue_preset" | "manual";
  presetId?: string | null;
  presetName?: string | null;
  appliedAt?: string | null;
};

export type Assignment = {
  projectId: string;
  inventoryId: InventoryId;
  creativeId: CreativeId | null;   // null = unassigned
  updatedAt: string;              // ISO
};
