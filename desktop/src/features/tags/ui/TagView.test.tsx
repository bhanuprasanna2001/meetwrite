// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TagView from "./TagView";
import type { EntrySummary, Folder } from "../../../shared/api/sidecar";

afterEach(cleanup);

const folder = (overrides: Partial<Folder> = {}): Folder => ({
  id: 2,
  name: "Inbox",
  isInbox: true,
  ...overrides,
});

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

describe("TagView", () => {
  it("backs out with the shared ← Back control", () => {
    const onBack = vi.fn();
    render(
      <TagView
        tag="todo"
        entries={[entry()]}
        folders={[folder()]}
        onOpenEntry={vi.fn()}
        onOpenTag={vi.fn()}
        onBack={onBack}
      />,
    );
    fireEvent.click(screen.getByText("← Back"));
    expect(onBack).toHaveBeenCalled();
  });

  it("puts the tag on its own heading line with a count line under it", () => {
    render(
      <TagView
        tag="todo"
        entries={[entry()]}
        folders={[folder()]}
        onOpenEntry={vi.fn()}
        onOpenTag={vi.fn()}
        onBack={vi.fn()}
      />,
    );
    expect(screen.getByText("todo")).not.toBeNull();
    expect(screen.getByText("1 note across 1 folder")).not.toBeNull();
  });
});
