import { useState } from "react";
import TagPicker from "../../tags/ui/TagPicker";

interface TagEditorProps {
  /** The note's current tags — the starting set. */
  initial: string[];
  /** Every known tag, offered as a searchable, selectable list. */
  suggestions: string[];
  onSave: (tags: string[]) => void;
  onClose: () => void;
}

/**
 * The tag editor: one searchable list of THIS note's tags. Clicking a row
 * checks or unchecks it, Enter (or the "Create …" row) on an unknown name
 * adds a brand-new tag as a checked row, and a checked row's × takes it
 * back off this note. Saving replaces the whole set in one request —
 * nothing is written until then. Deleting a tag everywhere lives in the
 * sidebar's Tags section, not here.
 */
export default function TagEditor({
  initial,
  suggestions,
  onSave,
  onClose,
}: TagEditorProps) {
  const [values, setValues] = useState<string[]>(initial);
  const allTags = [...new Set([...suggestions, ...initial])].sort();

  const toggle = (tag: string) => {
    setValues((current) =>
      current.includes(tag) ? current.filter((value) => value !== tag) : [...current, tag],
    );
  };

  const add = (tag: string) => {
    const cleaned = tag.trim();
    if (!cleaned) return;
    setValues((current) => (current.includes(cleaned) ? current : [...current, cleaned]));
  };

  // The × on a checked row: take this tag off THIS note only. The change
  // is local until Save — Cancel leaves the note's tags untouched.
  const removeTag = (tag: string) => {
    setValues((current) => current.filter((value) => value !== tag));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-32" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Edit tags"
        className="w-[420px] overflow-hidden rounded-xl border border-ink-line bg-paper shadow-2xl dark:border-paper-line dark:bg-ink"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-ink-line px-4 py-3 dark:border-paper-line">
          <h2 className="text-sm font-semibold text-ink dark:text-paper">Tags</h2>
          <p className="text-xs text-ink-mute dark:text-paper-mute">
            {values.length} selected
          </p>
        </header>

        <TagPicker
          tags={allTags}
          selected={values}
          onToggle={toggle}
          onAdd={add}
          onRemove={removeTag}
        />

        <footer className="flex justify-end gap-2 border-t border-ink-line px-3 py-2.5 dark:border-paper-line">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-lg px-3 py-1.5 text-xs font-medium text-ink-mute hover:bg-ink-line/40 hover:text-ink dark:text-paper-mute dark:hover:bg-paper-line/15 dark:hover:text-paper"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave(values)}
            className="cursor-pointer rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-paper hover:bg-ink-soft dark:bg-paper dark:text-ink dark:hover:bg-paper-soft"
          >
            Save
          </button>
        </footer>
      </div>
    </div>
  );
}
