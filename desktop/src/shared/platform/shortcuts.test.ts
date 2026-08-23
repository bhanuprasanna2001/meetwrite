import { describe, expect, it } from "vitest";
import { matchShortcut } from "./shortcuts";

/** A minimal key event — just the fields matching reads. */
const key = (
  over: Partial<{
    key: string;
    metaKey: boolean;
    ctrlKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
  }> = {},
) => ({ key: "a", metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...over });

describe("matchShortcut", () => {
  it("maps ⌘K (and Ctrl+K) to search", () => {
    expect(matchShortcut(key({ key: "k", metaKey: true }))).toBe("search");
    expect(matchShortcut(key({ key: "K", metaKey: true }))).toBe("search"); // Caps Lock
    expect(matchShortcut(key({ key: "k", ctrlKey: true }))).toBe("search");
  });

  it("maps the plain ⌘ shortcuts", () => {
    expect(matchShortcut(key({ key: "n", metaKey: true }))).toBe("new-entry");
    expect(matchShortcut(key({ key: "e", metaKey: true }))).toBe("enhance");
    expect(matchShortcut(key({ key: "r", metaKey: true }))).toBe("record");
    expect(matchShortcut(key({ key: ",", metaKey: true }))).toBe("settings");
  });

  it("maps ⌘⇧H to history but leaves plain ⌘H (macOS Hide) alone", () => {
    expect(matchShortcut(key({ key: "h", metaKey: true, shiftKey: true }))).toBe("history");
    expect(matchShortcut(key({ key: "h", metaKey: true }))).toBeNull();
  });

  it("maps ⌘⇧P to preview and ⌘⇧I to add-image, but never the plain keys", () => {
    expect(matchShortcut(key({ key: "p", metaKey: true, shiftKey: true }))).toBe(
      "toggle-preview",
    );
    expect(matchShortcut(key({ key: "i", metaKey: true, shiftKey: true }))).toBe("add-image");
    expect(matchShortcut(key({ key: "p", metaKey: true }))).toBeNull();
    expect(matchShortcut(key({ key: "i", metaKey: true }))).toBeNull();
  });

  it("maps ⌘/ to help, but not ⌘?", () => {
    expect(matchShortcut(key({ key: "/", metaKey: true }))).toBe("help");
    expect(matchShortcut(key({ key: "?", metaKey: true, shiftKey: true }))).toBeNull();
  });

  it("maps ⌃⌘M to the meeting toggle, leaving ⌘M (macOS Minimize) alone", () => {
    expect(
      matchShortcut(key({ key: "m", metaKey: true, ctrlKey: true })),
    ).toBe("meeting-mode");
    expect(matchShortcut(key({ key: "m", metaKey: true }))).toBeNull();
  });

  it("maps Esc only without modifiers", () => {
    expect(matchShortcut(key({ key: "Escape" }))).toBe("escape");
    expect(matchShortcut(key({ key: "Escape", metaKey: true }))).toBeNull();
  });

  it("ignores plain keys and ⌥ combos", () => {
    expect(matchShortcut(key({ key: "k" }))).toBeNull();
    expect(matchShortcut(key({ key: "k", metaKey: true, altKey: true }))).toBeNull();
  });
});
