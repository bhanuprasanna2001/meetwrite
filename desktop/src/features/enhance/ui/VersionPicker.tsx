import { useMemo, useState } from "react";
import type { EnhancedVersion, Template } from "../../../shared/api/sidecar";
import { moveSelection } from "../../../shared/lib/selection";
import { newestFirst, versionLabel, versionTemplateName } from "../model/versions";

/**
 * The note-version picker — the same brick + list design as the ⌘K palette
 * and the enhance picker. The Human notes are always the first row; below
 * them every enhanced version, newest first, with its AI-generated title.
 */

interface VersionPickerProps {
  versions: EnhancedVersion[];
  templates: Template[];
  /** The version currently shown; null means the Human notes. */
  activeVersionId: number | null;
  onClose: () => void;
  onSelect: (versionId: number | null) => void;
}

export default function VersionPicker({
  versions,
  templates,
  activeVersionId,
  onClose,
  onSelect,
}: VersionPickerProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);

  // Human is pinned on top; the query filters the versions below it.
  const ordered = newestFirst(versions);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return ordered;
    return ordered.filter((version) => versionLabel(version).toLowerCase().includes(needle));
  }, [ordered, query]);
  const safeSelection = Math.min(selected, filtered.length);

  const run = (versionId: number | null) => {
    onClose();
    onSelect(versionId);
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-black/40 pt-24" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Choose a note version"
        className="flex h-fit max-h-[65vh] w-[560px] flex-col overflow-hidden rounded-xl border border-ink-line bg-paper shadow-2xl dark:border-paper-line dark:bg-ink"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-none items-center gap-2.5 border-b border-ink-line px-4 py-3 dark:border-paper-line">
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setSelected((current) => moveSelection(current, 1, filtered.length + 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setSelected((current) => moveSelection(current, -1, filtered.length + 1));
              } else if (event.key === "Enter") {
                run(safeSelection === 0 ? null : filtered[safeSelection - 1].id);
              }
            }}
            placeholder="Choose a note version…"
            aria-label="Choose a note version"
            className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint dark:text-paper dark:placeholder:text-paper-mute"
          />
        </div>

        <ul className="min-h-0 overflow-y-auto py-1">
          <li>
            <button
              type="button"
              onMouseEnter={() => setSelected(0)}
              onClick={() => run(null)}
              className={`block w-full truncate px-4 py-2 text-left text-sm ${
                safeSelection === 0
                  ? "bg-ink-line/60 text-ink dark:bg-paper-line/25 dark:text-paper"
                  : "text-ink-soft dark:text-paper-mute"
              }`}
            >
              Human
              {activeVersionId === null && (
                <span className="ml-2 text-xs text-ink-mute dark:text-paper-mute">shown</span>
              )}
            </button>
          </li>
          {filtered.map((version, index) => (
            <li key={version.id}>
              <button
                type="button"
                onMouseEnter={() => setSelected(index + 1)}
                onClick={() => run(version.id)}
                className={`block w-full px-4 py-2 text-left ${
                  safeSelection === index + 1
                    ? "bg-ink-line/60 dark:bg-paper-line/25"
                    : ""
                }`}
              >
                <span
                  className={`block truncate text-sm ${
                    safeSelection === index + 1 ? "text-ink dark:text-paper" : "text-ink-soft dark:text-paper-mute"
                  }`}
                >
                  {versionLabel(version)}
                  {version.id === activeVersionId && (
                    <span className="ml-2 text-xs text-ink-mute dark:text-paper-mute">shown</span>
                  )}
                </span>
                <span className="block truncate text-xs text-ink-mute dark:text-paper-mute">
                  {versionTemplateName(templates, version) ?? "Enhanced"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
