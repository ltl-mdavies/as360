// src/logic/orderBuilder.ts
import type { InventoryItem as BaseInventoryItem } from "../domain/types/inventory";
import type { CreativeAsset } from "./mockAssignment";
import { mediaLabelFromKey } from "./mockAssignment";

type InventoryItem = BaseInventoryItem & {
  assignedCreativeId?: string | null;
};

export type CreateOrderLine = {
  creativeId: string;
  unitNumber: string;
  quantity: number;
  filename: string;
  trimHeight: string;
  trimWidth: string;
  safeHeight: string;
  safeWidth: string;
  assignedLocations: string;
  mediaVariantKey: string;
};

export type CreateOrderProduct = {
  productSku: string;
  productCategory: "Art";
  productQty: number;
  file_name: string;
  art_file?: string;
  trim_height: string;
  trim_width: string;
  safe_height: string;
  safe_width: string;
  mediaVariantLabel?: string;
  assigned_Locations: string;
};

export type CreateOrderPayload = {
  ext_id: string;
  po_number: string;
  contract_no?: string;
  customer_id?: string;
  order_title: string;
  order_note?: string;
  lines: CreateOrderLine[];
  product_data: CreateOrderProduct[];
};

export type CreateOrderValidation = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};

export function sanitizeFilename(name: string) {
  // Replace illegal characters likely to cause issues downstream
  // Keep it conservative: letters, numbers, space, dash, underscore, dot
  return name.replace(/[^a-zA-Z0-9 ._-]+/g, "_").trim();
}

export function buildCreateOrderPayload(args: {
  projectId: string;
  customerName: string;
  venueName: string;
  artworkDueDate?: string;
  extId?: string;
  poNumber?: string;
  contractNumber?: string;
  creatives: CreativeAsset[];
  inventory: InventoryItem[];
}): { payload: CreateOrderPayload; validation: CreateOrderValidation } {
  const { customerName, venueName, extId, poNumber, contractNumber, creatives, inventory } = args;

  const errors: string[] = [];
  const warnings: string[] = [];

  // Hard requirement: 100% assigned
  const unassigned = inventory.filter((i) => !i.assignedCreativeId);
  if (unassigned.length > 0) {
    errors.push(`Allocation incomplete: ${unassigned.length} inventory items have no creative assigned.`);
  }

  // Ensure unitNumber exists
  const missingUnit = inventory.filter((i) => !i.unitNumber || String(i.unitNumber).trim() === "");
  if (missingUnit.length > 0) {
    errors.push(`Unit# missing: ${missingUnit.length} inventory items do not have a unitNumber.`);
  }

  const creativeById = new Map<string, CreativeAsset>();
  creatives.forEach((c) => creativeById.set(c.id, c));

  const group = new Map<string, {
    creative: CreativeAsset;
    mediaVariantKey: string;
    unitNumber: string;
    inventoryIds: string[];
    trimHeights: Set<string>;
    trimWidths: Set<string>;
    safeHeights: Set<string>;
    safeWidths: Set<string>;
  }>();

  for (const inv of inventory) {
    if (!inv.assignedCreativeId) continue;

    const creative = creativeById.get(inv.assignedCreativeId);
    if (!creative) {
      errors.push(`Inventory ${inv.id} is assigned to creativeId ${inv.assignedCreativeId} which does not exist.`);
      continue;
    }

    const unitNumber = String(inv.unitNumber || "").trim();
    if (!unitNumber) continue; // already counted as error

    const key = `${unitNumber}||${creative.id}||${inv.mediaVariantKey}`;

    if (!group.has(key)) {
      group.set(key, {
        creative,
        mediaVariantKey: inv.mediaVariantKey,
        unitNumber,
        inventoryIds: [],
        trimHeights: new Set<string>(),
        trimWidths: new Set<string>(),
        safeHeights: new Set<string>(),
        safeWidths: new Set<string>(),
      });
    }

    const g = group.get(key)!;
    g.inventoryIds.push(inv.id);
    const trimHeight = inv.trimHeight ?? null;
    const trimWidth = inv.trimWidth ?? null;
    const safeHeight = inv.safeHeight ?? null;
    const safeWidth = inv.safeWidth ?? null;

    if (trimHeight == null || trimWidth == null || safeHeight == null || safeWidth == null) {
      errors.push(`Trim/safe missing: inventory ${inv.id} is missing one or more print dimensions.`);
    } else {
      g.trimHeights.add(String(trimHeight));
      g.trimWidths.add(String(trimWidth));
      g.safeHeights.add(String(safeHeight));
      g.safeWidths.add(String(safeWidth));
    }
  }

  const groupedLines = Array.from(group.values())
    .map((grouped) => {
      grouped.inventoryIds.sort();
      if (grouped.trimHeights.size > 1 || grouped.trimWidths.size > 1 || grouped.safeHeights.size > 1 || grouped.safeWidths.size > 1) {
        errors.push(
          `Dimension mismatch: grouped line for ${grouped.creative.filename} / ${grouped.unitNumber} contains inconsistent trim or safe values.`
        );
      }
      return {
        creativeId: grouped.creative.id,
        unitNumber: grouped.unitNumber,
        quantity: grouped.inventoryIds.length,
        filename: sanitizeFilename(grouped.creative.filename),
        trimHeight: Array.from(grouped.trimHeights)[0] || "",
        trimWidth: Array.from(grouped.trimWidths)[0] || "",
        safeHeight: Array.from(grouped.safeHeights)[0] || "",
        safeWidth: Array.from(grouped.safeWidths)[0] || "",
        assignedLocations: grouped.inventoryIds.join(", "),
        mediaVariantKey: grouped.mediaVariantKey,
      };
    })
    .sort((a, b) => {
      const la = mediaLabelFromKey(a.mediaVariantKey);
      const lb = mediaLabelFromKey(b.mediaVariantKey);
      const byVariant = la.localeCompare(lb, undefined, { sensitivity: "base" });
      if (byVariant !== 0) return byVariant;
      const byFilename = a.filename.localeCompare(b.filename, undefined, { sensitivity: "base" });
      if (byFilename !== 0) return byFilename;
      return a.unitNumber.localeCompare(b.unitNumber, undefined, { sensitivity: "base" });
    });

  // Warn if filenames were sanitized
  for (const c of creatives) {
    const sanitized = sanitizeFilename(c.filename);
    if (sanitized !== c.filename) {
      warnings.push(`Filename sanitized: "${c.filename}" → "${sanitized}"`);
    }
  }

  const payload: CreateOrderPayload = {
    ext_id: extId || "",
    po_number: poNumber || (extId?.startsWith("Z") ? extId.slice(1) : ""),
    contract_no: contractNumber || undefined,
    order_title: `${customerName} @ ${venueName}`,
    lines: groupedLines.map(
      ({ creativeId, unitNumber, quantity, filename, trimHeight, trimWidth, safeHeight, safeWidth, assignedLocations, mediaVariantKey }) => ({
        creativeId,
        unitNumber,
        quantity,
        filename,
        trimHeight,
        trimWidth,
        safeHeight,
        safeWidth,
        assignedLocations,
        mediaVariantKey,
      })
    ),
    product_data: groupedLines.map(({ creativeId: _creativeId, quantity, filename, trimHeight, trimWidth, safeHeight, safeWidth, assignedLocations, mediaVariantKey, unitNumber }) => ({
      productSku: unitNumber,
      productCategory: "Art" as const,
      productQty: quantity,
      file_name: filename,
      trim_height: trimHeight,
      trim_width: trimWidth,
      safe_height: safeHeight,
      safe_width: safeWidth,
      mediaVariantLabel: mediaLabelFromKey(mediaVariantKey),
      assigned_Locations: assignedLocations,
    })),
  };

  return {
    payload,
    validation: {
      ok: errors.length === 0,
      errors,
      warnings,
    },
  };
}
