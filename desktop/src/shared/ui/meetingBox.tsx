/** Shared chrome for the three meeting boxes (chat + transcript + audio):
 * taller than the original h-56 so long threads and transcripts get room to
 * breathe. The audio box is the short one — just the player. */
export const BOX =
  "flex h-72 min-w-0 flex-1 flex-col rounded-lg border border-ink-line " +
  "bg-ink-surface dark:border-paper-line dark:bg-paper-surface";

export const AUDIO_BOX =
  "flex h-14 min-w-0 flex-1 flex-col justify-center rounded-lg border " +
  "border-ink-line bg-ink-surface px-4 dark:border-paper-line dark:bg-paper-surface";

/**
 * The compact panels' shared 16px header controls — one stroke style, like
 * History's row controls. Kept here so Chat, Transcript, and Audio agree.
 */
export function BackIcon() {
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
      <path d="M10 3 5 8l5 5" />
    </svg>
  );
}

export function CloseIcon() {
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
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

export function ExpandIcon() {
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
      <path d="M6.5 2.5H2.5v4M2.5 2.5l4 4M9.5 13.5h4v-4M13.5 13.5l-4-4" />
    </svg>
  );
}
