export type ProjectId = string;

export type Project = {
  id: ProjectId;
  customerId: string;     // "intersection"
  venueId: string;

  title: string;
  poNumber?: string;
  adspaceOrderNumber?: string;
  extId?: string;         // AS360 ext id
  liftOrderNumber?: string;

  postDate?: string;      // YYYY-MM-DD
  artworkDueDate?: string;

  createdAt: string;      // ISO
};
