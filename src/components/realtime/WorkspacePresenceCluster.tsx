import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { WorkspacePresenceParticipant } from "../../realtime/useWorkspacePresence";
import "./WorkspacePresenceCluster.css";

type WorkspacePresenceClusterProps = {
  participants: WorkspacePresenceParticipant[];
  currentSessionId: string;
  status: "idle" | "connecting" | "connected" | "unavailable";
};

export function WorkspacePresenceCluster({ participants, currentSessionId, status }: WorkspacePresenceClusterProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const others = participants.filter((participant) => participant.sessionId !== currentSessionId);
  const title = useMemo(() => formatPresenceTitle(others), [others]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  if (others.length === 0) return null;

  const visible = others.slice(0, 3);
  const overflow = Math.max(0, others.length - visible.length);

  return (
    <div className="presenceClusterWrap" ref={rootRef}>
      <button
        className="presenceCluster"
        data-status={status}
        type="button"
        title={title}
        aria-label={title}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <div className="presenceCluster-avatars" aria-hidden="true">
          {visible.map((participant) => (
            <span
              className="presenceCluster-avatar"
              key={participant.sessionId}
              style={{ "--presence-color": participant.color } as CSSProperties}
            >
              {participant.initials}
            </span>
          ))}
          {overflow > 0 ? <span className="presenceCluster-avatar presenceCluster-overflow">+{overflow}</span> : null}
        </div>
        <span className="presenceCluster-label">{others.length === 1 ? "Also here" : `${others.length} here`}</span>
      </button>
      {open ? (
        <div className="presenceCluster-popover" role="dialog" aria-label="Collaborators viewing this page">
          <div className="presenceCluster-popoverTitle">Collaborators</div>
          <div className="presenceCluster-popoverList">
            {others.map((participant) => (
              <div className="presenceCluster-person" key={participant.sessionId}>
                <span className="presenceCluster-avatar" style={{ "--presence-color": participant.color } as CSSProperties}>
                  {participant.initials}
                </span>
                <span className="presenceCluster-personText">
                  <span className="presenceCluster-personName">{participant.actorName}</span>
                  <span className="presenceCluster-personMeta">{formatLastSeen(participant.lastSeenAt)}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function formatPresenceTitle(participants: WorkspacePresenceParticipant[]) {
  const names = participants.map((participant) => participant.actorName).filter(Boolean);
  if (names.length === 0) return "Other collaborators are viewing this page";
  if (names.length <= 3) return `${names.join(", ")} ${names.length === 1 ? "is" : "are"} viewing this page`;
  return `${names.slice(0, 3).join(", ")} and ${names.length - 3} more are viewing this page`;
}

function formatLastSeen(value: string) {
  const lastSeen = Date.parse(value);
  if (!Number.isFinite(lastSeen)) return "Viewing now";
  const secondsAgo = Math.max(0, Math.round((Date.now() - lastSeen) / 1000));
  if (secondsAgo < 45) return "Viewing now";
  return `Active ${Math.ceil(secondsAgo / 60)}m ago`;
}
