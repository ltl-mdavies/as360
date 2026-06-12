export type VenueId = string;
export type VenueLocationId = string;

export type Venue = {
  id: VenueId;
  name: string;         // "Penn Station"
  market: string;       // "New York City"
  customerId: string;   // "intersection"
  imageUrl?: string;    // venue hero image (Hub card)
  documentLibraryUrl?: string; // shared Drive/docs link exposed to clients
};

export type VenueLocation = {
  id: VenueLocationId;  // "mezzanine"
  venueId: VenueId;
  name: string;         // "Mezzanine"
  mapUrl: string;       // SVG/PDF/PNG converted to SVG ideally
  sortIndex: number;
};
