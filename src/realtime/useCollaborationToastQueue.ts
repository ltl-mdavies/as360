import { useCallback, useEffect, useRef } from "react";
import { demoStore } from "../domain/store/demoStore";
import type { WorkspaceChangeEvent } from "./useWorkspacePresence";

type PendingToast = {
  summary: string;
  actorName?: string;
};

export function useCollaborationToastQueue(fallbackSummary: string, delayMs = 900) {
  const pendingRef = useRef<PendingToast[]>([]);
  const timerRef = useRef<number | null>(null);

  const flush = useCallback(() => {
    timerRef.current = null;
    const pending = pendingRef.current.splice(0);
    if (pending.length === 0) return;
    if (pending.length === 1) {
      demoStore.actions.pushToast("success", pending[0].summary || fallbackSummary);
      return;
    }

    const actorNames = Array.from(new Set(pending.map((item) => item.actorName).filter(Boolean)));
    const summary =
      actorNames.length === 1
        ? `${pending.length} changes synced from ${actorNames[0]}.`
        : `${pending.length} collaboration changes synced.`;
    demoStore.actions.pushToast("success", summary);
  }, [fallbackSummary]);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, []);

  return useCallback((event: WorkspaceChangeEvent, summary?: string) => {
    pendingRef.current.push({
      summary: summary || event.summary || fallbackSummary,
      actorName: event.actorName,
    });
    if (timerRef.current) return;
    timerRef.current = window.setTimeout(flush, delayMs);
  }, [delayMs, fallbackSummary, flush]);
}
