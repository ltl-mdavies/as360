import { formatMediaDimensions, mockMediaVariants, type CreativeAsset } from "../../logic/mockAssignment";
import { buildDocumentThumbUrl, buildMockFullPreviewUrl, buildMockThumbUrl } from "../../logic/imageUrls";
import { demoStore } from "../../domain/store/demoStore";
import type { Dispatch, SetStateAction } from "react";
import {
  createProjectCreativeAsset,
  requestArtworkUploadUrl,
  updateProjectCreativeAsset,
  type ApiClientLike,
} from "../../api/projects";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export type PreparedUploadFile = {
  id: string;
  file: File;
  filename: string;
  objectUrl: string | null;
  isPdf: boolean;
  sizeLabel: string;
};

export type ProjectUploadFile = {
  file: File;
  filename: string;
  isPdf: boolean;
  objectUrl?: string | null;
};

export async function generatePdfThumbnail(file: File, filename: string) {
  const data = await file.arrayBuffer();
  const pdf = await getDocument({ data }).promise;
  const page = await pdf.getPage(1);
  const baseViewport = page.getViewport({ scale: 1 });
  const targetWidth = 960;
  const scale = targetWidth / Math.max(baseViewport.width, 1);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    await pdf.destroy();
    throw new Error("Canvas rendering is unavailable for PDF thumbnails");
  }

  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));

  await page.render({ canvas, canvasContext: context, viewport }).promise;
  await pdf.destroy();

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((next) => resolve(next), "image/jpeg", 0.9);
  });

  if (!blob) {
    throw new Error("Unable to generate PDF thumbnail");
  }

  const safeBase = filename.replace(/\.[^.]+$/, "") || "creative";
  return new File([blob], `${safeBase}.thumb.jpg`, { type: "image/jpeg" });
}

export function bytesLabel(bytes: number) {
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
}

export function sanitizeFilename(name: string) {
  return (name || "file")
    .replace(/[^\w\s.\-()]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}

export function makeUploadId(prefix = "up") {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

export function prepareUploadFiles(list: FileList | File[]): PreparedUploadFile[] {
  const arr = Array.from(list || []);
  return arr.map((file) => {
    const filename = sanitizeFilename(file.name);
    const isPdf = /pdf$/i.test(filename) || file.type === "application/pdf";
    const isImage = file.type.startsWith("image/");
    const objectUrl = isImage ? URL.createObjectURL(file) : null;

    return {
      id: makeUploadId("pf"),
      file: new File([file], filename, { type: file.type }),
      filename,
      objectUrl,
      isPdf,
      sizeLabel: bytesLabel(file.size),
    };
  });
}

export async function prepareUploadFilesWithPreview(list: FileList | File[]) {
  const prepared = prepareUploadFiles(list);
  return Promise.all(
    prepared.map(async (item) => {
      if (!item.isPdf || item.objectUrl) return item;
      try {
        const thumbnailFile = await generatePdfThumbnail(item.file, item.filename);
        return {
          ...item,
          objectUrl: URL.createObjectURL(thumbnailFile),
        };
      } catch (error) {
        console.warn("Failed to prepare PDF preview", error);
        return item;
      }
    })
  );
}

export async function addUploadedArtworkToProject(args: {
  projectId?: string;
  isDemo: boolean;
  shareMode?: boolean;
  variantKey: string;
  files: ProjectUploadFile[];
  setLegacyCreatives?: Dispatch<SetStateAction<CreativeAsset[]>>;
  apiClient?: ApiClientLike;
  customerId?: string;
}) {
  const variant = mockMediaVariants.find((v: any) => v.key === args.variantKey);
  const uploadedIds: string[] = [];
  const replaceLocalCreative = (creativeId: string, nextCreative: CreativeAsset) => {
    args.setLegacyCreatives?.((prev) => prev.map((item) => (item.id === creativeId ? nextCreative : item)));
  };
  const patchLocalCreative = (creativeId: string, patch: Partial<CreativeAsset>) => {
    args.setLegacyCreatives?.((prev) =>
      prev.map((item) => (item.id === creativeId ? { ...item, ...patch } : item))
    );
  };
  const removeLocalCreative = (creativeId: string) => {
    args.setLegacyCreatives?.((prev) => prev.filter((item) => item.id !== creativeId));
  };

  if (!args.isDemo && args.apiClient && args.projectId) {
    for (const { file, filename, isPdf } of args.files) {
      const fileMeta = `${isPdf ? "PDF" : "FILE"} · ${(file.size / 1024 / 1024).toFixed(1)} MB · ${
        variant?.mediaName || "Media"
      } ${formatMediaDimensions(variant?.w || "", variant?.h || "")}`;
      const tempId = makeUploadId("creative_tmp");
      const initialThumb =
        !isPdf && file.type.startsWith("image/")
          ? URL.createObjectURL(file)
          : buildDocumentThumbUrl({
              label: isPdf ? "PDF" : "FILE",
              accent: variant?.color || "#3F6ED8",
            });

      args.setLegacyCreatives?.((prev) => [
        {
          id: tempId,
          filename,
          fileMeta,
          mediaVariantKey: args.variantKey,
          color: variant?.color || "rgba(148,163,184,.9)",
          assignedInventoryIds: [],
          thumbUrl: initialThumb,
          fullUrl: !isPdf && file.type.startsWith("image/") ? initialThumb : initialThumb,
          uploadState: "uploading",
          isOptimistic: true,
        },
        ...prev,
      ]);

      let thumbnailFile: File | null = null;
      try {
        if (isPdf) {
          thumbnailFile = await generatePdfThumbnail(file, filename);
          patchLocalCreative(tempId, {
            uploadState: "processing",
            thumbUrl: URL.createObjectURL(thumbnailFile),
          });
        } else {
          patchLocalCreative(tempId, {
            uploadState: "processing",
          });
        }
      } catch (error) {
        console.warn("Failed to generate PDF thumbnail", error);
        patchLocalCreative(tempId, { uploadState: "processing" });
      }

      try {
        const signed = await requestArtworkUploadUrl(args.apiClient, {
          projectId: args.projectId,
          customerId: args.customerId,
          filename,
          contentType: file.type || "application/octet-stream",
          shareMode: args.shareMode,
        });

        let signedThumb:
          | {
              bucket: string;
              key: string;
              uploadUrl: string;
            }
          | null = null;

        if (thumbnailFile) {
          const thumbSigned = await requestArtworkUploadUrl(args.apiClient, {
            projectId: args.projectId,
            customerId: args.customerId,
            filename: thumbnailFile.name,
            contentType: thumbnailFile.type || "image/jpeg",
            shareMode: args.shareMode,
          });
          signedThumb = {
            bucket: thumbSigned.bucket,
            key: thumbSigned.key,
            uploadUrl: thumbSigned.uploadUrl,
          };
        }

        const uploadResponse = await fetch(signed.uploadUrl, {
          method: "PUT",
          headers: {
            "Content-Type": file.type || "application/octet-stream",
          },
          body: file,
        });

        if (!uploadResponse.ok) {
          throw new Error(`Upload failed for ${filename}`);
        }

        if (signedThumb && thumbnailFile) {
          const thumbUploadResponse = await fetch(signedThumb.uploadUrl, {
            method: "PUT",
            headers: {
              "Content-Type": thumbnailFile.type || "image/jpeg",
            },
            body: thumbnailFile,
          });

          if (!thumbUploadResponse.ok) {
            throw new Error(`Thumbnail upload failed for ${filename}`);
          }
        }

        const creative = await createProjectCreativeAsset(args.apiClient, args.projectId, {
          bucketName: signed.bucket,
          objectKey: signed.key,
          thumbObjectKey: signedThumb?.key,
          filename,
          fileMeta,
          mediaVariantKey: args.variantKey,
          color: variant?.color || "rgba(148,163,184,.9)",
          contentType: file.type || "application/octet-stream",
          thumbContentType: thumbnailFile?.type || undefined,
          sizeBytes: file.size,
        }, args.shareMode);

        uploadedIds.push(creative.id);
        replaceLocalCreative(tempId, {
          ...creative,
          uploadState: "ready",
          isOptimistic: false,
        });
      } catch (error) {
        removeLocalCreative(tempId);
        throw error;
      }
    }

    return {
      uploadedIds,
      variant,
      message: `Uploaded ${args.files.length} file${args.files.length === 1 ? "" : "s"} as ${
        variant?.mediaName || "Media"
      } ${formatMediaDimensions(variant?.w || "", variant?.h || "")}`,
    };
  }

  args.files.forEach(({ file, filename, isPdf, objectUrl }) => {
    const id = makeUploadId("cr");
    uploadedIds.push(id);

    const fileMeta = `${isPdf ? "PDF" : "FILE"} · ${(file.size / 1024 / 1024).toFixed(1)} MB · ${
      variant?.mediaName || "Media"
    } ${formatMediaDimensions(variant?.w || "", variant?.h || "")}`;

    const creative = {
      id,
      filename,
      fileMeta,
      mediaVariantKey: args.variantKey,
      color: variant?.color || "rgba(148,163,184,.9)",
      thumbUrl: objectUrl || buildMockThumbUrl(id, 240, 180),
      fullUrl: objectUrl || (isPdf ? buildDocumentThumbUrl({ label: "PDF", accent: variant?.color || "#3F6ED8" }) : buildMockFullPreviewUrl(id, fileMeta, 1800)),
      uploadState: "ready" as const,
      isOptimistic: false,
    };

    if (args.isDemo && args.projectId) {
      demoStore.actions.addCreative(args.projectId, creative);
    } else if (args.setLegacyCreatives) {
      args.setLegacyCreatives((prev) => [
        ...prev,
        {
          ...creative,
          assignedInventoryIds: [],
        } as CreativeAsset,
      ]);
    }
  });

  return {
    uploadedIds,
    variant,
    message: `Uploaded ${args.files.length} file${args.files.length === 1 ? "" : "s"} as ${
      variant?.mediaName || "Media"
    } ${formatMediaDimensions(variant?.w || "", variant?.h || "")}`,
  };
}

export async function replaceProjectCreativeFile(args: {
  apiClient: ApiClientLike;
  projectId: string;
  creativeId: string;
  variantKey: string;
  color?: string;
  file: File;
  filename: string;
  isPdf: boolean;
  customerId?: string;
  shareMode?: boolean;
}) {
  let thumbnailFile: File | null = null;
  if (args.isPdf) {
    try {
      thumbnailFile = await generatePdfThumbnail(args.file, args.filename);
    } catch (error) {
      console.warn("Failed to generate replacement PDF thumbnail", error);
    }
  }

  const signed = await requestArtworkUploadUrl(args.apiClient, {
    projectId: args.projectId,
    customerId: args.customerId,
    filename: args.filename,
    contentType: args.file.type || "application/octet-stream",
    shareMode: args.shareMode,
  });

  let signedThumb:
    | {
        key: string;
        uploadUrl: string;
      }
    | null = null;

  if (thumbnailFile) {
    const thumbSigned = await requestArtworkUploadUrl(args.apiClient, {
      projectId: args.projectId,
      customerId: args.customerId,
      filename: thumbnailFile.name,
      contentType: thumbnailFile.type || "image/jpeg",
      shareMode: args.shareMode,
    });
    signedThumb = {
      key: thumbSigned.key,
      uploadUrl: thumbSigned.uploadUrl,
    };
  }

  const uploadResponse = await fetch(signed.uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": args.file.type || "application/octet-stream",
    },
    body: args.file,
  });

  if (!uploadResponse.ok) {
    throw new Error(`Upload failed for ${args.filename}`);
  }

  if (signedThumb && thumbnailFile) {
    const thumbUploadResponse = await fetch(signedThumb.uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": thumbnailFile.type || "image/jpeg",
      },
      body: thumbnailFile,
    });

    if (!thumbUploadResponse.ok) {
      throw new Error(`Thumbnail upload failed for ${args.filename}`);
    }
  }

  const variant = mockMediaVariants.find((v: any) => v.key === args.variantKey);
  const fileMeta = `${args.isPdf ? "PDF" : "FILE"} · ${(args.file.size / 1024 / 1024).toFixed(1)} MB · ${
    variant?.mediaName || "Media"
  } ${formatMediaDimensions(variant?.w || "", variant?.h || "")}`;

  const creative = await updateProjectCreativeAsset(args.apiClient, args.projectId, args.creativeId, {
    bucketName: signed.bucket,
    objectKey: signed.key,
    thumbObjectKey: signedThumb?.key,
    filename: args.filename,
    fileMeta,
    contentType: args.file.type || "application/octet-stream",
    thumbContentType: thumbnailFile?.type || undefined,
    sizeBytes: args.file.size,
  }, args.shareMode);

  return creative;
}
