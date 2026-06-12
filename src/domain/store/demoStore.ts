// src/domain/store/demoStore.ts
import { useSyncExternalStore } from "react";
import type {
  Project,
  ProjectScope,
  Venue,
  VenueLocation,
  InventoryItem,
  Creative,
  Assignment,
  TransitApproval,
  ProofLine,
  ProjectShareLink,
  ShareAccessType,
  ShareParticipant,
  ProjectAuditEvent,
} from "../types";
import { buildDemoDataset } from "./demoSeed";
import type { CreateOrderPayload } from "../../logic/orderBuilder";
import type { LiftOrderLine } from "../../logic/lift/parseFlushOrder";
import type { SnapshotLineKeyByLineNumber } from "../../logic/lift/diffLiftOrderLines";
import { diffLiftOrderLines } from "../../logic/lift/diffLiftOrderLines";

type ProductionApprovalMode = "immediate" | "project_release";

type DemoState = {
  hydrated: boolean;

  venues: Venue[];
  locations: VenueLocation[];
  inventory: InventoryItem[];

  projects: Project[];
  scopes: Record<string, ProjectScope>;

  creatives: Creative[];
  assignments: Assignment[];

  transit: Record<string, TransitApproval>;
  proofs: Record<string, ProofLine[]>;
  shareLinks: ProjectShareLink[];
  shareParticipants: ShareParticipant[];
  auditEvents: ProjectAuditEvent[];

  activeProjectId: string;

  // Demo policy knobs
  productionApprovalMode: ProductionApprovalMode;
  transitRequired: boolean;
  productionReleasedByProject: Record<string, boolean>;

  // Post-submit edit story
  liveEditUnlockedByProject: Record<string, boolean>;
  submissionSnapshotByProject: Record<string, SnapshotLineKeyByLineNumber>;
  demoLiftLinesByProject: Record<string, LiftOrderLine[]>;

  lastToast?: { tone: "success" | "warning" | "danger"; message: string; at: number };
};

type Listener = () => void;

function emptyState(): DemoState {
  return {
    hydrated: false,
    venues: [],
    locations: [],
    inventory: [],
    projects: [],
    scopes: {},
    creatives: [],
    assignments: [],
    transit: {},
    proofs: {},
    shareLinks: [],
    shareParticipants: [],
    auditEvents: [],
    activeProjectId: "demo_001",

    productionApprovalMode: "project_release",
    transitRequired: true,
    productionReleasedByProject: {},

    liveEditUnlockedByProject: {},
    submissionSnapshotByProject: {},
    demoLiftLinesByProject: {},

    lastToast: undefined,
  };
}

function createStore() {
  let state: DemoState = emptyState();
  const listeners = new Set<Listener>();

  function emit() {
    listeners.forEach((l) => l());
  }

  function setState(patch: Partial<DemoState> | ((s: DemoState) => Partial<DemoState>)) {
    const nextPatch = typeof patch === "function" ? patch(state) : patch;
    // allow no-op patches
    if (!nextPatch || Object.keys(nextPatch).length === 0) return;
    state = { ...state, ...nextPatch };
    emit();
  }

  function getState() {
    return state;
  }

  function subscribe(listener: Listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  // ---------------- Actions ----------------
  function makeId(prefix: string) {
    return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 9)}`;
  }

  function makeToken(prefix = "share") {
    return `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
  }

  function buildDefaultShareLinks(projectId: string): ProjectShareLink[] {
    const createdAt = new Date().toISOString();
    return [
      {
        id: `${projectId}_share_collaboration`,
        token: `${projectId}_client_access`,
        projectId,
        label: "End Client Collaboration",
        accessType: "collaboration",
        status: "active",
        createdByName: "Angie",
        createdAt,
      },
      {
        id: `${projectId}_share_artwork`,
        token: `${projectId}_artwork_upload`,
        projectId,
        label: "Artwork Upload Only",
        accessType: "artwork_upload",
        status: "active",
        createdByName: "Angie",
        createdAt,
      },
      {
        id: `${projectId}_share_transit`,
        token: `${projectId}_transit_review`,
        projectId,
        label: "Transit Approval",
        accessType: "transit_approval",
        status: "active",
        createdByName: "Angie",
        createdAt,
      },
      {
        id: `${projectId}_share_view`,
        token: `${projectId}_view_only`,
        projectId,
        label: "View Only",
        accessType: "view_only",
        status: "active",
        createdByName: "Angie",
        createdAt,
      },
    ];
  }

  function hydrateDemo() {
    if (state.hydrated) return;
    const demo = buildDemoDataset();
    const activeProjectId = demo.projects[0]?.id || "demo_001";
    setState({
      hydrated: true,
      venues: demo.venues,
      locations: demo.locations,
      inventory: demo.inventory,
      projects: demo.projects,
      scopes: demo.scopes,
      creatives: demo.creatives,
      assignments: demo.assignments,
      transit: demo.transit,
      proofs: demo.proofs,
      shareLinks: buildDefaultShareLinks(activeProjectId),
      shareParticipants: [],
      auditEvents: [],
      activeProjectId,

      productionApprovalMode: "project_release",
      transitRequired: true,
      productionReleasedByProject: {},

      liveEditUnlockedByProject: {},
      submissionSnapshotByProject: {},
      demoLiftLinesByProject: {},
    });
  }
  
  function clearToast() {
    setState({ lastToast: undefined });
  }

  function resetDemo() {
    state = emptyState();
    emit();
    hydrateDemo();
  }

  function setActiveProject(projectId: string) {
    setState({ activeProjectId: projectId });
  }

  function updateProjectDetails(
    projectId: string,
    patch: Partial<Pick<Project, "title" | "poNumber" | "artworkDueDate" | "postDate" | "venueId">>
  ) {
    setState((s) => ({
      projects: s.projects.map((project) =>
        project.id === projectId
          ? {
              ...project,
              ...patch,
            }
          : project
      ),
    }));
    pushToast("success", "Project details updated");
  }

  function createShareLink(args: {
    projectId: string;
    label: string;
    accessType: ShareAccessType;
    createdByName?: string;
  }) {
    const link: ProjectShareLink = {
      id: makeId("share"),
      token: makeToken(args.accessType.replace("_", "")),
      projectId: args.projectId,
      label: args.label.trim() || "Shared project link",
      accessType: args.accessType,
      status: "active",
      createdByName: args.createdByName || "Angie",
      createdAt: new Date().toISOString(),
    };
    setState((s) => ({ shareLinks: [...s.shareLinks, link] }));
    return link;
  }

  function revokeShareLink(shareLinkId: string) {
    setState((s) => ({
      shareLinks: s.shareLinks.map((link) =>
        link.id === shareLinkId ? { ...link, status: "revoked" } : link
      ),
    }));
  }

  function regenerateShareLink(shareLinkId: string) {
    setState((s) => ({
      shareLinks: s.shareLinks.map((link) =>
        link.id === shareLinkId ? { ...link, token: makeToken(link.accessType.replace("_", "")), status: "active" } : link
      ),
    }));
  }

  function ensureShareParticipant(args: {
    shareLinkId: string;
    displayName: string;
    email: string;
    participantId?: string;
  }) {
    const now = new Date().toISOString();
    let participant: ShareParticipant | undefined;
    setState((s) => {
      const existing = s.shareParticipants.find(
        (p) =>
          p.id === args.participantId ||
          (p.shareLinkId === args.shareLinkId && p.email.toLowerCase() === args.email.toLowerCase())
      );
      participant = existing
        ? { ...existing, displayName: args.displayName.trim(), email: args.email.trim(), lastSeenAt: now }
        : {
            id: args.participantId || makeId("participant"),
            shareLinkId: args.shareLinkId,
            displayName: args.displayName.trim(),
            email: args.email.trim(),
            firstSeenAt: now,
            lastSeenAt: now,
          };

      return {
        shareParticipants: existing
          ? s.shareParticipants.map((p) => (p.id === existing.id ? participant! : p))
          : [...s.shareParticipants, participant!],
      };
    });
    return participant!;
  }

  function addAuditEvent(event: Omit<ProjectAuditEvent, "id" | "createdAt">) {
    const next: ProjectAuditEvent = {
      ...event,
      id: makeId("audit"),
      createdAt: new Date().toISOString(),
    };
    setState((s) => ({ auditEvents: [next, ...s.auditEvents].slice(0, 100) }));
  }

  function updateScope(projectId: string, includedIds: string[]) {
    setState((s) => ({
      scopes: { ...s.scopes, [projectId]: { includedIds: includedIds.slice().sort() } },
    }));
  }

  function setAssignment(projectId: string, inventoryId: string, creativeId: string | null) {
    setState((s) => {
      const updatedAt = new Date().toISOString();
      const next = s.assignments.map((a) =>
        a.projectId === projectId && a.inventoryId === inventoryId ? { ...a, creativeId, updatedAt } : a
      );
      const exists = next.some((a) => a.projectId === projectId && a.inventoryId === inventoryId);
      if (!exists) next.push({ projectId, inventoryId, creativeId, updatedAt });
      return { assignments: next };
    });
  }

  function addCreative(projectId: string, c: Omit<Creative, "projectId" | "createdAt">) {
    setState((s) => ({
      creatives: [...s.creatives, { ...c, projectId, createdAt: new Date().toISOString() }],
    }));
  }

  function updateCreative(projectId: string, creativeId: string, patch: Partial<Creative>) {
    setState((s) => ({
      creatives: s.creatives.map((creative) =>
        creative.projectId === projectId && creative.id === creativeId
          ? { ...creative, ...patch }
          : creative
      ),
    }));
  }

  function removeCreative(projectId: string, creativeId: string) {
    setState((s) => ({
      creatives: s.creatives.filter((creative) => !(creative.projectId === projectId && creative.id === creativeId)),
      assignments: s.assignments.map((assignment) =>
        assignment.projectId === projectId && assignment.creativeId === creativeId
          ? { ...assignment, creativeId: null, updatedAt: new Date().toISOString() }
          : assignment
      ),
      proofs: {
        ...s.proofs,
        [projectId]: (s.proofs[projectId] || []).filter((line) => line.clientCreativeId !== creativeId),
      },
    }));
  }

  function pushToast(tone: "success" | "warning" | "danger", message: string) {
    setState(() => ({ lastToast: { tone, message, at: Date.now() } }));
  }

  // ---------------- Demo: seed proofs (so Proof Approval is "ready") ----------------
  function seedDemoProofsForProject(projectId: string): ProofLine[] {
    const projectCreatives = state.creatives.filter((c) => c.projectId === projectId);
    const pickA = projectCreatives[0];
    const pickB = projectCreatives[1] || projectCreatives[0];
    const pickC = projectCreatives[4] || projectCreatives[2] || projectCreatives[0];

    const cida = pickA?.id || "demo_creative_A";
    const cidb = pickB?.id || "demo_creative_B";
    const cidc = pickC?.id || cida;

    const vka = (pickA as any)?.mediaVariantKey || "Media||0||0";
    const vkb = (pickB as any)?.mediaVariantKey || vka;
    const vkc = (pickC as any)?.mediaVariantKey || vka;

    const assignedIdsForCreative = (creativeId: string) =>
      state.assignments
        .filter((a) => a.projectId === projectId && a.creativeId === creativeId)
        .map((a) => a.inventoryId)
        .slice(0, 3);

    return [
      {
        projectId,
        lineItemId: `${projectId}_line_1`,
        lineNumber: 1,
        clientCreativeId: cida,
        mediaVariantKey: vka,
        locations: assignedIdsForCreative(cida),
        status: "pending",
        revised: false,
        proofThumbUrl: "https://picsum.photos/seed/demo_proof_1/900/560",
        proofFullUrl: "https://picsum.photos/seed/demo_proof_1_full/1600/1000",
        printTeamFeedback: "Please confirm margin on lower-right.",
      } as any,
      {
        projectId,
        lineItemId: `${projectId}_line_2`,
        lineNumber: 2,
        clientCreativeId: cidb,
        mediaVariantKey: vkb,
        locations: assignedIdsForCreative(cidb),
        status: "approved",
        revised: false,
        proofThumbUrl: "https://picsum.photos/seed/demo_proof_2/900/560",
        proofFullUrl: "https://picsum.photos/seed/demo_proof_2_full/1600/1000",
        printTeamFeedback: "Approved — ready for print.",
      } as any,
      {
        projectId,
        lineItemId: `${projectId}_line_3`,
        lineNumber: 3,
        clientCreativeId: cidc,
        mediaVariantKey: vkc,
        locations: assignedIdsForCreative(cidc),
        status: "pending",
        revised: false,
        proofThumbUrl: "https://picsum.photos/seed/demo_proof_3/900/560",
        proofFullUrl: "https://picsum.photos/seed/demo_proof_3_full/1600/1000",
        printTeamFeedback: "Please confirm final copy lockup before release.",
      } as any,
    ];
  }

  // ---------------- Demo write-backs: Transit + Proofs ----------------
  function upsertTransitApproval(projectId: string, patch: Partial<TransitApproval>) {
    setState((s) => {
      const existing = s.transit[projectId] || { projectId, status: "not_started" as const };
      return {
        transit: { ...s.transit, [projectId]: { ...existing, ...patch, projectId } },
        lastToast: { tone: "success", message: "Transit Approval submitted", at: Date.now() },
      };
    });
  }

  function updateProofLine(projectId: string, lineItemId: string, patch: Partial<ProofLine>) {
    setState((s) => {
      const lines = s.proofs[projectId] || [];
      const next = lines.map((l) => (l.lineItemId === lineItemId ? { ...l, ...patch } : l));
      return { proofs: { ...s.proofs, [projectId]: next } };
    });
  }

  function approveProofLine(projectId: string, lineItemId: string, userName?: string) {
    updateProofLine(projectId, lineItemId, {
      status: "approved",
      printTeamFeedback: userName ? `Approved by ${userName}` : undefined,
    });
    pushToast("success", "Proof approved");
  }

  function reviseProofLine(projectId: string, lineItemId: string) {
    updateProofLine(projectId, lineItemId, {
      revised: true,
      status: "pending",
      proofThumbUrl: `https://picsum.photos/seed/revised_proof_thumb_${projectId}_${lineItemId}/900/560`,
      proofFullUrl: `https://picsum.photos/seed/revised_proof_full_${projectId}_${lineItemId}/1600/1000`,
      printTeamFeedback: "Revised artwork received — updated proof is ready for review.",
    });
    pushToast("success", "Revision submitted and proof regenerated");
  }

  // ---------------- Production policy ----------------
  function setProductionApprovalMode(mode: ProductionApprovalMode) {
    setState({ productionApprovalMode: mode });
    pushToast("success", mode === "immediate" ? "Production mode: Immediate" : "Production mode: Project release");
  }

  function approveForProduction(projectId: string) {
    setState((s) => ({
      productionReleasedByProject: { ...s.productionReleasedByProject, [projectId]: true },
      lastToast: { tone: "success", message: "Approved for production", at: Date.now() },
    }));
  }

  // ============================================================
  // Live edit unlock + submission snapshot + demo “Lift lines”
  // ============================================================

  function setLiveEditUnlocked(projectId: string, unlocked: boolean) {
    setState((s) => ({
      liveEditUnlockedByProject: { ...s.liveEditUnlockedByProject, [projectId]: unlocked },
      lastToast: {
        tone: unlocked ? "warning" : "success",
        message: unlocked ? "Edits unlocked" : "Edits locked",
        at: Date.now(),
      },
    }));
  }

  /**
   * Called at submit time in demo mode:
   * - Stores a lineNumber->(unitNumber, creativeId) snapshot
   * - Stores a demo “current Lift lines” list
   */
  function recordDemoSubmission(projectId: string, payload: CreateOrderPayload) {
    const snapshot: SnapshotLineKeyByLineNumber = {};
    const liftLines: LiftOrderLine[] = payload.lines.map((l, idx) => {
      const lineNumber = idx + 1;
      snapshot[lineNumber] = { unitNumber: l.unitNumber, creativeId: l.creativeId };
      return {
        lineNumber,
        orderLineId: null,
        qty: l.quantity,
        productName: `${l.unitNumber} · ${l.filename}`,
        unitNumber: null,
        artUrl: null,
      };
    });

    setState((s) => ({
      submissionSnapshotByProject: { ...s.submissionSnapshotByProject, [projectId]: snapshot },
      demoLiftLinesByProject: { ...s.demoLiftLinesByProject, [projectId]: liftLines },
    }));
  }

  /**
   * Demo "submit order" write-back:
   * - record submission snapshot + lift lines
   * - mark order submitted
   * - seed proofs so Proof Approval is ready
   */
  function submitOrderDemo(args: { projectId: string; payload: CreateOrderPayload; note?: string }) {
    const { projectId, payload, note } = args;

    // Ensure baseline snapshot exists
    recordDemoSubmission(projectId, payload);

    // Mark the order as submitted
    setState((s) => ({
      projects: s.projects.map((p) =>
        p.id === projectId ? { ...p, liftOrderNumber: p.liftOrderNumber || "DEMO-A0001" } : p
      ),
      lastToast: { tone: "success", message: "Order submitted successfully", at: Date.now() },
    }));

    // Seed proofs if none exist yet
    setState((s) => {
      const existing = s.proofs[projectId];
      if (existing && existing.length > 0) return {};
      return { proofs: { ...s.proofs, [projectId]: seedDemoProofsForProject(projectId) } };
    });

    // Optional: store submission note on project
    if (note && note.trim()) {
      setState((s) => ({
        projects: s.projects.map((p: any) => (p.id === projectId ? { ...p, orderNote: note.trim() } : p)),
      }));
    }
  }

  /**
   * Demo apply: compute diff and update demoLiftLinesByProject accordingly.
   * Adds new lineNumbers appended to end (demo simplification).
   */
  function applyDemoOrderChanges(args: {
    projectId: string;
    desired: CreateOrderPayload;
    deleteMode: "qty_zero" | "cancel_field";
  }) {
    const { projectId, desired, deleteMode } = args;

    const snapshot = state.submissionSnapshotByProject[projectId];
    const current = state.demoLiftLinesByProject[projectId];

    if (!snapshot || !current) {
      pushToast("danger", "No submission snapshot found for this project");
      return;
    }

    const diff = diffLiftOrderLines({
      desired,
      current,
      snapshotLineKeyByLineNumber: snapshot,
      deleteMode,
    });

    // Apply updates
    let nextLines = current.map((l) => {
      const upd = diff.updates.find((u) => u.lineNumber === l.lineNumber);
      if (!upd) return l;
      if (typeof upd.set.qty === "number") return { ...l, qty: upd.set.qty };
      if ((upd.set as any).cancel) return { ...l, productName: (l.productName || "") + " (CANCELLED)" };
      return l;
    });

    // Apply adds: append new lineNumbers
    if (diff.adds.length > 0) {
      const maxLine = nextLines.reduce((m, l) => Math.max(m, l.lineNumber), 0);

      diff.adds.forEach((a, idx) => {
        const lineNumber = maxLine + idx + 1;

        // extend snapshot mapping
        const nextSnapshot = { ...(state.submissionSnapshotByProject[projectId] || {}) };
        nextSnapshot[lineNumber] = { unitNumber: a.desired.unitNumber, creativeId: a.desired.creativeId };
        state = {
          ...state,
          submissionSnapshotByProject: { ...state.submissionSnapshotByProject, [projectId]: nextSnapshot },
        };

        nextLines.push({
          lineNumber,
          orderLineId: null,
          qty: a.desired.quantity,
          productName: `${a.desired.unitNumber} · ${a.desired.filename}`,
          unitNumber: null,
          artUrl: null,
        });
      });
    }

    setState((s) => ({
      demoLiftLinesByProject: {
        ...s.demoLiftLinesByProject,
        [projectId]: nextLines.sort((a, b) => a.lineNumber - b.lineNumber),
      },
      lastToast: { tone: "success", message: "Order updated (demo)", at: Date.now() },
    }));
  }

  return {
    getState,
    setState,
    subscribe,
    actions: {
      hydrateDemo,
      resetDemo,
      setActiveProject,
      updateProjectDetails,
      updateScope,
      setAssignment,
      addCreative,
      updateCreative,
      removeCreative,

      pushToast,
      clearToast,

      createShareLink,
      revokeShareLink,
      regenerateShareLink,
      ensureShareParticipant,
      addAuditEvent,

      upsertTransitApproval,
      updateProofLine,
      approveProofLine,
      reviseProofLine,

      setProductionApprovalMode,
      approveForProduction,

      setLiveEditUnlocked,
      recordDemoSubmission,
      submitOrderDemo,
      seedDemoProofsForProject,
      applyDemoOrderChanges,
    },
  };
}

export const demoStore = createStore();

export function useDemoStore<T>(selector: (s: DemoState) => T): T {
  return useSyncExternalStore(
    demoStore.subscribe,
    () => selector(demoStore.getState()),
    () => selector(demoStore.getState())
  );
}
