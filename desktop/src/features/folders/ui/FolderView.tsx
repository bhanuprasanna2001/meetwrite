import { useMemo, useState } from "react";
import type {
  EntrySummary,
  Folder,
  OutlineImage,
} from "../../../shared/api/sidecar";
import TagPicker from "../../tags/ui/TagPicker";
import NoteCard from "../../entries/ui/NoteCard";

interface FolderViewProps {
  folder: Folder;
  entries: EntrySummary[];
  onOpenEntry: (id: number) => void;
  onNewEntry: () => void;
  onEditTags: (entryId: number) => void;
  onOpenTag: (tag: string) => void;
  /** A thumbnail click opens the image viewer (its one entry point). */
  onOpenImage: (entryId: number, image: OutlineImage) => void;
}

/**
 * The folder's note list — the center view opened from the sidebar. It is
 * derived entirely from data the workspace already holds, so opening it is
 * instant and can never show a stale list. Filtering is client-side: a
 * text query plus a multi-select tag bar (chips live inside the bar, a
 * dropdown picker adds more). Note tags are clickable — they open the
 * workspace-wide tag space.
 */
export default function FolderView({
  folder,
  entries,
  onOpenEntry,
  onNewEntry,
  onEditTags,
  onOpenTag,
  onOpenImage,
}: FolderViewProps) {
  const [query, setQuery] = useState("");
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [oldestFirst, setOldestFirst] = useState(false);
  const needle = query.trim().toLowerCase();

  // The folder's tag names, alphabetical — the picker's list.
  const folderTags = useMemo(
    () => [...new Set(entries.flatMap((entry) => entry.tags))].sort(),
    [entries],
  );

  const visible = useMemo(() => {
    const filtered = entries.filter(
      (entry) =>
        (needle === "" ||
          `${entry.title ?? ""} ${entry.preview} ${entry.tags.join(" ")}`
            .toLowerCase()
            .includes(needle)) &&
        activeTags.every((tag) => entry.tags.includes(tag)),
    );
    // Sort explicitly by update time so the toggle never depends on the
    // server's list order. ISO strings compare chronologically.
    const ordered = [...filtered].sort((a, b) =>
      a.updatedAt.localeCompare(b.updatedAt),
    );
    return oldestFirst ? ordered : ordered.reverse();
  }, [entries, needle, activeTags, oldestFirst]);

  const toggleFilterTag = (tag: string) => {
    setActiveTags((current) =>
      current.includes(tag) ? current.filter((value) => value !== tag) : [...current, tag],
    );
  };

  const addFilterTag = (tag: string) => {
    const cleaned = tag.trim();
    if (!cleaned) return;
    setActiveTags((current) => (current.includes(cleaned) ? current : [...current, cleaned]));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="mx-auto w-full max-w-3xl flex-none px-8 pb-6 pt-10">
        <div className="flex items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight text-ink dark:text-paper">
              {folder.name}
            </h1>
            <p className="mt-1 text-xs text-ink-mute dark:text-paper-mute">
              {entries.length} {entries.length === 1 ? "note" : "notes"}
            </p>
          </div>
          <button
            type="button"
            onClick={onNewEntry}
            className="flex-none cursor-pointer rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-paper transition-colors hover:bg-ink-soft dark:bg-paper dark:text-ink dark:hover:bg-paper-soft"
          >
            New note
          </button>
        </div>
        <div className="mt-5 flex gap-2">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter notes"
            aria-label="Filter notes in this folder"
            className="min-w-0 flex-1 border-b border-ink-line bg-transparent pb-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-ink-faint focus:outline-none dark:border-paper-line dark:text-paper dark:placeholder:text-paper-faint dark:focus:border-paper-faint"
          />
          <button
            type="button"
            onClick={() => setOldestFirst((current) => !current)}
            aria-label="Toggle note order"
            title={
              oldestFirst
                ? "Oldest first — click for newest first"
                : "Newest first — click for oldest first"
            }
            className="w-1/4 flex-none cursor-pointer border-b border-ink-line pb-1.5 text-left text-sm text-ink-mute hover:text-ink dark:border-paper-line dark:text-paper-mute dark:hover:text-paper"
          >
            {oldestFirst ? "Oldest first" : "Newest first"}
          </button>
        </div>
        <div className="relative mt-3">
          <div
            onClick={() => setPickerOpen(true)}
            className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-ink-line bg-ink-surface px-2 py-1.5 dark:border-paper-line dark:bg-paper-surface"
          >
            {activeTags.length === 0 && (
              <span className="cursor-pointer px-1.5 py-0.5 text-xs text-ink-faint hover:text-ink dark:text-paper-faint dark:hover:text-paper">
                Filter by tag…
              </span>
            )}
            {activeTags.map((tag) => (
              <span
                key={tag}
                className="flex items-center gap-1 rounded-md bg-ink-line/70 px-2 py-0.5 text-xs text-ink dark:bg-paper-line/40 dark:text-paper"
              >
                #{tag}
                <button
                  type="button"
                  onClick={(event) => {
                    // Removing a chip must not also open the picker.
                    event.stopPropagation();
                    toggleFilterTag(tag);
                  }}
                  aria-label={`Remove ${tag} filter`}
                  className="cursor-pointer text-ink-faint hover:text-ink dark:text-paper-mute dark:hover:text-paper"
                >
                  ×
                </button>
              </span>
            ))}
            <button
              type="button"
              onClick={(event) => {
                // The bar itself opens the picker; the + also closes it.
                event.stopPropagation();
                setPickerOpen((open) => !open);
              }}
              aria-label="Add tag filter"
              title="Add tag filter"
              className="ml-auto flex-none cursor-pointer rounded p-0.5 text-ink-faint hover:text-ink dark:text-paper-faint dark:hover:text-paper"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                <path d="M8 3v10M3 8h10" />
              </svg>
            </button>
          </div>
          {pickerOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setPickerOpen(false)} />
              <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-ink-line bg-paper shadow-xl dark:border-paper-line dark:bg-ink">
                <TagPicker
                  tags={folderTags}
                  selected={activeTags}
                  onToggle={toggleFilterTag}
                  onAdd={addFilterTag}
                />
              </div>
            </>
          )}
          {activeTags.length > 0 && (
            <p className="mt-1.5 text-xs text-ink-mute dark:text-paper-mute">
              {activeTags.map((tag) => `#${tag}`).join(" ")} — showing {visible.length} of{" "}
              {entries.length}
            </p>
          )}
        </div>
        {folderTags.length === 0 && entries.length > 0 && (
          <p className="mt-3 text-xs text-ink-faint dark:text-paper-faint">
            No tags yet — hover a note and click the tag icon to add one.
          </p>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <ul className="mx-auto w-full max-w-3xl space-y-2 px-8 pb-12">
          {visible.map((entry) => (
            <NoteCard
              key={entry.id}
              entry={entry}
              onOpen={() => onOpenEntry(entry.id)}
              onOpenTag={onOpenTag}
              onEditTags={() => onEditTags(entry.id)}
              onOpenImage={(image) => onOpenImage(entry.id, image)}
            />
          ))}
        </ul>

        {visible.length === 0 && (
          <p className="px-8 py-6 text-center text-xs text-ink-mute dark:text-paper-mute">
            {entries.length === 0
              ? "No notes here yet — create one to get started."
              : "No notes match this filter."}
          </p>
        )}
      </div>
    </div>
  );
}
