// src/logic/useAssignmentMode.ts
// Phase 2A: Assignment mode state + helpers (UI only, no persistence)

export type AssignModeState = {
  isActive: boolean;
  creativeId: string | null;
};

export function startAssignMode(creativeId: string): AssignModeState {
  return { isActive: true, creativeId };
}

export function endAssignMode(): AssignModeState {
  return { isActive: false, creativeId: null };
}