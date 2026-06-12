// src/logic/mockAssignment.ts
// Phase 1: mock data for Creative Assignment shell (no persistence yet)

export type MapLayer = {
  id: string;
  name: string;
  assigned: number;
  total: number;
  imageUrl: string; // SVG / PNG / JPG map background
};

export type MediaVariant = {
  key: string; // mediaName||w||h
  mediaName: string;
  w: number;
  h: number;
  shortLabel: string; // for pins later (CW, DC, 2S)
  color: string;
};

export type CreativeAsset = {
  id: string;
  filename: string;
  fileMeta: string; // "PDF • 462 KB • 1920 × 1080px"
  color: string; // hex, for halo later
  mediaVariantKey: string;
  assignedInventoryIds: string[];
  thumbUrl?: string;
  fullUrl?: string;
  uploadState?: "uploading" | "processing" | "ready" | "error";
  isOptimistic?: boolean;
};

export type InventoryItem = {
  id: string; // display inventoryId
  recordId?: string; // backend inventory record id when persisted
  locationName?: string;
  mapId: string; // which map layer
  mediaVariantKey: string;
  unitNumber: string; // Lift ProductSKU / Unit#
  assignedCreativeId?: string | null;
  assignmentUpdatedAt?: string | null;
  isActive?: boolean;
  // x/y used later for pin positioning (0..1 normalized)
  x: number;
  y: number;
};

export function mediaKey(mediaName: string, w: number, h: number) {
  return `${mediaName}||${w}||${h}`;
}

function makeInventoryItem(args: {
  id: string;
  mapId: string;
  mediaVariantKey: string;
  unitNumber: string;
  assignedCreativeId?: string | null;
  x: number;
  y: number;
}): InventoryItem {
  return {
    id: args.id,
    mapId: args.mapId,
    mediaVariantKey: args.mediaVariantKey,
    unitNumber: args.unitNumber,
    assignedCreativeId: args.assignedCreativeId ?? null,
    x: args.x,
    y: args.y,
  };
}

export function formatMediaDimensions(w: number | string, h: number | string) {
  const fw = `${w}`.trim();
  const fh = `${h}`.trim();
  if (!fw || !fh) return "Custom size";
  return `${Number(fw)}"h × ${Number(fh)}"w`;
}

export function mediaLabelFromKey(key: string) {
  const [name, w, h] = key.split("||");
  return `${name} • ${formatMediaDimensions(w, h)}`;
}

// Mock maps (the pills above the map)
export const mockMaps: MapLayer[] = [
  {
    id: "mezz",
    name: "Mezzanine",
    assigned: 12,
    total: 38,
    imageUrl:
      "https://adspace360-c.s3.amazonaws.com/venue_maps/Amtrak%20-%20NY%20Penn%20Station%20Map-ALL%20MEDIA_01.svg",
  },
  {
    id: "hall",
    name: "Hallway",
    assigned: 6,
    total: 26,
    imageUrl:
      "https://adspace360-c.s3.amazonaws.com/venue_maps/Amtrak%20-%20NY%20Penn%20Station%20Map-ALL%20MEDIA_02.svg",
  },
  {
    id: "platA",
    name: "Platform A",
    assigned: 7,
    total: 22,
    imageUrl:
      "https://adspace360-c.s3.amazonaws.com/venue_maps/Amtrak%20-%20NY%20Penn%20Station%20Map-ALL%20MEDIA_03.svg",
  },
  {
    id: "platB",
    name: "Platform B",
    assigned: 4,
    total: 18,
    imageUrl:
      "https://adspace360-c.s3.amazonaws.com/venue_maps/Amtrak%20-%20NY%20Penn%20Station%20Map-ALL%20MEDIA_04.svg",
  },
];

// Mock media variants (chips under map)
export const mockMediaVariants: MediaVariant[] = [
  { key: mediaKey("2-Sheet Poster", 46, 60), mediaName: "2-Sheet Poster", w: 46, h: 60, shortLabel: "2S", color: "#f4c84a" },
  { key: mediaKey("3-Sheet Poster", 84.2, 42.2), mediaName: "3-Sheet Poster", w: 84.2, h: 42.2, shortLabel: "3S", color: "#fb923c" },
  { key: mediaKey("Shelter Diorama", 68.5, 47.5), mediaName: "Shelter Diorama", w: 68.5, h: 47.5, shortLabel: "SD", color: "#f472b6" },
  { key: mediaKey("Column Wrap", 102.5, 127), mediaName: "Column Wrap", w: 102.5, h: 127, shortLabel: "CW", color: "#41c6a6" },
  { key: mediaKey("Column Wrap", 63.75, 123), mediaName: "Column Wrap", w: 63.75, h: 123, shortLabel: "CW", color: "#34d399" },
  { key: mediaKey("Stair Riser", 7.5, 124), mediaName: "Stair Riser", w: 7.5, h: 124, shortLabel: "SR", color: "#a78bfa" },
  { key: mediaKey("Rotunda Banner", 140, 480), mediaName: "Rotunda Banner", w: 140, h: 480, shortLabel: "RB", color: "#f97316" },
  { key: mediaKey("Banner", 75, 134), mediaName: "Banner", w: 75, h: 134, shortLabel: "BN", color: "#14b8a6" },
  { key: mediaKey("Slanted Wall Soffit", 54.5, 272), mediaName: "Slanted Wall Soffit", w: 54.5, h: 272, shortLabel: "SW", color: "#ef4444" },
  { key: mediaKey("Directional Clock", 24, 24), mediaName: "Directional Clock", w: 24, h: 24, shortLabel: "DC", color: "#60a5fa" },
];

// Mock creatives list (left rail)
export const mockCreatives: CreativeAsset[] = [
  {
    id: "c1",
    filename: "White_Claw_PennStation_2Sheet_A.pdf",
    fileMeta: "PDF • 462 KB • 1920 × 1080px",
    color: "#60a5fa",
    mediaVariantKey: mediaKey("2-Sheet Poster", 46, 60),
    assignedInventoryIds: ["PS-2-106", "PS-2-083", "PS-2-089", "PS-2-014"],
  },
  {
    id: "c2",
    filename: "White_Claw_Peach_PennStation_Wrap_A.pdf",
    fileMeta: "PDF • 467 KB • 1920 × 1081px",
    color: "#34d399",
    mediaVariantKey: mediaKey("Column Wrap", 63.75, 123),
    assignedInventoryIds: ["PS-CW-006", "PS-CW-001", "PS-CW-007"],
  },
  {
    id: "c3",
    filename: "Stillwater_PennStation_2Sheet_B.pdf",
    fileMeta: "PDF • 400 KB • 1300 × 650px",
    color: "#fbbf24",
    mediaVariantKey: mediaKey("2-Sheet Poster", 46, 60),
    assignedInventoryIds: ["PS-2-021", "PS-2-034"],
  },
  {
    id: "c4",
    filename: "PennStation_DirectionalClock_Q1.pdf",
    fileMeta: "PDF • 210 KB • 1200 × 1200px",
    color: "#a78bfa",
    mediaVariantKey: mediaKey("Directional Clock", 24, 24),
    assignedInventoryIds: ["PS-DC-021"],
  },
  {
    id: "c5",
    filename: "White_Claw_3Sheet_Concourse_A.pdf",
    fileMeta: "PDF • 588 KB • 1800 × 2400px",
    color: "#fb923c",
    mediaVariantKey: mediaKey("3-Sheet Poster", 84.2, 42.2),
    assignedInventoryIds: ["PS-3-004", "PS-3-018", "PS-3-025"],
  },
  {
    id: "c6",
    filename: "PennStation_ShelterDiorama_Q1.pdf",
    fileMeta: "PDF • 712 KB • 1800 × 1400px",
    color: "#f472b6",
    mediaVariantKey: mediaKey("Shelter Diorama", 68.5, 47.5),
    assignedInventoryIds: ["PS-SD-002", "PS-SD-014", "PS-SD-021"],
  },
  {
    id: "c7",
    filename: "PennStation_Rotunda_Banner_Feb.pdf",
    fileMeta: "PDF • 960 KB • 2200 × 4200px",
    color: "#f97316",
    mediaVariantKey: mediaKey("Rotunda Banner", 140, 480),
    assignedInventoryIds: ["PS-RB-001"],
  },
  {
    id: "c8",
    filename: "PennStation_StairRiser_Series_A.pdf",
    fileMeta: "PDF • 318 KB • 1400 × 900px",
    color: "#8b5cf6",
    mediaVariantKey: mediaKey("Stair Riser", 7.5, 124),
    assignedInventoryIds: ["PS-SR-001", "PS-SR-002"],
  },
  {
    id: "c9",
    filename: "PennStation_Soffit_Concept_C.pdf",
    fileMeta: "PDF • 844 KB • 1600 × 4200px",
    color: "#ef4444",
    mediaVariantKey: mediaKey("Slanted Wall Soffit", 54.5, 272),
    assignedInventoryIds: [],
  },
];

// Mock inventory (pins later; for now counts + filtering)
export const mockInventory: InventoryItem[] = [
  makeInventoryItem({ id: "PS-2-014", mapId: "mezz", mediaVariantKey: mediaKey("2-Sheet Poster", 46, 60), unitNumber: "6491501", assignedCreativeId: "c1", x: 0.18, y: 0.23 }),
  makeInventoryItem({ id: "PS-2-021", mapId: "mezz", mediaVariantKey: mediaKey("2-Sheet Poster", 46, 60), unitNumber: "6491502", assignedCreativeId: "c3", x: 0.28, y: 0.34 }),
  makeInventoryItem({ id: "PS-2-034", mapId: "hall", mediaVariantKey: mediaKey("2-Sheet Poster", 46, 60), unitNumber: "6491503", assignedCreativeId: "c3", x: 0.44, y: 0.25 }),
  makeInventoryItem({ id: "PS-2-083", mapId: "mezz", mediaVariantKey: mediaKey("2-Sheet Poster", 46, 60), unitNumber: "6491559", assignedCreativeId: "c1", x: 0.55, y: 0.52 }),
  makeInventoryItem({ id: "PS-2-089", mapId: "mezz", mediaVariantKey: mediaKey("2-Sheet Poster", 46, 60), unitNumber: "6491560", assignedCreativeId: "c1", x: 0.63, y: 0.62 }),
  makeInventoryItem({ id: "PS-2-106", mapId: "mezz", mediaVariantKey: mediaKey("2-Sheet Poster", 46, 60), unitNumber: "6491561", assignedCreativeId: "c1", x: 0.70, y: 0.35 }),
  makeInventoryItem({ id: "PS-2-118", mapId: "platA", mediaVariantKey: mediaKey("2-Sheet Poster", 46, 60), unitNumber: "6491562", assignedCreativeId: null, x: 0.34, y: 0.58 }),
  makeInventoryItem({ id: "PS-2-129", mapId: "platB", mediaVariantKey: mediaKey("2-Sheet Poster", 46, 60), unitNumber: "6491563", assignedCreativeId: null, x: 0.58, y: 0.42 }),

  makeInventoryItem({ id: "PS-3-004", mapId: "hall", mediaVariantKey: mediaKey("3-Sheet Poster", 84.2, 42.2), unitNumber: "7350004", assignedCreativeId: "c5", x: 0.22, y: 0.18 }),
  makeInventoryItem({ id: "PS-3-018", mapId: "hall", mediaVariantKey: mediaKey("3-Sheet Poster", 84.2, 42.2), unitNumber: "7350018", assignedCreativeId: "c5", x: 0.62, y: 0.32 }),
  makeInventoryItem({ id: "PS-3-025", mapId: "platA", mediaVariantKey: mediaKey("3-Sheet Poster", 84.2, 42.2), unitNumber: "7350025", assignedCreativeId: "c5", x: 0.72, y: 0.28 }),
  makeInventoryItem({ id: "PS-3-031", mapId: "platB", mediaVariantKey: mediaKey("3-Sheet Poster", 84.2, 42.2), unitNumber: "7350031", assignedCreativeId: null, x: 0.42, y: 0.68 }),

  makeInventoryItem({ id: "PS-SD-002", mapId: "hall", mediaVariantKey: mediaKey("Shelter Diorama", 68.5, 47.5), unitNumber: "8201002", assignedCreativeId: "c6", x: 0.18, y: 0.62 }),
  makeInventoryItem({ id: "PS-SD-014", mapId: "platA", mediaVariantKey: mediaKey("Shelter Diorama", 68.5, 47.5), unitNumber: "8201014", assignedCreativeId: "c6", x: 0.52, y: 0.51 }),
  makeInventoryItem({ id: "PS-SD-021", mapId: "platB", mediaVariantKey: mediaKey("Shelter Diorama", 68.5, 47.5), unitNumber: "8201021", assignedCreativeId: "c6", x: 0.78, y: 0.34 }),
  makeInventoryItem({ id: "PS-SD-026", mapId: "platB", mediaVariantKey: mediaKey("Shelter Diorama", 68.5, 47.5), unitNumber: "8201026", assignedCreativeId: null, x: 0.26, y: 0.56 }),

  makeInventoryItem({ id: "PS-CW-001", mapId: "mezz", mediaVariantKey: mediaKey("Column Wrap", 63.75, 123), unitNumber: "7123001", assignedCreativeId: "c2", x: 0.85, y: 0.30 }),
  makeInventoryItem({ id: "PS-CW-006", mapId: "mezz", mediaVariantKey: mediaKey("Column Wrap", 63.75, 123), unitNumber: "7123002", assignedCreativeId: "c2", x: 0.80, y: 0.30 }),
  makeInventoryItem({ id: "PS-CW-007", mapId: "hall", mediaVariantKey: mediaKey("Column Wrap", 63.75, 123), unitNumber: "7123003", assignedCreativeId: "c2", x: 0.82, y: 0.54 }),
  makeInventoryItem({ id: "PS-CW-013", mapId: "platA", mediaVariantKey: mediaKey("Column Wrap", 102.5, 127), unitNumber: "7123013", assignedCreativeId: null, x: 0.64, y: 0.66 }),
  makeInventoryItem({ id: "PS-CW-014", mapId: "platB", mediaVariantKey: mediaKey("Column Wrap", 102.5, 127), unitNumber: "7123014", assignedCreativeId: null, x: 0.68, y: 0.21 }),

  makeInventoryItem({ id: "PS-SR-001", mapId: "mezz", mediaVariantKey: mediaKey("Stair Riser", 7.5, 124), unitNumber: "9100001", assignedCreativeId: "c8", x: 0.31, y: 0.16 }),
  makeInventoryItem({ id: "PS-SR-002", mapId: "mezz", mediaVariantKey: mediaKey("Stair Riser", 7.5, 124), unitNumber: "9100002", assignedCreativeId: "c8", x: 0.33, y: 0.18 }),
  makeInventoryItem({ id: "PS-SR-003", mapId: "hall", mediaVariantKey: mediaKey("Stair Riser", 7.5, 124), unitNumber: "9100003", assignedCreativeId: null, x: 0.47, y: 0.40 }),
  makeInventoryItem({ id: "PS-SR-004", mapId: "platA", mediaVariantKey: mediaKey("Stair Riser", 7.5, 124), unitNumber: "9100004", assignedCreativeId: null, x: 0.56, y: 0.76 }),

  makeInventoryItem({ id: "PS-RB-001", mapId: "mezz", mediaVariantKey: mediaKey("Rotunda Banner", 140, 480), unitNumber: "9400001", assignedCreativeId: "c7", x: 0.52, y: 0.44 }),
  makeInventoryItem({ id: "PS-RB-002", mapId: "mezz", mediaVariantKey: mediaKey("Rotunda Banner", 140, 480), unitNumber: "9400002", assignedCreativeId: null, x: 0.48, y: 0.46 }),

  makeInventoryItem({ id: "PS-BN-001", mapId: "platA", mediaVariantKey: mediaKey("Banner", 75, 134), unitNumber: "9500001", assignedCreativeId: null, x: 0.18, y: 0.22 }),
  makeInventoryItem({ id: "PS-SW-001", mapId: "platB", mediaVariantKey: mediaKey("Slanted Wall Soffit", 54.5, 272), unitNumber: "9600001", assignedCreativeId: null, x: 0.20, y: 0.18 }),

  makeInventoryItem({ id: "PS-DC-019", mapId: "mezz", mediaVariantKey: mediaKey("Directional Clock", 24, 24), unitNumber: "8012345", assignedCreativeId: null, x: 0.48, y: 0.55 }),
  makeInventoryItem({ id: "PS-DC-021", mapId: "mezz", mediaVariantKey: mediaKey("Directional Clock", 24, 24), unitNumber: "8012346", assignedCreativeId: "c4", x: 0.59, y: 0.47 }),
  makeInventoryItem({ id: "PS-DC-027", mapId: "hall", mediaVariantKey: mediaKey("Directional Clock", 24, 24), unitNumber: "8012347", assignedCreativeId: null, x: 0.74, y: 0.46 }),
];

// Helper: counts for variant chips for a given map
export function variantCountsForMap(mapId: string) {
  const counts = new Map<string, { total: number; assigned: number }>();

  for (const inv of mockInventory.filter((i) => i.mapId === mapId)) {
    const key = inv.mediaVariantKey;
    const cur = counts.get(key) || { total: 0, assigned: 0 };
    cur.total += 1;
    if (inv.assignedCreativeId) cur.assigned += 1;
    counts.set(key, cur);
  }

  return counts;
}
