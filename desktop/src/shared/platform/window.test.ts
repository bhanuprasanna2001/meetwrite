import { describe, expect, it } from "vitest";
import { syncWindowMode } from "./window";

describe("syncWindowMode", () => {
  it("follows the shell into native fullscreen", () => {
    expect(syncWindowMode("normal", true, "normal")).toBe("fullscreen");
    expect(syncWindowMode("meeting", true, "meeting")).toBe("fullscreen");
  });

  it("restores the previous mode when fullscreen ends", () => {
    expect(syncWindowMode("fullscreen", false, "meeting")).toBe("meeting");
    expect(syncWindowMode("fullscreen", false, "normal")).toBe("normal");
  });

  it("stays put when nothing changed", () => {
    expect(syncWindowMode("meeting", false, "normal")).toBe("meeting");
    expect(syncWindowMode("fullscreen", true, "meeting")).toBe("fullscreen");
  });
});
