import { useState } from "react";

/** A boxed check — the row's selection state in the tag list. */
function CheckGlyph({ checked }: { checked: boolean }) {
  return (
    <svg
      className={`h-3.5 w-3.5 flex-none ${
        checked ? "text-ink dark:text-paper" : "text-ink-faint dark:text-paper-faint"
      }`}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2" y="2" width="12" height="12" rx="3" />
      {checked && <path d="m5.5 8.5 1.8 1.8 3.4-3.6" strokeWidth="1.8" />}
    </svg>
  );
}

/** The magnifier that marks the picker's search row. */
function SearchIcon() {
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
      <circle cx="7" cy="7" r="4.25" />
      <path d="m10.3 10.3 3.2 3.2" />
    </svg>
  );
}

interface TagPickerProps {
  /** Every known tag, listed alphabetically by the caller. */
  tags: string[];
  /** The chosen ones — checked in the list. */
  selected: string[];
  onToggle: (tag: string) => void;
  /** A brand-new tag the user typed (offered only when it doesn't exist). */
  onAdd: (tag: string) => void;
  /** When given, checked rows get a trailing × that removes the tag from
   * the selection — in the tag editor that means "off THIS note only". */
  onRemove?: (tag: string) => void;
}

/**
 * The one tag-selection surface, shared by the editor and the folder
 * filter: a search field above a scrollable list. The flow is exact:
 * clicking a row toggles it; Enter on an exact name toggles it; Enter (or
 * the "Create …" row) on an unknown name adds it as a checked row and
 * clears the field.
 */
export default function TagPicker({
  tags,
  selected,
  onToggle,
  onAdd,
  onRemove,
}: TagPickerProps) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  // Known tags plus any selected ones the caller doesn't know yet — a tag
  // created this session shows up as a checked row the moment it is added.
  const list = [...new Set([...tags, ...selected])].sort();
  const visible = list.filter((tag) => tag.toLowerCase().includes(needle));
  const unknown = needle !== "" && !list.some((tag) => tag.toLowerCase() === needle);

  const create = () => {
    const name = query.trim();
    if (!name) return;
    onAdd(name);
    setQuery(""); // The fresh tag now appears as a checked row below.
  };

  return (
    <div>
      <div className="flex items-center gap-2 border-b border-ink-line px-4 py-2.5 dark:border-paper-line">
        <span className="text-ink-faint dark:text-paper-mute">
          <SearchIcon />
        </span>
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || needle === "") return;
            event.preventDefault();
            const exact = list.find((tag) => tag.toLowerCase() === needle);
            if (exact !== undefined) {
              onToggle(exact);
            } else {
              create();
            }
          }}
          placeholder="Search or add a tag"
          aria-label="Search or add a tag"
          className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint dark:text-paper dark:placeholder:text-paper-mute"
        />
      </div>
      <ul className="max-h-64 overflow-y-auto py-1">
        {unknown && (
          <li>
            <button
              type="button"
              onClick={create}
              className="flex w-full cursor-pointer items-center gap-2.5 px-4 py-2 text-left text-sm text-ink-soft hover:bg-ink-line/40 hover:text-ink dark:text-paper-soft dark:hover:bg-paper-line/15 dark:hover:text-paper"
            >
              <span className="flex-none text-ink-faint dark:text-paper-faint">+</span>
              <span className="min-w-0 flex-1 truncate">Create “{query.trim()}”</span>
            </button>
          </li>
        )}
        {visible.map((tag) => (
          <li
            key={tag}
            className="group/row flex items-stretch hover:bg-ink-line/40 dark:hover:bg-paper-line/15"
          >
            <button
              type="button"
              onClick={() => onToggle(tag)}
              aria-pressed={selected.includes(tag)}
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 px-4 py-2 text-left text-sm text-ink-soft group-hover/row:text-ink dark:text-paper-soft dark:group-hover/row:text-paper"
            >
              <CheckGlyph checked={selected.includes(tag)} />
              <span className="min-w-0 flex-1 truncate">{tag}</span>
            </button>
            {onRemove && selected.includes(tag) && (
              <button
                type="button"
                onClick={() => onRemove(tag)}
                aria-label={`Remove ${tag} from this note`}
                title={`Remove #${tag} from this note`}
                className="flex flex-none cursor-pointer items-center px-3 text-ink-faint transition-colors hover:text-ink dark:text-paper-mute dark:hover:text-paper"
              >
                ×
              </button>
            )}
          </li>
        ))}
        {visible.length === 0 && !unknown && (
          <li className="px-4 py-3 text-xs text-ink-faint dark:text-paper-faint">
            {tags.length === 0
              ? "No tags yet — search above to create your first one."
              : "No tags match your search."}
          </li>
        )}
      </ul>
    </div>
  );
}
