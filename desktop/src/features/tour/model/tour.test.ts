import { describe, expect, it } from "vitest";
import { hasSeenTour, markTourSeen, TOUR_SEEN_KEY, TOUR_STEPS, type FlagStorage } from "./tour";

/** A tiny in-memory stand-in for localStorage (vitest runs in node). */
const storage = (seen = false): FlagStorage => {
  const map = new Map<string, string>();
  if (seen) map.set(TOUR_SEEN_KEY, "seen");
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
  };
};

describe("TOUR_STEPS", () => {
  it("is a short deck of complete cards", () => {
    expect(TOUR_STEPS.length).toBeGreaterThanOrEqual(4);
    for (const step of TOUR_STEPS) {
      expect(step.id).not.toBe("");
      expect(step.title).not.toBe("");
      expect(step.body.split(" ").length).toBeLessThanOrEqual(28);
    }
  });

  it("has one card per id", () => {
    const ids = TOUR_STEPS.map((step) => step.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("tour flag", () => {
  it("is unset on first run", () => {
    expect(hasSeenTour(storage())).toBe(false);
  });

  it("marks once and reads back forever", () => {
    const store = storage();
    markTourSeen(store);
    expect(hasSeenTour(store)).toBe(true);
    markTourSeen(store);
    expect(hasSeenTour(store)).toBe(true);
  });
});
