import { SHORTCUTS, WINDOW_MODES } from "../../../shared/platform/shortcuts";
import type { Caps } from "../../../app/model/caps";

/**
 * The ? help overlay: every shortcut plus the
 * three window states, so the app is discoverable without a menu bar.
 * AI-only rows hide in notes-only mode.
 * Closes on Esc (App's global keydown handler), a second ? click, or a
 * click on the dimmed backdrop. Focus returns to the opening control.
 */
export default function HelpOverlay({
  caps,
  onClose,
}: {
  caps: Caps;
  onClose: () => void;
}) {
  const shortcuts = SHORTCUTS.filter((shortcut) => !shortcut.aiOnly || caps.ai);
  const windowModes = WINDOW_MODES.filter((mode) => !("aiOnly" in mode) || caps.ai);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        tabIndex={-1}
        autoFocus
        className="max-h-[85vh] w-[400px] overflow-y-auto rounded-xl border border-ink-line bg-paper shadow-2xl dark:border-paper-line dark:bg-ink"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="border-b border-ink-line px-5 py-4 dark:border-paper-line">
          <h2 className="text-sm font-semibold text-ink dark:text-paper">Keyboard shortcuts</h2>
        </header>
        <ul className="px-5 py-3">
          {shortcuts.map((shortcut) => (
            <li key={shortcut.keys} className="flex items-center justify-between gap-6 py-1">
              <span className="text-sm text-ink-soft dark:text-paper">{shortcut.label}</span>
              <kbd className="rounded-md border border-ink-line bg-ink-surface px-1.5 py-0.5 text-[11px] font-medium text-ink-mute dark:border-paper-line dark:bg-paper-surface dark:text-paper-mute">
                {shortcut.keys}
              </kbd>
            </li>
          ))}
        </ul>

        <header className="border-y border-ink-line px-5 py-3 dark:border-paper-line">
          <h2 className="text-sm font-semibold text-ink dark:text-paper">Window modes</h2>
        </header>
        <ul className="px-5 py-3">
          {windowModes.map((mode) => (
            <li key={mode.name} className="flex items-baseline justify-between gap-6 py-1">
              <span className="text-sm font-medium text-ink-soft dark:text-paper">
                {mode.name}
              </span>
              <span className="text-right text-xs text-ink-mute dark:text-paper-mute">
                {mode.detail}
              </span>
            </li>
          ))}
        </ul>
        <p className="px-5 pb-4 text-xs text-ink-faint dark:text-paper-mute">
          Cycled with the Mode button (N · F · M) in the bottom bar.
        </p>
      </section>
    </div>
  );
}
