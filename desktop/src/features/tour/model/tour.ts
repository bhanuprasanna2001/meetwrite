/**
 * The one-time tour: five short cards that explain the bar and the loop on
 * the first visit. Pure data + a localStorage
 * flag, so the component stays dumb and the tests stay pure.
 */

export interface TourStep {
  id: string;
  title: string;
  body: string;
}

/** Short and honest — each card is one breath, not a manual. */
export const TOUR_STEPS: TourStep[] = [
  {
    id: "bar",
    title: "One bar, everything",
    body: "Record, Enhance, Download, History, Settings — the whole app lives in the bottom bar.",
  },
  {
    id: "record",
    title: "Record",
    body: "Live transcription streams in — you on the right, them on the left. Meeting mode is an optional setting.",
  },
  {
    id: "boxes",
    title: "The three pills",
    body: "Chat, Transcript, and Audio sit above the bar. Click a pill to open a panel, expand it to the full view, or close it with the ✕.",
  },
  {
    id: "versions",
    title: "Human ↔ Enhanced",
    body: "Enhance rewrites your notes with AI. Every run is kept as a version — switch anytime, nothing is lost.",
  },
  {
    id: "find",
    title: "Find anything",
    body: "⌘K searches notes and actions. History lists every meeting; Settings holds your key and preferences.",
  },
];

/** The flag key — UI-only state in localStorage, like the cached theme. */
export const TOUR_SEEN_KEY = "meetwrite.tour";

/** The storage slice the flag needs, injectable for tests. */
export interface FlagStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function hasSeenTour(storage: FlagStorage = localStorage): boolean {
  return storage.getItem(TOUR_SEEN_KEY) === "seen";
}

export function markTourSeen(storage: FlagStorage = localStorage): void {
  storage.setItem(TOUR_SEEN_KEY, "seen");
}
