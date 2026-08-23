/**
 * The note's list preview. Most notes start with their title line, so a
 * preview that repeats the title tells the reader nothing new — treat it
 * like an empty note instead of showing the same text twice.
 */
export function previewLabel(
  title: string | null | undefined,
  preview: string | null | undefined,
): string {
  const text = (preview ?? "").trim();
  if (text === "" || text === (title ?? "").trim()) return "Empty note";
  return text;
}
