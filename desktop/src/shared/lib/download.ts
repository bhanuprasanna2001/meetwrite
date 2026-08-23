/**
 * Save a note version as a .md file. One Download button, the version the
 * user is currently viewing (human or enhanced).
 */

export type NoteView = "human" | "enhanced";

/** Strip path separators so a title can never redirect the download. */
function safeName(title: string): string {
  return title.replace(/[\\/:*?"<>|]/g, " ").trim().replace(/\s+/g, " ");
}

/** The .md filename for one version of a note. */
export function downloadFileName(title: string | null, view: NoteView): string {
  const base = safeName(title?.trim() || "meeting-notes");
  return view === "enhanced" ? `${base}-enhanced.md` : `${base}.md`;
}

/** Save markdown text as a file (a one-shot anchor download). */
export function downloadMarkdown(filename: string, markdown: string): void {
  const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
