import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Portal from "../common/Portal";
import { demoStore, useDemoStore } from "../../domain/store/demoStore";
import type { ProjectShareLink, ShareAccessType, ShareParticipant } from "../../domain/types";
import { useApiClient } from "../../api/useApiClient";
import {
  createProjectShareLink,
  fetchProjectShareLinks,
  identifyShareParticipant,
  resolveShareLink,
  updateProjectShareLink,
  type ApiProjectShareLink,
} from "../../api/projects";
import { isDemoProjectRoute } from "../../logic/projectMode";
import "../../styles/shareAccess.css";

export type ShareWorkspace = "hub" | "artwork" | "assignment" | "proofs" | "transit";

type ResolvedShareLink = {
  id: string;
  projectId: string;
  label: string;
  accessType: ShareAccessType;
  status: "active" | "revoked";
  expiresAt?: string | null;
  shortUrl?: string | null;
};

type ShareLinkListItem = {
  id: string;
  label: string;
  accessType: ShareAccessType;
  status: "active" | "revoked";
  url: string;
  participantCount: number;
  actionCount: number;
  lastActivityAt?: string | null;
  recentActivity: Array<{
    eventType?: string;
    description?: string;
    createdAt?: string;
    actorName?: string;
    actorLabel?: string;
    detail?: Record<string, unknown>;
  }>;
};

const ACCESS_LABELS: Record<ShareAccessType, string> = {
  collaboration: "End Client Collaboration",
  artwork_upload: "Artwork Upload Only",
  transit_approval: "Transit Approval",
  view_only: "View Only",
};

function localParticipantKey(token: string) {
  return `adspace360:shareParticipant:${token}`;
}

function isValidEmail(email: string) {
  return /.+@.+\..+/.test(email.trim());
}

export function shareAccessLabel(accessType: ShareAccessType) {
  return ACCESS_LABELS[accessType];
}

export function canViewShareWorkspace(accessType: ShareAccessType | null | undefined, workspace: ShareWorkspace) {
  if (!accessType) return true;
  if (workspace === "hub") return accessType !== "transit_approval";
  if (accessType === "collaboration") return workspace === "artwork" || workspace === "assignment" || workspace === "proofs";
  if (accessType === "artwork_upload") return workspace === "artwork";
  if (accessType === "transit_approval") return workspace === "transit";
  if (accessType === "view_only") return workspace === "artwork" || workspace === "assignment" || workspace === "proofs";
  return false;
}

export function canEditShareWorkspace(accessType: ShareAccessType | null | undefined, workspace: ShareWorkspace) {
  if (!accessType) return true;
  if (accessType === "collaboration") return workspace === "artwork" || workspace === "assignment" || workspace === "proofs";
  if (accessType === "artwork_upload") return workspace === "artwork";
  if (accessType === "transit_approval") return workspace === "transit";
  return false;
}

export function useShareAccess(projectId?: string) {
  const api = useApiClient();
  const [searchParams] = useSearchParams();
  const shareToken = searchParams.get("share") || "";
  const isDemo = isDemoProjectRoute(projectId, projectId === "demo_001" || projectId === "proj_001");
  const shareLinks = useDemoStore((s) => s.shareLinks);
  const participants = useDemoStore((s) => s.shareParticipants);
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [liveShareLink, setLiveShareLink] = useState<ResolvedShareLink | null>(null);
  const [liveParticipant, setLiveParticipant] = useState<ShareParticipant | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const [pending, setPending] = useState<null | {
    workspace: ShareWorkspace;
    eventType: string;
    description: string;
    run: (participant: ShareParticipant) => void;
  }>(null);

  const demoShareLink = useMemo(() => {
    if (!shareToken) return null;
    const link = shareLinks.find((item) => item.token === shareToken) || null;
    if (!link) return null;
    if (projectId && link.projectId !== projectId) return null;
    return link;
  }, [shareLinks, shareToken, projectId]);

  const shareLink = isDemo ? demoShareLink : liveShareLink;

  const participant = useMemo(() => {
    if (isDemo) {
      if (!demoShareLink || !participantId) return null;
      return participants.find((item) => item.id === participantId && item.shareLinkId === demoShareLink.id) || null;
    }
    return liveParticipant;
  }, [demoShareLink, isDemo, liveParticipant, participantId, participants]);

  useEffect(() => {
    if (!shareToken || isDemo) return;
    let cancelled = false;

    async function resolve() {
      setIsResolving(true);
      try {
        const response = await resolveShareLink(api, shareToken);
        if (cancelled) return;
        if (projectId && response.shareLink.projectId !== projectId) {
          setLiveShareLink(null);
          return;
        }
        setLiveShareLink({
          id: response.shareLink.id,
          projectId: response.shareLink.projectId,
          label: response.shareLink.label,
          accessType: response.shareLink.accessType as ShareAccessType,
          status: response.shareLink.status,
          expiresAt: response.shareLink.expiresAt || null,
          shortUrl: response.shareLink.shortUrl || null,
        });
      } catch {
        if (!cancelled) setLiveShareLink(null);
      } finally {
        if (!cancelled) setIsResolving(false);
      }
    }

    void resolve();
    return () => {
      cancelled = true;
    };
  }, [api, isDemo, projectId, shareToken]);

  useEffect(() => {
    if (!shareToken || !shareLink) return;
    try {
      const raw = window.localStorage.getItem(localParticipantKey(shareToken));
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (!saved?.displayName || !saved?.email) return;
      if (!saved?.id) return;
      if (!isDemo) {
        setParticipantId(saved.id);
        setLiveParticipant({
          id: saved.id,
          shareLinkId: shareLink.id,
          displayName: saved.displayName,
          email: saved.email,
          firstSeenAt: saved.firstSeenAt || "",
          lastSeenAt: saved.lastSeenAt || "",
        });
        return;
      }
      const ensured = demoStore.actions.ensureShareParticipant({
        shareLinkId: shareLink.id,
        displayName: saved.displayName,
        email: saved.email,
        participantId: saved.id,
      });
      setParticipantId(ensured.id);
    } catch {
      // Ignore malformed local identity and ask again on the next edit action.
    }
  }, [isDemo, shareToken, shareLink]);

  function buildProjectUrl(path: string) {
    if (!shareToken) return path;
    return `${path}${path.includes("?") ? "&" : "?"}share=${encodeURIComponent(shareToken)}`;
  }

  function logEvent(args: { eventType: string; description: string; participant?: ShareParticipant | null }) {
    if (!shareLink || !isDemo) return;
    demoStore.actions.addAuditEvent({
      projectId: shareLink.projectId,
      shareLinkId: shareLink.id,
      participantId: args.participant?.id,
      actorLabel: args.participant?.displayName || shareLink.label,
      eventType: args.eventType,
      description: args.description,
    });
  }

  function requireEdit(
    workspace: ShareWorkspace,
    eventType: string,
    description: string,
    run: (participant?: ShareParticipant | null) => void
  ) {
    if (!shareToken) {
      run(null);
      return true;
    }

    if (!shareLink) {
      demoStore.actions.pushToast("danger", "This shared link is not valid for this project");
      return false;
    }

    if (shareLink.status !== "active") {
      demoStore.actions.pushToast("danger", "This shared link has been revoked");
      return false;
    }

    if (!canEditShareWorkspace(shareLink.accessType, workspace)) {
      demoStore.actions.pushToast("warning", "This shared link does not allow that action");
      return false;
    }

    if (!participant) {
      setPending({
        workspace,
        eventType,
        description,
        run: (nextParticipant) => {
          if (isDemo) logEvent({ eventType, description, participant: nextParticipant });
          run(nextParticipant);
        },
      });
      return false;
    }

    if (isDemo) logEvent({ eventType, description, participant });
    run(participant);
    return true;
  }

  function identityModal() {
    if (!pending || !shareLink) return null;
    return (
      <ShareIdentityModal
        shareLink={shareLink}
        onCancel={() => setPending(null)}
        onConfirm={async ({ displayName, email }) => {
          if (!isDemo) {
            const response = await identifyShareParticipant(api, {
              token: shareToken,
              displayName,
              email,
            });
            const next = response.participant;
            const normalized: ShareParticipant = {
              id: next.id,
              shareLinkId: next.shareLinkId,
              displayName: next.displayName,
              email: next.email,
              firstSeenAt: next.firstSeenAt,
              lastSeenAt: next.lastSeenAt,
            };
            window.localStorage.setItem(
              localParticipantKey(shareToken),
              JSON.stringify(normalized)
            );
            setParticipantId(normalized.id);
            setLiveParticipant(normalized);
            setPending(null);
            pending.run(normalized);
            return;
          }

          const next = demoStore.actions.ensureShareParticipant({
            shareLinkId: shareLink.id,
            displayName,
            email,
          });
          window.localStorage.setItem(
            localParticipantKey(shareToken),
            JSON.stringify({ id: next.id, displayName: next.displayName, email: next.email })
          );
          setParticipantId(next.id);
          setPending(null);
          pending.run(next);
        }}
      />
    );
  }

  return {
    isShareMode: !!shareToken,
    isResolving,
    shareToken,
    shareLink,
    participant,
    accessType: shareLink?.accessType || null,
    isRevoked: shareLink?.status === "revoked",
    canView: (workspace: ShareWorkspace) => canViewShareWorkspace(shareLink?.accessType, workspace),
    canEdit: (workspace: ShareWorkspace) => canEditShareWorkspace(shareLink?.accessType, workspace),
    requireEdit,
    buildProjectUrl,
    logEvent,
    identityModal,
  };
}

export function ShareAccessDenied({
  title = "This shared link cannot open this workspace",
  body = "Ask the project owner for a different access link if you need to upload files, assign creatives, or review approvals.",
}: {
  title?: string;
  body?: string;
}) {
  return (
    <div className="share-denied">
      <div className="share-kicker">Shared project access</div>
      <div className="share-deniedTitle">{title}</div>
      <div className="share-deniedBody">{body}</div>
    </div>
  );
}

function ShareIdentityModal({
  shareLink,
  onCancel,
  onConfirm,
}: {
  shareLink: { accessType: ShareAccessType };
  onCancel: () => void;
  onConfirm: (identity: { displayName: string; email: string }) => void | Promise<void>;
}) {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const canSubmit = displayName.trim().length >= 2 && isValidEmail(email);

  return (
    <Portal>
      <div className="share-scrim" role="presentation">
        <div className="share-identityCard" role="dialog" aria-modal="true" aria-label="Identify yourself">
          <div className="share-kicker">Shared project access</div>
          <div className="share-title">Tell us who is making this update</div>
          <div className="share-copy">
            This forwarded link allows <strong>{shareAccessLabel(shareLink.accessType)}</strong>. We’ll attach your
            name to uploads, assignments, and approvals so the project history stays clear.
          </div>

          <label className="share-field">
            <span>Name</span>
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Your name" autoFocus />
          </label>

          <label className="share-field">
            <span>Email</span>
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" />
          </label>

          <div className="share-actions">
            <button className="btn btn-ghost btn-soft" type="button" onClick={onCancel}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              type="button"
              disabled={!canSubmit}
              onClick={() => onConfirm({ displayName: displayName.trim(), email: email.trim() })}
            >
              Continue
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}

function shareUrlForLink(link: ProjectShareLink) {
  const base = window.location.origin;
  const token = encodeURIComponent(link.token);
  if (link.accessType === "artwork_upload") return `${base}/p/${link.projectId}/artwork?share=${token}`;
  if (link.accessType === "transit_approval") return `${base}/p/${link.projectId}/transit?share=${token}`;
  return `${base}/p/${link.projectId}?share=${token}`;
}

function formatAccessType(accessType: ShareAccessType) {
  return shareAccessLabel(accessType);
}

function formatDateTime(value?: string) {
  if (!value) return "No activity yet";
  try {
    return new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch {
    return value;
  }
}

export function ShareAccessModal({
  isOpen,
  projectId,
  projectTitle,
  onClose,
}: {
  isOpen: boolean;
  projectId: string;
  projectTitle: string;
  onClose: () => void;
}) {
  const api = useApiClient();
  const isDemo = isDemoProjectRoute(projectId, projectId === "demo_001" || projectId === "proj_001");
  const shareLinks = useDemoStore((s) => s.shareLinks);
  const participants = useDemoStore((s) => s.shareParticipants);
  const auditEvents = useDemoStore((s) => s.auditEvents);
  const [label, setLabel] = useState("");
  const [accessType, setAccessType] = useState<ShareAccessType>("collaboration");
  const [liveLinks, setLiveLinks] = useState<ApiProjectShareLink[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || isDemo) return;
    let cancelled = false;

    async function loadLinks() {
      setIsLoading(true);
      try {
        const response = await fetchProjectShareLinks(api, projectId);
        if (!cancelled) setLiveLinks(response.shareLinks || []);
      } catch (error) {
        console.error("Failed to load project share links", error);
        if (!cancelled) demoStore.actions.pushToast("danger", "We couldn't load share links yet");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void loadLinks();
    return () => {
      cancelled = true;
    };
  }, [api, isDemo, isOpen, projectId]);

  const links = useMemo<ShareLinkListItem[]>(() => {
    if (isDemo) {
      return shareLinks
        .filter((link) => link.projectId === projectId)
        .map((link) => {
          const linkParticipants = participants.filter((participant) => participant.shareLinkId === link.id);
          const linkEvents = auditEvents.filter((event) => event.shareLinkId === link.id);
          const lastActivityAt =
            linkEvents[0]?.createdAt ||
            linkParticipants.reduce<string | null>((latest, participant) => {
              if (!latest || participant.lastSeenAt > latest) return participant.lastSeenAt;
              return latest;
            }, null);

          return {
            id: link.id,
            label: link.label,
            accessType: link.accessType,
            status: link.status,
            url: shareUrlForLink(link),
            participantCount: linkParticipants.length,
            actionCount: linkEvents.length,
            lastActivityAt,
            recentActivity: linkEvents,
          };
        });
    }

    return liveLinks.map((link) => ({
      id: link.id,
      label: link.label,
      accessType: link.accessType,
      status: link.status,
      url: link.shortUrl || "",
      participantCount: link.participantCount,
      actionCount: link.actionCount,
      lastActivityAt: link.lastActivityAt || null,
      recentActivity: link.recentActivity || [],
    }));
  }, [auditEvents, isDemo, liveLinks, participants, projectId, shareLinks]);
  if (!isOpen) return null;

  return (
    <Portal>
      <div className="share-scrim" role="presentation" onMouseDown={onClose}>
        <div className="share-config" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
          <div className="share-configHead">
            <div>
              <div className="share-kicker">Share Access</div>
              <div className="share-title">Project collaboration links</div>
              <div className="share-copy">{projectTitle}</div>
            </div>
            <button className="btn btn-ghost btn-soft" type="button" onClick={onClose}>
              Close
            </button>
          </div>

          <div className="share-create">
            <input
              className="share-createInput"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Link label, e.g. Design team"
            />
            <select className="select share-createSelect" value={accessType} onChange={(e) => setAccessType(e.target.value as ShareAccessType)}>
              <option value="collaboration">End Client Collaboration</option>
              <option value="artwork_upload">Artwork Upload Only</option>
              <option value="transit_approval">Transit Approval</option>
              <option value="view_only">View Only</option>
            </select>
            <button
              className="btn btn-primary"
              type="button"
              onClick={async () => {
                if (isDemo) {
                  const next = demoStore.actions.createShareLink({
                    projectId,
                    label: label.trim() || formatAccessType(accessType),
                    accessType,
                  });
                  setLabel("");
                  navigator.clipboard?.writeText(shareUrlForLink(next));
                  demoStore.actions.pushToast("success", "Share link created");
                  return;
                }

                try {
                  const response = await createProjectShareLink(api, projectId, {
                    label: label.trim() || formatAccessType(accessType),
                    accessType,
                  });
                  setLiveLinks((prev) => [response.shareLink, ...prev]);
                  setLabel("");
                  if (response.shareLink.shortUrl) navigator.clipboard?.writeText(response.shareLink.shortUrl);
                  demoStore.actions.pushToast("success", "Share link created");
                } catch (error) {
                  console.error("Failed to create share link", error);
                  demoStore.actions.pushToast("danger", "We couldn't create the share link yet");
                }
              }}
            >
              Create Link
            </button>
          </div>

          <div className="share-linkList">
            {links.map((link) => {
              return (
                <div key={link.id} className={`share-linkCard ${link.status === "revoked" ? "is-revoked" : ""}`}>
                  <div className="share-linkMain">
                    <div className="share-linkTitleRow">
                      <div className="share-linkTitle">{link.label}</div>
                      <span className={`share-status ${link.status === "active" ? "is-active" : "is-revoked"}`}>
                        {link.status}
                      </span>
                    </div>
                    <div className="share-linkMeta">{formatAccessType(link.accessType)}</div>
                    <div className="share-linkUrl" title={link.url}>{link.url}</div>
                  </div>
                  <div className="share-linkStats">
                    <span><strong>{link.participantCount}</strong> participants</span>
                    <span><strong>{link.actionCount}</strong> actions</span>
                    <span>{formatDateTime(link.lastActivityAt || undefined)}</span>
                  </div>
                  <div className="share-linkActions">
                    <button className="btn btn-ghost btn-soft" type="button" onClick={() => copyTextToClipboard(link.url)}>
                      Copy
                    </button>
                    <button
                      className="btn btn-ghost btn-soft"
                      type="button"
                      onClick={async () => {
                        if (isDemo) {
                          demoStore.actions.regenerateShareLink(link.id);
                          demoStore.actions.pushToast("success", "Share link regenerated");
                          return;
                        }
                        try {
                          const response = await updateProjectShareLink(api, link.id, { regenerate: true });
                          setLiveLinks((prev) => prev.map((item) => (item.id === link.id ? response.shareLink : item)));
                          demoStore.actions.pushToast("success", "Share link regenerated");
                        } catch (error) {
                          console.error("Failed to regenerate share link", error);
                          demoStore.actions.pushToast("danger", "We couldn't regenerate the share link yet");
                        }
                      }}
                    >
                      Regenerate
                    </button>
                    <button
                      className="btn btn-ghost btn-soft"
                      type="button"
                      disabled={link.status === "revoked"}
                      onClick={async () => {
                        if (isDemo) {
                          demoStore.actions.revokeShareLink(link.id);
                          demoStore.actions.pushToast("warning", "Share link revoked");
                          return;
                        }
                        try {
                          const response = await updateProjectShareLink(api, link.id, { status: "revoked" });
                          setLiveLinks((prev) => prev.map((item) => (item.id === link.id ? response.shareLink : item)));
                          demoStore.actions.pushToast("warning", "Share link revoked");
                        } catch (error) {
                          console.error("Failed to revoke share link", error);
                          demoStore.actions.pushToast("danger", "We couldn't revoke the share link yet");
                        }
                      }}
                    >
                      Revoke
                    </button>
                  </div>
                  {link.recentActivity.length > 0 && (
                    <div className="share-activity">
                      {link.recentActivity.slice(0, 3).map((event) => (
                        <div key={`${link.id}-${event.createdAt}-${event.eventType}`} className="share-activityRow">
                          <span>{(event as any).actorLabel || (event as any).actorName || "Shared user"}</span>
                          <span>{formatActivityDescription(event)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {!isDemo && isLoading && <div className="share-copy">Loading share links…</div>}
          </div>
        </div>
      </div>
    </Portal>
  );
}

async function copyTextToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    demoStore.actions.pushToast("success", "Link copied");
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    demoStore.actions.pushToast("success", "Link copied");
  }
}

function formatActivityDescription(event: { eventType?: string; description?: string; detail?: Record<string, unknown> }) {
  if (event.description) return event.description;
  const detail = event.detail || {};
  switch (event.eventType) {
    case "share_link.created":
      return "created this shared link";
    case "share_link.updated":
      return "updated this shared link";
    case "share_link.regenerated":
      return "regenerated this shared link";
    case "creative.uploaded":
      return `uploaded ${String(detail.filename || "artwork")}`;
    case "creative.updated":
      return `replaced ${String(detail.filename || "artwork")}`;
    case "creative.deleted":
      return `deleted ${String(detail.filename || "artwork")}`;
    case "assignment.updated":
      return `assigned ${String(detail.inventoryLabel || "inventory")}`;
    case "assignment.cleared":
      return `cleared ${String(detail.inventoryLabel || "inventory")}`;
    case "proof.updated":
      return `updated proof status to ${String(detail.status || "pending")}`;
    case "transit.updated":
      return `updated transit to ${String(detail.status || "pending")}`;
    case "project.submitted":
      return "submitted the project order";
    case "project.production_released":
      return "released the project to production";
    default:
      return event.eventType || "updated the project";
  }
}
