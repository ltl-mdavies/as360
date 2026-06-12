export type ShareAccessType =
  | "collaboration"
  | "artwork_upload"
  | "transit_approval"
  | "view_only";

export type ShareLinkStatus = "active" | "revoked";

export type ProjectShareLink = {
  id: string;
  token: string;
  projectId: string;
  label: string;
  accessType: ShareAccessType;
  status: ShareLinkStatus;
  createdByName: string;
  createdAt: string;
  expiresAt?: string | null;
};

export type ShareParticipant = {
  id: string;
  shareLinkId: string;
  displayName: string;
  email: string;
  firstSeenAt: string;
  lastSeenAt: string;
};

export type ProjectAuditEvent = {
  id: string;
  projectId: string;
  eventType: string;
  description: string;
  createdAt: string;
  shareLinkId?: string;
  participantId?: string;
  actorLabel?: string;
};

