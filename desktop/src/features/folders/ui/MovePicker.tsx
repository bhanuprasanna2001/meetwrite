import type { Folder } from "../../../shared/api/sidecar";

interface MovePickerProps {
  folders: Folder[];
  /** The note's current folder — marked, not selectable. */
  currentFolderId: number;
  onMove: (folderId: number) => void;
  onClose: () => void;
}

/**
 * One list of folders; clicking one moves the current note there and
 * closes. The current folder is disabled — a move is always a real change.
 */
export default function MovePicker({
  folders,
  currentFolderId,
  onMove,
  onClose,
}: MovePickerProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-36" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Move to folder"
        className="max-h-[60vh] w-[420px] overflow-hidden rounded-xl border border-ink-line bg-paper shadow-2xl dark:border-paper-line dark:bg-ink"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="border-b border-ink-line px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-ink-mute dark:border-paper-line dark:text-paper-mute">
          Move to folder
        </p>
        <ul className="max-h-[50vh] overflow-y-auto py-1">
          {folders.map((folder) => {
            const isCurrent = folder.id === currentFolderId;
            return (
              <li key={folder.id}>
                <button
                  type="button"
                  disabled={isCurrent}
                  onClick={() => onMove(folder.id)}
                  className="flex w-full cursor-pointer items-center justify-between px-4 py-2 text-left text-sm text-ink-soft hover:bg-ink-line/40 hover:text-ink disabled:cursor-default disabled:text-ink-faint disabled:hover:bg-transparent dark:text-paper-soft dark:hover:bg-paper-line/15 dark:hover:text-paper dark:disabled:text-paper-faint dark:disabled:hover:bg-transparent"
                >
                  <span className="truncate">{folder.name}</span>
                  {isCurrent && (
                    <span className="flex-none text-[11px] text-ink-mute dark:text-paper-mute">
                      Current
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
