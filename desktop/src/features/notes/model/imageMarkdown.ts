/**
 * The pure text rules for embedding pictures: the markdown line an upload
 * inserts, where it goes, and what a dropped file is called. Kept free of
 * React so the rules are one-liners to test and impossible to drift.
 */

/** `![title](entry-image:3)` — the note's reference to one of its pictures. */
export function imageLine(title: string, imageId: number): string {
  return `![${title}](entry-image:${imageId})`;
}

const IMAGE_EXTENSION = /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i;

/**
 * The image a pasted URL resolves to, with a display title — or null when
 * the text is not a single image URL. The Google Images result page is
 * unwrapped: the real picture hides in its `imgurl` parameter, and that is
 * exactly what a user copies out of a search result.
 */
export function imageUrlFromText(
  text: string,
): { url: string; title: string } | null {
  const trimmed = text.trim();
  if (trimmed === "" || !/^https?:\/\//i.test(trimmed)) return null;
  try {
    const parsed = new URL(trimmed);
    let candidate = trimmed;
    if (parsed.hostname.includes("google.") && parsed.pathname === "/imgres") {
      const imgurl = parsed.searchParams.get("imgurl");
      if (imgurl === null || !/^https?:\/\//i.test(imgurl)) return null;
      candidate = imgurl;
    } else if (!IMAGE_EXTENSION.test(parsed.pathname)) {
      return null;
    }
    const stem = decodeURIComponent(
      candidate.slice(candidate.lastIndexOf("/") + 1).replace(/\?.*$/, ""),
    ).replace(IMAGE_EXTENSION, "");
    return { url: candidate, title: stem.trim() || "Image" };
  } catch {
    return null;
  }
}

/** The display title of an uploaded file: its name minus the extension. */
export function imageTitleFromFile(name: string | undefined): string {
  const stem = (name ?? "").replace(/\.[^.]*$/, "").trim();
  return stem || "Image";
}

/**
 * Insert one image line at `caret` (null appends at the end), keeping it on
 * its own line, and report where the caret ends up — the position the next
 * image of the same batch inserts at.
 */
export function insertImageMarkdown(
  current: string,
  line: string,
  caret: number | null,
): { text: string; caret: number } {
  const at = caret === null || caret > current.length ? current.length : caret;
  const needsLeadingBreak = at > 0 && current[at - 1] !== "\n";
  const needsTrailingBreak = at < current.length && current[at] !== "\n";
  const inserted = `${needsLeadingBreak ? "\n" : ""}${line}${
    needsTrailingBreak ? "\n" : ""
  }`;
  return { text: current.slice(0, at) + inserted + current.slice(at), caret: at + inserted.length };
}

/** The text a batch of uploaded pictures produces. `state.caret` starts at
 * the insertion point (null = end of note) and walks forward, so each
 * picture lands after the last — the one shared path for paste, drop, and
 * the bottom bar's picture button. */
export async function addImagesToNote(
  files: File[],
  upload: (file: File, title: string) => Promise<{ id: number } | null>,
  state: {
    current: string;
    caret: number | null;
    onChange: (text: string) => void;
  },
): Promise<void> {
  for (const file of files) {
    const title = imageTitleFromFile(file.name);
    const image = await upload(file, title);
    if (image === null) continue;
    const result = insertImageMarkdown(state.current, imageLine(title, image.id), state.caret);
    state.current = result.text;
    state.caret = result.caret;
    state.onChange(result.text);
  }
}
