import { describe, expect, it } from "vitest";
import { splitFrontmatter } from "./frontmatter";

describe("splitFrontmatter", () => {
  it("splits a leading key/value block off the note body", () => {
    const result = splitFrontmatter(
      "---\ntitle: Two Sum\ndifficulty: medium\n---\n\n# Two Sum\n\nApproach here.",
    );
    expect(result.fields).toEqual([
      { key: "title", value: "Two Sum" },
      { key: "difficulty", value: "medium" },
    ]);
    expect(result.body).toBe("\n# Two Sum\n\nApproach here.");
  });

  it("strips quotes and inline comments from values", () => {
    const result = splitFrontmatter(
      "---\ntitle: \"Two Sum\"\nurl: https://leetcode.com # the problem\n---\n\nBody.",
    );
    expect(result.fields).toEqual([
      { key: "title", value: "Two Sum" },
      { key: "url", value: "https://leetcode.com" },
    ]);
  });

  it("skips comment and blank lines and keeps the colon inside values", () => {
    const result = splitFrontmatter(
      "---\n# a comment\ntitle: Two Sum\n\nsolution: https://example.com/a:b\n---\n\nBody.",
    );
    expect(result.fields).toEqual([
      { key: "title", value: "Two Sum" },
      { key: "solution", value: "https://example.com/a:b" },
    ]);
  });

  it("treats a marker without a closing line as plain markdown", () => {
    const source = "---\ntitle: Two Sum\nbody continues";
    expect(splitFrontmatter(source)).toEqual({ fields: [], body: source });
  });

  it("treats a top horizontal rule with no fields as plain markdown", () => {
    const source = "---\n\n# A note\n\n---\n\nAnother rule.";
    expect(splitFrontmatter(source)).toEqual({ fields: [], body: source });
  });

  it("passes notes that do not start with a marker straight through", () => {
    const source = "# Plain note\n\nNo frontmatter at all.";
    expect(splitFrontmatter(source)).toEqual({ fields: [], body: source });
  });
});
