// src/components/projects/InventoryScopeModal.tsx
import { type ReactNode, useEffect, useMemo, useState } from "react";
import Portal from "../common/Portal";
import type { InventoryItem, MapLayer, MediaVariant } from "../../logic/mockAssignment";
import { mediaLabelFromKey, mockMediaVariants } from "../../logic/mockAssignment";
import { useSharedMapWorkspace } from "../maps/useSharedMapWorkspace";
import { getInventoryDisplayId, getInventoryLocationName, getInventoryStableId } from "../../logic/inventoryIdentity";

type Props = {
  isOpen: boolean;
  onClose: () => void;

  projectTitle: string;
  venueName: string;
  maps: MapLayer[];
  inventory: InventoryItem[];

  // includedIds model (explicit)
  initialIncludedIds: string[];
  onConfirm: (includedIds: string[]) => void | Promise<void>;

  // Future hook: show inactive items (Intersection preference)
  showInactiveItems?: boolean;
  title?: string;
  subtitle?: string;
  inventoryLabel?: string;
  confirmLabel?: string;
  savingLabel?: string;
  headerAddon?: ReactNode;
  canConfirm?: boolean;
  validationMessage?: string;
};

export default function InventoryScopeModal({
  isOpen,
  onClose,
  projectTitle,
  venueName,
  maps,
  inventory,
  initialIncludedIds,
  onConfirm,
  showInactiveItems = false,
  title = "Included Inventory",
  subtitle,
  inventoryLabel = "Inventory",
  confirmLabel = "Confirm Scope",
  savingLabel = "Saving Scope...",
  headerAddon,
  canConfirm = true,
  validationMessage,
}: Props) {
  const [activeMapId, setActiveMapId] = useState(maps[0]?.id ?? "");
  const [q, setQ] = useState("");
  const [variantKey, setVariantKey] = useState<string>("all");

  // Included set (explicit)
  const [includedSet, setIncludedSet] = useState<Set<string>>(new Set(initialIncludedIds));
  const [isSaving, setIsSaving] = useState(false);

  const activeMap = useMemo(() => maps.find((m) => m.id === activeMapId) || null, [maps, activeMapId]);

  const {
    viewportRef: mapViewportRef,
    imageRef: mapImgRef,
    mapFrameStyle,
    zoom,
    pan,
    mapLoading,
    mapError,
    fitMapToView,
    onImageLoad,
    onImageError,
    onWheelMap,
    onMouseDownMap,
    onMouseMoveMap,
    onMouseUpMap,
    onTouchStartMap,
    onTouchMoveMap,
    onTouchEndMap,
  } = useSharedMapWorkspace({
    mapSrc: activeMap?.imageUrl ?? null,
    activeKey: activeMapId,
    enabled: isOpen,
  });

  const inventoryForScope = useMemo(() => {
    return inventory.filter((i) => (showInactiveItems ? true : (i as any).isActive !== false));
  }, [inventory, showInactiveItems]);

  const visibleInventory = useMemo(() => {
    return inventoryForScope.filter((i) => i.mapId === activeMapId);
  }, [inventoryForScope, activeMapId]);

  const filteredList = useMemo(() => {
    const nq = q.trim().toLowerCase();
    return visibleInventory
      .filter((i) => (variantKey === "all" ? true : i.mediaVariantKey === variantKey))
      .filter((i) => (nq ? getInventoryDisplayId(i).toLowerCase().includes(nq) : true))
      .sort((a, b) => getInventoryDisplayId(a).localeCompare(getInventoryDisplayId(b)));
  }, [visibleInventory, q, variantKey]);

  const variantOptions = useMemo(() => {
    const keys = Array.from(new Set(inventoryForScope.map((i) => i.mediaVariantKey))).sort();
    return ["all", ...keys];
  }, [inventoryForScope]);

  const counts = useMemo(() => {
    const total = inventoryForScope.length;
    const included = Array.from(includedSet).length;

    const byMap = maps.map((m) => {
      const inv = inventoryForScope.filter((i) => i.mapId === m.id);
      const includedCount = inv.filter((i) => includedSet.has(getInventoryStableId(i))).length;
      return { mapId: m.id, mapName: m.name, included: includedCount, total: inv.length };
    });

    const byVariantMap = new Map<string, { included: number; total: number }>();
    for (const inv of inventoryForScope) {
      const cur = byVariantMap.get(inv.mediaVariantKey) || { included: 0, total: 0 };
      cur.total += 1;
      if (includedSet.has(getInventoryStableId(inv))) cur.included += 1;
      byVariantMap.set(inv.mediaVariantKey, cur);
    }

    const byVariant = Array.from(byVariantMap.entries())
      .map(([key, v]) => ({
        key,
        label: mediaLabelFromKey(key),
        included: v.included,
        total: v.total,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));

    return { total, included, byMap, byVariant };
  }, [inventoryForScope, includedSet, maps]);

  // --------------------------------
  // Toggle include/exclude
  // --------------------------------
  function toggleIncluded(id: string) {
    setIncludedSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllOnMap() {
    setIncludedSet((prev) => {
      const next = new Set(prev);
      for (const inv of visibleInventory) next.add(getInventoryStableId(inv));
      return next;
    });
  }

  function selectAllVenue() {
    setIncludedSet(new Set(inventoryForScope.map((i) => getInventoryStableId(i))));
  }

  function deselectAll() {
    setIncludedSet(new Set());
  }

  async function handleConfirm() {
    if (isSaving) return;
    setIsSaving(true);
    try {
      await onConfirm(Array.from(includedSet).sort());
      onClose();
    } finally {
      setIsSaving(false);
    }
  }

  useEffect(() => {
    if (!isOpen) return;
    // reset included on open to match initial
    setIncludedSet(new Set(initialIncludedIds));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    if (!maps.length) {
      setActiveMapId("");
      return;
    }
    if (!activeMapId || !maps.some((map) => map.id === activeMapId)) {
      setActiveMapId(maps[0].id);
    }
  }, [activeMapId, isOpen, maps]);

  if (!isOpen) return null;

  return (
    <Portal>
      <div className="scope-backdrop" onMouseDown={onClose}>
        <div className="scope-modal" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
          {/* Header */}
          <div className="scope-head">
            <div className="scope-head-left">
              <div className="scope-title">{title}</div>
              <div className="scope-sub">{subtitle || `${projectTitle} · ${venueName}`}</div>
            </div>
            <div className="scope-head-right">
              <button className="btn btn-ghost btn-soft" type="button" onClick={onClose}>✕</button>
            </div>
          </div>
          {headerAddon ? <div className="scope-addon">{headerAddon}</div> : null}

          {/* Body: 3-rail */}
          <div className="scope-body">
            {/* Left rail */}
            <div className="scope-left">
              <div className="scope-left-top">
                <div className="scope-left-title">{inventoryLabel}</div>

                <div className="scope-fieldRow">
                  <div className="scope-search">
                    <span className="field-icon">⌕</span>
                    <input
                      className="field-input"
                      placeholder="Search inventory ID…"
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                    />
                  </div>

                  <select className="select scope-select" value={activeMapId} onChange={(e) => setActiveMapId(e.target.value)}>
                    {maps.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </div>

                <select className="select scope-selectWide" value={variantKey} onChange={(e) => setVariantKey(e.target.value)}>
                  <option value="all">All Media</option>
                  {variantOptions.map((vk) =>
                    vk === "all" ? null : (
                      <option key={vk} value={vk}>{mediaLabelFromKey(vk)}</option>
                    )
                  )}
                </select>

                <div className="scope-batch">
                  <button className="btn btn-ghost btn-soft" type="button" onClick={selectAllOnMap}>
                    Select all on map
                  </button>
                  <button className="btn btn-ghost btn-soft" type="button" onClick={selectAllVenue}>
                    Select all
                  </button>
                  <button className="btn btn-ghost btn-soft" type="button" onClick={deselectAll}>
                    Deselect all
                  </button>
                </div>
              </div>

              <div className="scope-list">
                {filteredList.map((inv) => {
                  const stableId = getInventoryStableId(inv);
                  const displayId = getInventoryDisplayId(inv);
                  const included = includedSet.has(stableId);
                  return (
                    <label key={stableId} className={`scope-row ${included ? "is-included" : "is-excluded"}`}>
                      <input
                        type="checkbox"
                        checked={included}
                        onChange={() => toggleIncluded(stableId)}
                      />
                      <div className="scope-row-main">
                        <div className="scope-row-id">{displayId}</div>
                        <div className="scope-row-meta">
                          {mediaLabelFromKey(inv.mediaVariantKey)} · {getInventoryLocationName(inv)}
                        </div>
                      </div>
                      <span className={`chip ${included ? "tone-success" : "tone-neutral"}`}>
                        {included ? "Included" : "Excluded"}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Center map */}
            <div className="scope-map">
              <div className="scope-mapHead">
                <div>
                  <div className="scope-mapTitle">{activeMap?.name || "Map"}</div>
                  <div className="scope-mapSub">{venueName}</div>
                </div>
              </div>
              <div
                className="assign-mapCanvas scope-mapViewport"
                ref={mapViewportRef}
                onWheel={onWheelMap}
                onMouseDown={onMouseDownMap}
                onMouseMove={onMouseMoveMap}
                onMouseUp={onMouseUpMap}
                onMouseLeave={onMouseUpMap}
                onTouchStart={onTouchStartMap}
                onTouchMove={onTouchMoveMap}
                onTouchEnd={onTouchEndMap}
                onTouchCancel={onTouchEndMap}
              >
                <div
                  className="map-transform"
                  style={{ ...mapFrameStyle, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
                >
                  {activeMap?.imageUrl ? (
                    <img
                      ref={mapImgRef}
                      className={`map-image ${mapLoading ? "is-loading" : ""}`}
                      src={activeMap.imageUrl}
                      alt=""
                      draggable={false}
                      onLoad={onImageLoad}
                      onError={onImageError}
                    />
                  ) : (
                    <div className="assign-mapPlaceholder">No map image</div>
                  )}

                  <div className="pin-layer">
                    {visibleInventory.map((inv) => {
                      const variant = (mockMediaVariants as MediaVariant[]).find((v) => v.key === inv.mediaVariantKey);
                      const baseColor = (variant as any)?.color || "#94a3b8";
                      const short = (variant as any)?.shortLabel || "";
                      const stableId = getInventoryStableId(inv);
                      const displayId = getInventoryDisplayId(inv);

                      const included = includedSet.has(stableId);

                      return (
                        <button
                          key={stableId}
                          className={`pin ${included ? "scope-pin-on" : "scope-pin-off"}`}
                          style={{
                            left: `${inv.x * 100}%`,
                            top: `${inv.y * 100}%`,
                            ["--pinColor" as any]: baseColor,
                            ["--haloColor" as any]: "transparent",
                            ["--pinInvScale" as any]: String(1 / zoom),
                            ["--pinJx" as any]: `0px`,
                            ["--pinJy" as any]: `0px`,
                          }}
                          type="button"
                          title={displayId}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            toggleIncluded(stableId);
                          }}
                        >
                          <span className="pin-halo" />
                          <span className="pin-core">{short}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {mapError ? <div className="assign-mapPlaceholder">We could not load this map asset.</div> : null}

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
            </div>

            {/* Right rail summary */}
            <div className="scope-right">
              <div className="scope-summary">
                <div className="scope-summaryTitle">Summary</div>
                <div className="scope-summaryBig">
                  <div className="scope-summaryNum">{counts.included}</div>
                  <div className="scope-summaryDen">/ {counts.total} included</div>
                </div>

                <div className="scope-summaryBlock">
                  <div className="scope-summaryBlockTitle">By Location</div>
                  {counts.byMap.map((m) => (
                    <div key={m.mapId} className="scope-sumRow">
                      <span>{m.mapName}</span>
                      <span className={m.included === m.total ? "ok" : ""}>{m.included}/{m.total}</span>
                    </div>
                  ))}
                </div>

                <div className="scope-summaryBlock">
                  <div className="scope-summaryBlockTitle">By Media</div>
                  {counts.byVariant.map((v) => (
                    <div key={v.key} className="scope-sumRow">
                      <span>{v.label}</span>
                      <span className={v.included === v.total ? "ok" : ""}>{v.included}/{v.total}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="scope-foot">
            {validationMessage ? <div className="scope-footNote">{validationMessage}</div> : null}
            <button className="btn btn-ghost btn-soft" type="button" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary btn-wide" type="button" onClick={() => void handleConfirm()} disabled={isSaving || !canConfirm}>
              {isSaving ? savingLabel : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
