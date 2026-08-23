// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import MarkdownView from "./MarkdownView";
import type { OutlineImage } from "../api/sidecar";

afterEach(cleanup);

describe("MarkdownView — admonitions", () => {
  it("turns a GitHub marker blockquote into a labeled admonition", () => {
    const { container } = render(
      <MarkdownView markdown={"> [!WARNING]\n> Careful with this."} />,
    );
    const admonition = container.querySelector(".admonition");
    expect(admonition).not.toBeNull();
    expect(admonition?.classList.contains("admonition-warning")).toBe(true);
    expect(container.textContent).toContain("Careful with this.");
    // The marker itself is never rendered.
    expect(container.textContent).not.toContain("[!WARNING]");
  });

  it("is case-insensitive and leaves non-markers as blockquotes", () => {
    const { container } = render(
      <MarkdownView markdown={"> [!note]\n> Just a note.\n\n> [!NOTREAL]\n> Plain quote."} />,
    );
    expect(container.querySelector(".admonition.admonition-note")).not.toBeNull();
    expect(container.querySelector("blockquote")).not.toBeNull();
  });
});

describe("MarkdownView — frontmatter", () => {
  it("renders a meta card, hides empty values, and keeps the body intact", () => {
    const source = [
      "---",
      "title: Two Sum",
      "difficulty: medium",
      "solution: https://example.com/solution",
      "submission:",
      "---",
      "",
      "# Two Sum",
      "",
      "Body here.",
    ].join("\n");
    const { container } = render(<MarkdownView markdown={source} />);

    const card = container.querySelector(".prose-meta");
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain("Two Sum");
    expect(card?.textContent).toContain("medium");
    const link = card?.querySelector("a[href='https://example.com/solution']");
    expect(link).not.toBeNull();
    // Empty fields stay out of the card…
    expect(card?.querySelectorAll("dt").length).toBe(3);
    expect(card?.textContent).not.toContain("submission");
    // …and the body renders without the raw yaml.
    expect(container.textContent).toContain("Body here.");
    expect(container.textContent).not.toContain("difficulty:");
  });
});

describe("MarkdownView — math, code, pictures", () => {
  it("renders inline and block math through KaTeX", () => {
    const { container } = render(
      <MarkdownView markdown={"Inline $x^2$ and block:\n\n$$\na + b\n$$"} />,
    );
    expect(container.querySelectorAll(".katex").length).toBeGreaterThan(0);
  });

  it("resolves entry-image references to the note's file endpoint", () => {
    const images: OutlineImage[] = [{ id: 3, title: "Board" }];
    const { container } = render(
      <MarkdownView markdown="![Board](entry-image:3)" entryId={5} images={images} />,
    );
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toContain("/entries/5/images/3");
    expect(img?.getAttribute("alt")).toBe("Board");
  });

  it("renders nothing for a reference to a deleted picture", () => {
    const { container } = render(
      <MarkdownView markdown="![Gone](entry-image:9)" entryId={5} images={[]} />,
    );
    expect(container.querySelector("img")).toBeNull();
  });

  it("renders ordinary markdown features (code, task lists, tables)", () => {
    const { container } = render(
      <MarkdownView
        markdown={"```js\nconst x = 1;\n```\n\n- [x] done\n- [ ] todo\n\n| a | b |\n| - | - |\n| 1 | 2 |"}
      />,
    );
    expect(container.querySelector("pre code")).not.toBeNull();
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
    expect(container.querySelector("table")).not.toBeNull();
  });
});
