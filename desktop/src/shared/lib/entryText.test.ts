import { describe, expect, it } from "vitest";
import { previewLabel } from "./entryText";

describe("previewLabel", () => {
  it("is 'Empty note' when there is no preview", () => {
    expect(previewLabel("Two Sum", null)).toBe("Empty note");
    expect(previewLabel(null, "  ")).toBe("Empty note");
  });

  it("is 'Empty note' when the preview repeats the title", () => {
    expect(previewLabel("Two Sum", "Two Sum")).toBe("Empty note");
    expect(previewLabel("Two Sum", "  Two Sum\n")).toBe("Empty note");
  });

  it("keeps a preview that adds something new", () => {
    expect(previewLabel("Two Sum", "Use two pointers")).toBe("Use two pointers");
  });
});
