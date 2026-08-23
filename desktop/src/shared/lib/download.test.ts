import { describe, expect, it } from "vitest";
import { downloadFileName } from "./download";

describe("downloadFileName", () => {
  it("names the human version after the title", () => {
    expect(downloadFileName("Design review", "human")).toBe("Design review.md");
  });

  it("names the enhanced version with a suffix", () => {
    expect(downloadFileName("Design review", "enhanced")).toBe("Design review-enhanced.md");
  });

  it("falls back to meeting-notes without a title", () => {
    expect(downloadFileName(null, "human")).toBe("meeting-notes.md");
    expect(downloadFileName("   ", "enhanced")).toBe("meeting-notes-enhanced.md");
  });

  it("strips path separators from the title", () => {
    expect(downloadFileName("a/b\\c", "human")).toBe("a b c.md");
  });
});
