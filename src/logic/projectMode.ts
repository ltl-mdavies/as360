export function isSeededDemoProjectId(projectId?: string | null) {
  if (!projectId) return false;
  if (projectId === "demo_001") return true;
  return projectId === "proj_001";
}

export function isDemoProjectRoute(projectId?: string | null, stateDemo?: boolean) {
  return stateDemo === true || isSeededDemoProjectId(projectId);
}
