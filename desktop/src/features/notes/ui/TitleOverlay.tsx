import { useEffect, useState } from "react";

interface TitleOverlayProps {
  /** The note's current title (empty when untitled) — the rename starting point. */
  initial: string;
  /** A suggested title filling the input the moment it arrives. */
  suggested: string | null;
  loading: boolean;
  onSave: (title: string | null) => void;
  onClose: () => void;
}

/**
 * One dialog for two palette commands: rename (prefilled with the current
 * title) and suggest title (the AI suggestion fills the same input when it
 * arrives — nothing is ever saved without an explicit Save).
 */
export default function TitleOverlay({
  initial,
  suggested,
  loading,
  onSave,
  onClose,
}: TitleOverlayProps) {
  const [draft, setDraft] = useState(initial);

  useEffect(() => {
    if (suggested !== null) setDraft(suggested);
  }, [suggested]);

  const save = () => onSave(draft.trim() || null);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-36" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Note title"
        className="w-[480px] rounded-xl border border-ink-line bg-paper p-4 shadow-2xl dark:border-paper-line dark:bg-ink"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-mute dark:text-paper-mute">
          Note title
        </p>
        <input
          autoFocus
          value={draft}
          disabled={loading}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") save();
          }}
          placeholder={loading ? "Suggesting…" : "Untitled"}
          aria-label="Note title"
          className="mt-2 w-full border-b border-ink-line bg-transparent pb-1 text-sm text-ink outline-none focus:border-ink-faint disabled:opacity-50 dark:border-paper-line dark:text-paper dark:focus:border-paper-faint"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium text-ink-mute hover:bg-ink-line/40 hover:text-ink dark:text-paper-mute dark:hover:bg-paper-line/15 dark:hover:text-paper"
          >
            Keep current
          </button>
          <button
            type="button"
            onClick={save}
            disabled={loading}
            className="cursor-pointer rounded-lg border border-ink-line bg-ink px-3 py-1.5 text-xs font-medium text-paper hover:bg-ink-soft disabled:opacity-50 dark:border-paper-line dark:bg-paper dark:text-ink dark:hover:bg-paper-soft"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
