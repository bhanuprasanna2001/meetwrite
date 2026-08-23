import { useMemo, useState } from "react";
import type { Template } from "../../../shared/api/sidecar";
import { moveSelection } from "../../../shared/lib/selection";
import { filterTemplates } from "../model/templates";

/**
 * The enhance picker — the same brick + list design as the ⌘K palette, but
 * its own component. Picking a template runs
 * the enhance with it; the "Use your own instructions…" row turns the same
 * input into a free-text field whose Enter runs the enhance with those
 * instructions on top of the usual rules.
 */

/** A small sparkle in the app's 16px icon box. */
function SparkleIcon() {
  return (
    <svg
      className="h-4 w-4 flex-none text-ink-mute dark:text-paper-mute"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 2.5c.4 2.3 1.7 3.6 4 4-2.3.4-3.6 1.7-4 4-.4-2.3-1.7-3.6-4-4 2.3-.4 3.6-1.7 4-4Z" />
      <path d="M12.5 9.5c.2 1.1.8 1.7 1.9 1.9-1.1.2-1.7.8-1.9 1.9-.2-1.1-.8-1.7-1.9-1.9 1.1-.2 1.7-.8 1.9-1.9Z" />
    </svg>
  );
}

interface EnhancePickerProps {
  templates: Template[];
  onClose: () => void;
  /** Run one enhance: a template id, or null + custom instructions. */
  onEnhance: (templateId: string | null, instructions: string | null) => void;
}

export default function EnhancePicker({
  templates,
  onClose,
  onEnhance,
}: EnhancePickerProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [customMode, setCustomMode] = useState(false);

  const matches = useMemo(() => filterTemplates(templates, query), [templates, query]);
  const safeSelection = Math.min(selected, matches.length);

  const runTemplate = (templateId: string) => {
    onClose();
    onEnhance(templateId, null);
  };

  const runCustom = () => {
    const instructions = query.trim();
    if (!instructions) return;
    onClose();
    onEnhance(null, instructions);
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-black/40 pt-24" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Enhance notes"
        className="flex h-fit max-h-[65vh] w-[560px] flex-col overflow-hidden rounded-xl border border-ink-line bg-paper shadow-2xl dark:border-paper-line dark:bg-ink"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-none items-center gap-2.5 border-b border-ink-line px-4 py-3 dark:border-paper-line">
          <SparkleIcon />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (customMode) {
                if (event.key === "Enter") runCustom();
                return;
              }
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setSelected((current) => moveSelection(current, 1, matches.length + 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setSelected((current) => moveSelection(current, -1, matches.length + 1));
              } else if (event.key === "Enter") {
                const template = matches[safeSelection];
                if (template) runTemplate(template.id);
                else if (safeSelection === matches.length) {
                  setCustomMode(true);
                  setQuery("");
                }
              }
            }}
            placeholder={
              customMode
                ? "Describe how to enhance (Enter to run)…"
                : "Choose how to enhance…"
            }
            aria-label="Choose how to enhance"
            className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint dark:text-paper dark:placeholder:text-paper-mute"
          />
        </div>

        {customMode ? (
          <p className="px-4 py-3 text-xs leading-relaxed text-ink-mute dark:text-paper-mute">
            Your instructions run on top of the usual rules — facts still come only from the
            notes and transcript.
          </p>
        ) : (
          <ul className="min-h-0 overflow-y-auto py-1">
            {matches.map((template, index) => (
              <li key={template.id}>
                <button
                  type="button"
                  onMouseEnter={() => setSelected(index)}
                  onClick={() => runTemplate(template.id)}
                  className={`block w-full px-4 py-2 text-left ${
                    index === safeSelection
                      ? "bg-ink-line/60 dark:bg-paper-line/25"
                      : ""
                  }`}
                >
                  <span
                    className={`block truncate text-sm ${
                    index === safeSelection ? "text-ink dark:text-paper" : "text-ink-soft dark:text-paper-mute"
                    }`}
                  >
                    {template.name}
                  </span>
                  <span className="block truncate text-xs text-ink-mute dark:text-paper-mute">
                    {template.description}
                  </span>
                </button>
              </li>
            ))}
            <li>
              <button
                type="button"
                onMouseEnter={() => setSelected(matches.length)}
                onClick={() => {
                  setCustomMode(true);
                  setQuery("");
                }}
                className={`block w-full truncate px-4 py-2 text-left text-sm ${
                  safeSelection === matches.length
                    ? "bg-ink-line/60 text-ink dark:bg-paper-line/25 dark:text-paper"
                    : "text-ink-soft dark:text-paper-mute"
                }`}
              >
                Use your own instructions…
              </button>
            </li>
            {matches.length === 0 && (
              <li className="px-4 py-3 text-sm text-ink-mute dark:text-paper-mute">
                No templates match
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
