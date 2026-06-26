// src/pages/CreativeAssignment/CreativeAssignmentPage.tsx
//
// Creative Assignment (Map-first) with post-submit review mode
// - Upload modal tags all files in session with selected media+dim variant
// - Uploaded creatives show real thumbs when available (objectURL for images; fallback for PDFs)
// - Review Allocation modal is primary before and after submit
// - After submit, the page becomes review-only until Lift supports order updates
// - Assignments fire global toasts (filename + inventory id)

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams, useLocation } from "react-router-dom";
import { Search, SlidersHorizontal, X } from "lucide-react";

import AppShell from "../../app/AppShell";
import { useApiClient } from "../../api/useApiClient";
import {
  deleteProjectCreativeAsset,
  fetchVenueDetail,
  fetchProjectWorkspace,
  invalidateProjectWorkspaceCache,
  logProjectErrorEvent,
  normalizeCreativeAsset,
  normalizeWorkspaceInventory,
  normalizeWorkspaceMaps,
  normalizeWorkspaceVariants,
  peekProjectWorkspaceCache,
  updateProjectAssignment,
  type ApiVenueDetailResponse,
  type ApiProjectWorkspaceResponse,
} from "../../api/projects";
import Panel from "../../components/common/Panel";
import Portal from "../../components/common/Portal";
import Lightbox from "../../components/common/Lightbox";
import PageHeader from "../../components/common/PageHeader";
import { WorkspacePresenceCluster } from "../../components/realtime/WorkspacePresenceCluster";
import { ShareAccessDenied, useShareAccess } from "../../components/share/ShareAccess";
import CreativeUploaderModal from "../../components/uploader/CreativeUploaderModal";
import {
  addUploadedArtworkToProject,
  prepareUploadFilesWithPreview,
  replaceProjectCreativeFile,
  type ProjectUploadFile,
} from "../../components/uploader/uploadFiles";
import ArtworkFolderWorkspace from "../ArtworkFolder/ArtworkFolderWorkspace";

import ReviewAllocationModal from "../../components/reviewAllocation/ReviewAllocationModal";
import { useSharedMapWorkspace } from "../../components/maps/useSharedMapWorkspace";
import { useCollaborationToastQueue } from "../../realtime/useCollaborationToastQueue";
import { useWorkspacePresence, type WorkspaceChangeEvent } from "../../realtime/useWorkspacePresence";

import { buildDocumentThumbUrl, buildMockFullPreviewUrl, buildMockThumbUrl } from "../../logic/imageUrls";

import { useDemoProjectContext } from "../../domain/selectors/useDemoProjectContext";

import { demoStore, useDemoStore } from "../../domain/store/demoStore";
import { getRollupById } from "../../logic/mockRollups";
import { isDemoProjectRoute } from "../../logic/projectMode";

import { toLegacyInventory, toLegacyCreatives } from "../../domain/adapters/uiShapes";

import {
  formatMediaDimensions,
  mockMaps,
  mockMediaVariants,
  mediaLabelFromKey,
  type CreativeAsset,
  type InventoryItem,
} from "../../logic/mockAssignment";

import { endAssignMode, startAssignMode, type AssignModeState } from "../../logic/useAssignmentMode";
import { resolveCreativeColor } from "../../logic/creativeColors";

function formatSpecNumber(value: number | string | null | undefined) {
  if (value == null || value === "") return "";
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return `${numeric}"`;
  return String(value);
}

function formatSpecDimensions(height: number | string | null | undefined, width: number | string | null | undefined, fallback = "Not specified") {
  const formattedHeight = formatSpecNumber(height);
  const formattedWidth = formatSpecNumber(width);
  if (formattedHeight && formattedWidth) return `${formattedHeight}h x ${formattedWidth}w`;
  return fallback;
}

function getInventoryMediaName(item: InventoryItem, variant?: any) {
  return item.mediaType || variant?.mediaName || mediaLabelFromKey(item.mediaVariantKey).split(" • ")[0] || "Media";
}

function formatRemoteAssignmentSummary(event: WorkspaceChangeEvent) {
  const actor = event.actorName || "Another user";
  const detail = event.detail || {};
  const inventoryLabel = typeof detail.inventoryLabel === "string" ? detail.inventoryLabel : "";
  const creativeFilename = typeof detail.creativeFilename === "string" ? detail.creativeFilename : "";
  if (event.eventType === "assignment.cleared" && inventoryLabel) return `${actor} cleared ${inventoryLabel}.`;
  if (inventoryLabel && creativeFilename) return `${actor} assigned ${inventoryLabel} to ${creativeFilename}.`;
  return event.summary || "Assignment updated by another user.";
}

function mergeInventoryVenueSpecs(inventory: InventoryItem[], venueDetail: ApiVenueDetailResponse | null) {
  if (!venueDetail?.inventory?.length) return inventory;
  const byRecordId = new Map(venueDetail.inventory.map((item) => [item.id, item]));
  const byInventoryId = new Map(venueDetail.inventory.map((item) => [item.inventoryId, item]));

  return inventory.map((item) => {
    const venueItem = (item.recordId ? byRecordId.get(item.recordId) : undefined) || byInventoryId.get(item.id);
    if (!venueItem) return item;
    return {
      ...item,
      mediaVariantKey: venueItem.mediaVariantKey || item.mediaVariantKey,
      mediaType: venueItem.mediaType || item.mediaType || undefined,
      trimHeight: venueItem.trimHeight ?? item.trimHeight ?? null,
      trimWidth: venueItem.trimWidth ?? item.trimWidth ?? null,
      safeHeight: venueItem.safeHeight ?? item.safeHeight ?? null,
      safeWidth: venueItem.safeWidth ?? item.safeWidth ?? null,
      notes: item.notes?.trim() ? item.notes : venueItem.notes || item.notes || "",
    };
  });
}

export default function CreativeAssignmentPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const api = useApiClient();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const modeSuffix = searchParams.get("mode") === "customer" ? "?mode=customer" : "";
  const useClassicHeader = ["1", "true", "yes"].includes((searchParams.get("classicHeader") || "").toLowerCase());
  const useUtilityHeader = !useClassicHeader;
  const shareAccess = useShareAccess(projectId);

  // Demo mode: either the known demo project id OR explicit navigation flag
  const isDemo = isDemoProjectRoute(projectId, (location.state as any)?.demo === true);

  useEffect(() => {
    if (isDemo) demoStore.actions.hydrateDemo();
  }, [isDemo]);

  const getCreativeThumb = useCallback((creative: CreativeAsset) => {
    if (isDemo) return (creative as any).thumbUrl || buildMockThumbUrl(creative.id, 160, 120);
    return (
      (creative as any).thumbUrl ||
      (creative as any).fullUrl ||
      buildDocumentThumbUrl({
        label: creative.fileMeta?.toUpperCase().includes("PDF") ? "PDF" : "FILE",
        accent: creative.color || "#94a3b8",
      })
    );
  }, [isDemo]);

  const getCreativeFull = useCallback((creative: CreativeAsset) => {
    if (isDemo) return (creative as any).fullUrl || buildMockFullPreviewUrl(creative.id, creative.fileMeta);
    return (creative as any).fullUrl || getCreativeThumb(creative);
  }, [getCreativeThumb, isDemo]);

  // -------------------------
  // Non-demo local state (legacy mocks)
  // -------------------------
  const [creativesState, setCreativesState] = useState<CreativeAsset[]>([]);
  const [inventoryState, setInventoryState] = useState<InventoryItem[]>([]);
  const [mapsState, setMapsState] = useState<typeof mockMaps>([]);
  const [variantsState, setVariantsState] = useState<typeof mockMediaVariants>([]);
  const [liveWorkspace, setLiveWorkspace] = useState<ApiProjectWorkspaceResponse | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [assignmentSaveState, setAssignmentSaveState] = useState<{
    tone: "idle" | "saving" | "saved" | "error";
    message: string;
  }>({
    tone: "idle",
    message: "",
  });

// -------------------------
// Demo store reads (stable refs only)
// -------------------------
const demoActiveProjectId = useDemoStore((s) => s.activeProjectId);

// These are still needed for uploader + thumbs (demo-first)
const demoCreativesAll = useDemoStore((s) => s.creatives);

// Canonical project context (A1 hardening)
const ctx = useDemoProjectContext(demoActiveProjectId);

const demoInventoryLegacy: InventoryItem[] = useMemo(() => {
  return toLegacyInventory(ctx);
}, [ctx]);

const demoCreativesLegacy: CreativeAsset[] = useMemo(() => {
  return toLegacyCreatives({
    ctx,
    legacyInventory: demoInventoryLegacy,
    demoCreativesAll, // preserve thumbUrl/fullUrl from uploader
  });
}, [ctx, demoInventoryLegacy, demoCreativesAll]);

  const enrichWorkspaceInventory = useCallback(
    async (response: ApiProjectWorkspaceResponse, baseInventory: InventoryItem[]) => {
      if (shareAccess.isShareMode || !response.project.venueId) return baseInventory;
      try {
        const venueDetail = await fetchVenueDetail(api, response.project.venueId);
        return mergeInventoryVenueSpecs(baseInventory, venueDetail);
      } catch (error) {
        console.warn("Unable to enrich assignment inventory specs from venue detail", error);
        return baseInventory;
      }
    },
    [api, shareAccess.isShareMode]
  );

  const loadWorkspace = useCallback(async (force = false, options: { silent?: boolean } = {}) => {
    if (!projectId || isDemo || shareAccess.isResolving) return;
    if (!options.silent) setWorkspaceLoading(true);
    try {
      if (!force) {
        const cached = peekProjectWorkspaceCache(projectId, shareAccess.isShareMode);
        if (cached) {
          setLiveWorkspace(cached);
          setCreativesState(cached.workspace.creatives.map(normalizeCreativeAsset));
          setInventoryState(normalizeWorkspaceInventory(cached.workspace.inventory));
          setMapsState(normalizeWorkspaceMaps(cached.workspace.maps));
          setVariantsState(normalizeWorkspaceVariants(cached.workspace.variants));
        }
      }
      if (force) invalidateProjectWorkspaceCache(projectId, shareAccess.isShareMode);
      const response = await fetchProjectWorkspace(api, projectId, shareAccess.isShareMode);
      const nextInventory = await enrichWorkspaceInventory(response, normalizeWorkspaceInventory(response.workspace.inventory));
      setLiveWorkspace(response);
      setCreativesState(response.workspace.creatives.map(normalizeCreativeAsset));
      setInventoryState(nextInventory);
      setMapsState(normalizeWorkspaceMaps(response.workspace.maps));
      setVariantsState(normalizeWorkspaceVariants(response.workspace.variants));
    } catch (error) {
      console.error("Failed to load creative assignment workspace", error);
    } finally {
      if (!options.silent) setWorkspaceLoading(false);
    }
  }, [api, enrichWorkspaceInventory, isDemo, projectId, shareAccess.isResolving, shareAccess.isShareMode]);

  const enqueueCollaborationToast = useCollaborationToastQueue("Assignment updated by another user.");

  const requestRemoteAssignmentSync = useCallback(() => {
    if (!projectId || isDemo) return;
    invalidateProjectWorkspaceCache(projectId, shareAccess.isShareMode);
    void loadWorkspace(true, { silent: true });
  }, [isDemo, loadWorkspace, projectId, shareAccess.isShareMode]);

  const handleRemoteAssignmentChange = useCallback((event: WorkspaceChangeEvent) => {
    requestRemoteAssignmentSync();
    enqueueCollaborationToast(event, formatRemoteAssignmentSummary(event));
  }, [enqueueCollaborationToast, requestRemoteAssignmentSync]);

  const presence = useWorkspacePresence({
    api,
    projectId,
    workspace: "assignment",
    enabled: !isDemo && Boolean(projectId) && !shareAccess.isResolving,
    shareMode: shareAccess.isShareMode,
    onRemoteChange: handleRemoteAssignmentChange,
    onSyncRequested: requestRemoteAssignmentSync,
  });

  useEffect(() => {
    let cancelled = false;
    if (!projectId || isDemo || shareAccess.isResolving) return;
    const cached = peekProjectWorkspaceCache(projectId, shareAccess.isShareMode);
    if (cached) {
      setLiveWorkspace(cached);
      setCreativesState(cached.workspace.creatives.map(normalizeCreativeAsset));
      setInventoryState(normalizeWorkspaceInventory(cached.workspace.inventory));
      setMapsState(normalizeWorkspaceMaps(cached.workspace.maps));
      setVariantsState(normalizeWorkspaceVariants(cached.workspace.variants));
    }
    setWorkspaceLoading(!cached);
    void (async () => {
      try {
        const response = await fetchProjectWorkspace(api, projectId, shareAccess.isShareMode);
        if (cancelled) return;
        const nextInventory = await enrichWorkspaceInventory(response, normalizeWorkspaceInventory(response.workspace.inventory));
        if (cancelled) return;
        setLiveWorkspace(response);
        setCreativesState(response.workspace.creatives.map(normalizeCreativeAsset));
        setInventoryState(nextInventory);
        setMapsState(normalizeWorkspaceMaps(response.workspace.maps));
        setVariantsState(normalizeWorkspaceVariants(response.workspace.variants));
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load creative assignment workspace", error);
        }
      } finally {
        if (!cancelled) setWorkspaceLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, enrichWorkspaceInventory, isDemo, projectId, shareAccess.isResolving, shareAccess.isShareMode]);

  useEffect(() => {
    if (assignmentSaveState.tone !== "saved" && assignmentSaveState.tone !== "error") return;
    const timeout = window.setTimeout(() => {
      setAssignmentSaveState((current) => (current.tone === "saving" ? current : { tone: "idle", message: "" }));
    }, assignmentSaveState.tone === "saved" ? 2200 : 3400);
    return () => window.clearTimeout(timeout);
  }, [assignmentSaveState]);

  function formatAssignmentSaveStamp() {
    return `Saved ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  }

  // -------------------------
  // Choose data source for the page
  // -------------------------
  const creatives: CreativeAsset[] = isDemo ? demoCreativesLegacy : creativesState;
  const inventory: InventoryItem[] = isDemo ? demoInventoryLegacy : inventoryState;
  const maps = isDemo ? mockMaps : mapsState;
  const variantCatalog = isDemo ? mockMediaVariants : variantsState;
  const variantByKey = useMemo(
    () => new Map(variantCatalog.map((variant: any) => [variant.key, variant])),
    [variantCatalog]
  );
  const creativeDisplayColorById = useMemo(() => {
    const next = new Map<string, string>();
    creatives.forEach((creative) => {
      const variant = variantByKey.get(creative.mediaVariantKey) as any;
      next.set(creative.id, resolveCreativeColor(creative, { variantColor: variant?.color }));
    });
    return next;
  }, [creatives, variantByKey]);

  const liveOrderNumber = liveWorkspace?.project.liftOrderId || null;
  const isSubmitted = isDemo ? ctx.isSubmitted : !!liveOrderNumber;
  const isLocked = isSubmitted || (shareAccess.isShareMode && !shareAccess.canEdit("assignment"));
  const canUploadArtwork = shareAccess.canEdit("artwork");

  // -------------------------
  // Assigned locations expand/collapse per card
  // -------------------------
  const [expandedLocs, setExpandedLocs] = useState<Record<string, boolean>>({});

  // Layout state
  const [activeMapId, setActiveMapId] = useState("");
  const activeMap = useMemo(() => maps.find((m) => m.id === activeMapId) || null, [maps, activeMapId]);

  useEffect(() => {
    if (maps.length === 0) {
      if (activeMapId) setActiveMapId("");
      return;
    }
    if (!activeMapId || !maps.some((map) => map.id === activeMapId)) {
      setActiveMapId(maps[0]?.id ?? "");
    }
  }, [maps, activeMapId]);

  const [creativeQuery, setCreativeQuery] = useState("");
  const [activeVariantKey, setActiveVariantKey] = useState<string | null>(null);

  // Filter source
  const [filterSource, setFilterSource] = useState<"manual" | "auto" | null>(null);

  // Assign mode
  const [assignMode, setAssignMode] = useState<AssignModeState>(endAssignMode());
  const [invQuery, setInvQuery] = useState("");
  const [mapInvQuery, setMapInvQuery] = useState("");

  // Pins + popover
  const [activePinId, setActivePinId] = useState<string | null>(null);
  const [pinPopoverId, setPinPopoverId] = useState<string | null>(null);
  const [pinPopoverMode, setPinPopoverMode] = useState<"summary" | "pick">("summary");

  // Popover positioning
  const [pinAnchor, setPinAnchor] = useState<DOMRect | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const [popPos, setPopPos] = useState<{ left: number; top: number } | null>(null);

  // Lightbox
  const [lightbox, setLightbox] = useState<{
    src: string;
    fallbackSrc?: string;
    title?: string;
    subtitle?: string;
    openUrl?: string;
    assetType?: "image" | "document";
  } | null>(null);

  // Hover assigned ID and scale pin on map
  const [hoveredInvId, setHoveredInvId] = useState<string | null>(null);

  // Review Allocation Modal
  const [isReviewOpen, setReviewOpen] = useState(false);

  // Uploader Modal
  const [isUploaderOpen, setUploaderOpen] = useState(false);
  const [isArtworkFolderOpen, setArtworkFolderOpen] = useState(false);

  // Rail 2 view toggle
  const [assignView, setAssignView] = useState<"map" | "list">("map");
  const [isListOnlyViewport, setIsListOnlyViewport] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 980px)").matches
  );
  const [isListFirstViewport, setIsListFirstViewport] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 1319px)").matches
  );
  const [hasManualViewChoice, setHasManualViewChoice] = useState(false);

  useEffect(() => {
    const listOnlyQuery = window.matchMedia("(max-width: 980px)");
    const listFirstQuery = window.matchMedia("(max-width: 1319px)");
    const updateViewportMode = () => {
      setIsListOnlyViewport(listOnlyQuery.matches);
      setIsListFirstViewport(listFirstQuery.matches);
    };

    updateViewportMode();
    listOnlyQuery.addEventListener("change", updateViewportMode);
    listFirstQuery.addEventListener("change", updateViewportMode);
    return () => {
      listOnlyQuery.removeEventListener("change", updateViewportMode);
      listFirstQuery.removeEventListener("change", updateViewportMode);
    };
  }, []);

  useEffect(() => {
    if (isListOnlyViewport) {
      setAssignView("list");
      return;
    }
    if (isListFirstViewport && !hasManualViewChoice) {
      setAssignView("list");
      return;
    }
    if (!isListFirstViewport && !hasManualViewChoice) {
      setAssignView("map");
    }
  }, [hasManualViewChoice, isListFirstViewport, isListOnlyViewport]);

  function selectAssignView(view: "map" | "list") {
    setHasManualViewChoice(true);
    setAssignView(isListOnlyViewport && view === "map" ? "list" : view);
  }

  const {
    viewportRef: mapViewportRef,
    imageRef: mapImgRef,
    mapFrameStyle,
    zoom,
    pan,
    isPanning,
    mapLoading,
    fitMapToView,
    onImageLoad: onMapImageLoad,
    onImageError: onMapImageError,
    onWheelMap,
    onMouseDownMap,
    onMouseMoveMap,
    onMouseUpMap,
  } = useSharedMapWorkspace({
    mapSrc: assignView === "map" ? activeMap?.imageUrl : undefined,
    activeKey: `${assignView}:${activeMapId}`,
    enabled: assignView === "map",
  });

  // Inventory List view filters
  const [invListQuery, setInvListQuery] = useState("");
  const [invListMapId, setInvListMapId] = useState<string>("all");
  const [invListVariantKey, setInvListVariantKey] = useState<string>("all");
  const [mobileInventoryToolsExpanded, setMobileInventoryToolsExpanded] = useState(false);
  const assignListFilterSnapshotRef = useRef<{
    query: string;
    mapId: string;
    variantKey: string;
  } | null>(null);
  
  // Inventory List inline picker (Assigned column)
  const [openInvPickerId, setOpenInvPickerId] = useState<string | null>(null);
  const [mapModalInventoryId, setMapModalInventoryId] = useState<string | null>(null);
  const [openListDetailsId, setOpenListDetailsId] = useState<string | null>(null);
  
  
  const listStageRef = useRef<HTMLDivElement | null>(null);
  const mobileInventorySearchRef = useRef<HTMLInputElement | null>(null);

useEffect(() => {
  if (!openInvPickerId) return;

  function onDocDown(e: MouseEvent) {
    const t = e.target as HTMLElement | null;
    if (!t) return;

    // 1) If click is inside the open picker, do nothing
    const pickerEl = document.querySelector(
      `.assign-listAssigned .pin-pop-picker`
    ) as HTMLElement | null;
    if (pickerEl && pickerEl.contains(t)) return;

    // 2) If click is on the chip that opened it, do nothing (so toggle works)
    const chipEl = document.querySelector(
      `.assign-listChip[data-inv="${openInvPickerId}"]`
    ) as HTMLElement | null;
    if (chipEl && chipEl.contains(t)) return;

    // Otherwise, close
    setOpenInvPickerId(null);
  }

  document.addEventListener("mousedown", onDocDown);
  return () => document.removeEventListener("mousedown", onDocDown);
}, [openInvPickerId]);

  // -------------------------
  // Derived lookups
  // -------------------------
  const activeCreative = useMemo(() => {
    if (!assignMode.creativeId) return null;
    return creatives.find((c) => c.id === assignMode.creativeId) || null;
  }, [assignMode.creativeId, creatives]);

  const creativeById = useMemo(() => {
    const map = new Map<string, CreativeAsset>();
    creatives.forEach((c) => map.set(c.id, c));
    return map;
  }, [creatives]);

  const mapModalInventory = useMemo(
    () => inventory.find((item) => item.id === mapModalInventoryId) || null,
    [inventory, mapModalInventoryId]
  );
  const mapModalMap = useMemo(
    () => maps.find((map) => map.id === mapModalInventory?.mapId) || null,
    [mapModalInventory?.mapId, maps]
  );
  const {
    viewportRef: modalMapViewportRef,
    imageRef: modalMapImgRef,
    mapFrameStyle: modalMapFrameStyle,
    zoom: modalMapZoom,
    pan: modalMapPan,
    mapError: modalMapError,
    fitMapToView: fitModalMapToView,
    onImageLoad: onModalMapImageLoad,
    onImageError: onModalMapImageError,
    onWheelMap: onWheelModalMap,
    onMouseDownMap: onMouseDownModalMap,
    onMouseMoveMap: onMouseMoveModalMap,
    onMouseUpMap: onMouseUpModalMap,
  } = useSharedMapWorkspace({
    mapSrc: mapModalMap?.imageUrl,
    activeKey: `list-map-modal:${mapModalMap?.id || ""}:${mapModalInventoryId || ""}`,
    enabled: !!mapModalInventoryId,
  });

  const isAllocationComplete = useMemo(
    () => inventory.length > 0 && inventory.every((i) => !!i.assignedCreativeId),
    [inventory]
  );
  const assignedCreativesCount = useMemo(
    () => creatives.filter((c) => c.assignedInventoryIds.length > 0).length,
    [creatives]
  );
  const assignedLocationsCount = useMemo(
    () => inventory.filter((i) => !!i.assignedCreativeId).length,
    [inventory]
  );
  const remainingLocationsCount = Math.max(0, inventory.length - assignedLocationsCount);

  // Variant options for dropdown
  const variantOptions = useMemo(() => {
    const keys = Array.from(new Set(variantCatalog.map((v: any) => v.key)));
    return ["all", ...keys];
  }, [variantCatalog]);

  // Filter creatives by search + active variant
  const creativesFiltered = useMemo(() => {
    const q = creativeQuery.trim().toLowerCase();
    return creatives.filter((c) => {
      const matchesAssignFocus = !assignMode.isActive || assignMode.creativeId === c.id;
      const matchesText = !q || c.filename.toLowerCase().includes(q);
      const matchesVariant = !activeVariantKey || c.mediaVariantKey === activeVariantKey;
      return matchesAssignFocus && matchesText && matchesVariant;
    });
  }, [creativeQuery, creatives, activeVariantKey, assignMode.isActive, assignMode.creativeId]);

  // Counts per variant on current map
  const variantCounts = useMemo(() => {
    const out = new Map<string, { total: number; assigned: number }>();
    inventory
      .filter((item) => item.mapId === activeMapId)
      .forEach((item) => {
        const next = out.get(item.mediaVariantKey) || { total: 0, assigned: 0 };
        next.total += 1;
        if (item.assignedCreativeId) next.assigned += 1;
        out.set(item.mediaVariantKey, next);
      });
    return out;
  }, [inventory, activeMapId]);
  
  const mapNameById = useMemo(() => {
    const out: Record<string, string> = {};
    maps.forEach((m) => (out[m.id] = m.name));
    return out;
  }, [maps]);

  const mapCountsById = useMemo(() => {
    const out: Record<string, { total: number; assigned: number }> = {};
    maps.forEach((m) => {
      out[m.id] = { total: 0, assigned: 0 };
    });

    inventory.forEach((i) => {
      if (!out[i.mapId]) out[i.mapId] = { total: 0, assigned: 0 };
      out[i.mapId].total += 1;
      if (i.assignedCreativeId) out[i.mapId].assigned += 1;
    });

    return out;
  }, [inventory, maps]);

  const inventoryListRows = useMemo(() => {
    const q = invListQuery.trim().toLowerCase();

    return inventory
      .filter((i) => (invListMapId === "all" ? true : i.mapId === invListMapId))
      .filter((i) => (invListVariantKey === "all" ? true : i.mediaVariantKey === invListVariantKey))
      .filter((i) => (q ? i.id.toLowerCase().includes(q) : true))
      .sort((a, b) => {
        if (a.mapId !== b.mapId) return a.mapId.localeCompare(b.mapId);
        return a.id.localeCompare(b.id);
      });
  }, [inventory, invListQuery, invListMapId, invListVariantKey]);

  const isListAssignMode = assignView === "list" && assignMode.isActive && !!activeCreative;
  const listRowsForRender = useMemo(() => {
    if (!isListAssignMode || !activeCreative) return inventoryListRows;
    return inventoryListRows.filter((item) => item.mediaVariantKey === activeCreative.mediaVariantKey);
  }, [activeCreative, inventoryListRows, isListAssignMode]);

  const hasActiveInventoryListFilters = Boolean(invListQuery.trim()) || invListMapId !== "all" || invListVariantKey !== "all";
  const inventoryListMapFilterLabel = invListMapId === "all" ? "All maps" : mapNameById[invListMapId] || "Map filter";
  const inventoryListMediaFilterLabel = invListVariantKey === "all" ? "All media" : mediaLabelFromKey(invListVariantKey);
  const inventoryListFilterSummary = hasActiveInventoryListFilters
    ? `${inventoryListMapFilterLabel} · ${inventoryListMediaFilterLabel}`
    : "to assign";

  const expandMobileInventoryTools = useCallback((focusSearch = false) => {
    setMobileInventoryToolsExpanded(true);
    if (focusSearch) {
      window.setTimeout(() => mobileInventorySearchRef.current?.focus(), 80);
    }
  }, []);

  const clearInventoryListFilters = useCallback(() => {
    setInvListQuery("");
    setInvListMapId("all");
    setInvListVariantKey("all");
  }, []);

  const scrollInventoryListTop = useCallback(() => {
    listStageRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  // Pins visible on map (map + activeVariantKey filter)
  const pinsOnActiveMap = useMemo(() => {
    const q = mapInvQuery.trim().toLowerCase();
    return inventory
      .filter((i) => i.mapId === activeMapId)
      .filter((i) => !activeVariantKey || i.mediaVariantKey === activeVariantKey)
      .filter((i) => (q ? i.id.toLowerCase().includes(q) : true));
  }, [inventory, activeMapId, activeVariantKey, mapInvQuery]);

  const activeMapAssignedCount = useMemo(
    () => inventory.filter((i) => i.mapId === activeMapId && !!i.assignedCreativeId).length,
    [inventory, activeMapId]
  );
  const activeMapTotalCount = useMemo(
    () => inventory.filter((i) => i.mapId === activeMapId).length,
    [inventory, activeMapId]
  );

  const inventoryListAssignedCount = useMemo(
    () => listRowsForRender.filter((item) => !!item.assignedCreativeId).length,
    [listRowsForRender]
  );
  const isInventoryListContext = assignView === "list";
  const inventoryContextTitle = isInventoryListContext
    ? invListMapId === "all"
      ? "All venue inventory"
      : inventoryListMapFilterLabel
    : activeMap?.name || "Location";
  const inventoryContextAssignedCount = isInventoryListContext ? inventoryListAssignedCount : activeMapAssignedCount;
  const inventoryContextTotalCount = isInventoryListContext ? listRowsForRender.length : activeMapTotalCount;
  const inventoryContextSummary = isInventoryListContext
    ? invListMapId === "all"
      ? `${inventoryContextAssignedCount}/${inventoryContextTotalCount} assigned in list`
      : `${inventoryContextAssignedCount}/${inventoryContextTotalCount} assigned on map`
    : `${inventoryContextAssignedCount}/${inventoryContextTotalCount} locations assigned in this view`;
  const inventoryContextCompactSummary = `${inventoryContextAssignedCount}/${inventoryContextTotalCount} assigned`;
  const inventoryContextIsComplete =
    inventoryContextTotalCount > 0 && inventoryContextAssignedCount === inventoryContextTotalCount;

  // Pin declutter (hover-only)
  const declutterCenterId = hoveredInvId || activePinId || null;

  function openCreativePreview(creative: CreativeAsset | null | undefined) {
    if (!creative) return;
    const isDocument = creative.fileMeta?.toUpperCase().includes("PDF");
    const fullPreview = getCreativeFull(creative);
    const thumbPreview = getCreativeThumb(creative);
    setLightbox({
      src: fullPreview,
      title: creative.filename,
      subtitle: creative.fileMeta,
      openUrl: fullPreview,
      fallbackSrc: thumbPreview,
      assetType: isDocument ? "document" : "image",
    });
  }

  const pinJitterById = useMemo(() => {
    const out = new Map<string, { jx: number; jy: number }>();
    if (!declutterCenterId) return out;

    const center = pinsOnActiveMap.find((p) => p.id === declutterCenterId);
    if (!center) return out;

    const radiusNorm = 0.03 / Math.max(zoom, 0.7);

    const neighbors = pinsOnActiveMap
      .filter((p) => Math.hypot(p.x - center.x, p.y - center.y) <= radiusNorm)
      .sort((a, b) => a.id.localeCompare(b.id));

    if (neighbors.length <= 1) return out;

    const spreadPx = 20;
    const others = neighbors.filter((n) => n.id !== center.id);

    others.forEach((p, idx) => {
      const angle = (Math.PI * 2 * idx) / others.length;
      out.set(p.id, {
        jx: Math.round(Math.cos(angle) * spreadPx),
        jy: Math.round(Math.sin(angle) * spreadPx),
      });
    });

    out.set(center.id, { jx: 0, jy: 0 });
    return out;
  }, [declutterCenterId, pinsOnActiveMap, zoom]);

  // Assign overlay lists
  const assignLists = useMemo(() => {
    if (!assignMode.isActive || !activeCreative) return { available: [], elsewhere: [] };

    const q = invQuery.trim().toLowerCase();
    const matching = inventory
      .filter((i) => i.mapId === activeMapId)
      .filter((i) => i.mediaVariantKey === activeCreative.mediaVariantKey)
      .filter((i) => (q ? i.id.toLowerCase().includes(q) : true));

    const available: InventoryItem[] = [];
    const elsewhere: InventoryItem[] = [];

    for (const i of matching) {
      if (!i.assignedCreativeId || i.assignedCreativeId === activeCreative.id) available.push(i);
      else elsewhere.push(i);
    }
    return { available, elsewhere };
  }, [assignMode.isActive, activeCreative, inventory, activeMapId, invQuery]);

  // -------------------------
  // Helpers
  // -------------------------
  function isExpanded(id: string) {
    return !!expandedLocs[id];
  }

  function toggleExpanded(id: string) {
    setExpandedLocs((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function closePopover() {
    setPinPopoverId(null);
    setPinPopoverMode("summary");
    setPinAnchor(null);
    setPopPos(null);
  }

  function applyLocalAssignmentUpdate(inventoryId: string, creativeId: string | null) {
    const nextUpdatedAt = new Date().toISOString();

    setInventoryState((prev) =>
      prev.map((item) =>
        item.id === inventoryId
          ? {
              ...item,
              assignedCreativeId: creativeId,
              assignmentUpdatedAt: nextUpdatedAt,
            }
          : item
      )
    );

    setCreativesState((prev) =>
      prev.map((creative) => {
        const withoutInventory = (creative.assignedInventoryIds || []).filter((id) => id !== inventoryId);
        if (creative.id === creativeId) {
          return {
            ...creative,
            assignedInventoryIds: withoutInventory.includes(inventoryId)
              ? withoutInventory
              : [...withoutInventory, inventoryId],
          };
        }
        return {
          ...creative,
          assignedInventoryIds: withoutInventory,
        };
      })
    );
  }

  function setAssignment(inventoryId: string, creativeId: string | null) {
    if (isLocked) return;

    const inv = inventory.find((i) => i.id === inventoryId);
    if (!inv) return;
    const nextCreative = creativeId ? creativeById.get(creativeId) : null;
    const prevCreative = inv?.assignedCreativeId ? creativeById.get(inv.assignedCreativeId) : null;
    const inventoryRecordId = inv.recordId || inventoryId;

    const invLabel = inventoryId;
    const fileLabel = nextCreative?.filename || "Creative";

    const msgAssign = `Assigned “${fileLabel}” → ${invLabel}`;
    const msgRemove = prevCreative ? `Removed ${invLabel} from “${prevCreative.filename}”` : `Removed assignment from ${invLabel}`;

    const applyAssignment = () => {
      if (isDemo) {
        const demoProjectId = demoActiveProjectId || "demo_001";
        demoStore.actions.setAssignment(demoProjectId, inventoryId, creativeId);
        setAssignmentSaveState({
          tone: "saved",
          message: formatAssignmentSaveStamp(),
        });
        return;
      }

      if (!projectId) return;

      void (async () => {
        const previousInventory = inventoryState;
        const previousCreatives = creativesState;
        try {
          applyLocalAssignmentUpdate(inventoryId, creativeId);
          setAssignmentSaveState({ tone: "saving", message: "Saving in background…" });
          await updateProjectAssignment(
            api,
            projectId,
            inventoryRecordId,
            creativeId,
            inventory.find((item) => item.recordId === inventoryRecordId)?.assignmentUpdatedAt ?? null,
            shareAccess.isShareMode,
            presence.sessionId
          );
          setAssignmentSaveState({
            tone: "saved",
            message: formatAssignmentSaveStamp(),
          });
          void loadWorkspace(true);
        } catch (error) {
          setInventoryState(previousInventory);
          setCreativesState(previousCreatives);
          const message = error instanceof Error ? error.message : "Failed to save assignment";
          void logProjectErrorEvent(api, projectId, {
            actionType: "assignment.update",
            errorCode: "assignment_update_failed",
            message,
            severity: "error",
            surface: "creative_assignment.assignment",
            workspace: "assignment",
            metadata: {
              inventoryRecordId,
              creativeId,
            },
          }, shareAccess.isShareMode).catch(() => undefined);
          setAssignmentSaveState({ tone: "error", message: "Couldn’t save. Try again." });
          demoStore.actions.pushToast("danger", message);
        }
      })();
    };

    shareAccess.requireEdit("assignment", "assignment.update", creativeId ? msgAssign : msgRemove, applyAssignment);
  }

  function toggleForActiveCreative(inventoryId: string) {
    if (!activeCreative) return;
    const inv = inventory.find((i) => i.id === inventoryId);
    if (!inv) return;

    if (inv.assignedCreativeId === activeCreative.id) return setAssignment(inventoryId, null);
    if (!inv.assignedCreativeId) return setAssignment(inventoryId, activeCreative.id);
  }

  function onPinClick(invId: string, anchorEl?: HTMLElement | null) {
    setActivePinId(invId);

    if (assignMode.isActive) {
      toggleForActiveCreative(invId);
      return;
    }

    setPinPopoverId(invId);
    setPinPopoverMode("summary");

    if (anchorEl) {
      const r = anchorEl.getBoundingClientRect();
      setPinAnchor(r);
      setPopPos({ left: r.right + 12, top: Math.max(10, r.top - 10) });
    } else {
      setPinAnchor(null);
      setPopPos(null);
    }
  }

  function onStartAssign(creativeId: string) {
    if (isLocked) return;
    setAssignMode(startAssignMode(creativeId));
    setInvQuery("");

    const c = creatives.find((x) => x.id === creativeId);
    if (c) {
      setActiveVariantKey(c.mediaVariantKey);
      setFilterSource("auto");
      if (assignView === "list") {
        if (!assignListFilterSnapshotRef.current) {
          assignListFilterSnapshotRef.current = {
            query: invListQuery,
            mapId: invListMapId,
            variantKey: invListVariantKey,
          };
        }
        setInvListVariantKey(c.mediaVariantKey);
        setOpenInvPickerId(null);
      }
    }
  }

  function restoreListAssignFilters() {
    const snapshot = assignListFilterSnapshotRef.current;
    if (!snapshot) return;
    setInvListQuery(snapshot.query);
    setInvListMapId(snapshot.mapId);
    setInvListVariantKey(snapshot.variantKey);
    assignListFilterSnapshotRef.current = null;
  }

  function onExitAssign() {
    setAssignMode(endAssignMode());
    setInvQuery("");
    restoreListAssignFilters();

    if (filterSource === "auto") {
      setActiveVariantKey(null);
      setFilterSource(null);
    }
  }
  
  useEffect(() => {
	  if (!assignMode.isActive) return;
	
	  function onKey(e: KeyboardEvent) {
		if (e.key === "Escape") {
		  onExitAssign();
		}
	  }
	
	  document.addEventListener("keydown", onKey);
	  return () => document.removeEventListener("keydown", onKey);
	  // eslint-disable-next-line react-hooks/exhaustive-deps
	}, [assignMode.isActive]);

  useEffect(() => {
    if (!isLocked) return;
    setAssignMode(endAssignMode());
    setOpenInvPickerId(null);
    closePopover();
  }, [isLocked]);

  const reviewCtaLabel = isSubmitted
    ? "Open Review Allocation"
    : isAllocationComplete
    ? "Review Allocation & Submit Order"
    : "Review Allocation";
  const openAllocationPdf = () => {
    const pid = isDemo ? "demo_001" : projectId;
    window.open(`/p/${pid}/allocation-report?print=1`, "_blank");
  };

  useLayoutEffect(() => {
    if (!pinPopoverId || assignMode.isActive) return;
    if (!pinAnchor) return;
    if (!popRef.current) return;

    const pad = 10;
    const pop = popRef.current.getBoundingClientRect();

    let left = pinAnchor.right + 12;
    if (left + pop.width + pad > window.innerWidth) left = pinAnchor.left - pop.width - 12;

    let top = pinAnchor.top - 10;
    if (top + pop.height + pad > window.innerHeight) top = window.innerHeight - pop.height - pad;

    if (top < pad) top = pad;
    if (left < pad) left = pad;

    setPopPos({ left, top });
  }, [pinPopoverId, pinAnchor, assignMode.isActive, pinPopoverMode]);

  useEffect(() => {
    if (!pinPopoverId) return;

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closePopover();
    }

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pinPopoverId]);

  // =========================
  // Render
  // =========================

  const currentRollup = !isDemo && projectId === "proj_001" ? getRollupById(projectId) : undefined;
  const liveProject = liveWorkspace?.project;
  const projectTitle = isDemo
    ? ctx.title
    : liveProject?.title || currentRollup?.title || (projectId === "proj_001" ? "White Claw @ Penn Station 12.25.2025" : `Project ${projectId}`);
  const artworkDue = isDemo
    ? (ctx.artworkDueDate || "—")
    : liveProject?.artworkDueDate || currentRollup?.dates.artworkDue || (projectId === "proj_001" ? "2025-12-10" : "—");
  const postDate = isDemo
    ? (ctx.postDate || "—")
    : liveProject?.postDate || currentRollup?.dates.postDate || (projectId === "proj_001" ? "2025-12-25" : "—");
  const commandArtworkDue = artworkDue === "—" ? "Not set" : artworkDue;
  const commandPostDate = postDate === "—" ? "Not set" : postDate;
  const projectMarketLabel = isDemo ? ctx.venueMarket || "New York City" : liveProject?.marketName || currentRollup?.marketName || "New York City";
  const projectVenueLabel = isDemo ? ctx.venueName || "Penn Station" : liveProject?.venueName || currentRollup?.venueName || "Penn Station";
  const projectCustomerLabel = isDemo ? "Intersection" : liveProject?.customerName || "Intersection";

  function uploadArtworkFiles({ variantKey, files }: { variantKey: string; files: ProjectUploadFile[] }) {
    shareAccess.requireEdit("artwork", "artwork.upload", `uploaded ${files.length} artwork file${files.length === 1 ? "" : "s"}`, () => {
      void (async () => {
        try {
          const result = await addUploadedArtworkToProject({
            projectId: isDemo ? (demoActiveProjectId || "demo_001") : projectId,
            isDemo,
            shareMode: shareAccess.isShareMode,
            variantKey,
            files,
            setLegacyCreatives: setCreativesState,
            apiClient: api,
            customerId: liveProject?.customerId,
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
              surface: "assignment.upload",
              workspace: "artwork",
            }, shareAccess.isShareMode).catch(() => undefined);
          }
          demoStore.actions.pushToast("danger", message);
        }
      })();
    });
  }

  function deleteCreativeAsset(creative: CreativeAsset) {
    const assignedCount = creative.assignedInventoryIds.length;
    const confirmed = window.confirm(
      assignedCount > 0
        ? `${creative.filename} is assigned to ${assignedCount} location${assignedCount === 1 ? "" : "s"}. Deleting it will clear those assignments. Continue?`
        : `Delete ${creative.filename}?`
    );
    if (!confirmed) return;

    shareAccess.requireEdit("artwork", "artwork.delete", `deleted artwork file ${creative.filename}`, () => {
      if (isDemo) {
        demoStore.actions.removeCreative(demoActiveProjectId || "demo_001", creative.id);
        demoStore.actions.pushToast("success", "Artwork deleted");
        return;
      }
      if (!projectId) return;

      const previousCreatives = creativesState;
      const previousInventory = inventoryState;
      setCreativesState((prev) => prev.filter((item) => item.id !== creative.id));
      setInventoryState((prev) =>
        prev.map((item) => (item.assignedCreativeId === creative.id ? { ...item, assignedCreativeId: null } : item))
      );

      void (async () => {
        try {
          await deleteProjectCreativeAsset(api, projectId, creative.id, shareAccess.isShareMode);
          await loadWorkspace(true);
          demoStore.actions.pushToast("success", "Artwork deleted");
        } catch (error) {
          setCreativesState(previousCreatives);
          setInventoryState(previousInventory);
          const message = error instanceof Error ? error.message : "We couldn't delete that artwork yet.";
          if (!isDemo && projectId) {
            void logProjectErrorEvent(api, projectId, {
              actionType: "creative.delete",
              errorCode: "artwork_delete_failed",
              message,
              severity: "error",
              surface: "assignment.creative_delete",
              workspace: "artwork",
            }, shareAccess.isShareMode).catch(() => undefined);
          }
          demoStore.actions.pushToast("danger", message);
        }
      })();
    });
  }

  function replaceCreativeAsset(creative: CreativeAsset) {
    if (!canUploadArtwork || isLocked) return;

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
          const previousCreatives = creativesState;
          const existingVariantDetails = creative.fileMeta.split("·").slice(2).join("·").trim();

          setCreativesState((prev) =>
            prev.map((item) =>
              item.id === creative.id
                ? {
                    ...item,
                    filename: nextFile.filename,
                    fileMeta: `${nextFile.isPdf ? "PDF" : "FILE"} · ${nextFile.sizeLabel} · ${existingVariantDetails}`,
                    thumbUrl: nextFile.objectUrl || item.thumbUrl || item.fullUrl,
                    fullUrl: nextFile.objectUrl || item.fullUrl || item.thumbUrl,
                    uploadState: "processing",
                    isOptimistic: true,
                  }
                : item
            )
          );

          if (isDemo) {
            demoStore.actions.updateCreative(demoActiveProjectId || "demo_001", creative.id, {
              filename: nextFile.filename,
              fileMeta: `${nextFile.isPdf ? "PDF" : "FILE"} · ${nextFile.sizeLabel} · ${existingVariantDetails}`,
              thumbUrl: nextFile.objectUrl || creative.thumbUrl,
              fullUrl: nextFile.objectUrl || creative.fullUrl,
            } as any);
            demoStore.actions.pushToast("success", "Artwork replaced");
            return;
          }
          if (!projectId) return;

          void (async () => {
            try {
              const updated = await replaceProjectCreativeFile({
                apiClient: api,
                projectId,
                creativeId: creative.id,
                variantKey: creative.mediaVariantKey,
                color: creative.color,
                file: nextFile.file,
                filename: nextFile.filename,
                isPdf: nextFile.isPdf,
                customerId: liveProject?.customerId,
                shareMode: shareAccess.isShareMode,
              });
              setCreativesState((prev) => prev.map((item) => (item.id === creative.id ? updated : item)));
              await loadWorkspace(true);
              demoStore.actions.pushToast("success", "Artwork replaced");
            } catch (error) {
              setCreativesState(previousCreatives);
              const message = error instanceof Error ? error.message : "We couldn't replace that artwork yet.";
              if (!isDemo && projectId) {
                void logProjectErrorEvent(api, projectId, {
                  actionType: "creative.replace",
                  errorCode: "artwork_replace_failed",
                  message,
                  severity: "error",
                  surface: "assignment.creative_replace",
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
  }

  if (shareAccess.isShareMode && shareAccess.isResolving) {
    return (
      <AppShell pageClassName="workspace" projectTitle={projectTitle}>
        <div className="assign-empty">
          <div className="assign-empty-title">Loading Creative Assignment</div>
          <div className="assign-empty-body">Checking your shared access and pulling the live project workspace.</div>
        </div>
      </AppShell>
    );
  }

  if (shareAccess.isShareMode && (!shareAccess.shareLink || shareAccess.isRevoked || !shareAccess.canView("assignment"))) {
    return (
      <AppShell pageClassName="workspace" projectTitle={projectTitle}>
        <ShareAccessDenied
          title={shareAccess.isRevoked ? "This shared link has been revoked" : "This shared link cannot open Creative Assignment"}
          body="Ask the project owner for an End Client Collaboration or View Only link if you need assignment access."
        />
      </AppShell>
    );
  }

  const usesCreativeShelf = assignView === "list" && isListFirstViewport;
  const hasReviewableInventory = inventory.length > 0;
  const compactReviewCtaLabel =
    useUtilityHeader && !isSubmitted && isAllocationComplete ? "Review & Submit" : reviewCtaLabel;
  const headerActions = isSubmitted ? null : (
    <div className="assign-headerActions">
      <div className="assign-headerActionRow">
        <button className="btn btn-ghost btn-soft" type="button" onClick={openAllocationPdf}>
          Download PDF
        </button>

        {!isSubmitted && shareAccess.canView("artwork") && (
          <button className="btn btn-ghost btn-soft" type="button" onClick={() => setArtworkFolderOpen(true)}>
            Artwork Folder
          </button>
        )}

        <button
          className={[
            "btn",
            "btn-primary",
            isAllocationComplete ? "review-cta-ready" : "",
            !hasReviewableInventory ? "review-cta-empty" : "",
          ].filter(Boolean).join(" ")}
          type="button"
          onClick={() => setReviewOpen(true)}
          disabled={!hasReviewableInventory}
        >
          {compactReviewCtaLabel}
          {!isSubmitted && isAllocationComplete && <span className="review-cta-spark" aria-hidden="true">✨</span>}
        </button>
      </div>
      <div
        className={[
          "assign-headerSaveStatus",
          assignmentSaveState.tone === "saving" ? "is-saving" : "",
          assignmentSaveState.tone === "saved" ? "is-saved" : "",
          assignmentSaveState.tone === "error" ? "is-error" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {assignmentSaveState.tone === "saving"
          ? "Updating…"
          : assignmentSaveState.tone === "idle"
            ? ""
            : assignmentSaveState.message}
      </div>
    </div>
  );

  return (
    <AppShell pageClassName="workspace" projectTitle={projectTitle}>
      <div
        className={[
          "assign-fullscreen",
          useUtilityHeader ? "is-utility-header" : "",
          `assign-view-${assignView}`,
          isListOnlyViewport ? "is-list-only" : "",
          isListFirstViewport ? "is-list-first" : "",
          usesCreativeShelf ? "is-creative-shelf" : "",
        ].filter(Boolean).join(" ")}
      >
        {useUtilityHeader ? (
          <section className="assign-commandHeader" aria-label="Creative assignment workspace header">
            <div className="assign-commandIdentity">
              <button
                className="btn btn-ghost btn-soft assign-commandBack"
                type="button"
                onClick={() => navigate(shareAccess.buildProjectUrl(`/p/${projectId}${modeSuffix}`), isDemo ? { state: { demo: true } } : undefined)}
              >
                ← Back
              </button>

              <div className="assign-commandTitleBlock">
                <div className="assign-commandEyebrow">Creative Assignment</div>
                <div className="assign-commandTitle" title={projectTitle}>{projectTitle}</div>
              </div>
            </div>

            <div className="assign-commandMeta" aria-label="Project status">
              <span className="assign-commandChip">{projectMarketLabel}</span>
              <span className="assign-commandChip">{projectVenueLabel}</span>

              <span className="assign-commandStat assign-commandStatDue">
                <span className="assign-commandStatLabel">Due</span>
                <span className="assign-commandStatValue">{commandArtworkDue}</span>
              </span>

              <span className="assign-commandStat assign-commandStatPost">
                <span className="assign-commandStatLabel">Post</span>
                <span className="assign-commandStatValue">{commandPostDate}</span>
              </span>

              <span className="assign-commandStat assign-commandStatCoverage">
                <span className="assign-commandStatLabel">Coverage</span>
                <span className="assign-commandStatValue">{assignedLocationsCount}/{inventory.length} assigned</span>
              </span>
            </div>

            <div className="assign-commandActions">
              <WorkspacePresenceCluster
                participants={presence.participants}
                currentSessionId={presence.sessionId}
                status={presence.status}
              />
              {headerActions}
            </div>
          </section>
        ) : (
          <PageHeader
            variant="workspace"
            className="page-header-compactProject"
            eyebrow="Creative Assignment"
            title={projectTitle}
            meta={
              <div className="assign-projectMetaRow assign-projectMetaRow-grouped">
                <div className="assign-projectContextGroup">
                  <div className="assign-projectMeta assign-projectMeta-chip">
                    <span className="assign-metaValue">{projectMarketLabel}</span>
                  </div>

                  <div className="assign-projectMeta assign-projectMeta-chip">
                    <span className="assign-metaValue">{projectVenueLabel}</span>
                  </div>
                </div>

                <div className="assign-projectCampaignGroup">
                  <div className="assign-projectMeta assign-projectMeta-detail">
                    <span className="assign-metaLabel">Artwork Due</span>
                    <span className="assign-metaValue">{artworkDue}</span>
                  </div>

                  <div className="assign-projectMeta assign-projectMeta-detail">
                    <span className="assign-metaLabel">Post Date</span>
                    <span className="assign-metaValue">{postDate}</span>
                  </div>

                  <div className="assign-projectMeta assign-projectMeta-detail assign-projectMeta-detailEmphasis">
                    <span className="assign-metaLabel">Coverage</span>
                    <span className="assign-metaValue">
                      {assignedLocationsCount}/{inventory.length} assigned
                    </span>
                  </div>
                </div>
              </div>
            }
            backLabel="← Back to Hub"
            onBack={() => navigate(shareAccess.buildProjectUrl(`/p/${projectId}${modeSuffix}`), isDemo ? { state: { demo: true } } : undefined)}
            actions={headerActions}
          />
        )}

        {!isSubmitted && isAllocationComplete && inventory.length > 0 && (
          <div className="assign-completeBanner">
            <div className="assign-completeBannerMain">
              <div className="assign-completeKicker">Assignment Complete</div>
              <div className="assign-completeTitle">All required locations have artwork assigned.</div>
              <div className="assign-completeBody">
                Review the allocation, confirm the final coverage, and submit the order when you’re ready to move this campaign into proofing.
              </div>
            </div>

            <div className="assign-completeActions">
              <button className="btn btn-primary btn-lg" type="button" onClick={() => setReviewOpen(true)}>
                Review Allocation
              </button>
              <button className="btn btn-ghost btn-soft btn-lg" type="button" onClick={openAllocationPdf}>
                Download PDF
              </button>
            </div>
          </div>
        )}

        {isSubmitted && (
          <>
            <div className="assign-lockBanner">
              <div className="assign-lockBannerMain">
                <div className="assign-lockKicker">Review Only</div>
                <div className="assign-lockTitle">Congrats, this project has been submitted.</div>
                <div className="assign-lockBody">
                  You can still review placements, internal coordination details, and installer reference views, but assignment edits are now locked after submission.
                </div>
              </div>

              <div className="assign-lockActions">
                <button className="btn btn-primary" type="button" onClick={() => setReviewOpen(true)}>
                  Open Review Allocation
                </button>
                <button className="btn btn-ghost btn-soft" type="button" onClick={openAllocationPdf}>
                  Download PDF
                </button>
              </div>
            </div>

            <div className="assign-statusStrip">
              <div className="assign-statusCard">
                <div className="assign-statusLabel">Order</div>
                <div className="assign-statusValue">{ctx.liftOrderNumber || "Submitted"}</div>
              </div>
              <div className="assign-statusCard">
                <div className="assign-statusLabel">Allocation</div>
                <div className="assign-statusValue">{isAllocationComplete ? "Complete" : "Incomplete"}</div>
              </div>
              <div className="assign-statusCard">
                <div className="assign-statusLabel">Editing</div>
                <div className="assign-statusValue">Locked</div>
              </div>
            </div>
          </>
        )}

        <div className="assign-layout">
          {/* ================= LEFT RAIL ================= */}
          <Panel className="assign-left panel-tight">
            <div className="assign-left-pad">
              <div className="assign-rail-title">Creatives</div>

              {isSubmitted ? (
                <div className="assign-reviewNote">
                  Review submitted artwork and final placement coverage. Editing tools are disabled after submission.
                </div>
              ) : canUploadArtwork ? (
                <button className="btn assign-upload" type="button" onClick={() => setUploaderOpen(true)}>
                  ＋ Upload Artwork
                </button>
              ) : (
                <div className="assign-reviewNote">This shared link is view-only for artwork uploads.</div>
              )}

              <div className="assign-rail-meta">
                <span>{creatives.length} Files</span>
                <span className="dot">•</span>
                <span>{assignedCreativesCount} Placed</span>
                <span className="dot">•</span>
                <span>{remainingLocationsCount} Locations Open</span>
              </div>

              <div className="assign-searchRow">
                <div className="assign-search">
                  <span className="field-icon">⌕</span>
                  <input
                    className="field-input"
                    placeholder="Search files…"
                    value={creativeQuery}
                    onChange={(e) => setCreativeQuery(e.target.value)}
                  />
                </div>

                <select
                  className="select assign-filterSelect"
                  value={activeVariantKey ?? "all"}
                  onChange={(e) => {
                    const v = e.target.value;
                    const next = v === "all" ? null : v;
                    setActiveVariantKey(next);
                    setFilterSource(next ? "manual" : null);
                  }}
                >
                  {variantOptions.map((k) => (
                    <option key={k} value={k}>
                      {k === "all" ? "All Media" : mediaLabelFromKey(k)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="assign-cards">
              {!isDemo && workspaceLoading && creatives.length === 0 ? (
                <div className="assign-empty">
                  <div className="assign-empty-icon">⋯</div>
                  <div className="assign-empty-title">Loading artwork</div>
                  <div className="assign-empty-sub">Pulling the latest project creatives and assignment state from the backend.</div>
                </div>
              ) : creatives.length === 0 ? (
                <div className="assign-empty">
                  <div className="assign-empty-icon">⬆︎</div>
                  <div className="assign-empty-title">No creatives uploaded yet</div>
                  <div className="assign-empty-sub">
                    {isSubmitted
                      ? "No artwork is available to review for this submitted order."
                      : "Upload artwork to start assigning files to locations."}
                  </div>
                  {!isSubmitted && canUploadArtwork && (
                    <button className="btn assign-upload" type="button" onClick={() => setUploaderOpen(true)}>
                      ＋ Upload Artwork
                    </button>
                  )}
                </div>
              ) : creativesFiltered.length === 0 ? (
                <div className="assign-empty">
                  <div className="assign-empty-icon">⌕</div>
                  <div className="assign-empty-title">No matching creatives</div>
                  <div className="assign-empty-sub">
                    {activeVariantKey ? (
                      <>
                        No uploaded files match <strong>{mediaLabelFromKey(activeVariantKey)}</strong>.
                      </>
                    ) : (
                      <>Try adjusting your search.</>
                    )}
                  </div>

                  <div className="assign-empty-actions">
                    {activeVariantKey && (
                      <button
                        className="btn btn-ghost btn-soft"
                        type="button"
                        onClick={() => {
                          setActiveVariantKey(null);
                          setFilterSource(null);
                        }}
                      >
                        Clear filter
                      </button>
                    )}

                    {creativeQuery.trim() && (
                      <button className="btn btn-ghost btn-soft" type="button" onClick={() => setCreativeQuery("")}>
                        Clear search
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                creativesFiltered.map((c) => {
                  const mediaLabel = mediaLabelFromKey(c.mediaVariantKey);
                  const assignedCount = c.assignedInventoryIds.length;
                  const hasAssignments = assignedCount > 0;
                  const variant = variantByKey.get(c.mediaVariantKey) as any;
                  const creativeDisplayColor = creativeDisplayColorById.get(c.id) || c.color || "#3F6ED8";

                  return (
                    <div
                      key={c.id}
                      className={`creative-card ${assignMode.isActive && assignMode.creativeId === c.id ? "is-active" : ""} ${isLocked ? "is-readonly" : ""}`}
                    >
                      <div className="creative-card-top">
                        <div className="creative-thumb creative-thumb-zoom" title="Click to preview">
                          <img
                            className="creative-thumb-img"
                            src={getCreativeThumb(c)}
                            alt=""
                            loading="lazy"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              openCreativePreview(c);
                            }}
                          />
                          <span className="creative-thumb-zoomIcon" aria-hidden="true">⌕</span>
                        </div>

                        <div className="creative-main">
                          <div className="creative-filename" title={c.filename}>{c.filename}</div>
                          <div className="creative-meta">{c.fileMeta}</div>
                          <div className="creative-status">
                            {c.uploadState === "uploading" ? (
                              <>
                                <span className="dot-gray" /> Uploading…
                              </>
                            ) : c.uploadState === "processing" ? (
                              <>
                                <span className="dot-gray" /> Processing preview…
                              </>
                            ) : hasAssignments ? (
                              <>
                                <span className="dot-green" /> {assignedCount} placement{assignedCount === 1 ? "" : "s"}
                              </>
                            ) : (
                              <>
                                <span className="dot-gray" /> Ready to place
                              </>
                            )}
                          </div>
                        </div>

                        <div className="creative-cardTools">
                          <div className="creative-colorDot" style={{ background: creativeDisplayColor }} />
                          {!isLocked && canUploadArtwork && (
                            <>
                              <button
                                className="btn btn-ghost btn-soft creative-deleteBtn"
                                type="button"
                                disabled={c.uploadState === "uploading" || c.uploadState === "processing"}
                                onClick={() => replaceCreativeAsset(c)}
                              >
                                Replace File
                              </button>
                              <button
                                className="btn btn-ghost btn-soft creative-deleteBtn"
                                type="button"
                                disabled={c.uploadState === "uploading" || c.uploadState === "processing"}
                                onClick={() => deleteCreativeAsset(c)}
                              >
                                Delete
                              </button>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="creative-mid">
                        <div
                          className="creative-pill"
                          title={mediaLabel}
                          style={{ ["--variantTone" as any]: variant?.color || c.color || "#3F6ED8" }}
                        >
                          {mediaLabel}
                        </div>
                      </div>

                      <div className="creative-locs">
                        <div className="creative-locs-head">
                          <span>Assigned Locations ({assignedCount})</span>
                        </div>

                        {assignedCount === 0 ? (
                          <div className="creative-locs-empty">No locations assigned yet.</div>
                        ) : (
                          <>
                            {(isExpanded(c.id) ? c.assignedInventoryIds : c.assignedInventoryIds.slice(0, 2)).map((id) => (
                              <div
                                key={id}
                                className="creative-locRow"
                                onMouseEnter={() => setHoveredInvId(id)}
                                onMouseLeave={() => setHoveredInvId(null)}
                              >
                                <span>{id}</span>
                                <button
                                  className="btn btn-ghost btn-soft creative-locRemove"
                                  type="button"
                                  onClick={() => setAssignment(id, null)}
                                  aria-label={`Remove ${id}`}
                                  title="Remove assignment"
                                  disabled={isLocked}
                                >
                                  Remove
                                </button>
                              </div>
                            ))}

                            {assignedCount > 2 && !isExpanded(c.id) && (
                              <button className="creative-locMoreLink" type="button" onClick={() => toggleExpanded(c.id)}>
                                + {assignedCount - 2} more
                              </button>
                            )}

                            {assignedCount > 2 && isExpanded(c.id) && (
                              <button className="creative-locMoreLink" type="button" onClick={() => toggleExpanded(c.id)}>
                                Show less
                              </button>
                            )}
                          </>
                        )}
                      </div>

					{!isLocked && assignMode.isActive && assignMode.creativeId === c.id ? (
					  <button
						className="btn btn-primary assign-cta is-assigning"
						type="button"
						onClick={onExitAssign}
						title="Assign mode is active — click to exit"
            disabled={c.uploadState === "uploading" || c.uploadState === "processing"}
					  >
						Assign Mode • Click pins
					  </button>
					) : !isLocked ? (
					  <button
              className="btn btn-primary assign-cta"
              type="button"
              disabled={c.uploadState === "uploading" || c.uploadState === "processing"}
              onClick={() => onStartAssign(c.id)}
            >
						Assign Creative
					  </button>
					) : (
            <div className="assign-readonlyPill">Review only</div>
					)}
                    </div>
                  );
                })
              )}
            </div>
          </Panel>

          {/* ================= RIGHT RAIL (map) ================= */}
          <Panel className="assign-right panel-tight">
            <div className="assign-mapHead">
				<div className="assign-mapHeadTop">
				<div>
                  <div className="assign-venueName">Penn Station</div>
                  <div className="assign-mapContext">
                    <span className="assign-mapContextTitle">{inventoryContextTitle}</span>
                    <span className="assign-mapContextText">
                      <span className="assign-mapContextTextFull">{inventoryContextSummary}</span>
                      <span className="assign-mapContextTextCompact">{inventoryContextCompactSummary}</span>
                    </span>
                    <span className={`assign-mapCompletePill ${inventoryContextIsComplete ? "is-visible" : "is-hidden"}`}>
                      Complete
                    </span>
                  </div>
                </div>
			
				{!isListOnlyViewport ? (
				  <div className="assign-viewToggle">
				    <button
					  type="button"
					  className={`assign-viewBtn ${assignView === "map" ? "is-on" : ""}`}
					  onClick={() => selectAssignView("map")}
				    >
					  Map View
				    </button>
				    <button
					  type="button"
					  className={`assign-viewBtn ${assignView === "list" ? "is-on" : ""}`}
					  onClick={() => selectAssignView("list")}
				    >
					  List View
				    </button>
				  </div>
				) : null}
			  </div>
        {isSubmitted && (
          <div className="assign-mapNote">
            Map and list views remain available for review only. Placement edits are locked after submission.
          </div>
        )}
			
			  {/* Keep location pills visible in both modes */}
			  {assignView === "map" && (
				  <div className="assign-mapPills">
					{maps.map((m) => (
					  <button
						key={m.id}
						className={`map-pill ${m.id === activeMapId ? "is-active" : ""} ${(mapCountsById[m.id]?.total ?? 0) > 0 && (mapCountsById[m.id]?.assigned ?? 0) === (mapCountsById[m.id]?.total ?? 0) ? "is-complete" : ""}`}
						type="button"
						onClick={() => {
						  setActiveMapId(m.id);
						  setInvListMapId(m.id);
						}}
					  >
						<span className="map-pill-name">{m.name}</span>
						<span className="map-pill-count">
						  {(mapCountsById[m.id]?.assigned ?? 0)}/{(mapCountsById[m.id]?.total ?? 0)}
						</span>
					  </button>
					))}
				  </div>
				)}
			</div>

				{assignView === "map" ? (
				  <div className="assign-mapStage">
					<div
					  className="assign-mapCanvas"
					  ref={mapViewportRef}
					  onWheel={onWheelMap}
					  onMouseDown={onMouseDownMap}
					  onMouseMove={onMouseMoveMap}
					  onMouseUp={onMouseUpMap}
					  onMouseLeave={onMouseUpMap}
					  onClick={() => {
						if (!isPanning) closePopover();
					  }}
					>
					  <div
              className="map-transform"
              style={{ ...mapFrameStyle, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
            >
						{activeMap?.imageUrl ? (
						  <img
							key={activeMapId}
							ref={mapImgRef}
							className={`map-image ${mapLoading ? "is-loading" : ""}`}
							src={activeMap.imageUrl}
							alt=""
							draggable={false}
							onLoad={onMapImageLoad}
							onError={onMapImageError}
						  />
						) : (
						  <div className="assign-mapPlaceholder">No map image configured for this location.</div>
						)}
				
						<div className="pin-layer">
						  {pinsOnActiveMap.map((inv) => {
							const variant: any = variantCatalog.find((v: any) => v.key === inv.mediaVariantKey);
							const baseColor = variant?.color || "#94a3b8";
							const short = variant?.shortLabel || "";
							const jitter = pinJitterById.get(inv.id) || { jx: 0, jy: 0 };
				
							const assignedCreative = inv.assignedCreativeId ? creativeById.get(inv.assignedCreativeId) : null;
							const haloColor = assignedCreative
                ? creativeDisplayColorById.get(assignedCreative.id) || assignedCreative.color || "transparent"
                : "transparent";
				
							const isSelected = activePinId === inv.id;
							const isAssignedToActive =
							  assignMode.isActive && activeCreative && inv.assignedCreativeId === activeCreative.id;
				
							const assignedElsewhere =
							  assignMode.isActive &&
							  activeCreative &&
							  inv.assignedCreativeId &&
							  inv.assignedCreativeId !== activeCreative.id;
				
							return (
							  <button
								key={inv.id}
								className={[
								  "pin",
								  hoveredInvId === inv.id ? "is-hovered" : "",
								  isSelected ? "is-selected" : "",
								  isAssignedToActive ? "is-checked" : "",
								  assignedElsewhere ? "is-dim" : "",
								].join(" ")}
								style={{
								  left: `${inv.x * 100}%`,
								  top: `${inv.y * 100}%`,
								  ["--pinColor" as any]: baseColor,
								  ["--haloColor" as any]: haloColor,
								  ["--pinInvScale" as any]: String(1 / zoom),
								  ["--pinJx" as any]: `${jitter.jx}px`,
								  ["--pinJy" as any]: `${jitter.jy}px`,
								}}
								type="button"
								title={inv.id}
								onMouseEnter={() => setHoveredInvId(inv.id)}
								onMouseLeave={() => setHoveredInvId(null)}
								onClick={(e) => {
								  e.preventDefault();
								  e.stopPropagation();
								  onPinClick(inv.id, e.currentTarget as HTMLElement);
								}}
							  >
								<span className="pin-halo" />
								<span className="pin-core">{short}</span>
							  </button>
							);
						  })}
						</div>
					  </div>
				
					  <div className="map-hint" onClick={(e) => e.stopPropagation()}>
						{Math.round(zoom * 100)}%
						<button
						  className="map-hint-btn"
						  type="button"
						  onClick={(e) => {
							e.preventDefault();
							e.stopPropagation();
							fitMapToView();
						  }}
						>
						  Fit
						</button>
					  </div>
					</div>
				
					{/* Pin popover */}
					{!assignMode.isActive && pinPopoverId && (
					  <Portal>
						<div
						  ref={popRef}
						  className="pin-popover pin-popover-fixed"
						  style={{
							left: popPos?.left ?? (pinAnchor?.right ?? 20) + 12,
							top: popPos?.top ?? Math.max(20, (pinAnchor?.top ?? 80) - 10),
              ["--pinPopoverAccent" as any]:
                ((variantByKey.get(inventory.find((i) => i.id === pinPopoverId)?.mediaVariantKey || "") as any)?.color ||
                  "#2fbf71"),
						  }}
						  onClick={(e) => e.stopPropagation()}
						>
						  {(() => {
							const inv = inventory.find((i) => i.id === pinPopoverId);
							if (!inv) return null;
				
							const assignedCreative = inv.assignedCreativeId ? creativeById.get(inv.assignedCreativeId) : null;
              const variant = variantByKey.get(inv.mediaVariantKey) as any;
              const mediaName = getInventoryMediaName(inv, variant);
              const trimDimensions = formatSpecDimensions(
                inv.trimHeight,
                inv.trimWidth,
                variant ? formatMediaDimensions(variant.w, variant.h) : "Not specified"
              );
              const safeDimensions = formatSpecDimensions(inv.safeHeight, inv.safeWidth);
				
							return (
							  <>
								<div className="pin-pop-head">
								  <div className="pin-pop-heading">
								    <div className="pin-pop-title">{inv.id}</div>
								    <div className="pin-pop-meta">{mediaLabelFromKey(inv.mediaVariantKey)}</div>
								  </div>
								  <button className="btn btn-ghost btn-soft pin-pop-close" type="button" onClick={closePopover}>
									✕
								  </button>
								</div>

                <details className="pin-details">
                  <summary className="pin-details-summary">Specs</summary>
                  <div className="pin-details-body">
                    <div className="pin-details-row"><span className="k">Inventory ID</span><span className="v">{inv.id}</span></div>
                    <div className="pin-details-row"><span className="k">Media</span><span className="v">{mediaName}</span></div>
                    <div className="pin-details-row"><span className="k">Dimensions</span><span className="v">{trimDimensions}</span></div>
                    <div className="pin-details-row"><span className="k">Safety Dimensions</span><span className="v">{safeDimensions}</span></div>
                    <div className="pin-details-notes">
                      <div className="pin-details-notesLabel">Notes</div>
                      <div className="pin-details-notesText">{inv.notes?.trim() || "No notes added."}</div>
                    </div>
                  </div>
                </details>
				
								{assignedCreative ? (
								  <div className="pin-pop-assigned">
									<span
                    className="pin-pop-color"
                    style={{ background: creativeDisplayColorById.get(assignedCreative.id) || assignedCreative.color }}
                  />
									<div className="pin-pop-filechip" title={assignedCreative.filename}>
									  <img
										className="pin-pop-thumb"
										src={getCreativeThumb(assignedCreative)}
										alt=""
										loading="lazy"
										title="Click to preview"
										style={{ cursor: "zoom-in" }}
										onClick={(e) => {
										  e.preventDefault();
										  e.stopPropagation();
										  openCreativePreview(assignedCreative);
										}}
									  />
									  <div className="pin-pop-filemeta">
										<div className="pin-pop-filelabel">Assigned</div>
										<div className="pin-pop-filename">{assignedCreative.filename}</div>
									  </div>
									</div>
								  </div>
								) : (
								  <div className="pin-pop-unassigned">No creative assigned</div>
								)}
				
								{!isLocked && (
                  <div className="pin-pop-actions">
                    <button
                      className="btn btn-primary btn-wide"
                      type="button"
                      onClick={() => setPinPopoverMode((m) => (m === "pick" ? "summary" : "pick"))}
                    >
                      {pinPopoverMode === "pick" ? "Close" : "Assign / Replace"}
                    </button>
                    {assignedCreative ? (
                      <button
                        className="btn btn-ghost btn-soft btn-wide"
                        type="button"
                        onClick={() => {
                          setAssignment(inv.id, null);
                          closePopover();
                        }}
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                )}
				
								{!isLocked && pinPopoverMode === "pick" && (
								  <div className="pin-pop-picker">
									<div className="pin-pop-pickerTitle">
									  Matching creatives ({creatives.filter((c) => c.mediaVariantKey === inv.mediaVariantKey).length})
									</div>
				
									{creatives.filter((c) => c.mediaVariantKey === inv.mediaVariantKey).length === 0 ? (
									  <div className="pin-pop-pickerEmpty">
										No uploaded creatives match <strong>{mediaLabelFromKey(inv.mediaVariantKey)}</strong>.
									  </div>
									) : (
									  <div className="pin-pop-pickerList">
										{creatives
										  .filter((c) => c.mediaVariantKey === inv.mediaVariantKey)
										  .map((c) => (
											<button
											  key={c.id}
											  type="button"
											  className="pin-pop-pickRow"
											  onClick={() => {
												setAssignment(inv.id, c.id);
												closePopover();
											  }}
											>
											  <span
                          className="pin-pop-color"
                          style={{ background: creativeDisplayColorById.get(c.id) || c.color }}
                        />
											  <img
												className="pin-pop-thumb"
												src={getCreativeThumb(c)}
												alt=""
												loading="lazy"
												title="Click to preview"
												style={{ cursor: "zoom-in" }}
												onClick={(e) => {
												  e.preventDefault();
												  e.stopPropagation();
												  openCreativePreview(c);
												}}
											  />
											  <div className="pin-pop-pickMeta">
												<div className="pin-pop-pickName" title={c.filename}>
												  {c.filename}
												</div>
												<div className="pin-pop-pickSub">{c.fileMeta}</div>
											  </div>
											  <span className="pin-pop-selectPill">Select</span>
											</button>
										  ))}
									  </div>
									)}
								  </div>
								)}
							  </>
							);
						  })()}
						</div>
					  </Portal>
					)}
				
					{/* Bottom filter chips */}
					{!assignMode.isActive && (
					  <div className="assign-mapFilters">
						<div className="assign-invSearch">
						  <span className="field-icon">⌕</span>
						  <input
                className="field-input"
                placeholder="Filter visible inventory by ID…"
                value={mapInvQuery}
                onChange={(e) => setMapInvQuery(e.target.value)}
              />
						</div>

            <div className="assign-mapFiltersLabel">
              Visible media on this map
            </div>
				
						<div className="assign-variantChips">
						  {variantCatalog.map((v: any) => {
							const c = variantCounts.get(v.key);
							if (!c || c.total === 0) return null;
				
							return (
							  <button
								key={v.key}
								className={`variant-chip ${activeVariantKey === v.key ? "is-active" : ""}`}
								type="button"
								onClick={() => {
								  setActiveVariantKey((cur) => {
									const next = cur === v.key ? null : v.key;
									setFilterSource(next ? "manual" : null);
									return next;
								  });
								}}
							  >
								<span className="variant-chip-dot" style={{ background: v.color || "#94a3b8" }} />
								<span className="variant-chip-name">{v.mediaName}</span>
								<span className="variant-chip-size">{formatMediaDimensions(v.w, v.h)}</span>
								<span className="variant-chip-count">{c.assigned}/{c.total}</span>
							  </button>
							);
						  })}
						</div>
					  </div>
					)}
				
					{/* Assign mode overlay inspector */}
					{!isLocked && assignMode.isActive && activeCreative && (
					  <div
              className="assign-overlay"
              style={{ ["--assignOverlayColor" as any]: creativeDisplayColorById.get(activeCreative.id) || activeCreative.color || "#3F6ED8" }}
            >
						<div className="assign-overlayHead">
						  <div className="assign-overlayIdentity">
                <button
                  className="assign-overlayThumb"
                  type="button"
                  onClick={() => openCreativePreview(activeCreative)}
                  aria-label={`Preview ${activeCreative.filename}`}
                  title="Preview creative"
                >
                  <img src={getCreativeThumb(activeCreative)} alt="" loading="lazy" />
                  <span className="assign-overlayColorDot" aria-hidden="true" />
                </button>
                <div className="assign-overlayCopy">
                  <div className="assign-overlayTitle">Assign Mode</div>
                  <div className="assign-overlayFile" title={activeCreative.filename}>
                    <strong>{activeCreative?.filename}</strong>
                  </div>
                  <div className="assign-overlayHint">
                    Matching <strong>{mediaLabelFromKey(activeCreative.mediaVariantKey)}</strong>
                  </div>
                </div>
              </div>
						  <button className="assign-overlayClose" type="button" onClick={onExitAssign} aria-label="Exit assign mode">
                <X aria-hidden="true" size={17} />
						  </button>
						</div>

            <div className="assign-overlayInstruction">
              <span>Click map pins or rows to place this creative.</span>
              <kbd>Esc</kbd>
            </div>
				
						<div className="assign-overlaySearch">
						  <span className="field-icon">⌕</span>
						  <input
							className="field-input"
							placeholder="Filter inventory ID…"
							value={invQuery}
							onChange={(e) => setInvQuery(e.target.value)}
						  />
						</div>
				
						<div className="assign-overlaySection">
						  <div className="assign-overlaySectionTitle is-available">
                <span>Available</span>
                <strong>{assignLists.available.length}</strong>
              </div>
				
						  {assignLists.available.map((i) => {
							const checked = i.assignedCreativeId === activeCreative.id;
				
							return (
							  <button
								key={i.id}
								className={`assign-invRow ${checked ? "is-checked" : ""}`}
								type="button"
                aria-pressed={checked}
								onClick={() => toggleForActiveCreative(i.id)}
							  >
								<div className="assign-invRow-main">
								  <div className="assign-invId">{i.id}</div>
								  <div className="assign-invMeta">{mediaLabelFromKey(i.mediaVariantKey)}</div>
								</div>
				
								<div className={`assign-check ${checked ? "on" : ""}`}>{checked ? "✓" : ""}</div>
							  </button>
							);
						  })}
						</div>
				
						{assignLists.elsewhere.length > 0 && (
						  <div className="assign-overlaySection">
							<div className="assign-overlaySectionTitle is-elsewhere">
                <span>Assigned Elsewhere</span>
                <strong>{assignLists.elsewhere.length}</strong>
              </div>
				
							{assignLists.elsewhere.map((i) => (
							  <div key={i.id} className="assign-invRow elsewhere">
								<div className="assign-invRow-main">
								  <div className="assign-invId">{i.id}</div>
								  <div className="assign-invMeta">Assigned to another creative</div>
								</div>
				
								<button className="btn btn-ghost btn-soft" type="button" onClick={() => setAssignment(i.id, activeCreative.id)}>
								  Replace
								</button>
							  </div>
							))}
						  </div>
						)}
					  </div>
					)}
				  </div>
				) : (
					<div className="assign-listStage" ref={listStageRef}>
						{/* LIST TOOLBAR */}
						<div className="assign-listToolbar">
              <div className="assign-listSummary">
                <div className="assign-listSummaryTitle">Inventory Review</div>
                <div className="assign-listSummaryText">
                  {isListAssignMode && activeCreative
                    ? `Assigning ${activeCreative.filename}`
                    : `${listRowsForRender.length} visible item${listRowsForRender.length === 1 ? "" : "s"} in this filtered list`}
                </div>
              </div>

              <div className={`assign-mobileInventoryDock ${mobileInventoryToolsExpanded ? "is-expanded" : ""}`}>
                <button
                  className="assign-mobileInventoryDockSummary"
                  type="button"
                  onClick={() => setMobileInventoryToolsExpanded((value) => !value)}
                  aria-expanded={mobileInventoryToolsExpanded}
                >
                  <strong>{listRowsForRender.length}</strong>
                  <span>Inventory</span>
                  <em>{inventoryListFilterSummary}</em>
                </button>
                <button
                  className="assign-mobileInventoryDockIcon"
                  type="button"
                  aria-label="Search inventory"
                  onClick={() => expandMobileInventoryTools(true)}
                >
                  <Search aria-hidden="true" size={17} />
                </button>
                <button
                  className={`assign-mobileInventoryDockIcon ${hasActiveInventoryListFilters ? "is-active" : ""}`}
                  type="button"
                  aria-label="Filter inventory"
                  onClick={() => expandMobileInventoryTools(false)}
                >
                  <SlidersHorizontal aria-hidden="true" size={17} />
                </button>
                <button className="assign-mobileInventoryDockTop" type="button" onClick={scrollInventoryListTop}>
                  Top
                </button>
              </div>

              <div className={`assign-listControls ${mobileInventoryToolsExpanded ? "is-mobile-expanded" : ""}`}>
					      <div className="assign-invSearch">
						      <span className="field-icon">⌕</span>
						      <input
                    ref={mobileInventorySearchRef}
						        className="field-input"
						        placeholder="Search inventory ID…"
						        value={invListQuery}
						        onChange={(e) => setInvListQuery(e.target.value)}
						      />
					      </div>
				
					      <select className="select assign-filterSelect" value={invListMapId} onChange={(e) => setInvListMapId(e.target.value)}>
						    <option value="all">All Maps</option>
						    {maps.map((m) => (
						      <option key={m.id} value={m.id}>{m.name}</option>
						    ))}
					      </select>
				
					      <select className="select assign-filterSelect" value={invListVariantKey} onChange={(e) => setInvListVariantKey(e.target.value)}>
						    <option value="all">All Media</option>
						    {variantCatalog.map((v: any) => (
						      <option key={v.key} value={v.key}>
							    {v.mediaName} {formatMediaDimensions(v.w, v.h)}
						      </option>
						    ))}
					      </select>
                <div className="assign-mobileInventoryQueueBar">
                  <div className="assign-mobileInventoryQueueCount">
                    <strong>{listRowsForRender.length}</strong>
                    <span>of {inventory.length} shown</span>
                  </div>
                  <button
                    className="assign-mobileInventoryQueueButton"
                    type="button"
                    onClick={clearInventoryListFilters}
                    disabled={!hasActiveInventoryListFilters}
                  >
                    Clear
                  </button>
                  <button className="assign-mobileInventoryQueueButton" type="button" onClick={scrollInventoryListTop}>
                    Top
                  </button>
                  <button
                    className="assign-mobileInventoryQueueButton assign-mobileInventoryQueueClose"
                    type="button"
                    onClick={() => setMobileInventoryToolsExpanded(false)}
                    aria-label="Collapse inventory controls"
                  >
                    <X aria-hidden="true" size={15} />
                    <span>Collapse</span>
                  </button>
                </div>
                {isListAssignMode ? (
                  <button className="btn btn-primary" type="button" onClick={onExitAssign}>
                    Done
                  </button>
                ) : null}
              </div>
					</div>
				
					{/* LIST TABLE */}
					<div className="assign-listTable">
					  <div className="assign-listHead">
						<div>Inventory</div>
						<div>Media</div>
						<div>Assigned</div>
						<div className="right">Actions</div>
					  </div>
				
					  {listRowsForRender.length === 0 ? (
						<div className="invtab-empty">
              <div className="invtab-emptyTitle">No inventory items match these filters</div>
              <div className="invtab-emptyText">
                Try adjusting the map, media, or inventory search to find a different set of placements.
              </div>
            </div>
					  ) : (
						listRowsForRender.map((inv) => {
						  const assigned = inv.assignedCreativeId ? creativeById.get(inv.assignedCreativeId) : null;
						  const mediaLabel = mediaLabelFromKey(inv.mediaVariantKey);
              const variant = variantByKey.get(inv.mediaVariantKey) as any;
              const mediaName = getInventoryMediaName(inv, variant);
              const trimDimensions = formatSpecDimensions(
                inv.trimHeight,
                inv.trimWidth,
                variant ? formatMediaDimensions(variant.w, variant.h) : "Not specified"
              );
              const safeDimensions = formatSpecDimensions(inv.safeHeight, inv.safeWidth);
						  const matchingCreatives = creatives.filter((c) => c.mediaVariantKey === inv.mediaVariantKey);
              const checkedForActive = isListAssignMode && activeCreative && inv.assignedCreativeId === activeCreative.id;
              const assignedElsewhere = isListAssignMode && activeCreative && inv.assignedCreativeId && inv.assignedCreativeId !== activeCreative.id;
				
						  return (
							<div
                key={inv.id}
                className={`assign-listRow ${isListAssignMode ? "is-batch" : ""}`}
                style={{ ["--inventoryColor" as any]: variant?.color || "#94a3b8" }}
              >
							  <div className="assign-listInv">
								<div className="assign-listInvId">
                  {isListAssignMode && !assignedElsewhere ? (
                    <input
                      className="assign-listCheckbox"
                      type="checkbox"
                      checked={Boolean(checkedForActive)}
                      onChange={() => toggleForActiveCreative(inv.id)}
                      disabled={isLocked}
                    />
                  ) : null}
                  <span>{inv.id}</span>
                </div>
								<div className="assign-listInvSub">{mapNameById[inv.mapId] || inv.mapId}</div>
							  </div>
				
							  <div className="assign-listMedia">{mediaLabel}</div>
				
								<div className="assign-listAssigned">
                  {isListAssignMode ? (
                    assigned ? (
                      <div className={`assign-listBatchState ${checkedForActive ? "is-active" : "is-elsewhere"}`}>
                        <span className="assign-listDot" style={{ background: creativeDisplayColorById.get(assigned.id) || assigned.color }} />
                        <span className="assign-listName" title={assigned.filename}>
                          {checkedForActive ? "Selected" : assigned.filename}
                        </span>
                      </div>
                    ) : (
                      <div className="assign-listBatchState">Available</div>
                    )
                  ) : (
                    <>
								  {/* “Assigned chip” is now the picker trigger (like pin popover) */}
									<button
									  type="button"
									  data-inv={inv.id}
									  className={`assign-listChip ${openInvPickerId === inv.id ? "is-open" : ""}`}
									  onClick={() => setOpenInvPickerId((cur) => (cur === inv.id ? null : inv.id))}
									  title={assigned ? assigned.filename : "Assign creative"}
                    disabled={isLocked}
									>
									{assigned ? (
									  <>
										<img
										  className="assign-listThumb"
										  src={getCreativeThumb(assigned)}
										  alt=""
										  loading="lazy"
										/>
										<span className="assign-listDot" style={{ background: creativeDisplayColorById.get(assigned.id) || assigned.color }} />
										<span className="assign-listName" title={assigned.filename}>
										  {assigned.filename}
										</span>
									  </>
									) : (
									  <span className="assign-listEmpty">Select creative…</span>
									)}
									<span className="assign-listChevron" aria-hidden="true">▾</span>
								  </button>
								
								  {/* Inline picker list (only matching creatives) */}
								{!isLocked && openInvPickerId === inv.id && (
								  <div className="pin-pop-picker" onClick={(e) => e.stopPropagation()}>
									<div className="pin-pop-pickerTitle">
									  Matching creatives ({matchingCreatives.length})
									</div>
								
									{matchingCreatives.length === 0 ? (
									  <div className="pin-pop-pickerEmpty">
										No uploaded creatives match <strong>{mediaLabelFromKey(inv.mediaVariantKey)}</strong>.
									  </div>
									) : (
									  <div className="pin-pop-pickerList">
										{matchingCreatives.map((c) => (
										  <button
											key={c.id}
											type="button"
											className="pin-pop-pickRow"
											onClick={() => {
											  setAssignment(inv.id, c.id);
											  setOpenInvPickerId(null);
											}}
										  >
											<span className="pin-pop-color" style={{ background: creativeDisplayColorById.get(c.id) || c.color }} />
											<img
											  className="pin-pop-thumb"
											  src={getCreativeThumb(c)}
											  alt=""
											  loading="lazy"
											  title="Click to preview"
											  style={{ cursor: "zoom-in" }}
											  onClick={(e) => {
												e.preventDefault();
												e.stopPropagation();
												openCreativePreview(c);
											  }}
											/>
											<div className="pin-pop-pickMeta">
											  <div className="pin-pop-pickName" title={c.filename}>
												{c.filename}
											  </div>
											  <div className="pin-pop-pickSub">{c.fileMeta}</div>
											</div>
											<span className="pin-pop-selectPill">Select</span>
										  </button>
										))}
									  </div>
									)}
								  </div>
								)}
                  </>
                  )}
								</div>
				
								<div className="assign-listActions right">
                  <button
                    className="btn btn-ghost btn-soft"
                    type="button"
                    onClick={() => setMapModalInventoryId(inv.id)}
                  >
                    View Map
                  </button>
                  <button
                    className="btn btn-ghost btn-soft"
                    type="button"
                    onClick={() => setOpenListDetailsId((current) => (current === inv.id ? null : inv.id))}
                  >
                    Details
                  </button>
                  {assignedElsewhere && activeCreative ? (
                    <button
                      className="btn btn-ghost btn-soft"
                      type="button"
                      onClick={() => setAssignment(inv.id, activeCreative.id)}
                      disabled={isLocked}
                    >
                      Replace
                    </button>
                  ) : inv.assignedCreativeId && !isListAssignMode ? (
                    <button
                      className="btn btn-ghost btn-soft"
                      type="button"
                      onClick={() => {
                        setAssignment(inv.id, null);
                        setOpenInvPickerId(null);
                      }}
                      disabled={isLocked}
                    >
                      Clear
                    </button>
                  ) : (
                    <span className="assign-listActionSlot" aria-hidden="true" />
                  )}
								</div>
                {openListDetailsId === inv.id ? (
                  <div className="assign-listDetails">
                    <div className="assign-listDetailsGrid">
                      <div><span>Inventory ID</span><strong>{inv.id}</strong></div>
                      <div><span>Media</span><strong>{mediaName}</strong></div>
                      <div><span>Dimensions</span><strong>{trimDimensions}</strong></div>
                      <div><span>Safety Dimensions</span><strong>{safeDimensions}</strong></div>
                    </div>
                    <div className="assign-listDetailsNotes">
                      <span>Notes</span>
                      <p>{inv.notes?.trim() || "No notes added."}</p>
                    </div>
                  </div>
                ) : null}
							</div>
						  );
						})
					  )}
					</div>
				  </div>
				)}
			</Panel>
        </div>
      </div>

      {/* Review Allocation Modal */}
      <ReviewAllocationModal
        isOpen={isReviewOpen}
        onClose={() => setReviewOpen(false)}
        project={{
          id: isDemo ? "demo_001" : (projectId || "proj"),
          title: projectTitle,
          venueName: projectVenueLabel,
          customerName: projectCustomerLabel,
          artworkDueDate: artworkDue === "—" ? undefined : artworkDue,
          postDate: postDate === "—" ? undefined : postDate,
          orderNumber: isDemo ? (isSubmitted ? (ctx.liftOrderNumber || "Submitted") : undefined) : (liveOrderNumber || undefined),
          extId: projectId || "",
          poNumber: undefined,
          termsOfSubmissionText:
            `TERMS OF SUBMISSION\n\nBy clicking Submit Order, you are confirming all order information is correct, creative allocations are complete and that all creative are in compliance with the Transit Authorities ad policy.\n\nOnce your order has been submitted the print manufacturer will evaluate each creative using a pre-press review process checking to ensure each file meets the correct size and resolution requirements.\n\nYou will be required to review and approve each pdf proof BEFORE the order can be printed.\n\nDuring this process you will have the opportunity to provide revised artwork.\n\nThe pdf proof is provided for content only and is NOT intended for color matching.\n\nCheck the box below to confirm you have read and understand the terms of submission.`,
        }}
        maps={maps}
        creatives={creatives}
        inventory={inventory}
        variantCatalog={variantCatalog as any}
        canSubmitOrder={shareAccess.canEdit("assignment")}
        onRequestSubmitOrder={(submit) =>
          shareAccess.requireEdit("assignment", "order.submit", "submitted the project order", submit)
        }
        onSubmitted={(result) => {
          setLiveWorkspace((prev) =>
            prev
              ? {
                  ...prev,
                  project: {
                    ...prev.project,
                    liftOrderId: result.liftOrderId,
                    orderSubmittedAt: result.submittedAt,
                    orderSubmittedByName: result.submittedByName,
                    orderSubmissionNote: result.note || null,
                  },
                }
              : prev
          );
        }}
        onDownloadPdf={() => {
          openAllocationPdf();
        }}
        onAfterSubmit={() => {
		  // return user to Hub after submit (keeps demo mode state)
		  navigate(shareAccess.buildProjectUrl(`/p/${projectId}${modeSuffix}`), isDemo ? { state: { demo: true } } : undefined);
		}}
      />

      {/* Uploader modal */}
      <CreativeUploaderModal
        isOpen={isUploaderOpen && !isSubmitted && canUploadArtwork}
        onClose={() => setUploaderOpen(false)}
        variants={variantCatalog.map((v: any) => ({
          key: v.key,
          mediaName: v.mediaName,
          w: v.w,
          h: v.h,
          color: v.color,
          shortLabel: v.shortLabel,
        }))}
        onAddToProject={uploadArtworkFiles}
      />

      {isArtworkFolderOpen && !isSubmitted && shareAccess.canView("artwork") && (
        <ArtworkFolderWorkspace
          projectId={projectId}
          projectTitle={projectTitle}
          venueName={projectVenueLabel}
          marketName={projectMarketLabel}
          artworkDue={artworkDue}
          postDate={postDate}
          creatives={creatives}
          inventory={inventory}
          variantCatalog={variantCatalog as any}
          chrome="modal"
          canUpload={canUploadArtwork}
          onClose={() => setArtworkFolderOpen(false)}
          onUploadFiles={uploadArtworkFiles}
          onReplaceCreative={!isLocked && canUploadArtwork ? replaceCreativeAsset : undefined}
          onDeleteCreative={!isLocked && canUploadArtwork ? deleteCreativeAsset : undefined}
        />
      )}

      {shareAccess.identityModal()}

      {mapModalInventoryId && mapModalInventory ? (
        <Portal>
          <div className="assign-mapModalBackdrop" onMouseDown={() => setMapModalInventoryId(null)}>
            <div className="assign-mapModal" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
              <div className="assign-mapModalHead">
                <div>
                  <div className="assign-mapModalTitle">{mapModalInventory.id}</div>
                  <div className="assign-mapModalSub">
                    {mapNameById[mapModalInventory.mapId] || mapModalMap?.name || "Map"} · {mediaLabelFromKey(mapModalInventory.mediaVariantKey)}
                  </div>
                </div>
                <button className="btn btn-ghost btn-soft" type="button" onClick={() => setMapModalInventoryId(null)}>
                  x
                </button>
              </div>
              <div
                className="assign-mapCanvas assign-mapModalCanvas"
                ref={modalMapViewportRef}
                onWheel={onWheelModalMap}
                onMouseDown={onMouseDownModalMap}
                onMouseMove={onMouseMoveModalMap}
                onMouseUp={onMouseUpModalMap}
                onMouseLeave={onMouseUpModalMap}
              >
                <div
                  className="map-transform"
                  style={{
                    ...modalMapFrameStyle,
                    transform: `translate(${modalMapPan.x}px, ${modalMapPan.y}px) scale(${modalMapZoom})`,
                  }}
                >
                  {mapModalMap?.imageUrl ? (
                    <img
                      ref={modalMapImgRef}
                      className="map-image"
                      src={mapModalMap.imageUrl}
                      alt=""
                      draggable={false}
                      onLoad={onModalMapImageLoad}
                      onError={onModalMapImageError}
                    />
                  ) : (
                    <div className="assign-mapPlaceholder">No map image configured for this location.</div>
                  )}
                  <div className="pin-layer">
                    {inventory
                      .filter((item) => item.id === mapModalInventory.id)
                      .map((inv) => {
                        const variant: any = variantCatalog.find((v: any) => v.key === inv.mediaVariantKey);
                        const assignedCreative = inv.assignedCreativeId ? creativeById.get(inv.assignedCreativeId) : null;
                        const selected = inv.id === mapModalInventory.id;
                        return (
                          <button
                            key={inv.id}
                            className={`pin ${selected ? "is-selected is-hovered" : ""}`}
                            style={{
                              left: `${inv.x * 100}%`,
                              top: `${inv.y * 100}%`,
                              ["--pinColor" as any]: variant?.color || "#94a3b8",
                              ["--haloColor" as any]: assignedCreative
                                ? creativeDisplayColorById.get(assignedCreative.id) || assignedCreative.color
                                : "transparent",
                              ["--pinInvScale" as any]: String(1 / modalMapZoom),
                              ["--pinJx" as any]: "0px",
                              ["--pinJy" as any]: "0px",
                            }}
                            type="button"
                            title={inv.id}
                            onClick={() => setMapModalInventoryId(inv.id)}
                          >
                            <span className="pin-halo" />
                            <span className="pin-core">{variant?.shortLabel || ""}</span>
                          </button>
                        );
                      })}
                  </div>
                </div>
                {modalMapError ? <div className="assign-mapPlaceholder">We could not load this map asset.</div> : null}
                <div className="map-hint" onClick={(e) => e.stopPropagation()}>
                  {Math.round(modalMapZoom * 100)}%
                  <button
                    className="map-hint-btn"
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      fitModalMapToView();
                    }}
                  >
                    Fit
                  </button>
                </div>
              </div>
            </div>
          </div>
        </Portal>
      ) : null}

      <Lightbox
        isOpen={!!lightbox}
        src={lightbox?.src || ""}
        fallbackSrc={lightbox?.fallbackSrc}
        title={lightbox?.title}
        subtitle={lightbox?.subtitle}
        openInNewTabUrl={lightbox?.openUrl}
        assetType={lightbox?.assetType}
        onClose={() => setLightbox(null)}
      />
    </AppShell>
  );
}
