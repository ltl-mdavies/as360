import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import AppShell from "../../app/AppShell";
import ArtworkFolderWorkspace from "./ArtworkFolderWorkspace";
import { ShareAccessDenied, useShareAccess } from "../../components/share/ShareAccess";
import { useApiClient } from "../../api/useApiClient";
import {
  deleteProjectCreativeAsset,
  fetchProjectWorkspace,
  invalidateProjectWorkspaceCache,
  peekProjectWorkspaceCache,
  logProjectErrorEvent,
  normalizeCreativeAsset,
  normalizeWorkspaceInventory,
  normalizeWorkspaceVariants,
  type ApiProjectWorkspaceResponse,
} from "../../api/projects";
import { demoStore, useDemoStore } from "../../domain/store/demoStore";
import { useDemoProjectContext } from "../../domain/selectors/useDemoProjectContext";
import { toLegacyCreatives, toLegacyInventory } from "../../domain/adapters/uiShapes";
import {
  addUploadedArtworkToProject,
  prepareUploadFilesWithPreview,
  replaceProjectCreativeFile,
  type ProjectUploadFile,
} from "../../components/uploader/uploadFiles";
import { getRollupById } from "../../logic/mockRollups";
import { isDemoProjectRoute } from "../../logic/projectMode";
import { mockMediaVariants, type CreativeAsset } from "../../logic/mockAssignment";

export default function ArtworkFolderPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const api = useApiClient();
  const [searchParams] = useSearchParams();
  const modeSuffix = searchParams.get("mode") === "customer" ? "?mode=customer" : "";
  const shareAccess = useShareAccess(projectId);

  const isDemo = isDemoProjectRoute(projectId, (location.state as any)?.demo === true);

  useEffect(() => {
    if (isDemo) demoStore.actions.hydrateDemo();
  }, [isDemo]);

  const demoActiveProjectId = useDemoStore((s) => s.activeProjectId);
  const demoCreativesAll = useDemoStore((s) => s.creatives);
  const ctx = useDemoProjectContext(demoActiveProjectId);

  const demoInventoryLegacy = useMemo(() => toLegacyInventory(ctx), [ctx]);
  const demoCreativesLegacy = useMemo(
    () =>
      toLegacyCreatives({
        ctx,
        legacyInventory: demoInventoryLegacy,
        demoCreativesAll,
      }),
    [ctx, demoInventoryLegacy, demoCreativesAll]
  );

  const [localCreatives, setLocalCreatives] = useState<CreativeAsset[]>([]);
  const [localVariants, setLocalVariants] = useState<typeof mockMediaVariants>([]);
  const [liveWorkspace, setLiveWorkspace] = useState<ApiProjectWorkspaceResponse | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const rollup = !isDemo && projectId === "proj_001" ? getRollupById(projectId) : undefined;

  const loadWorkspace = useCallback(async (force = false) => {
    if (!projectId || isDemo || shareAccess.isResolving) return;
    setWorkspaceLoading(true);
    try {
      if (!force) {
        const cached = peekProjectWorkspaceCache(projectId, shareAccess.isShareMode);
        if (cached) {
          setLiveWorkspace(cached);
          setLocalCreatives(cached.workspace.creatives.map(normalizeCreativeAsset));
          setLocalVariants(normalizeWorkspaceVariants(cached.workspace.variants));
        }
      }
      if (force) invalidateProjectWorkspaceCache(projectId, shareAccess.isShareMode);
      const response = await fetchProjectWorkspace(api, projectId, shareAccess.isShareMode);
      setLiveWorkspace(response);
      setLocalCreatives(response.workspace.creatives.map(normalizeCreativeAsset));
      setLocalVariants(normalizeWorkspaceVariants(response.workspace.variants));
    } catch (error) {
      console.error("Failed to load artwork folder workspace", error);
    } finally {
      setWorkspaceLoading(false);
    }
  }, [api, isDemo, projectId, shareAccess.isResolving, shareAccess.isShareMode]);

  useEffect(() => {
    let cancelled = false;
    if (!projectId || isDemo || shareAccess.isResolving) return;
    const cached = peekProjectWorkspaceCache(projectId, shareAccess.isShareMode);
    if (cached) {
      setLiveWorkspace(cached);
      setLocalCreatives(cached.workspace.creatives.map(normalizeCreativeAsset));
      setLocalVariants(normalizeWorkspaceVariants(cached.workspace.variants));
    }
    setWorkspaceLoading(!cached);
    void (async () => {
      try {
        const response = await fetchProjectWorkspace(api, projectId, shareAccess.isShareMode);
        if (cancelled) return;
        setLiveWorkspace(response);
        setLocalCreatives(response.workspace.creatives.map(normalizeCreativeAsset));
        setLocalVariants(normalizeWorkspaceVariants(response.workspace.variants));
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load artwork folder workspace", error);
        }
      } finally {
        if (!cancelled) setWorkspaceLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, isDemo, loadWorkspace, projectId, shareAccess.isResolving, shareAccess.isShareMode]);

  const projectTitle = isDemo
    ? ctx.title
    : liveWorkspace?.project.title || rollup?.title || (projectId === "proj_001" ? "White Claw @ Penn Station 12.25.2025" : `Project ${projectId}`);
  const venueName = isDemo ? ctx.venueName || "Penn Station" : liveWorkspace?.project.venueName || rollup?.venueName || "Penn Station";
  const marketName = isDemo ? ctx.venueMarket || "New York City" : liveWorkspace?.project.marketName || rollup?.marketName || "New York City";
  const artworkDue = isDemo ? ctx.artworkDueDate : liveWorkspace?.project.artworkDueDate || rollup?.dates.artworkDue || null;
  const postDate = isDemo ? ctx.postDate : liveWorkspace?.project.postDate || rollup?.dates.postDate || null;

  const uploadFiles = ({ variantKey, files }: { variantKey: string; files: ProjectUploadFile[] }) => {
    shareAccess.requireEdit("artwork", "artwork.upload", `uploaded ${files.length} artwork file${files.length === 1 ? "" : "s"}`, () => {
      void (async () => {
        try {
          const result = await addUploadedArtworkToProject({
            projectId: isDemo ? (demoActiveProjectId || "demo_001") : projectId,
            isDemo,
            shareMode: shareAccess.isShareMode,
            variantKey,
            files,
            setLegacyCreatives: setLocalCreatives,
            apiClient: api,
            customerId: liveWorkspace?.project.customerId,
          });
          if (!isDemo) {
            await loadWorkspace(true);
          }
          demoStore.actions.pushToast("success", result.message);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Artwork upload failed";
          if (!isDemo && projectId) {
            void logProjectErrorEvent(api, projectId, {
              actionType: "creative.upload",
              errorCode: "artwork_upload_failed",
              message,
              severity: "error",
              surface: "artwork_folder.upload",
              workspace: "artwork",
            }, shareAccess.isShareMode).catch(() => undefined);
          }
          demoStore.actions.pushToast("danger", message);
        }
      })();
    });
  };

  const deleteCreative = (creative: CreativeAsset) => {
    const assignedCount = creative.assignedInventoryIds?.length || 0;
    const confirmed = window.confirm(
      assignedCount > 0
        ? `${creative.filename} is currently assigned to ${assignedCount} location${assignedCount === 1 ? "" : "s"}. Deleting it will clear those assignments. Continue?`
        : `Delete ${creative.filename}?`
    );
    if (!confirmed) return;

    shareAccess.requireEdit("artwork", "artwork.delete", `deleted artwork file ${creative.filename}`, () => {
      void (async () => {
        const previousCreatives = localCreatives;
        setLocalCreatives((prev) => prev.filter((item) => item.id !== creative.id));
        try {
          if (isDemo) {
            demoStore.actions.removeCreative(demoActiveProjectId || "demo_001", creative.id);
            demoStore.actions.pushToast("success", "Artwork deleted");
            return;
          }
          if (!projectId) return;
          await deleteProjectCreativeAsset(api, projectId, creative.id, shareAccess.isShareMode);
          await loadWorkspace(true);
          demoStore.actions.pushToast("success", "Artwork deleted");
        } catch (error) {
          setLocalCreatives(previousCreatives);
          const message = error instanceof Error ? error.message : "We couldn't delete that artwork yet.";
          if (!isDemo && projectId) {
            void logProjectErrorEvent(api, projectId, {
              actionType: "creative.delete",
              errorCode: "artwork_delete_failed",
              message,
              severity: "error",
              surface: "artwork_folder.delete",
              workspace: "artwork",
            }, shareAccess.isShareMode).catch(() => undefined);
          }
          demoStore.actions.pushToast("danger", message);
        }
      })();
    });
  };

  const replaceCreative = (creative: CreativeAsset) => {
    if (!shareAccess.canEdit("artwork")) return;

    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/pdf,image/*";
    input.multiple = false;
    input.onchange = () => {
      void (async () => {
        const selected = input.files;
        if (!selected || selected.length === 0) return;
        const prepared = await prepareUploadFilesWithPreview(selected);
        const nextFile = prepared[0];
        if (!nextFile) return;

        shareAccess.requireEdit("artwork", "artwork.replace", `replaced artwork file ${creative.filename}`, () => {
          void (async () => {
            const previousCreatives = localCreatives;
            const existingVariantDetails = creative.fileMeta.split("·").slice(2).join("·").trim();

            setLocalCreatives((prev) =>
              prev.map((item) =>
                item.id === creative.id
                  ? {
                      ...item,
                      filename: nextFile.filename,
                      fileMeta: nextFile.isPdf
                        ? `PDF · ${nextFile.sizeLabel} · ${existingVariantDetails}`
                        : `FILE · ${nextFile.sizeLabel} · ${existingVariantDetails}`,
                      thumbUrl: nextFile.objectUrl || item.thumbUrl || item.fullUrl,
                      fullUrl: nextFile.objectUrl || item.fullUrl || item.thumbUrl,
                      uploadState: "processing",
                      isOptimistic: true,
                    }
                  : item
              )
            );

            try {
              if (isDemo) {
                demoStore.actions.updateCreative(demoActiveProjectId || "demo_001", creative.id, {
                  filename: nextFile.filename,
                  fileMeta: `${nextFile.isPdf ? "PDF" : "FILE"} · ${nextFile.sizeLabel} · ${creative.fileMeta.split("·").slice(2).join("·").trim()}`,
                  thumbUrl: nextFile.objectUrl || creative.thumbUrl,
                  fullUrl: nextFile.objectUrl || creative.fullUrl,
                } as any);
                demoStore.actions.pushToast("success", "Artwork replaced");
                return;
              }
              if (!projectId) return;
              const updated = await replaceProjectCreativeFile({
                apiClient: api,
                projectId,
                creativeId: creative.id,
                variantKey: creative.mediaVariantKey,
                color: creative.color,
                file: nextFile.file,
                filename: nextFile.filename,
                isPdf: nextFile.isPdf,
                customerId: liveWorkspace?.project.customerId,
                shareMode: shareAccess.isShareMode,
              });
              setLocalCreatives((prev) => prev.map((item) => (item.id === creative.id ? updated : item)));
              await loadWorkspace(true);
              demoStore.actions.pushToast("success", "Artwork replaced");
            } catch (error) {
              setLocalCreatives(previousCreatives);
              const message = error instanceof Error ? error.message : "We couldn't replace that artwork yet.";
              if (!isDemo && projectId) {
                void logProjectErrorEvent(api, projectId, {
                  actionType: "creative.replace",
                  errorCode: "artwork_replace_failed",
                  message,
                  severity: "error",
                  surface: "artwork_folder.replace",
                  workspace: "artwork",
                }, shareAccess.isShareMode).catch(() => undefined);
              }
              demoStore.actions.pushToast("danger", message);
            }
          })();
        });
      })();
    };
    input.click();
  };

  if (shareAccess.isShareMode && shareAccess.isResolving) {
    return (
      <AppShell pageClassName="wide" projectTitle={projectTitle}>
        <div className="assign-empty">
          <div className="assign-empty-title">Loading Artwork Folder</div>
          <div className="assign-empty-body">Checking your shared access and pulling the live project artwork guide.</div>
        </div>
      </AppShell>
    );
  }

  if (shareAccess.isShareMode && (!shareAccess.shareLink || shareAccess.isRevoked || !shareAccess.canView("artwork"))) {
    return (
      <AppShell pageClassName="wide" projectTitle={projectTitle}>
        <ShareAccessDenied
          title={shareAccess.isRevoked ? "This shared link has been revoked" : "This shared link cannot open Artwork Folder"}
          body="Ask the project owner for an Artwork Upload Only or collaboration link if you need to provide campaign artwork."
        />
      </AppShell>
    );
  }

  return (
    <AppShell pageClassName="wide" projectTitle={projectTitle}>
      <ArtworkFolderWorkspace
        projectId={projectId}
        projectTitle={projectTitle}
        venueName={venueName}
        marketName={marketName}
        artworkDue={artworkDue}
        postDate={postDate}
        creatives={isDemo ? demoCreativesLegacy : localCreatives}
        inventory={isDemo ? demoInventoryLegacy : liveWorkspace ? normalizeWorkspaceInventory(liveWorkspace.workspace.inventory) : []}
        variantCatalog={isDemo ? mockMediaVariants : localVariants}
        onUploadFiles={uploadFiles}
        canUpload={shareAccess.canEdit("artwork")}
        isLoading={!isDemo && workspaceLoading && !liveWorkspace}
        onDeleteCreative={shareAccess.canEdit("artwork") ? deleteCreative : undefined}
        onReplaceCreative={shareAccess.canEdit("artwork") ? replaceCreative : undefined}
        onBack={() => navigate(shareAccess.buildProjectUrl(`/p/${projectId}${modeSuffix}`), isDemo ? { state: { demo: true } } : undefined)}
      />
      {shareAccess.identityModal()}
    </AppShell>
  );
}
