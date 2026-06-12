import { useMemo } from "react";
import { useAuth } from "../auth/AuthProvider";
import { apiConfig } from "./apiConfig";

type RequestOptions = Omit<RequestInit, "headers"> & {
  headers?: HeadersInit;
};

export function useApiClient() {
  const { getAccessToken, signOut } = useAuth();

  return useMemo(
    () => ({
      async request<T>(path: string, options: RequestOptions = {}) {
        const startedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
        const token = getAccessToken();
        const shareToken = readShareTokenFromLocation();
        if (!token && !shareToken) {
          throw new Error("Missing authenticated session");
        }

        const headers = new Headers(options.headers || {});
        if (token) headers.set("Authorization", `Bearer ${token}`);
        if (shareToken) {
          headers.set("x-share-token", shareToken);
          const participantId = readShareParticipantId(shareToken);
          if (participantId) headers.set("x-share-participant-id", participantId);
        }
        if (options.body && !headers.has("Content-Type")) {
          headers.set("Content-Type", "application/json");
        }

        const response = await fetch(`${apiConfig.baseUrl}${path}`, {
          ...options,
          headers,
        });
        const completedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
        const clientMs = completedAt - startedAt;
        const serverMsHeader = response.headers.get("x-adspace-route-ms");
        const serverMs = serverMsHeader ? Number(serverMsHeader) : NaN;
        if (clientMs >= 700 || Number.isFinite(serverMs) && serverMs >= 700) {
          console.info("[Adspace API timing]", {
            path,
            method: options.method || "GET",
            status: response.status,
            clientMs: Math.round(clientMs),
            serverMs: Number.isFinite(serverMs) ? Math.round(serverMs) : null,
            routeKey: response.headers.get("x-adspace-route-key"),
          });
        }

        if ((response.status === 401 || response.status === 403) && token && !shareToken) {
          signOut();
          throw new Error("Your session is no longer authorized. Please sign in again.");
        }

        const text = await response.text();
        const payload = text ? JSON.parse(text) : null;

        if (!response.ok) {
          throw new Error(payload?.error || `Request failed with status ${response.status}`);
        }

        return payload as T;
      },
    }),
    [getAccessToken, signOut]
  );
}

function readShareTokenFromLocation() {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("share") || "";
}

function readShareParticipantId(shareToken: string) {
  if (typeof window === "undefined" || !shareToken) return "";
  try {
    const raw = window.localStorage.getItem(`adspace360:shareParticipant:${shareToken}`);
    if (!raw) return "";
    const parsed = JSON.parse(raw) as { id?: string };
    return parsed.id || "";
  } catch {
    return "";
  }
}
