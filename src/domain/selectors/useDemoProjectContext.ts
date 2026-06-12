// src/domain/selectors/useDemoProjectContext.ts
import { useMemo } from "react";
import { useDemoStore } from "../store/demoStore";
import { buildProjectContext } from "./projectContext";

export function useDemoProjectContext(projectId: string) {
  // IMPORTANT:
  // Each selector returns a value already stored in demoStore state.
  // We avoid returning a new object literal inside a selector because that
  // breaks useSyncExternalStore caching and can cause infinite re-render loops.

  const projects = useDemoStore((s) => s.projects);
  const scopes = useDemoStore((s) => s.scopes);
  const inventory = useDemoStore((s) => s.inventory);
  const creatives = useDemoStore((s) => s.creatives);
  const assignments = useDemoStore((s) => s.assignments);
  const proofs = useDemoStore((s) => s.proofs);
  const transit = useDemoStore((s) => s.transit);

  const productionApprovalMode = useDemoStore((s) => s.productionApprovalMode);
  const transitRequired = useDemoStore((s) => s.transitRequired);
  const productionReleasedByProject = useDemoStore((s) => s.productionReleasedByProject);
  const liveEditUnlockedByProject = useDemoStore((s) => s.liveEditUnlockedByProject);

  const venues = useDemoStore((s) => s.venues);

  return useMemo(() => {
    return buildProjectContext({
      source: {
        projects,
        scopes,
        inventory,
        creatives,
        assignments,
        proofs,
        transit,
        productionApprovalMode,
        transitRequired,
        productionReleasedByProject,
        liveEditUnlockedByProject,
        venues,
      },
      projectId,
    });
  }, [
    projects,
    scopes,
    inventory,
    creatives,
    assignments,
    proofs,
    transit,
    productionApprovalMode,
    transitRequired,
    productionReleasedByProject,
    liveEditUnlockedByProject,
    venues,
    projectId,
  ]);
}