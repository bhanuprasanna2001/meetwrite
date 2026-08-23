import type { Chat, EntrySummary, Folder, Theme } from "../../../shared/api/sidecar";
import type { NoteMode } from "../../notes/ui/NoteEditor";
import { dayLabel } from "../../../shared/lib/dates";
export { moveSelection } from "../../../shared/lib/selection";

/**
 * The ⌘K palette's pure logic. One ordered set of groups — Notes, Chats in
 * this note, Navigation, Actions, Settings — where every item is a value
 * the controller can execute in one switch. An empty query shows recent
 * notes and every available action; typing filters on labels (and note
 * titles, previews, and tags). Availability is decided here once, from the
 * context, so the controller never re-derives whether a command is legal.
 */

export type PaletteGroupName =
  | "Notes"
  | "Chats in this note"
  | "Navigation"
  | "Actions"
  | "Settings";

export type PaletteActionId =
  | "open-transcript"
  | "new-chat"
  | "rename-note"
  | "edit-tags"
  | "move-to-folder"
  | "suggest-title"
  | "new-entry"
  | "open-folder"
  | "daily-note"
  | "record"
  | "toggle-meeting"
  | "toggle-preview"
  | "add-image"
  | "history"
  | "theme"
  | "settings"
  | "help"
  | "toggle-ai";

export interface EntryItem {
  kind: "entry";
  id: number;
  /** The note's own title (preview or "Untitled" when there is none). */
  title: string;
  /** Second line: "Inbox · Today" — where it lives and when it moved. */
  hint: string;
}

export interface ChatItem {
  kind: "chat";
  entryId: number;
  id: number;
  label: string;
}

export interface ActionItem {
  kind: "action";
  id: PaletteActionId;
  label: string;
  hint?: string;
  /** Set only for `open-folder`. */
  folderId?: number;
}

export type PaletteItem = EntryItem | ChatItem | ActionItem;

export interface PaletteGroup {
  name: PaletteGroupName;
  items: PaletteItem[];
}

/** Everything the palette's availability rules need — all already loaded. */
export interface PaletteContext {
  entries: EntrySummary[];
  folders: Folder[];
  /** The current note's chats. */
  chats: Chat[];
  currentEntryId: number | null;
  aiEnabled: boolean;
  keySet: boolean;
  recording: boolean;
  meetingMode: boolean;
  /** The daily note is on — the one-command path to today's note. */
  dailyNoteEnabled: boolean;
  theme: Theme;
  /** The one app-wide Write|Preview value — labels the toggle action. */
  noteMode: NoteMode;
  /** True while the current note is the human version — pictures can be
   * added only to it, so the add-picture action hides otherwise. */
  insertImages: boolean;
}

/** The notes group never renders more than this many rows. */
export const MAX_RESULTS = 20;

/** One line of preview text, for notes with no title. */
function previewText(entry: EntrySummary): string {
  const text = entry.preview.replace(/\s+/g, " ").trim();
  return text.length > 48 ? `${text.slice(0, 48)}…` : text;
}

/** The note row label: "Today — title", preview standing in when untitled. */
export function entryLabel(entry: EntrySummary): string {
  const title = entry.title?.trim() || previewText(entry) || "Untitled";
  return `${dayLabel(entry.updatedAt)} — ${title}`;
}

/** Case-insensitive substring match; an empty query matches everything. */
function matches(label: string, query: string): boolean {
  return query === "" || label.toLowerCase().includes(query);
}

/** The palette's grouped items for a query and the current context. */
export function paletteItems(query: string, context: PaletteContext): PaletteGroup[] {
  const q = query.trim().toLowerCase();
  const folderName = (folderId: number) =>
    context.folders.find((folder) => folder.id === folderId)?.name ?? "Inbox";
  const currentNote =
    context.currentEntryId === null
      ? null
      : (context.entries.find((entry) => entry.id === context.currentEntryId) ?? null);
  // A note matches on title, preview, AND tags — the same text is used to
  // filter the notes group, so a tag hit never disappears in a later pass.
  const searchText = (entry: EntrySummary) =>
    `${entry.title ?? ""} ${entry.preview} ${entry.tags.join(" ")}`;
  const searchTextById = new Map(context.entries.map((entry) => [entry.id, searchText(entry)]));

  const notes: PaletteItem[] = context.entries
    .filter((entry) => matches(searchText(entry), q))
    .sort((a, b) => {
      if (q === "") return 0; // Stable sort keeps the recency order.
      const aTitle = a.title?.toLowerCase().includes(q) ? 0 : 1;
      const bTitle = b.title?.toLowerCase().includes(q) ? 0 : 1;
      return aTitle - bTitle;
    })
    .slice(0, MAX_RESULTS)
    .map((entry) => ({
      kind: "entry" as const,
      id: entry.id,
      title: entry.title?.trim() || previewText(entry) || "Untitled",
      hint: `${folderName(entry.folderId)} · ${dayLabel(entry.updatedAt)}`,
    }));

  const chats: PaletteItem[] =
    currentNote !== null && context.aiEnabled
      ? context.chats.map((chat, index) => ({
          kind: "chat" as const,
          entryId: currentNote.id,
          id: chat.id,
          label: chat.title ?? `Chat ${index + 1}`,
        }))
      : [];

  const navigation: PaletteItem[] = [
    ...(context.meetingMode
      ? []
      : [
          {
            kind: "action" as const,
            id: "new-entry" as const,
            label: "New note",
            hint: "⌘N",
          },
          {
            kind: "action" as const,
            id: "history" as const,
            label: "History",
            hint: "⌘⇧H",
          },
        ]),
    ...(context.dailyNoteEnabled
      ? [
          {
            kind: "action" as const,
            id: "daily-note" as const,
            label: "Open today's note",
          },
        ]
      : []),
    ...context.folders.map((folder) => ({
      kind: "action" as const,
      id: "open-folder" as const,
      folderId: folder.id,
      label: `Open folder: ${folder.name}`,
    })),
  ];

  const actions: PaletteItem[] = [];
  if (currentNote !== null && context.aiEnabled) {
    actions.push({ kind: "action", id: "open-transcript", label: "Open transcript" });
    actions.push({ kind: "action", id: "new-chat", label: "New chat" });
  }
  if (currentNote !== null) {
    actions.push({ kind: "action", id: "rename-note", label: "Rename note" });
    actions.push({ kind: "action", id: "edit-tags", label: "Edit tags" });
    actions.push({ kind: "action", id: "move-to-folder", label: "Move to folder" });
    actions.push({
      kind: "action",
      id: "toggle-preview",
      label: context.noteMode === "write" ? "Preview note" : "Write note",
      hint: "⌘⇧P",
    });
    if (context.insertImages) {
      actions.push({
        kind: "action",
        id: "add-image",
        label: "Add a picture",
        hint: "⌘⇧I",
      });
    }
  }
  if (currentNote !== null && context.aiEnabled && context.keySet) {
    actions.push({ kind: "action", id: "suggest-title", label: "Suggest title" });
  }
  if (context.aiEnabled) {
    actions.push({
      kind: "action",
      id: "record",
      label: context.recording ? "Stop recording" : "Start recording",
      hint: "⌘R",
    });
  }
  actions.push({
    kind: "action",
    id: "toggle-meeting",
    label: context.meetingMode ? "Exit meeting mode" : "Meeting mode",
    hint: "⌃⌘M",
  });

  const settings: PaletteItem[] = [
    {
      kind: "action",
      id: "theme",
      label: context.theme === "dark" ? "Switch to light" : "Switch to dark",
    },
    {
      kind: "action",
      id: "toggle-ai",
      label: context.aiEnabled ? "Turn AI off (notes only)" : "Turn AI on",
    },
    { kind: "action", id: "settings", label: "Open settings", hint: "⌘," },
    { kind: "action", id: "help", label: "Help", hint: "⌘/" },
  ];

  const groups: PaletteGroup[] = [
    { name: "Notes", items: notes },
    { name: "Chats in this note", items: chats },
    { name: "Navigation", items: navigation },
    { name: "Actions", items: actions },
    { name: "Settings", items: settings },
  ];
  return groups
    .map((group) => ({
      name: group.name,
      items: group.items.filter((item) => {
        if (item.kind === "entry") {
          return matches(searchTextById.get(item.id) ?? "", q);
        }
        return matches(item.label, q);
      }),
    }))
    .filter((group) => group.items.length > 0);
}
