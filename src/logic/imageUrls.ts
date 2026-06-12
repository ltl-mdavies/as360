// src/logic/imageUrls.ts
// Shared image URL helpers (mock now, real URLs later)

export function parsePxFromMeta(meta: string): { w: number; h: number } | null {
  // Expects: "... 1920 × 1080px" (your current mock format)
  const m = meta.match(/(\d+)\s*[×x]\s*(\d+)\s*px/i);
  if (!m) return null;
  return { w: Number(m[1]), h: Number(m[2]) };
}

/**
 * Build a "full preview" URL that preserves aspect ratio.
 * For now: picsum seed.
 * Later: swap to CloudFront/S3/Lift proof URL builder with same signature.
 */
export function buildMockFullPreviewUrl(seed: string, fileMeta: string, targetW = 1600) {
  const px = parsePxFromMeta(fileMeta);
  const w0 = px?.w ?? 1600;
  const h0 = px?.h ?? 900;
  const targetH = Math.max(400, Math.round(targetW * (h0 / w0)));
  return `https://picsum.photos/seed/${seed}/${targetW}/${targetH}`;
}

/** Small thumb (cards/pickers). Keep stable. */
export function buildMockThumbUrl(seed: string, w = 160, h = 120) {
  return `https://picsum.photos/seed/${seed}/${w}/${h}`;
}

export function buildDocumentThumbUrl(args?: { label?: string; accent?: string }) {
  const label = (args?.label || "PDF").slice(0, 8);
  const accent = args?.accent || "#2563eb";
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240" fill="none">
      <rect width="320" height="240" rx="28" fill="#f8fafc"/>
      <rect x="22" y="22" width="276" height="196" rx="22" fill="#ffffff" stroke="#dbe4f1"/>
      <path d="M224 62H128c-12.15 0-22 9.85-22 22v72c0 12.15 9.85 22 22 22h64c12.15 0 22-9.85 22-22V96l-42-34Z" fill="${accent}" fill-opacity=".12" stroke="${accent}" stroke-opacity=".45"/>
      <path d="M214 96h-24c-9.941 0-18-8.059-18-18V62" stroke="${accent}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>
      <rect x="78" y="166" width="164" height="18" rx="9" fill="#e2e8f0"/>
      <rect x="78" y="192" width="118" height="14" rx="7" fill="#edf2f7"/>
      <text x="160" y="136" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="36" font-weight="700" fill="${accent}">${label}</text>
    </svg>
  `.trim();
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
