// src/domain/store/demoSeed.ts
import type {
  Project,
  ProjectScope,
  Venue,
  VenueLocation,
  InventoryItem,
  Creative,
  Assignment,
  TransitApproval,
  ProofLine,
} from "../types";

import { mockCreatives, mockInventory, mockMaps } from "../../logic/mockAssignment";
import { buildMockThumbUrl, buildMockFullPreviewUrl } from "../../logic/imageUrls";

export type DemoDataset = {
  venues: Venue[];
  locations: VenueLocation[];
  inventory: InventoryItem[];

  projects: Project[];
  scopes: Record<string, ProjectScope>;

  creatives: Creative[];
  assignments: Assignment[];

  transit: Record<string, TransitApproval>;
  proofs: Record<string, ProofLine[]>;
};

export function buildDemoDataset(): DemoDataset {
  const customerId = "intersection";
  const venueId = "venue_penn_station";
  const projectId = "demo_001";

  const venue: Venue = {
    id: venueId,
    name: "Penn Station",
    market: "New York City",
    customerId,
    imageUrl: undefined,
  };

  const locations: VenueLocation[] = mockMaps.map((m, idx) => ({
    id: m.id,            // use your existing map ids (mezz/hall/platA/platB)
    venueId,
    name: m.name,
    mapUrl: (m as any).imageUrl || "", // if you added imageUrl to mockMaps
    sortIndex: idx,
  }));

  const inactiveInventoryIds = new Set([
    "PS-2-129",
    "PS-3-031",
    "PS-SD-026",
    "PS-CW-014",
    "PS-SR-004",
    "PS-BN-001",
    "PS-SW-001",
  ]);

  // Convert legacy mockInventory -> canonical InventoryItem
  const inventory: InventoryItem[] = (mockInventory as any[]).map((i) => ({
    id: i.id,
    venueId,
    locationId: i.mapId,          // legacy mapId -> canonical locationId
    mediaVariantKey: i.mediaVariantKey,
    unitNumber: i.unitNumber || "",
    x: i.x,
    y: i.y,
    isActive: !inactiveInventoryIds.has(i.id),
  }));

  // Project + scope (Option A = include all active)
  const project: Project = {
    id: projectId,
    customerId,
    venueId,
    title: "Demo — White Claw @ Penn Station",
    poNumber: "DEMO-PO-0001",
    extId: projectId,
    liftOrderNumber: undefined,
    artworkDueDate: "2025-12-10",
    postDate: "2025-12-25",
    createdAt: new Date().toISOString(),
  };

  const scope: ProjectScope = {
    includedIds: inventory.filter((i) => i.isActive).map((i) => i.id),
  };

  // Convert legacy mockCreatives -> canonical Creative
  const creatives: Creative[] = (mockCreatives as any[]).map((c) => ({
    id: c.id,
    projectId,
    filename: c.filename,
    fileMeta: c.fileMeta,
    mediaVariantKey: c.mediaVariantKey,
    color: c.color,
    thumbUrl: buildMockThumbUrl(c.id, 160, 120),
    fullUrl: buildMockFullPreviewUrl(c.id, c.fileMeta, 1800),
    createdAt: new Date().toISOString(),
  }));

  // Build assignments from mockInventory assignedCreativeId (if present)
  const assignments: Assignment[] = inventory.map((inv) => {
    const legacy = (mockInventory as any[]).find((x) => x.id === inv.id);
    const creativeId = legacy?.assignedCreativeId ?? null;

    return {
      projectId,
      inventoryId: inv.id,
      creativeId,
      updatedAt: new Date().toISOString(),
    };
  });

  const transit: Record<string, TransitApproval> = {
    [projectId]: {
      projectId,
      status: "not_started",
    },
  };

  // Demo projects begin pre-submit, so proofs should not exist until submitOrderDemo seeds them.
  const proofs: Record<string, ProofLine[]> = {
    [projectId]: [],
  };

  return {
    venues: [venue],
    locations,
    inventory,
    projects: [project],
    scopes: { [projectId]: scope },
    creatives,
    assignments,
    transit,
    proofs,
  };
}
