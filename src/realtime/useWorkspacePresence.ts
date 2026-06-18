import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { fetchRealtimeConfig, type ApiClientLike } from "../api/projects";

export type WorkspaceKind = "assignment" | "proofs";

export type WorkspacePresenceParticipant = {
  sessionId: string;
  actorId: string;
  actorName: string;
  actorType: "user" | "share_participant";
  initials: string;
  color: string;
  joinedAt: string;
  lastSeenAt: string;
};

export type WorkspaceChangeEvent = {
  type: "workspace.change";
  workspace: WorkspaceKind;
  projectId: string;
  eventType: string;
  summary: string;
  actorId: string;
  actorName: string;
  actorType: "user" | "share_participant";
  originSessionId?: string | null;
  occurredAt: string;
  detail?: Record<string, unknown>;
};

type PresenceMessage =
  | {
      type: "presence.snapshot";
      workspace: WorkspaceKind;
      projectId: string;
      participants: WorkspacePresenceParticipant[];
    }
  | WorkspaceChangeEvent;

type PresenceOptions = {
  api: ApiClientLike;
  projectId?: string;
  workspace: WorkspaceKind;
  enabled: boolean;
  shareMode?: boolean;
  onRemoteChange?: (event: WorkspaceChangeEvent) => void;
  onSyncRequested?: (reason: "visibility" | "poll" | "reconnect") => void;
};

const SESSION_STORAGE_KEY = "adspace360:presence-session-id";
const HEARTBEAT_MS = 25_000;
const STALE_MS = 95_000;
const FALLBACK_SYNC_MS = 75_000;
const realtimeConfigCache = new Map<string, Promise<string>>();

export function useWorkspacePresence({
  api,
  projectId,
  workspace,
  enabled,
  shareMode = false,
  onRemoteChange,
  onSyncRequested,
}: PresenceOptions) {
  const { getAccessToken } = useAuth();
  const [participants, setParticipants] = useState<WorkspacePresenceParticipant[]>([]);
  const [status, setStatus] = useState<"idle" | "connecting" | "connected" | "unavailable">("idle");
  const sessionId = useMemo(() => getPresenceSessionId(), []);
  const remoteChangeRef = useRef(onRemoteChange);
  const syncRequestedRef = useRef(onSyncRequested);

  useEffect(() => {
    remoteChangeRef.current = onRemoteChange;
  }, [onRemoteChange]);

  useEffect(() => {
    syncRequestedRef.current = onSyncRequested;
  }, [onSyncRequested]);

  useEffect(() => {
    if (!enabled || !projectId) {
      setParticipants([]);
      setStatus("idle");
      return;
    }

    let cancelled = false;
    let socket: WebSocket | null = null;
    let heartbeatTimer: number | null = null;
    let reconnectTimer: number | null = null;
    let fallbackSyncTimer: number | null = null;
    let reconnectAttempt = 0;
    let connecting = false;
    let hasConnectedOnce = false;

    const closeSocket = () => {
      if (heartbeatTimer) window.clearInterval(heartbeatTimer);
      heartbeatTimer = null;
      if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        try {
          socket.close(1000, "workspace left");
        } catch {
          // The browser can throw while a socket is still opening; cleanup continues below.
        }
      }
      socket = null;
    };

    const send = (message: Record<string, unknown>) => {
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify(message));
    };

    const joinPayload = () => ({
      type: "join",
      projectId,
      workspace,
      sessionId,
      accessToken: getAccessToken() || undefined,
      shareToken: shareMode ? readShareTokenFromLocation() || undefined : undefined,
      shareParticipantId: shareMode ? readShareParticipantId() || undefined : undefined,
    });

    const requestSync = (reason: "visibility" | "poll" | "reconnect") => {
      window.setTimeout(() => syncRequestedRef.current?.(reason), 0);
    };

    const scheduleReconnect = () => {
      if (cancelled || reconnectTimer) return;
      reconnectAttempt += 1;
      const delay = Math.min(12_000, 900 * reconnectAttempt);
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        void connect();
      }, delay);
    };

    const connect = async () => {
      if (connecting || cancelled) return;
      if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
      connecting = true;
      setStatus((current) => current === "connected" ? current : "connecting");
      try {
        const websocketUrl = await fetchCachedRealtimeUrl(api, shareMode);
        if (cancelled) return;
        if (!websocketUrl) {
          setStatus("unavailable");
          return;
        }

        const wasReconnect = hasConnectedOnce;
        socket = new WebSocket(websocketUrl);
        socket.addEventListener("open", () => {
          connecting = false;
          hasConnectedOnce = true;
          reconnectAttempt = 0;
          setStatus("connected");
          send(joinPayload());
          if (heartbeatTimer) window.clearInterval(heartbeatTimer);
          heartbeatTimer = window.setInterval(() => {
            send({
              type: "heartbeat",
              projectId,
              workspace,
              sessionId,
            });
          }, HEARTBEAT_MS);
          if (wasReconnect) requestSync("reconnect");
        });
        socket.addEventListener("message", (message) => {
          try {
            const payload = JSON.parse(String(message.data)) as PresenceMessage;
            if (payload.type === "presence.snapshot" && payload.projectId === projectId && payload.workspace === workspace) {
              const cutoff = Date.now() - STALE_MS;
              setParticipants(
                payload.participants
                  .filter((participant) => Date.parse(participant.lastSeenAt) >= cutoff)
                  .sort((a, b) => a.actorName.localeCompare(b.actorName))
              );
              return;
            }
            if (payload.type === "workspace.change" && payload.projectId === projectId && payload.workspace === workspace) {
              if (payload.originSessionId && payload.originSessionId === sessionId) return;
              window.setTimeout(() => remoteChangeRef.current?.(payload), 0);
            }
          } catch (error) {
            console.warn("Unable to parse workspace presence message", error);
          }
        });
        socket.addEventListener("close", () => {
          connecting = false;
          if (heartbeatTimer) window.clearInterval(heartbeatTimer);
          heartbeatTimer = null;
          if (cancelled) return;
          setStatus("unavailable");
          scheduleReconnect();
        });
        socket.addEventListener("error", () => {
          connecting = false;
          setStatus("unavailable");
        });
      } catch (error) {
        connecting = false;
        if (cancelled) return;
        console.warn("Workspace presence unavailable", error);
        setStatus("unavailable");
        scheduleReconnect();
      }
    };

    void connect();
    fallbackSyncTimer = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      requestSync("poll");
      if (!socket || socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
        void connect();
      }
    }, FALLBACK_SYNC_MS);

    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      requestSync("visibility");
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        void connect();
        return;
      }
      send(joinPayload());
    };

    const handleOnline = () => {
      requestSync("reconnect");
      void connect();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);

    return () => {
      cancelled = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (fallbackSyncTimer) window.clearInterval(fallbackSyncTimer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
      closeSocket();
    };
  }, [api, enabled, getAccessToken, projectId, sessionId, shareMode, workspace]);

  const otherParticipants = useMemo(
    () => participants.filter((participant) => participant.sessionId !== sessionId),
    [participants, sessionId]
  );

  return useMemo(
    () => ({ participants, otherParticipants, sessionId, status }),
    [otherParticipants, participants, sessionId, status]
  );
}

function fetchCachedRealtimeUrl(api: ApiClientLike, shareMode: boolean) {
  const key = shareMode ? "share" : "auth";
  const cached = realtimeConfigCache.get(key);
  if (cached) return cached;
  const request = fetchRealtimeConfig(api, shareMode)
    .then((config) => config.websocketUrl || "")
    .catch((error) => {
      realtimeConfigCache.delete(key);
      throw error;
    });
  realtimeConfigCache.set(key, request);
  return request;
}

function getPresenceSessionId() {
  if (typeof window === "undefined") return `session-${Math.random().toString(36).slice(2)}`;
  const existing = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
  if (existing) return existing;
  const next = window.crypto?.randomUUID?.() || `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  window.sessionStorage.setItem(SESSION_STORAGE_KEY, next);
  return next;
}

function readShareTokenFromLocation() {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("share") || "";
}

function readShareParticipantId() {
  if (typeof window === "undefined") return "";
  const shareToken = readShareTokenFromLocation();
  if (!shareToken) return "";
  try {
    const raw = window.localStorage.getItem(`adspace360:shareParticipant:${shareToken}`);
    if (!raw) return "";
    const parsed = JSON.parse(raw) as { id?: string };
    return parsed.id || "";
  } catch {
    return "";
  }
}
