import type { EntrySummary, Folder } from "../../../shared/api/sidecar";
import NoteCard from "../../entries/ui/NoteCard";

interface TagViewProps {
  tag: string;
  entries: EntrySummary[];
  folders: Folder[];
  onOpenEntry: (id: number) => void;
  onOpenTag: (tag: string) => void;
  /** Back to the folder the tag space was opened from. */
  onBack: () => void;
}

/**
 * The tag space: every note with this tag, across all folders — opened by
 * clicking a tag in the sidebar, a folder's tag chips, or a note's tags.
 * Derived from data the workspace already holds, like the folder view.
 */
export default function TagView({
  tag,
  entries,
  folders,
  onOpenEntry,
  onOpenTag,
  onBack,
}: TagViewProps) {
  const folderName = (folderId: number) =>
    folders.find((folder) => folder.id === folderId)?.name ?? "Inbox";
  const folderCount = new Set(entries.map((entry) => entry.folderId)).size;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="mx-auto w-full max-w-3xl flex-none px-8 pb-6 pt-10">
        <button
          type="button"
          onClick={onBack}
          className="cursor-pointer text-sm font-medium text-ink-mute hover:text-ink dark:text-paper-mute dark:hover:text-paper"
        >
          ← Back
        </button>
        <h1 className="mt-3 min-w-0 truncate text-2xl font-semibold tracking-tight text-ink dark:text-paper">
          <span className="text-ink-faint dark:text-paper-faint">#</span>
          {tag}
        </h1>
        <p className="mt-1 text-xs text-ink-mute dark:text-paper-mute">
          {entries.length} {entries.length === 1 ? "note" : "notes"} across{" "}
          {folderCount} {folderCount === 1 ? "folder" : "folders"}
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <ul className="mx-auto w-full max-w-3xl space-y-2 px-8 pb-12">
          {entries.map((entry) => (
            <NoteCard
              key={entry.id}
              entry={entry}
              contextLabel={folderName(entry.folderId)}
              activeTag={tag}
              onOpen={() => onOpenEntry(entry.id)}
              onOpenTag={onOpenTag}
            />
          ))}
        </ul>

        {entries.length === 0 && (
          <p className="px-8 py-6 text-center text-xs text-ink-mute dark:text-paper-mute">
            No notes use this tag anymore.
          </p>
        )}
      </div>
    </div>
  );
}
