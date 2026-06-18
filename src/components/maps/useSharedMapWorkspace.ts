import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { MouseEvent as ReactMouseEvent, WheelEvent as ReactWheelEvent } from "react";
import "./sharedMapWorkspace.css";

type SharedMapWorkspaceOptions = {
  mapSrc?: string | null;
  activeKey: string;
  enabled?: boolean;
  interactionLocked?: boolean;
  minZoom?: number;
  maxZoom?: number;
  fitDelayMs?: number;
};

export function clampMapZoom(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function useSharedMapWorkspace({
  mapSrc,
  activeKey,
  enabled = true,
  interactionLocked = false,
  minZoom = 0.25,
  maxZoom = 4,
  fitDelayMs = 30,
}: SharedMapWorkspaceOptions) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const panStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [mapLoading, setMapLoading] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [mapFrame, setMapFrame] = useState({ left: 0, top: 0, width: 0, height: 0 });

  const updateMapFrame = useCallback(() => {
    const viewport = viewportRef.current;
    const image = imageRef.current;
    if (!viewport || !image) return false;

    const viewportRect = viewport.getBoundingClientRect();
    const viewportWidth = viewportRect.width || viewport.clientWidth;
    const viewportHeight = viewportRect.height || viewport.clientHeight;
    const naturalWidth = image.naturalWidth || image.clientWidth;
    const naturalHeight = image.naturalHeight || image.clientHeight;

    if (viewportWidth < 8 || viewportHeight < 8 || naturalWidth < 8 || naturalHeight < 8) {
      return false;
    }

    const imageAspect = naturalWidth / naturalHeight;
    const viewportAspect = viewportWidth / viewportHeight;
    const width = imageAspect > viewportAspect ? viewportWidth : viewportHeight * imageAspect;
    const height = imageAspect > viewportAspect ? viewportWidth / imageAspect : viewportHeight;
    const next = {
      left: (viewportWidth - width) / 2,
      top: (viewportHeight - height) / 2,
      width,
      height,
    };

    setMapFrame((current) => {
      const changed =
        Math.abs(current.left - next.left) > 0.5 ||
        Math.abs(current.top - next.top) > 0.5 ||
        Math.abs(current.width - next.width) > 0.5 ||
        Math.abs(current.height - next.height) > 0.5;
      return changed ? next : current;
    });

    return true;
  }, []);

  const mapFrameStyle = useMemo<CSSProperties>(
    () =>
      mapFrame.width > 0 && mapFrame.height > 0
        ? {
            left: `${mapFrame.left}px`,
            top: `${mapFrame.top}px`,
            width: `${mapFrame.width}px`,
            height: `${mapFrame.height}px`,
          }
        : {
            left: 0,
            top: 0,
            width: "100%",
            height: "100%",
          },
    [mapFrame.height, mapFrame.left, mapFrame.top, mapFrame.width]
  );

  const canUseCurrentImage = useCallback(() => {
    const image = imageRef.current;
    if (!image || !image.complete) return false;

    const rect = image.getBoundingClientRect();
    return (
      (image.naturalWidth > 0 && image.naturalHeight > 0) ||
      image.clientWidth > 0 ||
      image.clientHeight > 0 ||
      rect.width > 0 ||
      rect.height > 0
    );
  }, []);

  const fitMapToView = useCallback(() => {
    if (!updateMapFrame()) {
      return false;
    }

    setZoom(clampMapZoom(1, minZoom, maxZoom));
    setPan({ x: 0, y: 0 });
    return true;
  }, [maxZoom, minZoom, updateMapFrame]);

  const finalizeLoadedMap = useCallback(() => {
    if (!enabled || !mapSrc) return false;
    if (!canUseCurrentImage()) return false;
    if (!fitMapToView()) return false;

    setMapError(false);
    setMapLoading(false);
    return true;
  }, [canUseCurrentImage, enabled, fitMapToView, mapSrc]);

  useEffect(() => {
    if (!interactionLocked) return;
    setIsPanning(false);
    panStartRef.current = null;
  }, [interactionLocked]);

  useEffect(() => {
    if (!enabled) return;
    if (!mapSrc) {
      setMapLoading(false);
      setMapError(false);
      setZoom(1);
      setPan({ x: 0, y: 0 });
      setMapFrame({ left: 0, top: 0, width: 0, height: 0 });
      return;
    }

    setMapLoading(true);
    setMapError(false);
    setIsPanning(false);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    panStartRef.current = null;

    const tryFinalize = () => finalizeLoadedMap();

    const timeout = window.setTimeout(() => {
      tryFinalize();
    }, fitDelayMs);

    const lateTimeout = window.setTimeout(() => {
      tryFinalize();
    }, Math.max(fitDelayMs * 4, 180));

    const raf = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        tryFinalize();
      });
    });

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined" && viewportRef.current) {
      observer = new ResizeObserver(() => {
        updateMapFrame();
        tryFinalize();
      });
      observer.observe(viewportRef.current);
    }

    return () => {
      window.clearTimeout(timeout);
      window.clearTimeout(lateTimeout);
      window.cancelAnimationFrame(raf);
      observer?.disconnect();
    };
  }, [activeKey, enabled, finalizeLoadedMap, fitDelayMs, mapSrc, updateMapFrame]);

  const onImageLoad = useCallback(() => {
    if (finalizeLoadedMap()) return;

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        finalizeLoadedMap();
      });
    });
  }, [finalizeLoadedMap]);

  const onImageError = useCallback(() => {
    if (!enabled) return;
    setMapError(true);
    setMapLoading(false);
  }, [enabled]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !enabled || interactionLocked) return;

    function onNativeWheel(event: WheelEvent) {
      event.preventDefault();
      const factor = event.deltaY > 0 ? 0.92 : 1.08;
      setZoom((current) => clampMapZoom(current * factor, minZoom, maxZoom));
    }

    viewport.addEventListener("wheel", onNativeWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onNativeWheel);
  }, [enabled, interactionLocked, maxZoom, minZoom]);

  function onWheelMap(event: ReactWheelEvent<HTMLDivElement>) {
    if (!enabled || interactionLocked) return;
    event.stopPropagation();
  }

  function onMouseDownMap(event: ReactMouseEvent<HTMLDivElement>) {
    if (!enabled || interactionLocked) return;
    if ((event.target as HTMLElement | null)?.closest(".pin")) return;
    event.preventDefault();
    setIsPanning(true);
    panStartRef.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
  }

  function onMouseMoveMap(event: ReactMouseEvent<HTMLDivElement>) {
    if (!enabled || interactionLocked || !isPanning || !panStartRef.current) return;
    const dx = event.clientX - panStartRef.current.x;
    const dy = event.clientY - panStartRef.current.y;
    setPan({ x: panStartRef.current.panX + dx, y: panStartRef.current.panY + dy });
  }

  function onMouseUpMap() {
    setIsPanning(false);
    panStartRef.current = null;
  }

  function zoomIn() {
    setZoom((current) => clampMapZoom(current * 1.08, minZoom, maxZoom));
  }

  function zoomOut() {
    setZoom((current) => clampMapZoom(current * 0.92, minZoom, maxZoom));
  }

  function clientPointToNormalized(clientX: number, clientY: number) {
    const image = imageRef.current;
    if (!image) return null;
    const rect = image.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;

    return {
      x: clampMapZoom((clientX - rect.left) / rect.width, 0.02, 0.98),
      y: clampMapZoom((clientY - rect.top) / rect.height, 0.02, 0.98),
    };
  }

  return {
    viewportRef,
    imageRef,
    mapFrameStyle,
    zoom,
    pan,
    isPanning,
    mapLoading,
    mapError,
    fitMapToView,
    onImageLoad,
    onImageError,
    onWheelMap,
    onMouseDownMap,
    onMouseMoveMap,
    onMouseUpMap,
    zoomIn,
    zoomOut,
    clientPointToNormalized,
  };
}
