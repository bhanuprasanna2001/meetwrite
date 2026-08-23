import { entryImageUrl, type EntrySummary, type OutlineImage } from "../../../shared/api/sidecar";
import { dayLabel } from "../../../shared/lib/dates";

/** The tag glyph — the hover affordance that opens the tag editor. */
function TagIcon() {
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
      <path d="M6.5 2h7.5v7.5L8 15.5 1.5 9 6.5 2Z" />
      <circle cx="5.5" cy="5.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

interface NoteCardProps {
  entry: EntrySummary;
  /** Extra context before the date — the folder name in the tag space. */
  contextLabel?: string;
  /** The tag this card is listed under, shown as the emphasized chip. */
  activeTag?: string;
  onOpen: () => void;
  /** When given, the card's tags render as clickable chips. */
  onOpenTag?: (tag: string) => void;
  /** When given, a tag-edit affordance sits at the card's top right. */
  onEditTags?: () => void;
  /** When given, the card shows its note's picture thumbnails. */
  onOpenImage?: (image: OutlineImage) => void;
}

/**
 * One note in the folder and tag spaces' list: a hairline card with the
 * title (the note's own text stands in when untitled), a Created · Updated
 * meta line, and tag chips and picture thumbnails beneath. The tag-edit
 * action reserves its own column and only fades in on hover, so nothing
 * ever overlaps the title or shifts the layout.
 */
export default function NoteCard({
  entry,
  contextLabel,
  activeTag,
  onOpen,
  onOpenTag,
  onEditTags,
  onOpenImage,
}: NoteCardProps) {
  return (
    <li className="group/card">
      <article className="rounded-xl border border-ink-line/60 px-4 py-3 transition-colors hover:border-ink-faint/60 hover:bg-ink-surface/50 dark:border-paper-line/50 dark:hover:border-paper-mute/40 dark:hover:bg-paper-surface/30">
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={onOpen}
            className="min-w-0 flex-1 cursor-pointer text-left"
          >
            <span className="block truncate text-sm font-medium text-ink dark:text-paper">
              {entry.title?.trim() || entry.preview.trim() || "Untitled note"}
            </span>
            <span className="mt-1 flex min-w-0 items-baseline gap-1.5 text-xs">
              {contextLabel !== undefined && (
                <>
                  <span className="flex-none text-ink-mute dark:text-paper-mute">
                    {contextLabel}
                  </span>
                  <span aria-hidden="true" className="flex-none text-ink-faint dark:text-paper-faint">
                    ·
                  </span>
                </>
              )}
              <span className="flex-none text-ink-mute dark:text-paper-mute">
                Created {dayLabel(entry.createdAt)}
              </span>
              <span aria-hidden="true" className="flex-none text-ink-faint dark:text-paper-faint">
                ·
              </span>
              <span className="flex-none text-ink-mute dark:text-paper-mute">
                Updated {dayLabel(entry.updatedAt)}
              </span>
            </span>
          </button>
          {onEditTags && (
            <button
              type="button"
              onClick={onEditTags}
              aria-label="Edit tags"
              title="Edit tags"
              className="flex-none cursor-pointer rounded-md p-1.5 text-ink-faint opacity-0 transition-opacity hover:bg-ink-line/50 hover:text-ink group-focus-within/card:opacity-100 group-hover/card:opacity-100 dark:text-paper-mute dark:hover:bg-paper-line/20 dark:hover:text-paper"
            >
              <TagIcon />
            </button>
          )}
        </div>

        {entry.tags.length > 0 && onOpenTag && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {entry.tags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => onOpenTag(tag)}
                title={`Open #${tag}`}
                className={`cursor-pointer rounded-md px-1.5 py-0.5 text-[11px] transition-colors ${
                  tag === activeTag
                    ? "bg-ink text-paper dark:bg-paper dark:text-ink"
                    : "bg-ink-line/60 text-ink-soft hover:bg-ink-line hover:text-ink dark:bg-paper-line/40 dark:text-paper-soft dark:hover:bg-paper-line/60 dark:hover:text-paper"
                }`}
              >
                #{tag}
              </button>
            ))}
          </div>
        )}

        {entry.images.length > 0 && onOpenImage && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {entry.images.slice(0, 6).map((image, index) => (
              <button
                key={image.id}
                type="button"
                onClick={() => onOpenImage(image)}
                title={image.title ?? `Picture ${index + 1}`}
                aria-label={image.title ?? `Picture ${index + 1}`}
                className="h-12 w-12 flex-none cursor-pointer overflow-hidden rounded-lg border border-ink-line dark:border-paper-line"
              >
                <img
                  src={entryImageUrl(entry.id, image.id)}
                  alt={image.title ?? ""}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              </button>
            ))}
            {entry.images.length > 6 && (
              <span className="flex h-12 items-center text-[11px] text-ink-mute dark:text-paper-mute">
                +{entry.images.length - 6}
              </span>
            )}
          </div>
        )}
      </article>
    </li>
  );
}
