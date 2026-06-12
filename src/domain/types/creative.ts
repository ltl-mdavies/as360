export type CreativeId = string;

export type Creative = {
  id: CreativeId;
  projectId: string;

  filename: string;         // full filename (sanitized later)
  fileMeta: string;         // "PDF • 462 KB • 1920×1080px" (UI convenience)
  mediaVariantKey: string;  // matches InventoryItem.mediaVariantKey
  color: string;            // dot/halo identity

  // storage URLs (later real S3/CloudFront)
  thumbUrl: string;
  fullUrl: string;

  createdAt: string;        // ISO
};