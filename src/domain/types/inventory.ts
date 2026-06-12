export type InventoryId = string;

export type InventoryMapVisibilityMode = "hidden" | "show_unavailable";

export type InventoryItem = {
  id: InventoryId;          // "PS-CW-006"
  venueId: string;
  locationId: string;       // which VenueLocation/map this belongs to

  mediaVariantKey: string;  // "Column Wrap||63.75||123"
  unitNumber?: string;      // Lift mapping (ProductSKU)

  // pin position normalized to map canvas 0..1
  x: number;
  y: number;

  isActive: boolean;        // venue-level availability
  mapVisibilityMode?: InventoryMapVisibilityMode;

  mediaType?: string;
  trimHeight?: number | null;
  trimWidth?: number | null;
  safeHeight?: number | null;
  safeWidth?: number | null;
  substrate?: string;
  finishing?: string;
  locationDetail?: string;
  notes?: string;
  dpi?: number | null;
  bleedTop?: number | null;
  bleedRight?: number | null;
  bleedBottom?: number | null;
  bleedLeft?: number | null;
};
