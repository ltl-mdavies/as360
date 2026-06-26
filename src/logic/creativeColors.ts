const CREATIVE_COLOR_PALETTE = [
  "#2563eb",
  "#dc2626",
  "#7c3aed",
  "#0891b2",
  "#db2777",
  "#ea580c",
  "#4f46e5",
  "#0f766e",
  "#be123c",
  "#9333ea",
  "#0284c7",
  "#b45309",
];

const FALLBACK_CREATIVE_COLORS = new Set([
  "",
  "#94a3b8",
  "#64748b",
  "rgba(148,163,184,.9)",
  "rgba(148, 163, 184, 0.9)",
]);

function normalizeColor(value?: string | null) {
  return (value || "").trim().toLowerCase().replace(/\s+/g, "");
}

export function hashCreativeId(input: string) {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function creativeColorForId(input: string) {
  const index = hashCreativeId(input || "creative") % CREATIVE_COLOR_PALETTE.length;
  return CREATIVE_COLOR_PALETTE[index] || CREATIVE_COLOR_PALETTE[0];
}

export function generateCreativeColor(seed?: string) {
  const id = seed || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return creativeColorForId(id);
}

export function resolveCreativeColor(
  creative: { id: string; color?: string | null },
  options: { variantColor?: string | null } = {}
) {
  const color = creative.color || "";
  const normalized = normalizeColor(color);
  const variant = normalizeColor(options.variantColor);
  const isMissingOrFallback = FALLBACK_CREATIVE_COLORS.has(normalized);
  const isVariantColor = Boolean(variant && normalized === variant);
  return isMissingOrFallback || isVariantColor ? creativeColorForId(creative.id) : color;
}
