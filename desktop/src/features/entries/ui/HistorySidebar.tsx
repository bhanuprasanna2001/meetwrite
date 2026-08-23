import { useEffect, useMemo, useRef, useState } from "react";
import type {
  EntryOutline,
  EntrySummary,
  Folder,
  OutlineImage,
} from "../../../shared/api/sidecar";
import { dayLabel } from "../../../shared/lib/dates";
import { previewLabel } from "../../../shared/lib/entryText";
import { log } from "../../../shared/lib/logger";
import { SIDEBAR_WIDTH } from "../../../shared/ui/layout";

/**
 * The docked right sidebar: folders with their notes, each note expandable
 * into its Transcript and Chats. One click has exactly one meaning:
 *
 * - folder chevron → expand/collapse that folder
 * - folder name   → open the folder view in the center
 * - note name     → open the note
 * - note chevron  → expand/collapse its transcript/chat children
 * - child row     → open that exact full view
 *
 * Folders and notes live in the workspace controller; this component only
 * owns which rows are expanded and in-flight rename inputs.
 */

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={`h-3 w-3 transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 4l4 4-4 4" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg
      className="h-3.5 w-3.5 flex-none"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1.5 4.5a1.5 1.5 0 0 1 1.5-1.5h3l1.5 2H13a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5H3a1.5 1.5 0 0 1-1.5-1.5v-8Z" />
    </svg>
  );
}

function TranscriptIcon() {
  return (
    <svg
      className="h-3.5 w-3.5 flex-none"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M2 5h6M2 8h10M2 11h6" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg
      className="h-3.5 w-3.5 flex-none"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.5 3.5h11a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-6l-3 2.5v-2.5h-2a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Z" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg
      className="h-3.5 w-3.5 flex-none"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
      <circle cx="5.5" cy="6.5" r="1.5" />
      <path d="m2.5 12 3.5-3.5 2.5 2.5 2-2 3 3" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11.3 2.7a1.5 1.5 0 0 1 2.1 2.1L5.5 12.7 2 14l1.3-3.5 8-7.8Z" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

/** The shared style of every rename/new-folder input row. */
const RENAME_INPUT =
  "w-full border-b border-ink-line bg-transparent pb-0.5 text-sm text-ink " +
  "outline-none dark:border-paper-line dark:text-paper";

/** One inline editing input shared by note rename, folder rename, and the
 * new-folder field. The caller keeps its commit/cancel mirror ref — this is
 * only the rendering of the input. */
function InlineRenameInput({
  value,
  placeholder,
  ariaLabel,
  onChange,
  onCommit,
  onCancel,
}: {
  value: string;
  placeholder?: string;
  ariaLabel: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  return (
    <input
      autoFocus
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onCommit}
      onKeyDown={(event) => {
        if (event.key === "Enter") onCommit();
        if (event.key === "Escape") onCancel();
      }}
      aria-label={ariaLabel}
      className={RENAME_INPUT}
    />
  );
}

interface HistorySidebarProps {
  open: boolean;
  folders: Folder[];
  entries: EntrySummary[];
  activeId: number | null;
  activeFolderId: number | null;
  onOpen: (id: number) => void;
  onOpenChatEntry: (entryId: number, chatId: number) => void;
  onOpenTranscriptEntry: (entryId: number) => void;
  onOpenFolder: (folderId: number) => void;
  onOpenTag: (tag: string) => void;
  /** The tag whose tag-space view is open, for the active highlight. */
  activeTag: string | null;
  onCreateFolder: (name: string) => void;
  onRenameFolder: (id: number, name: string) => void;
  onDeleteFolder: (id: number) => void;
  onDelete: (id: number) => void;
  onRename: (id: number, title: string | null) => void;
  onRenameTag: (tag: string, name: string) => void;
  onDeleteTag: (tag: string) => void;
  onLoadOutline: (entryId: number) => Promise<EntryOutline>;
  /** A picture row click opens the image viewer (its one entry point). */
  onOpenImage: (entryId: number, image: OutlineImage) => void;
  onSearch: () => void;
}

export default function HistorySidebar({
  open,
  folders,
  entries,
  activeId,
  activeFolderId,
  onOpen,
  onOpenChatEntry,
  onOpenTranscriptEntry,
  onOpenFolder,
  onOpenTag,
  activeTag,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onDelete,
  onRename,
  onRenameTag,
  onDeleteTag,
  onLoadOutline,
  onOpenImage,
  onSearch,
}: HistorySidebarProps) {
  const [expandedFolders, setExpandedFolders] = useState<ReadonlySet<number>>(() => new Set());
  const [expandedEntries, setExpandedEntries] = useState<ReadonlySet<number>>(() => new Set());
  const [outlines, setOutlines] = useState<Record<number, EntryOutline>>({});
  const outlineRequestRef = useRef(0);

  // Note rename, mirrored in a ref so Enter-commit and the following blur
  // can never both fire.
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const editingRef = useRef<number | null>(null);

  // Folder rename — same mirror pattern.
  const [folderEditingId, setFolderEditingId] = useState<number | null>(null);
  const [folderDraft, setFolderDraft] = useState("");
  const folderEditingRef = useRef<number | null>(null);

  // New folder — same mirror pattern, Enter and blur commit exactly once.
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderDraft, setNewFolderDraft] = useState("");
  const creatingRef = useRef(false);

  // The Inbox starts expanded: it is where new notes land.
  useEffect(() => {
    const inbox = folders.find((folder) => folder.isInbox);
    if (inbox === undefined) return;
    setExpandedFolders((current) => {
      if (current.has(inbox.id)) return current;
      const next = new Set(current);
      next.add(inbox.id);
      return next;
    });
  }, [folders]);

  // Workspace-wide tag counts, alphabetical — the sidebar's tag space list.
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of entries) {
      for (const tag of entry.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [entries]);

  const toggleFolder = (folderId: number) => {
    setExpandedFolders((current) => {
      const next = new Set(current);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };

  const toggleEntry = (entryId: number) => {
    const willExpand = !expandedEntries.has(entryId);
    setExpandedEntries((current) => {
      const next = new Set(current);
      if (willExpand) next.add(entryId);
      else next.delete(entryId);
      return next;
    });
    if (!willExpand) return;
    // The outline loads fresh on every expand so it can never list chats
    // that were deleted after an earlier visit.
    const requestId = ++outlineRequestRef.current;
    onLoadOutline(entryId)
      .then((outline) => {
        if (requestId !== outlineRequestRef.current) return;
        setOutlines((current) => ({ ...current, [entryId]: outline }));
      })
      .catch((outlineError) => log.error("entry.outline_failed", { entryId }, outlineError));
  };

  const startRename = (id: number, title: string | null) => {
    editingRef.current = id;
    setDraft(title ?? "");
    setEditingId(id);
  };

  const stopRename = () => {
    editingRef.current = null;
    setEditingId(null);
  };

  const commitRename = (id: number) => {
    if (editingRef.current !== id) return; // Already committed or cancelled.
    const title = draft.trim();
    stopRename();
    onRename(id, title || null);
  };

  const startFolderRename = (id: number, name: string) => {
    folderEditingRef.current = id;
    setFolderDraft(name);
    setFolderEditingId(id);
  };

  const stopFolderRename = () => {
    folderEditingRef.current = null;
    setFolderEditingId(null);
  };

  const commitFolderRename = (id: number) => {
    if (folderEditingRef.current !== id) return;
    const name = folderDraft.trim();
    stopFolderRename();
    if (name) onRenameFolder(id, name);
  };

  const startNewFolder = () => {
    creatingRef.current = true;
    setNewFolderDraft("");
    setCreatingFolder(true);
  };

  const cancelNewFolder = () => {
    creatingRef.current = false;
    setCreatingFolder(false);
  };

  const commitNewFolder = () => {
    if (!creatingRef.current) return;
    creatingRef.current = false;
    setCreatingFolder(false);
    const name = newFolderDraft.trim();
    if (name) onCreateFolder(name);
  };

  // Tag rename — same mirror pattern, keyed by the tag's value.
  const [tagEditingValue, setTagEditingValue] = useState<string | null>(null);
  const [tagDraft, setTagDraft] = useState("");
  const tagEditingRef = useRef<string | null>(null);

  const startTagRename = (tag: string) => {
    tagEditingRef.current = tag;
    setTagDraft(tag);
    setTagEditingValue(tag);
  };

  const stopTagRename = () => {
    tagEditingRef.current = null;
    setTagEditingValue(null);
  };

  const commitTagRename = (tag: string) => {
    if (tagEditingRef.current !== tag) return; // Already committed or cancelled.
    const name = tagDraft.trim();
    stopTagRename();
    if (name && name !== tag) onRenameTag(tag, name);
  };

  return (
    <aside
      className="flex-none overflow-hidden border-l border-ink-line bg-ink-surface transition-[width] duration-200 dark:border-paper-line dark:bg-paper-surface"
      style={{ width: open ? SIDEBAR_WIDTH : 0 }}
      aria-hidden={!open}
      inert={!open}
    >
      <div className="flex h-full flex-col" style={{ width: SIDEBAR_WIDTH }}>
        <header className="flex flex-none items-center justify-between border-b border-ink-line py-2 pl-4 pr-2 dark:border-paper-line">
          <h2 className="text-sm font-semibold text-ink dark:text-paper">Notes</h2>
          <button
            type="button"
            onClick={startNewFolder}
            aria-label="New folder"
            title="New folder"
            className="cursor-pointer rounded p-1.5 text-ink-faint hover:bg-ink-line/40 hover:text-ink dark:text-paper-mute dark:hover:bg-paper-line/15 dark:hover:text-paper"
          >
            <PlusIcon />
          </button>
        </header>

        <nav className="min-h-0 flex-1 overflow-y-auto py-1">
          {creatingFolder && (
            <div className="px-4 py-2">
              <InlineRenameInput
                value={newFolderDraft}
                placeholder="Folder name"
                ariaLabel="New folder name"
                onChange={setNewFolderDraft}
                onCommit={commitNewFolder}
                onCancel={cancelNewFolder}
              />
            </div>
          )}

          <ul>
            {folders.map((folder) => {
              const folderEntries = entries.filter((entry) => entry.folderId === folder.id);
              const expanded = expandedFolders.has(folder.id);
              const isOpen = activeFolderId === folder.id;
              return (
                <li key={folder.id} className="group/folder">
                  {folderEditingId === folder.id ? (
                    <div className="px-3 py-1.5 pl-9">
                      <InlineRenameInput
                        value={folderDraft}
                        ariaLabel="Rename folder"
                        onChange={setFolderDraft}
                        onCommit={() => commitFolderRename(folder.id)}
                        onCancel={stopFolderRename}
                      />
                    </div>
                  ) : (
                    <div
                      className={`flex items-center py-0.5 pl-2 pr-1.5 ${
                        isOpen ? "bg-ink-line/40 dark:bg-paper-line/15" : ""
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => toggleFolder(folder.id)}
                        aria-label={expanded ? "Collapse folder" : "Expand folder"}
                        className="flex-none cursor-pointer rounded p-1.5 text-ink-faint hover:text-ink dark:text-paper-mute dark:hover:text-paper"
                      >
                        <ChevronIcon expanded={expanded} />
                      </button>
                      <span className="flex-none pl-0.5 pr-1.5 text-ink-mute dark:text-paper-mute">
                        <FolderIcon />
                      </span>
                      <button
                        type="button"
                        onClick={() => onOpenFolder(folder.id)}
                        className="min-w-0 flex-1 cursor-pointer truncate py-2 text-left text-sm font-medium text-ink dark:text-paper"
                      >
                        {folder.name}
                      </button>
                      <span className="flex-none px-1.5 text-[11px] text-ink-mute dark:text-paper-mute">
                        {folderEntries.length}
                      </span>
                      {!folder.isInbox && (
                        <div className="flex flex-none items-center opacity-0 transition-opacity group-hover/folder:opacity-100 group-focus-within/folder:opacity-100">
                          <button
                            type="button"
                            onClick={() => startFolderRename(folder.id, folder.name)}
                            aria-label="Rename folder"
                            title="Rename folder"
                            className="cursor-pointer px-1.5 py-1 text-ink-faint hover:text-ink dark:text-paper-mute dark:hover:text-paper"
                          >
                            <PencilIcon />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteFolder(folder.id)}
                            aria-label="Delete folder"
                            title="Delete folder — its notes move to Inbox"
                            className="cursor-pointer px-1.5 py-1 text-ink-faint hover:text-ink dark:text-paper-mute dark:hover:text-paper"
                          >
                            <XIcon />
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {expanded && folderEntries.length > 0 && (
                    <ul className="pb-0.5">
                      {folderEntries.map((entry) => {
                        const entryExpanded = expandedEntries.has(entry.id);
                        const outline = outlines[entry.id] ?? null;
                        return (
                          <li key={entry.id} className="group/entry relative">
                            {editingId === entry.id ? (
                              <div className="py-1.5 pl-9 pr-4">
                                <InlineRenameInput
                                  value={draft}
                                  ariaLabel="Rename note"
                                  onChange={setDraft}
                                  onCommit={() => commitRename(entry.id)}
                                  onCancel={stopRename}
                                />
                              </div>
                            ) : (
                              <>
                                <div
                                  className={`flex items-center py-0.5 pl-4 pr-1.5 ${
                                    entry.id === activeId
                                      ? "bg-ink-line/60 dark:bg-paper-line/25"
                                      : "hover:bg-ink-line/25 dark:hover:bg-paper-line/10"
                                  }`}
                                >
                                  <button
                                    type="button"
                                    onClick={() => toggleEntry(entry.id)}
                                    aria-label={
                                      entryExpanded ? "Collapse note" : "Expand note"
                                    }
                                    className="flex-none cursor-pointer rounded p-1.5 text-ink-faint hover:text-ink dark:text-paper-mute dark:hover:text-paper"
                                  >
                                    <ChevronIcon expanded={entryExpanded} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => onOpen(entry.id)}
                                    className="min-w-0 flex-1 cursor-pointer py-1.5 pl-0.5 pr-[4rem] text-left"
                                  >
                                    <span className="block text-[11px] text-ink-mute dark:text-paper-mute">
                                      {dayLabel(entry.updatedAt)}
                                    </span>
                                    <span className="block truncate text-sm text-ink-soft dark:text-paper">
                                      {previewLabel(entry.title, entry.preview)}
                                    </span>
                                  </button>
                                  <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center opacity-0 transition-opacity group-hover/entry:opacity-100 group-focus-within/entry:opacity-100">
                                    <button
                                      type="button"
                                      onClick={() => startRename(entry.id, entry.title)}
                                      aria-label="Rename note"
                                      title="Rename note"
                                      className="cursor-pointer px-1.5 py-1 text-ink-faint hover:text-ink dark:text-paper-mute dark:hover:text-paper"
                                    >
                                      <PencilIcon />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => onDelete(entry.id)}
                                      aria-label="Delete note"
                                      title="Delete note"
                                      className="cursor-pointer px-1.5 py-1 text-ink-faint hover:text-ink dark:text-paper-mute dark:hover:text-paper"
                                    >
                                      <XIcon />
                                    </button>
                                  </div>
                                </div>

                                {entryExpanded && outline === null && (
                                  <p className="py-1.5 pl-10 pr-4 text-xs text-ink-faint dark:text-paper-faint">
                                    Loading…
                                  </p>
                                )}

                                {entryExpanded && outline !== null && (
                                  <ul className="pb-1">
                                    {outline.hasTranscript && (
                                      <li>
                                        <button
                                          type="button"
                                          onClick={() => onOpenTranscriptEntry(entry.id)}
                                          className="flex w-full cursor-pointer items-center gap-2 py-1.5 pl-10 pr-4 text-left text-xs text-ink hover:bg-ink-line/40 dark:text-paper dark:hover:bg-paper-line/15"
                                        >
                                          <TranscriptIcon />
                                          Transcript
                                        </button>
                                      </li>
                                    )}
                                    {outline.images.map((image, index) => (
                                      <li key={image.id}>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            onOpenImage(entry.id, {
                                              id: image.id,
                                              title: image.title,
                                            })
                                          }
                                          className="flex w-full cursor-pointer items-center gap-2 py-1.5 pl-10 pr-4 text-left text-xs text-ink hover:bg-ink-line/40 dark:text-paper dark:hover:bg-paper-line/15"
                                        >
                                          <ImageIcon />
                                          <span className="min-w-0 flex-1 truncate">
                                            {image.title ?? `Image ${index + 1}`}
                                          </span>
                                        </button>
                                      </li>
                                    ))}
                                    {outline.chats.map((chat, index) => (
                                      <li key={chat.id}>
                                        <button
                                          type="button"
                                          onClick={() => onOpenChatEntry(entry.id, chat.id)}
                                          className="flex w-full cursor-pointer items-center gap-2 py-1.5 pl-10 pr-4 text-left text-xs text-ink hover:bg-ink-line/40 dark:text-paper dark:hover:bg-paper-line/15"
                                        >
                                          <ChatIcon />
                                          <span className="min-w-0 flex-1 truncate">
                                            {chat.title ?? `Chat ${index + 1}`}
                                          </span>
                                        </button>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>

          {entries.length === 0 && (
            <p className="px-4 py-3 text-xs text-ink-mute dark:text-paper-mute">
              No notes yet.
            </p>
          )}

          <ul className="border-t border-ink-line pt-1 dark:border-paper-line">
            <li role="presentation">
              <p className="px-4 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-ink-faint dark:text-paper-faint">
                Tags
              </p>
            </li>
            {tagCounts.map(([tag, count]) => (
              <li key={tag} className="group/tag">
                {tagEditingValue === tag ? (
                  <div className="py-1.5 pl-9 pr-4">
                    <InlineRenameInput
                      value={tagDraft}
                      ariaLabel="Rename tag"
                      onChange={setTagDraft}
                      onCommit={() => commitTagRename(tag)}
                      onCancel={stopTagRename}
                    />
                  </div>
                ) : (
                  <div
                    className={`flex items-center py-0.5 pl-2 pr-1.5 ${
                      activeTag === tag ? "bg-ink-line/40 dark:bg-paper-line/15" : ""
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onOpenTag(tag)}
                      className={`flex min-w-0 flex-1 cursor-pointer items-baseline gap-1.5 py-1 pl-2 text-left text-sm ${
                        activeTag === tag
                          ? "text-ink dark:text-paper"
                          : "text-ink-soft hover:text-ink dark:text-paper-soft dark:hover:text-paper"
                      }`}
                    >
                      <span className="flex-none text-ink-faint dark:text-paper-faint">#</span>
                      <span className="min-w-0 flex-1 truncate">{tag}</span>
                      <span className="flex-none pr-1 text-[11px] tabular-nums text-ink-mute dark:text-paper-mute">
                        {count}
                      </span>
                    </button>
                    <div className="flex flex-none items-center opacity-0 transition-opacity group-hover/tag:opacity-100 group-focus-within/tag:opacity-100">
                      <button
                        type="button"
                        onClick={() => startTagRename(tag)}
                        aria-label="Rename tag"
                        title="Rename tag"
                        className="cursor-pointer px-1.5 py-1 text-ink-faint hover:text-ink dark:text-paper-mute dark:hover:text-paper"
                      >
                        <PencilIcon />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteTag(tag)}
                        aria-label="Delete tag"
                        title="Delete tag — removed from every note"
                        className="cursor-pointer px-1.5 py-1 text-ink-faint hover:text-ink dark:text-paper-mute dark:hover:text-paper"
                      >
                        <XIcon />
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
            {tagCounts.length === 0 && (
              <li className="px-4 py-1.5 text-xs text-ink-faint dark:text-paper-faint">
                No tags yet
              </li>
            )}
          </ul>
        </nav>

        <footer className="flex-none border-t border-ink-line p-2 dark:border-paper-line">
          <button
            type="button"
            onClick={onSearch}
            className="flex w-full cursor-pointer items-center justify-between rounded-md px-2 py-1.5 text-xs text-ink-mute hover:bg-ink-line/40 hover:text-ink dark:text-paper-mute dark:hover:bg-paper-line/15 dark:hover:text-paper"
          >
            <span>Search notes</span>
            <kbd className="rounded border border-ink-line px-1 text-[10px] dark:border-paper-line">
              ⌘K
            </kbd>
          </button>
        </footer>
      </div>
    </aside>
  );
}
