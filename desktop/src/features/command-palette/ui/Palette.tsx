import { useEffect, useMemo, useState } from "react";
import {
  moveSelection,
  paletteItems,
  type PaletteContext,
  type PaletteItem,
} from "../model/palette";

/**
 * The ⌘K palette: one centered "brick" (~560px) floating near the top — a
 * borderless input above grouped rows (Notes, Chats in this note,
 * Navigation, Actions, Settings). Real combobox semantics: the input keeps
 * focus, ↑/↓ move one row (wrapping), ↵ runs it, Esc closes (the app-level
 * cascade). Clicking a row runs it too. The dimmed backdrop closes; the
 * component mounts fresh on every open, so the query starts empty.
 */

/** A stroke magnifier in the app's 16px icon box. */
function MagnifierIcon() {
  return (
    <svg
      className="h-4 w-4 flex-none text-ink-mute dark:text-paper-mute"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="7" cy="7" r="4.25" />
      <path d="m10.25 10.25 3.25 3.25" />
    </svg>
  );
}

/** A document glyph — marks note rows so they read as "open this note". */
function NoteIcon() {
  return (
    <svg
      className="h-3.5 w-3.5 flex-none text-ink-mute dark:text-paper-mute"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 1.5h5.5L13 5v9.5H4a1.5 1.5 0 0 1-1.5-1.5V3A1.5 1.5 0 0 1 4 1.5Z" />
      <path d="M9.5 1.5V5H13" />
    </svg>
  );
}

/** A speech bubble — marks chat rows. */
function ChatGlyph() {
  return (
    <svg
      className="h-3.5 w-3.5 flex-none text-ink-mute dark:text-paper-mute"
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

/** A run chevron — marks command rows as "this does something". */
function RunIcon() {
  return (
    <svg
      className="h-3.5 w-3.5 flex-none text-ink-faint dark:text-paper-faint"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 3.5 11 8l-5 4.5" />
    </svg>
  );
}

/** One listbox row: a group label, or one selectable option. */
type Row =
  | { kind: "header"; name: string }
  | { kind: "option"; item: PaletteItem; index: number };

interface PaletteProps extends PaletteContext {
  onClose: () => void;
  onRun: (item: PaletteItem) => void;
}

export default function Palette(props: PaletteProps) {
  const { onClose, onRun, ...context } = props;
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);

  const groups = useMemo(() => paletteItems(query, context), [query, context]);
  const items = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  // One flat row list for the listbox: a header row, then its options with
  // stable indexes — built once per render, never mutated in place.
  const rows = useMemo(() => {
    const result: Row[] = [];
    let next = 0;
    for (const group of groups) {
      result.push({ kind: "header", name: group.name });
      for (const item of group.items) {
        result.push({ kind: "option", item, index: next });
        next += 1;
      }
    }
    return result;
  }, [groups]);

  // Typing can shrink the list; derive a safe cursor without a syncing effect.
  const safeSelected = items.length > 0 ? selected % items.length : 0;

  // Arrows wrap the selection; scrolling must follow it, or the cursor can
  // land on an option that is not on screen.
  useEffect(() => {
    if (items.length === 0) return;
    document
      .getElementById(`palette-option-${safeSelected}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [safeSelected, items.length]);

  const run = (item: PaletteItem) => {
    onClose();
    onRun(item);
  };

  const itemKey = (item: PaletteItem) =>
    item.kind === "entry"
      ? `entry-${item.id}`
      : item.kind === "chat"
        ? `chat-${item.id}`
        : `action-${item.id}-${item.folderId ?? ""}`;

  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-black/40 pt-24" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search notes and actions"
        className="flex h-fit max-h-[65vh] w-[560px] flex-col overflow-hidden rounded-xl border border-ink-line bg-paper shadow-2xl dark:border-paper-line dark:bg-ink"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-none items-center gap-2.5 border-b border-ink-line px-4 py-3 dark:border-paper-line">
          <MagnifierIcon />
          <input
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-listbox"
            aria-activedescendant={
              items.length > 0 ? `palette-option-${safeSelected}` : undefined
            }
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelected(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setSelected((current) => moveSelection(current, 1, items.length));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setSelected((current) => moveSelection(current, -1, items.length));
              } else if (event.key === "Enter") {
                const item = items[safeSelected];
                if (item) run(item);
              }
            }}
            placeholder="Search notes and actions…"
            aria-label="Search notes and actions"
            className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint dark:text-paper dark:placeholder:text-paper-mute"
          />
        </div>

        <ul id="palette-listbox" role="listbox" aria-label="Results" className="min-h-0 overflow-y-auto px-1.5 py-1">
          {rows.map((row) =>
            row.kind === "header" ? (
              <li key={row.name} role="presentation">
                <p className="px-2.5 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-widest text-ink-mute dark:text-paper-mute">
                  {row.name}
                </p>
              </li>
            ) : row.item.kind === "entry" ? (
              <button
                key={itemKey(row.item)}
                type="button"
                role="option"
                id={`palette-option-${row.index}`}
                aria-selected={row.index === safeSelected}
                onMouseEnter={() => setSelected(row.index)}
                onClick={() => run(row.item)}
                className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left ${
                  row.index === safeSelected
                    ? "bg-ink-line/60 dark:bg-paper-line/25"
                    : ""
                }`}
              >
                <NoteIcon />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-ink dark:text-paper">
                    {row.item.title}
                  </span>
                  <span className="block truncate text-[11px] text-ink-mute dark:text-paper-mute">
                    {row.item.hint}
                  </span>
                </span>
              </button>
            ) : row.item.kind === "chat" ? (
              <button
                key={itemKey(row.item)}
                type="button"
                role="option"
                id={`palette-option-${row.index}`}
                aria-selected={row.index === safeSelected}
                onMouseEnter={() => setSelected(row.index)}
                onClick={() => run(row.item)}
                className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm ${
                  row.index === safeSelected
                    ? "bg-ink-line/60 text-ink dark:bg-paper-line/25 dark:text-paper"
                    : "text-ink-soft dark:text-paper-soft"
                }`}
              >
                <ChatGlyph />
                <span className="min-w-0 flex-1 truncate">{row.item.label}</span>
              </button>
            ) : (
              <button
                key={itemKey(row.item)}
                type="button"
                role="option"
                id={`palette-option-${row.index}`}
                aria-selected={row.index === safeSelected}
                onMouseEnter={() => setSelected(row.index)}
                onClick={() => run(row.item)}
                className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm ${
                  row.index === safeSelected
                    ? "bg-ink-line/60 text-ink dark:bg-paper-line/25 dark:text-paper"
                    : "text-ink-soft dark:text-paper-soft"
                }`}
              >
                <RunIcon />
                <span className="min-w-0 flex-1 truncate">{row.item.label}</span>
                {row.item.hint && (
                  <kbd className="flex-none rounded border border-ink-line px-1.5 py-px text-[10px] text-ink-mute dark:border-paper-line dark:text-paper-mute">
                    {row.item.hint}
                  </kbd>
                )}
              </button>
            ),
          )}
          {items.length === 0 && (
            <li className="px-4 py-3 text-sm text-ink-mute dark:text-paper-mute">No results</li>
          )}
        </ul>
      </div>
    </div>
  );
}
