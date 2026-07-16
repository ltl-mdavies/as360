// src/components/table/CellRenderer.tsx
import { useNavigate } from "react-router-dom";
import PopoverMenu from "../common/PopoverMenu";
import { useLocation } from "react-router-dom";
import { buildProjectOrderActionPath, isProjectOrderLifecycleAction } from "../../logic/orderLifecycleActions";

function routeForAction(action: string, projectId: string): string | null {
  if (isProjectOrderLifecycleAction(action)) {
    return buildProjectOrderActionPath(projectId, action, "default");
  }

  switch (action) {
    case "open_project":
      return `/p/${projectId}`;

    case "manage_project_details":
      return `/p/${projectId}?panel=details`;

    case "open_assignment":
      return `/p/${projectId}/assignment`;

    case "open_proofs":
      return `/p/${projectId}/proofs`;

    case "open_transit":
      return `/p/${projectId}/transit`;

    case "open_docs":
      return `/p/${projectId}/docs`;

    // These are “commands” later; for now send them to the right workspace
    case "submit_order":
      return `/p/${projectId}`; // later: open hub + show submit UI
    case "approve_for_production":
      return `/p/${projectId}`; // later: hub or project overview with release panel
    case "open_project_overview":
      return `/p/${projectId}`; // later: a dedicated overview route if desired

    default:
      return null;
  }
}

export default function CellRenderer({ cell, row }: { cell: any; row?: any }) {
  const navigate = useNavigate();

  if (!cell) return null;

  const projectId = row?.projectId as string | undefined;
  const location = useLocation();
  const isCustomerContext = location.pathname.startsWith("/customer");
  const modeParam = isCustomerContext ? "mode=customer" : "";

  switch (cell.type) {
    case "text":
      return (
        <div className="cell-text">
          <div className="cell-primary">{cell.primary}</div>
          {cell.secondary && <div className="cell-secondary">{cell.secondary}</div>}
        </div>
      );

    case "chip":
      return <span className={`chip tone-${cell.tone}`}>{cell.label}</span>;

    case "chips":
      return (
        <div className="chip-row">
          {cell.chips.map((c: any, i: number) => (
            <span key={i} className={`chip tone-${c.tone}`}>
              {c.label}
            </span>
          ))}
        </div>
      );

    case "actions": {
      const items = (cell.secondary || []).map((a: any) => ({
        label: a.label,
        action: a.action,
      }));

      const go = (action: string) => {
        if (!projectId) return;
        const route = routeForAction(action, projectId);
        if (!route) return;
        const separator = route.includes("?") ? "&" : "?";
        navigate(modeParam ? `${route}${separator}${modeParam}` : route);
      };

      return (
        <div className="actions-cell">
          <div className="actions-primary">
            {cell.primary ? (
              <button
                className="btn btn-primary btn-wide"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation(); // don't trigger row click
                  go(cell.primary.action);
                }}
              >
                {cell.primary.label}
              </button>
            ) : (
              <button
                className="btn btn-ghost btn-soft btn-wide"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  go("open_project");
                }}
              >
                Open Hub
              </button>
            )}
          </div>

          <PopoverMenu
            items={items}
            onAction={(action) => go(action)}
          />
        </div>
      );
    }

    default:
      return null;
  }
}
