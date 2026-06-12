// src/domain/factories/createProject.ts
import type { Project, ProjectScope, Venue, InventoryItem } from "../types";
import type { NewProjectDraft } from "../../components/projects/CreateProjectModal";

/**
 * Generate a simple unique project id (client-side stub).
 * Later: Firestore doc id or server-generated id.
 */
export function makeProjectId(prefix = "proj") {
  return `${prefix}_${Date.now()}`;
}

/**
 * Create a Project + default ProjectScope (Option A):
 * scope.includedIds = ALL ACTIVE inventory items for the chosen venue.
 *
 * NOTE: this function does NOT persist anything. It just returns objects.
 */
export function createProjectWithDefaultScope(args: {
  draft: NewProjectDraft;
  customerId: string;
  venue: Venue;
  // inventory should be ALL inventory for that venue (across all locations/maps)
  venueInventory: InventoryItem[];
}): {
  project: Project;
  scope: ProjectScope;
} {
  const { draft, customerId, venue, venueInventory } = args;

  const projectId = makeProjectId();

  const project: Project = {
    id: projectId,
    customerId,
    venueId: venue.id,

    title: draft.title,
    poNumber: draft.poNumber,
    extId: projectId, // for now; later: separate extId policy
    liftOrderNumber: undefined,

    artworkDueDate: draft.artworkDueDate,
    postDate: draft.postDate,

    createdAt: new Date().toISOString(),
  };

  // ✅ Option A default: all ACTIVE inventory included
  const scope: ProjectScope = {
    includedIds: venueInventory
      .filter((i) => i.isActive)
      .map((i) => i.id),
  };

  return { project, scope };
}
