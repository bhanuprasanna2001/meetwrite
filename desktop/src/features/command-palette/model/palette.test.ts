import { describe, expect, it } from "vitest";
import type { EntrySummary, Folder } from "../../../shared/api/sidecar";
import {
  entryLabel,
  MAX_RESULTS,
  moveSelection,
  paletteItems,
  type ActionItem,
  type PaletteContext,
  type PaletteItem,
} from "./palette";

const entry = (
  id: number,
  title: string | null,
  preview = "",
  tags: string[] = [],
): EntrySummary => ({
  id,
  folderId: 1,
  title,
  preview,
  tags,
  images: [],
  createdAt: "2026-08-18T10:00:00+00:00",
  updatedAt: "2026-08-18T10:00:00+00:00",
});

const folder = (id: number, name: string, isInbox = false): Folder => ({
  id,
  name,
  isInbox,
});

const context = (overrides: Partial<PaletteContext> = {}): PaletteContext => ({
  entries: [],
  folders: [folder(1, "Inbox", true), folder(2, "LeetCode")],
  chats: [],
  currentEntryId: null,
  aiEnabled: true,
  keySet: true,
  recording: false,
  meetingMode: false,
  dailyNoteEnabled: false,
  theme: "light",
  noteMode: "write",
  insertImages: true,
  ...overrides,
});

const itemsOf = (groupName: string, ctx: PaletteContext, query = ""): PaletteItem[] =>
  paletteItems(query, ctx).find((group) => group.name === groupName)?.items ?? [];

const noteIds = (ctx: PaletteContext, query = "") =>
  itemsOf("Notes", ctx, query)
    .filter((item) => item.kind === "entry")
    .map((item) => (item.kind === "entry" ? item.id : -1));

const actionIds = (ctx: PaletteContext, query = "") =>
  [
    ...itemsOf("Navigation", ctx, query),
    ...itemsOf("Actions", ctx, query),
    ...itemsOf("Settings", ctx, query),
  ]
    .filter((item) => item.kind === "action")
    .map((item) => (item.kind === "action" ? item.id : null));

describe("paletteItems — groups", () => {
  it("keeps the group order: Notes, Chats, Navigation, Actions, Settings", () => {
    const ctx = context({ entries: [entry(1, "Roadmap")] });
    expect(paletteItems("", ctx).map((group) => group.name)).toEqual([
      "Notes",
      "Navigation",
      "Actions",
      "Settings",
    ]);
  });

  it("offers today's note only while the daily note is enabled", () => {
    expect(actionIds(context())).not.toContain("daily-note");
    expect(actionIds(context({ dailyNoteEnabled: true }))).toContain("daily-note");
  });

  it("offers the preview toggle and add-picture only for the current note", () => {
    const noNote = actionIds(context());
    expect(noNote).not.toContain("toggle-preview");
    expect(noNote).not.toContain("add-image");

    const withNote = context({
      entries: [entry(1, "Roadmap")],
      currentEntryId: 1,
    });
    expect(actionIds(withNote)).toContain("toggle-preview");
    expect(actionIds(withNote)).toContain("add-image");
  });

  it("hides add-picture while an enhanced version is shown, and flips the toggle label in preview", () => {
    const enhanced = context({
      entries: [entry(1, "Roadmap")],
      currentEntryId: 1,
      insertImages: false,
    });
    expect(actionIds(enhanced)).toContain("toggle-preview");
    expect(actionIds(enhanced)).not.toContain("add-image");

    const previewing = context({
      entries: [entry(1, "Roadmap")],
      currentEntryId: 1,
      noteMode: "preview",
    });
    const labels = itemsOf("Actions", previewing)
      .filter((item) => item.kind === "action")
      .map((item) => (item.kind === "action" ? item.label : null));
    expect(labels).toContain("Write note");
    expect(labels).not.toContain("Preview note");
  });

  it("an empty query shows recent notes and every available action", () => {
    const ctx = context({ entries: [entry(2, "B"), entry(1, "A")] });
    expect(noteIds(ctx)).toEqual([2, 1]); // Recency order kept.
    expect(actionIds(ctx)).toEqual([
      "new-entry",
      "history",
      "open-folder",
      "open-folder",
      "record",
      "toggle-meeting",
      "theme",
      "toggle-ai",
      "settings",
      "help",
    ]);
  });

  it("matches titles, previews, and tags, case-insensitively", () => {
    const ctx = context({
      entries: [
        entry(1, "Design review", "talks about buttons"),
        entry(2, null, "roadmap"),
        entry(3, null, "anything", ["dynamic-programming"]),
      ],
    });
    expect(noteIds(ctx, "design")).toEqual([1]);
    expect(noteIds(ctx, "ROAD")).toEqual([2]);
    expect(noteIds(ctx, "program")).toEqual([3]);
    expect(noteIds(ctx, "nowhere")).toEqual([]);
  });

  it("ranks title matches above preview matches", () => {
    const ctx = context({
      entries: [entry(1, null, "mentions roadmap"), entry(2, "Roadmap", "")],
    });
    expect(noteIds(ctx, "roadmap")).toEqual([2, 1]);
  });

  it("a note row shows its title and a folder · day hint", () => {
    const ctx = context({
      entries: [{ ...entry(1, "Two sum"), folderId: 2 }],
    });
    const note = itemsOf("Notes", ctx)[0];
    expect(note.kind).toBe("entry");
    if (note.kind === "entry") {
      expect(note.title).toBe("Two sum");
      expect(note.hint).toContain("LeetCode · ");
    }
  });

  it("caps the notes at MAX_RESULTS", () => {
    const entries = Array.from({ length: MAX_RESULTS + 5 }, (_, index) =>
      entry(index, `Note ${index}`),
    );
    expect(noteIds(context({ entries }))).toHaveLength(MAX_RESULTS);
  });
});

describe("paletteItems — availability", () => {
  it("note-scoped actions need a current note", () => {
    expect(itemsOf("Chats in this note", context({ currentEntryId: null }))).toEqual([]);
    const withoutNote = actionIds(context({ currentEntryId: null }));
    expect(withoutNote).not.toContain("rename-note");
    expect(withoutNote).not.toContain("edit-tags");
    expect(withoutNote).not.toContain("move-to-folder");

    const open = context({ currentEntryId: 1, entries: [entry(1, "A")] });
    const ids = actionIds(open);
    expect(ids).toContain("rename-note");
    expect(ids).toContain("edit-tags");
    expect(ids).toContain("move-to-folder");
  });

  it("notes-only mode hides every AI action", () => {
    const ctx = context({ aiEnabled: false, currentEntryId: 1, entries: [entry(1, "A")] });
    const ids = actionIds(ctx);
    expect(ids).not.toContain("record");
    expect(ids).not.toContain("open-transcript");
    expect(ids).not.toContain("new-chat");
    expect(ids).not.toContain("suggest-title");
    expect(ids).toContain("toggle-ai");
  });

  it("suggest title also needs a stored key", () => {
    const ctx = context({ keySet: false, currentEntryId: 1, entries: [entry(1, "A")] });
    expect(actionIds(ctx)).not.toContain("suggest-title");
  });

  it("recording and meeting mode change their labels", () => {
    const recordingAction = itemsOf("Actions", context({ recording: true })).find(
      (item): item is ActionItem => item.kind === "action" && item.id === "record",
    );
    expect(recordingAction?.label).toBe("Stop recording");

    const meetingAction = itemsOf("Actions", context({ meetingMode: true })).find(
      (item): item is ActionItem =>
        item.kind === "action" && item.id === "toggle-meeting",
    );
    expect(meetingAction?.label).toBe("Exit meeting mode");
    // New entry and History hide in meeting mode, like their bottom-bar buttons.
    expect(actionIds(context({ meetingMode: true }))).not.toContain("new-entry");
    expect(actionIds(context({ meetingMode: true }))).not.toContain("history");
  });

  it("a query filters every group and drops empty ones", () => {
    const ctx = context({ entries: [entry(1, "Two sum")], currentEntryId: 1 });
    const groups = paletteItems("help", ctx);
    expect(groups.map((group) => group.name)).toEqual(["Settings"]);
    const helpItem = groups[0].items[0];
    expect(helpItem.kind).toBe("action");
    if (helpItem.kind === "action") expect(helpItem.label).toBe("Help");
  });
});

describe("entryLabel", () => {
  it("is the day plus the title", () => {
    expect(entryLabel(entry(1, "Design review"))).toContain("— Design review");
  });

  it("falls back to a trimmed preview, then to Untitled", () => {
    expect(entryLabel(entry(2, null, "first   line of the note"))).toContain(
      "— first line of the note",
    );
    expect(entryLabel(entry(3, null, ""))).toContain("— Untitled");
  });
});

describe("moveSelection", () => {
  it("wraps forward and backward", () => {
    expect(moveSelection(1, 1, 3)).toBe(2);
    expect(moveSelection(2, 1, 3)).toBe(0);
    expect(moveSelection(0, -1, 3)).toBe(2);
  });

  it("stays at zero for an empty list", () => {
    expect(moveSelection(0, 1, 0)).toBe(0);
  });
});
