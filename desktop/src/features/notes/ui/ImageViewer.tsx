import { useState } from "react";
import { entryImageUrl } from "../../../shared/api/sidecar";

interface ImageViewerProps {
  entryId: number;
  imageId: number;
  /** The picture's current title (null = untitled). */
  title: string | null;
  /** Commit a new title (null clears it). */
  onRename: (title: string | null) => void;
  onDelete: () => void;
  onClose: () => void;
}

/**
 * The one place a picture is seen large and the one place its title is
 * edited — every thumbnail and preview click lands here. Renaming follows
 * the sidebar pattern: Enter commits, Escape cancels, blur commits once.
 */
export default function ImageViewer({
  entryId,
  imageId,
  title,
  onRename,
  onDelete,
  onClose,
}: ImageViewerProps) {
  const [draft, setDraft] = useState(title ?? "");

  // Blur is the one commit point (Enter just blurs), so a commit can never
  // fire twice. Comparing against the server truth keeps retry possible:
  // after a failed save the title prop is unchanged, so the next blur
  // re-attempts the same value.
  const commit = () => {
    const next = draft.trim() || null;
    if (next === title) return;
    onRename(next);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/60 p-10"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title ?? "Picture"}
        className="flex max-h-full max-w-4xl flex-col items-center gap-3"
        onClick={(event) => event.stopPropagation()}
      >
        <img
          src={entryImageUrl(entryId, imageId)}
          alt={title ?? ""}
          className="max-h-[72vh] max-w-full rounded-xl object-contain shadow-2xl"
        />
        <div className="flex w-full max-w-md items-center gap-3">
          <input
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") onClose();
            }}
            placeholder="Untitled picture"
            aria-label="Picture title"
            className="min-w-0 flex-1 border-b border-paper-line bg-transparent pb-1 text-center text-sm text-paper outline-none placeholder:text-paper-mute focus:border-paper-soft"
          />
          <button
            type="button"
            onClick={onDelete}
            title="Delete this picture"
            className="flex-none cursor-pointer rounded-lg border border-paper-line px-3 py-1.5 text-xs font-medium text-paper-dim hover:text-paper"
          >
            Delete
          </button>
          <button
            type="button"
            onClick={onClose}
            title="Close (Esc)"
            className="flex-none cursor-pointer rounded-lg border border-paper-line px-3 py-1.5 text-xs font-medium text-paper-dim hover:text-paper"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
