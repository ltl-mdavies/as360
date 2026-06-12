// src/domain/selectors/displayAsset.ts

export type DisplayAsset = {
  thumbUrl: string | null;
  fullUrl: string | null;
  source: "proof" | "creative" | "fallback";
  proofStatus?: string | null;
};

export type DisplayAssetBundle = {
  upload: DisplayAsset;  // uploaded creative (latest upload)
  proof: DisplayAsset;   // best proof (approved > pending > waiting)
  best: DisplayAsset;    // convenience: proof if available else upload
};

type ProofLike = {
  clientCreativeId?: string | null;
  creativeId?: string | null;
  status?: string | null; // approved | pending | waiting
  proofThumbUrl?: string | null;
  proofFullUrl?: string | null;
};

type CreativeLike = {
  id: string;
  thumbUrl?: string | null;
  fullUrl?: string | null;
};

function scoreProof(p: ProofLike) {
  const s = (p.status || "").toLowerCase();
  if (s === "approved") return 300;
  if (s === "pending") return 200;
  if (s === "waiting") return 100;
  return 50;
}

function proofHasUrls(p: ProofLike) {
  return !!(p.proofThumbUrl || p.proofFullUrl);
}

export function getCreativeDisplayAssets(args: {
  creative: CreativeLike;
  proofsForProject: ProofLike[];
}): DisplayAssetBundle {
  const { creative, proofsForProject } = args;

  // Upload asset
  const upload: DisplayAsset =
    creative.thumbUrl || creative.fullUrl
      ? {
          thumbUrl: creative.thumbUrl || creative.fullUrl || null,
          fullUrl: creative.fullUrl || creative.thumbUrl || null,
          source: "creative",
          proofStatus: null,
        }
      : {
          thumbUrl: null,
          fullUrl: null,
          source: "fallback",
          proofStatus: null,
        };

  // Proof asset (best proof for this creative)
  const proofMatches = proofsForProject.filter((p) => {
    const pid = (p.clientCreativeId || p.creativeId || "").trim();
    return pid && pid === creative.id;
  });

  const bestProof = proofMatches
    .filter(proofHasUrls)
    .sort((a, b) => scoreProof(b) - scoreProof(a))[0];

  const proof: DisplayAsset = bestProof
    ? {
        thumbUrl: bestProof.proofThumbUrl || bestProof.proofFullUrl || null,
        fullUrl: bestProof.proofFullUrl || bestProof.proofThumbUrl || null,
        source: "proof",
        proofStatus: bestProof.status || null,
      }
    : {
        thumbUrl: null,
        fullUrl: null,
        source: "fallback",
        proofStatus: null,
      };

  const best = proof.source === "proof" ? proof : upload;

  return { upload, proof, best };
}

/**
 * Convenience helper when you just want one asset (by mode).
 * mode:
 * - "upload": always upload truth
 * - "proof": proof-first (falls back to upload if no proof)
 * - "best": proof if exists else upload
 */
export function pickCreativeDisplayAsset(args: {
  creative: CreativeLike;
  proofsForProject: ProofLike[];
  mode: "upload" | "proof" | "best";
}): DisplayAsset {
  const bundle = getCreativeDisplayAssets(args);
  if (args.mode === "upload") return bundle.upload;
  if (args.mode === "proof") return bundle.proof.source === "proof" ? bundle.proof : bundle.upload;
  return bundle.best;
}