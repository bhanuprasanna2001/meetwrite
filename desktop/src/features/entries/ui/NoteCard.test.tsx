// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import NoteCard from "./NoteCard";
import type { EntrySummary, OutlineImage } from "../../../shared/api/sidecar";

afterEach(cleanup);

const entry = (overrides: Partial<EntrySummary> = {}): EntrySummary => ({
  id: 1,
  folderId: 2,
  title: "Standup",
  preview: "what we shipped",
  tags: ["todo"],
  images: [],
  createdAt: "2026-08-22T08:00:00Z",
  updatedAt: "2026-08-22T09:00:00Z",
  ...overrides,
});

const image: OutlineImage = { id: 7, title: "board" };

describe("NoteCard", () => {
  it("shows the title with a Created · Updated meta line", () => {
    render(
      <NoteCard
        entry={entry()}
        onOpen={vi.fn()}
        onOpenTag={vi.fn()}
        onEditTags={vi.fn()}
      />,
    );
    const card = screen.getByText("Standup").closest("article");
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain("Created");
    expect(card?.textContent).toContain("Updated");
    expect(card?.textContent).not.toContain("Empty note");
  });

  it("stands in with its content when a note has no title", () => {
    render(<NoteCard entry={entry({ title: null, preview: "roadmap notes" })} onOpen={vi.fn()} />);
    expect(screen.getByText("roadmap notes")).not.toBeNull();
    expect(screen.queryByText("Untitled note")).toBeNull();
  });

  it("falls back to an untitled label only when there is no content either", () => {
    render(<NoteCard entry={entry({ title: null, preview: "" })} onOpen={vi.fn()} />);
    expect(screen.getByText("Untitled note")).not.toBeNull();
  });

  it("opens the tag space from a chip", () => {
    const onOpenTag = vi.fn();
    render(
      <NoteCard entry={entry({ tags: ["todo", "ship"] })} onOpen={vi.fn()} onOpenTag={onOpenTag} />,
    );
    fireEvent.click(screen.getByTitle("Open #todo"));
    expect(onOpenTag).toHaveBeenCalledWith("todo");
  });

  it("offers the tag editor from the card's hover action", () => {
    const onEditTags = vi.fn();
    render(
      <NoteCard entry={entry()} onOpen={vi.fn()} onOpenTag={vi.fn()} onEditTags={onEditTags} />,
    );
    fireEvent.click(screen.getByLabelText("Edit tags"));
    expect(onEditTags).toHaveBeenCalled();
  });

  it("opens the image viewer from a thumbnail", () => {
    const onOpenImage = vi.fn();
    render(
      <NoteCard
        entry={entry({ images: [image] })}
        onOpen={vi.fn()}
        onOpenTag={vi.fn()}
        onEditTags={vi.fn()}
        onOpenImage={onOpenImage}
      />,
    );
    fireEvent.click(screen.getByTitle("board"));
    expect(onOpenImage).toHaveBeenCalledWith(image);
  });
});
