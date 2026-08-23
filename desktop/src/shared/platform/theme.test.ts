// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { startupTheme } from "./theme";

afterEach(() => {
  document.documentElement.dataset.theme = "";
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("startupTheme", () => {
  it("prefers the shell-injected painted theme over the cache", () => {
    document.documentElement.dataset.theme = "dark";
    localStorage.setItem("meetwrite.theme", "light");
    expect(startupTheme()).toBe("dark");
  });

  it("falls back to the localStorage cache when nothing is painted", () => {
    localStorage.setItem("meetwrite.theme", "dark");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    expect(startupTheme()).toBe("dark");
  });

  it("falls back to the OS appearance when nothing else exists", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    expect(startupTheme()).toBe("dark");
  });
});
