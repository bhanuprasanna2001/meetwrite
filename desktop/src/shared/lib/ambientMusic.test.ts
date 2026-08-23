import { describe, expect, it } from "vitest";
import { nextTrack, TRACKS } from "./ambientMusic";

describe("TRACKS", () => {
  it("is a small playlist of open-licensed, sourced files", () => {
    expect(TRACKS.length).toBe(3);
    for (const track of TRACKS) {
      expect(track.file).toMatch(/\.mp3$/);
      expect(track.title).not.toBe("");
      expect(track.artist).not.toBe("");
      expect(track.license).toMatch(/^CC /);
      expect(track.source).toMatch(/^https:\/\//);
    }
  });

  it("never repeats a file", () => {
    const files = TRACKS.map((track) => track.file);
    expect(new Set(files).size).toBe(files.length);
  });
});

describe("nextTrack", () => {
  it("advances through the playlist", () => {
    expect(nextTrack(0)).toBe(1);
    expect(nextTrack(1)).toBe(2);
  });

  it("wraps back to the start", () => {
    expect(nextTrack(TRACKS.length - 1)).toBe(0);
  });
});
