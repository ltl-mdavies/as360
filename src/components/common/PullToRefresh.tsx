import { useRef, useState, type ReactNode, type TouchEvent } from "react";

type PullRefreshState = "idle" | "pulling" | "ready" | "refreshing" | "done";

type PullToRefreshProps = {
  children: ReactNode;
  disabled?: boolean;
  label?: string;
  onRefresh: () => Promise<void> | void;
};

const START_THRESHOLD = 8;
const REFRESH_THRESHOLD = 76;
const MAX_PULL = 118;
const COMPLETE_DELAY_MS = 650;

const DISABLED_TARGET_SELECTOR = [
  "a",
  "button",
  "input",
  "textarea",
  "select",
  "[contenteditable='true']",
  "[role='button']",
  "[role='dialog']",
  "[data-pull-refresh-disabled]",
  ".modal",
  ".lightbox",
  ".assign-mapCanvas",
  ".assign-mapModal",
  ".artwork-workspace",
  ".proof-artworkFrame",
  ".proof-revisionDrop",
  ".proof-historyModal",
  ".documents-mediaModal",
  ".reviewAllocation-modal",
  ".uploader-modal",
  ".shared-map-workspace",
].join(",");

function isMobileRefreshSurface() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(pointer: coarse), (max-width: 860px)").matches;
}

function canStartFromTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return true;
  return !target.closest(DISABLED_TARGET_SELECTOR);
}

function isAtPageTop() {
  const scrollingElement = document.scrollingElement || document.documentElement;
  return window.scrollY <= 0 && scrollingElement.scrollTop <= 0;
}

function stateLabel(state: PullRefreshState, label: string) {
  if (state === "ready") return "Release to refresh";
  if (state === "refreshing") return "Refreshing...";
  if (state === "done") return "Updated";
  return label;
}

export default function PullToRefresh({
  children,
  disabled = false,
  label = "Pull to refresh",
  onRefresh,
}: PullToRefreshProps) {
  const startYRef = useRef(0);
  const activeRef = useRef(false);
  const pullStartedRef = useRef(false);
  const [state, setState] = useState<PullRefreshState>("idle");
  const [pullDistance, setPullDistance] = useState(0);

  function resetSoon() {
    window.setTimeout(() => {
      setState("idle");
      setPullDistance(0);
      pullStartedRef.current = false;
      activeRef.current = false;
    }, COMPLETE_DELAY_MS);
  }

  function handleTouchStart(event: TouchEvent<HTMLDivElement>) {
    if (disabled || state === "refreshing" || !isMobileRefreshSurface() || !isAtPageTop() || !canStartFromTarget(event.target)) {
      activeRef.current = false;
      pullStartedRef.current = false;
      return;
    }
    activeRef.current = true;
    pullStartedRef.current = false;
    startYRef.current = event.touches[0]?.clientY || 0;
  }

  function handleTouchMove(event: TouchEvent<HTMLDivElement>) {
    if (!activeRef.current || disabled || state === "refreshing") return;
    const currentY = event.touches[0]?.clientY || 0;
    const rawDistance = currentY - startYRef.current;
    if (rawDistance <= START_THRESHOLD) return;
    if (!isAtPageTop()) {
      activeRef.current = false;
      setState("idle");
      setPullDistance(0);
      return;
    }

    event.preventDefault();
    pullStartedRef.current = true;
    const nextDistance = Math.min(MAX_PULL, Math.round(rawDistance * 0.58));
    setPullDistance(nextDistance);
    setState(nextDistance >= REFRESH_THRESHOLD ? "ready" : "pulling");
  }

  async function handleTouchEnd() {
    if (!activeRef.current) return;
    const shouldRefresh = pullStartedRef.current && pullDistance >= REFRESH_THRESHOLD && !disabled;
    if (!shouldRefresh) {
      activeRef.current = false;
      pullStartedRef.current = false;
      setState("idle");
      setPullDistance(0);
      return;
    }

    setState("refreshing");
    setPullDistance(REFRESH_THRESHOLD);
    try {
      await onRefresh();
      setState("done");
    } finally {
      resetSoon();
    }
  }

  return (
    <div
      className={`pull-refresh ${state !== "idle" ? "is-active" : ""} is-${state}`}
      style={{ "--pullRefreshDistance": `${pullDistance}px` } as any}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={() => {
        activeRef.current = false;
        pullStartedRef.current = false;
        setState("idle");
        setPullDistance(0);
      }}
    >
      <div className="pull-refreshIndicator" aria-live="polite" aria-atomic="true">
        <span className="pull-refreshSpinner" aria-hidden="true" />
        <span>{stateLabel(state, label)}</span>
      </div>
      {children}
    </div>
  );
}
