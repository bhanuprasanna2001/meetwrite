import { useEffect, useRef } from "react";
import type { NoteFont, OutlineImage, Settings } from "../../../shared/api/sidecar";
import MarkdownView from "../../../shared/markdown/MarkdownView";
import { addImagesToNote, imageUrlFromText, insertImageMarkdown } from "../model/imageMarkdown";

/**
 * The note surface — no chrome of its own. The Write|Preview switch and the
 * picture button live in the bottom bar; this component is only the text:
 *
 * - write: the borderless textarea — the markdown stays source text.
 * - preview: the same content through the shared MarkdownView (GFM, math,
 *   code highlighting, admonitions, frontmatter, note pictures).
 *
 * Pictures still join a note by paste or drop: they insert as an
 * `entry-image:` line at the caret, only on the human note.
 */

const FONT_STACKS: Record<NoteFont, string> = {
  lato: "'Lato', -apple-system, 'Helvetica Neue', Arial, sans-serif",
  arial: "'Inter', -apple-system, 'Helvetica Neue', Arial, sans-serif",
  serif: "'Lora', Georgia, 'Charter', serif",
  mono: "'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace",
};

export type NoteMode = "write" | "preview";

interface NoteEditorProps {
  noteMd: string;
  settings: Settings;
  readOnly?: boolean;
  mode: NoteMode;
  /** The note's id and pictures — the preview resolves entry-image refs. */
  entryId: number;
  images: OutlineImage[];
  /** Only the human note accepts pictures; enhanced versions never do. */
  insertImages: boolean;
  onChange: (noteMd: string) => void;
  /** Uploads one picture; resolves to its id, null when it failed. */
  onUploadImage: (file: File, title: string | null) => Promise<{ id: number } | null>;
  /** Clicking an embedded picture opens the image viewer. */
  onOpenImage: (image: OutlineImage) => void;
}

export default function NoteEditor({
  noteMd,
  settings,
  readOnly = false,
  mode,
  entryId,
  images,
  insertImages,
  onChange,
  onUploadImage,
  onOpenImage,
}: NoteEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // The latest text for insertions inside an async upload batch; kept in
  // sync with the prop so a batch never writes over fresh keystrokes.
  const textRef = useRef(noteMd);
  useEffect(() => {
    textRef.current = noteMd;
  }, [noteMd]);

  const fontStyle = {
    fontFamily: FONT_STACKS[settings.noteFont],
    fontSize: settings.noteFontSize,
  };

  /** Insert point: the caret when the editor is focused, else the end. */
  const captureCaret = (): number | null => {
    const textarea = textareaRef.current;
    if (textarea === null || document.activeElement !== textarea) return null;
    return textarea.selectionStart ?? null;
  };

  const uploadBatch = (files: File[]) => {
    // No uploads while the workspace is between states — a picture must
    // never land on a note that is being left.
    if (!insertImages || readOnly || files.length === 0) return;
    void addImagesToNote(files, onUploadImage, {
      current: textRef.current,
      caret: captureCaret(),
      onChange: (text) => {
        textRef.current = text;
        onChange(text);
      },
    });
  };

  const imageFiles = (items: readonly (File | null)[]): File[] =>
    items.filter(
      (item): item is File => item !== null && item.type.startsWith("image/"),
    );

  const onPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = imageFiles(
      Array.from(event.clipboardData.items)
        .filter((item) => item.kind === "file")
        .map((item) => item.getAsFile()),
    );
    if (files.length > 0) {
      event.preventDefault();
      uploadBatch(files);
      return;
    }
    if (readOnly) return;
    // A single pasted image URL embeds as a picture — the Google Images
    // result page included. Everything else pastes as ordinary text.
    const text = event.clipboardData.getData("text/plain");
    if (text.trim() !== "" && !/\s/.test(text.trim())) {
      const image = imageUrlFromText(text);
      if (image !== null) {
        event.preventDefault();
        const result = insertImageMarkdown(
          textRef.current,
          `![${image.title}](${image.url})`,
          captureCaret(),
        );
        textRef.current = result.text;
        onChange(result.text);
      }
    }
  };

  const onDrop = (event: React.DragEvent) => {
    const files = imageFiles(Array.from(event.dataTransfer.files));
    if (files.length === 0) return;
    event.preventDefault();
    uploadBatch(files);
  };

  if (mode === "write") {
    return (
      <div
        className="flex min-w-0 flex-1 justify-center"
        onClick={(event) => {
          // Clicks on the side gutters focus the note; clicks inside the
          // textarea are its own business.
          if (event.target === event.currentTarget) textareaRef.current?.focus();
        }}
      >
        <textarea
          ref={textareaRef}
          value={noteMd}
          readOnly={readOnly}
          onChange={(event) => onChange(event.target.value)}
          onPaste={onPaste}
          placeholder="Start typing"
          className="h-full w-full max-w-3xl resize-none overflow-y-auto bg-transparent px-8 pb-12 pt-8 leading-relaxed text-ink outline-none placeholder:text-ink-faint dark:text-paper dark:placeholder:text-paper-mute"
          style={fontStyle}
        />
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div
        className="mx-auto w-full max-w-3xl px-8 pb-12 pt-8"
        style={fontStyle}
        onDrop={onDrop}
      >
        {noteMd.trim() === "" ? (
          <p className="text-ink-faint dark:text-paper-mute">Nothing to preview yet.</p>
        ) : (
          <MarkdownView
            markdown={noteMd}
            entryId={entryId}
            images={images}
            onImageClick={onOpenImage}
          />
        )}
      </div>
    </div>
  );
}
