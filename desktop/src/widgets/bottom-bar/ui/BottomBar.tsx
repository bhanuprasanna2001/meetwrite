import type { Settings } from "../../../shared/api/sidecar";
import type { NoteView } from "../../../shared/lib/download";
import { FONT_LABELS, nextFont, nextSize } from "../../../shared/lib/fonts";
import type { WindowMode } from "../../../shared/platform/window";
import type { Caps } from "../../../app/model/caps";
import type { NoteMode } from "../../../features/notes/ui/NoteEditor";
import CopyButton from "../../../shared/ui/CopyButton";

/**
 * The workspace's one-bar layout:
 *
 *   [?] [16px] [font] …gap… [Record] [Human|Enhanced] [Enhance] [Download]
 *   [N F M] [New Entry] [History] [◐] [⚙]
 *
 * Human ↔ Enhanced is a fidget like the font size: it shows the current
 * version, and one click opens the version list (Human + every enhanced
 * version). Enhance next to it opens the template picker — one pick runs
 * the AI rewrite, as often as wanted. N / F / M pick the window state;
 * hovering a letter shows its full name. New Entry, History, and ⚙
 * drive the note surface and hide in meeting mode.
 *
 * Notes-only mode hides every AI control: Record, Human ↔ Enhanced,
 * and Enhance. The Meeting window state stays — it is a note-taking
 * layout, not an AI feature.
 */

// Hover is text-only: blackest in light mode, whitest in dark mode — no
// background highlight boxes anywhere (the freewrite look).
const ACTION =
  "cursor-pointer px-2 py-1 font-medium text-ink-mute " +
  "hover:text-ink dark:text-paper-mute dark:hover:text-paper";

/** A control in its "on" state (the shown note version, window state, …). */
const ACTION_ON = "px-2 py-1 font-medium text-ink dark:text-paper";

/** The ◐ glyph renders much larger than ⚙ in the system font, so both are SVG
 * icons of the same box size; currentColor keeps the text-only hover. */
function ThemeIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M8 1.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="M8 1.5a6.5 6.5 0 0 1 0 13Z" fill="currentColor" />
    </svg>
  );
}

/** The Write|Preview toggle: a pencil in write mode, an open book in
 * preview — the same one-button feel as the theme toggle. */
function PencilIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11.3 2.7a1.5 1.5 0 0 1 2.1 2.1L5.5 12.7 2 14l1.3-3.5 8-7.8Z" />
    </svg>
  );
}

function BookIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 3.5c-1.5-1.5-3.5-2-6-2v11c2.5 0 4.5.5 6 2 1.5-1.5 3.5-2 6-2v-11c-2.5 0-4.5.5-6 2Z" />
      <path d="M8 3.5v11" />
    </svg>
  );
}

function PhotoIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
      <circle cx="5.5" cy="6.5" r="1.5" />
      <path d="m2.5 12 3.5-3.5 2.5 2.5 2-2 3 3" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <rect x="6" y="1.5" width="4" height="7.5" rx="2" />
      <path d="M3 7.5a5 5 0 0 0 10 0M8 12.5V15M5.5 15h5" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="3.5" y="3.5" width="9" height="9" rx="1.5" fill="currentColor" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

interface BottomBarProps {
  settings: Settings;
  /** The one capability gate — notes-only mode hides every AI control. */
  caps: Caps;
  onChange: (next: Settings) => void;
  /** Open the keyboard-shortcuts overlay (the ? button). */
  onHelp: () => void;
  onNewEntry: () => void;
  onToggleHistory: () => void;
  historyOpen: boolean;
  windowMode: WindowMode;
  onWindowMode: (mode: WindowMode) => void;
  onOpenSettings: () => void;
  recording: boolean;
  /** True while the recording finalizes after Stop; the button shows it. */
  stopping: boolean;
  keySet: boolean;
  /** The text the Copy button copies (the shown note version). */
  copyText: string;
  /** The shown note version (the Human ↔ Enhanced fidget). */
  view: NoteView;
  enhancing: boolean;
  enhanceEnabled: boolean;
  onPickVersion: () => void;
  onEnhance: () => void;
  /** Download the shown version as a .md file. */
  onDownload: () => void;
  onRecord: () => void;
  /** Write|Preview — one toggle button, like the theme button. */
  noteMode: NoteMode;
  onNoteModeChange: (mode: NoteMode) => void;
  /** The human note accepts pictures; enhanced versions never do. */
  insertImages: boolean;
  /** True while the picture batch uploads — the button shows it. */
  addingImages: boolean;
  /** The one picture path — clicks the app's hidden file input. */
  onPickImages: () => void;
}

/** A control that needs the OpenAI key; disabled with a pointer to Settings. */
const NEEDS_KEY = "disabled:cursor-not-allowed disabled:opacity-40";

export default function BottomBar({
  settings,
  caps,
  onChange,
  onHelp,
  onNewEntry,
  onToggleHistory,
  historyOpen,
  windowMode,
  onWindowMode,
  onOpenSettings,
  recording,
  stopping,
  keySet,
  copyText,
  view,
  enhancing,
  enhanceEnabled,
  onPickVersion,
  onEnhance,
  onDownload,
  onRecord,
  noteMode,
  onNoteModeChange,
  insertImages,
  addingImages,
  onPickImages,
}: BottomBarProps) {
  const { noteFont, noteFontSize, theme } = settings;
  const meetingMode = windowMode === "meeting";

  // One button, two faces: the pencil in write mode, the open book in
  // preview — clicking flips modes, exactly like the theme button.
  const modeTitle = noteMode === "write" ? "Preview note" : "Write note";

  return (
    <footer
      className="group flex h-11 flex-none items-center gap-1 border-t border-ink-line bg-ink-surface px-3 text-xs dark:border-paper-line dark:bg-paper-surface"
      // Bottom-bar clicks (Record, Mode, …) never collapse the meeting boxes;
      // only clicking the note surface does (the root's outside-click).
      onClick={(event) => event.stopPropagation()}
    >
      <button type="button" className={ACTION} title="Keyboard shortcuts" onClick={onHelp}>
        ?
      </button>
      <CopyButton text={copyText} className="px-2 py-1" />
      <button
        type="button"
        className={ACTION}
        title="Font size (note only)"
        onClick={() => onChange({ ...settings, noteFontSize: nextSize(noteFontSize) })}
      >
        {noteFontSize}px
      </button>
      <button
        type="button"
        className={ACTION}
        title="Font family (note only)"
        onClick={() => onChange({ ...settings, noteFont: nextFont(noteFont) })}
      >
        {FONT_LABELS[noteFont]}
      </button>
      {/* One button, two faces — the pencil in write mode, the open book in
          preview. Clicking flips modes, exactly like the theme button. */}
      <button
        type="button"
        className={noteMode === "preview" ? ACTION_ON : ACTION}
        title={modeTitle}
        aria-label={modeTitle}
        onClick={() => onNoteModeChange(noteMode === "write" ? "preview" : "write")}
      >
        {noteMode === "write" ? <BookIcon /> : <PencilIcon />}
      </button>
      {insertImages && (
        <button
          type="button"
          className={ACTION}
          disabled={addingImages}
          title="Add a picture (or paste / drop one)"
          aria-label="Add a picture"
          onClick={onPickImages}
        >
          {addingImages ? (
            <span className="text-[10px] font-medium">…</span>
          ) : (
            <PhotoIcon />
          )}
        </button>
      )}

      {/* The gap is the window drag handle; hovering the bar reveals a small
          hint in the middle (pointer-events-none so it never eats the drag).
          Meeting and fullscreen hide it — the window is exactly where the
          user wants it. */}
      <div
        className="flex flex-1 items-center justify-center self-stretch"
        data-tauri-drag-region
      >
        {windowMode === "normal" && (
          <span className="pointer-events-none text-[10px] font-medium tracking-wide text-ink-faint opacity-0 transition-opacity group-hover:opacity-100 dark:text-paper-mute">
            Drag to move
          </span>
        )}
      </div>

      {caps.ai && (
        <button
          type="button"
          className={`${recording ? ACTION_ON : ACTION} ${NEEDS_KEY} disabled:cursor-not-allowed`}
          disabled={!keySet || stopping}
          title={
            !keySet
              ? "Set an API key in Settings first"
              : stopping
                ? "Stopping the recording…"
                : recording
                  ? "Stop recording"
                  : "Record the meeting (meeting mode + live transcript)"
          }
          onClick={onRecord}
        >
          {stopping ? "…" : recording ? <StopIcon /> : <MicIcon />}
        </button>
      )}
      {/* The note-version fidget: shows the current version, one click opens
          the version list — the same feel as the font-size fidget. */}
      {caps.ai && (
        <button
          type="button"
          className={`${ACTION} disabled:cursor-not-allowed disabled:opacity-40`}
          disabled={enhancing}
          title="Choose a note version (Human ↔ Enhanced)"
          onClick={onPickVersion}
        >
          {view === "human" ? "Human" : "Enhanced"}
        </button>
      )}
      {/* Enhance opens the template picker; a pick runs the AI rewrite, as
          often as wanted. */}
      {caps.ai && (
        <button
          type="button"
          className={`${ACTION} ${NEEDS_KEY}`}
          disabled={!keySet || !enhanceEnabled || enhancing}
          title={
            !keySet
              ? "Set an API key in Settings first"
              : !enhanceEnabled
                ? "Write some notes or record first"
                : "Rewrite the notes with AI"
          }
          onClick={onEnhance}
        >
          {enhancing ? "Enhance…" : "Enhance"}
        </button>
      )}
      <button
        type="button"
        className={ACTION}
        title="Download this version as .md"
        onClick={onDownload}
      >
        Download
      </button>
      <button
        type="button"
        className={windowMode === "normal" ? ACTION_ON : ACTION}
        title="Normal window"
        onClick={() => onWindowMode("normal")}
      >
        N
      </button>
      <button
        type="button"
        className={windowMode === "fullscreen" ? ACTION_ON : ACTION}
        title="Full screen"
        onClick={() => onWindowMode("fullscreen")}
      >
        F
      </button>
      <button
        type="button"
        className={windowMode === "meeting" ? ACTION_ON : ACTION}
        title="Meeting mode — right third of the screen"
        onClick={() => onWindowMode("meeting")}
      >
        M
      </button>
      {!meetingMode && (
        <>
          <button type="button" className={ACTION} title="New note" onClick={onNewEntry}>
            New Entry
          </button>
          <button
            type="button"
            className={historyOpen ? ACTION_ON : ACTION}
            title="History"
            onClick={onToggleHistory}
          >
            History
          </button>
        </>
      )}
      <button
        type="button"
        className={ACTION}
        title={theme === "light" ? "Switch to dark" : "Switch to light"}
        onClick={() => onChange({ ...settings, theme: theme === "light" ? "dark" : "light" })}
      >
        <ThemeIcon />
      </button>
      {!meetingMode && (
        <button type="button" className={ACTION} title="Settings" onClick={onOpenSettings}>
          <GearIcon />
        </button>
      )}
    </footer>
  );
}
