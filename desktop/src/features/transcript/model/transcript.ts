/**
 * Transcript helpers: the sidecar's canonical lines (sequence-ordered) and
 * the live SSE partials funnel into one flat thread, oldest first.
 */

import type {
  TranscriptLine,
  TranscriptSource,
} from "../../../shared/api/contracts";
import { parseIsoDate } from "../../../shared/lib/dates";

export type { TranscriptLine, TranscriptSource } from "../../../shared/api/contracts";

/** One in-flight utterance. Keyed by its OpenAI item id, so two overlapping
 * turns can be live at once and must never merge or clear each other. */
export interface LivePartial {
  itemId: string;
  source: TranscriptSource;
  sequence: number;
  text: string;
}

/** Live partials, oldest turn first. */
export type Partials = LivePartial[];

export const EMPTY_PARTIALS: Partials = [];

/**
 * One stable order for every line the server can send: sequence first, then
 * id. Timestamps are display-only and never decide order — two lines can
 * share a second, but a sequence is unique per entry.
 */
export function orderLines(lines: TranscriptLine[]): TranscriptLine[] {
  return [...lines].sort((a, b) => a.sequence - b.sequence || a.id - b.id);
}

/** Replace the partial with this item id (or append it), then re-sort. */
export function upsertPartial(partials: Partials, next: LivePartial): Partials {
  const updated = partials.some((partial) => partial.itemId === next.itemId)
    ? partials.map((partial) => (partial.itemId === next.itemId ? next : partial))
    : [...partials, next];
  return updated.sort(
    (a, b) => a.sequence - b.sequence || a.itemId.localeCompare(b.itemId),
  );
}

/** A finalized turn leaves the live list — and only that turn. */
export function dropPartial(partials: Partials, itemId: string): Partials {
  return partials.filter((partial) => partial.itemId !== itemId);
}

/** hh:mm for a bubble timestamp (24-hour, no locale decorations). */
export function formatLineTime(createdAt: string): string {
  return parseIsoDate(createdAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "Aug 13" for the copy template — locale-independent. */
export function formatMeetingDate(createdAt: string): string {
  const date = parseIsoDate(createdAt);
  if (Number.isNaN(date.getTime())) return "";
  return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

/**
 * The whole transcript as one shareable document, the shape the transcript
 * box's copy button writes to the clipboard:
 *
 *   ---
 *   Meeting Title: …
 *   Date: …
 *   Meeting participants: …
 *   Transcript:
 *   Me: …
 *   Them: …
 *   ---
 */
export function transcriptTemplate(
  title: string | null,
  createdAt: string | null,
  userName: string | null,
  lines: TranscriptLine[],
): string {
  const me = lines
    .filter((line) => line.source === "me")
    .map((line) => line.text)
    .join(" ");
  const them = lines
    .filter((line) => line.source === "them")
    .map((line) => line.text)
    .join(" ");
  const sections = [
    "---",
    `Meeting Title: ${title ?? "Untitled"}`,
    "",
    `Date: ${formatMeetingDate(createdAt ?? "")}`,
    "",
  ];
  if (userName) sections.push(`Meeting participants: ${userName}`, "");
  sections.push("Transcript:", "");
  if (me) sections.push(`Me: ${me}`, "");
  if (them) sections.push(`Them: ${them}`, "");
  sections.push("---");
  return sections.join("\n");
}

/** Whether notes + transcript reach the Enhance minimum (10 words / 60 chars). */
export function hasEnhanceSource(noteMd: string, transcript: string): boolean {
  const words = `${noteMd} ${transcript}`.split(/\s+/).filter(Boolean).length;
  return words >= 10 || noteMd.length + transcript.length >= 60;
}

