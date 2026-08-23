import { useEffect, useMemo, useRef, useState } from "react";
import {
  formatLineTime,
  transcriptTemplate,
  type LivePartial,
  type Partials,
  type TranscriptLine,
} from "../model/transcript";
import {
  BOX,
  BackIcon,
  CloseIcon,
  ExpandIcon,
} from "../../../shared/ui/meetingBox";
import CopyButton from "../../../shared/ui/CopyButton";
import RecordingBadge from "../../../shared/ui/RecordingBadge";
import { useThreadScroll } from "../../../shared/ui/useThreadScroll";

/**
 * The transcript in two forms, one component so they can never drift:
 *
 * - compact: the panel under the note, with search, the REC indicator, copy,
 *   expand, and collapse.
 * - full: replaces the note (editor stays mounted), with a Back control.
 *
 * One flat thread, ordered by canonical sequence — "them" (left, system
 * audio) and "me" (right, mic) bubbles interleave as they landed. Live
 * partials ride the same bubbles with a small breathing dot, keyed by item
 * id so overlapping turns never merge. Search highlights matches and steps
 * between them instead of hiding the conversation around them. Timestamps
 * live inside each bubble: tiny and faint, never outside it.
 */

interface TranscriptBoxProps {
  mode: "compact" | "full";
  lines: TranscriptLine[];
  partials: Partials;
  /** Recording failure to surface under the search field. */
  error?: string | null;
  /** Live recording — shows the indicator and the listening empty state. */
  recording?: boolean;
  /** The REC timer's origin — null until capture is active. */
  recordingStartedAt?: number | null;
  /** For the copy template: the entry's title, creation date, and your name. */
  entryTitle?: string | null;
  entryCreatedAt?: string | null;
  userName?: string | null;
  /** Compact only: open the full transcript for this entry. */
  onExpand?: () => void;
  /** Compact only: fold the panel away (explicit — never an outside click). */
  onCollapse?: () => void;
  /** Full only: return to the note with the compact transcript panel. */
  onBack?: () => void;
}

const HEADER_BUTTON =
  "flex h-6 w-6 cursor-pointer items-center justify-center rounded " +
  "text-ink-faint hover:text-ink dark:text-paper-mute dark:hover:text-paper";

function ChevronUpIcon() {
  return (
    <svg
      className="h-3 w-3"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 10.5 8 5.5l5 5" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg
      className="h-3 w-3"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 5.5l5 5 5-5" />
    </svg>
  );
}

/** The first case-insensitive match, wrapped in a mark. */
function Highlighted({ text, query }: { text: string; query: string }) {
  if (query === "") return <>{text}</>;
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      <mark className="rounded-sm bg-ink-line/70 dark:bg-paper-line/60">
        {text.slice(index, index + query.length)}
      </mark>
      {text.slice(index + query.length)}
    </>
  );
}

/** One utterance bubble. The timestamp stays inside it — tiny and faint. */
function Bubble({
  line,
  query,
  active,
  bubbleRef,
}: {
  line: TranscriptLine;
  query: string;
  active: boolean;
  bubbleRef: (node: HTMLParagraphElement | null) => void;
}) {
  const align = line.source === "me" ? "right" : "left";
  return (
    <div
      className={`flex max-w-[85%] flex-col ${
        align === "right" ? "self-end items-end" : "self-start items-start"
      }`}
    >
      <p
        ref={bubbleRef}
        className={`max-w-full whitespace-pre-wrap break-words rounded-2xl bg-ink-surface px-3 py-2 text-[13px] leading-relaxed text-ink-soft [overflow-wrap:anywhere] dark:bg-paper-surface dark:text-paper ${
          align === "right" ? "rounded-br-md" : "rounded-bl-md"
        } ${active ? "ring-1 ring-ink-mute dark:ring-paper-mute" : ""}`}
      >
        <Highlighted text={line.text} query={query} />
        <time className="ml-1.5 text-[8px] font-medium tracking-wide text-ink-faint/60 dark:text-paper-mute/50">
          {formatLineTime(line.createdAt)}
        </time>
      </p>
    </div>
  );
}

/** An in-flight utterance: the same bubble, muted — faint until it finalizes. */
function PartialBubble({ partial }: { partial: LivePartial }) {
  const align = partial.source === "me" ? "right" : "left";
  return (
    <div
      className={`flex max-w-[85%] flex-col ${
        align === "right" ? "self-end items-end" : "self-start items-start"
      }`}
    >
      <p className="max-w-full whitespace-pre-wrap break-words rounded-2xl bg-ink-surface/60 px-3 py-2 text-[13px] leading-relaxed text-ink-mute [overflow-wrap:anywhere] dark:bg-paper-surface/60 dark:text-paper-mute">
        {partial.text}
      </p>
    </div>
  );
}

export default function TranscriptBox({
  mode,
  lines,
  partials,
  error = null,
  recording = false,
  recordingStartedAt = null,
  entryTitle = null,
  entryCreatedAt = null,
  userName = null,
  onExpand,
  onCollapse,
  onBack,
}: TranscriptBoxProps) {
  const full = mode === "full";
  const [query, setQuery] = useState("");
  const [activeMatch, setActiveMatch] = useState(0);
  const bubbleRefs = useRef<Map<number, HTMLParagraphElement>>(new Map());
  const listRef = useRef<HTMLDivElement | null>(null);
  const thread = useThreadScroll(listRef, [lines, partials]);

  // Indices of matching lines — the thread always renders in full; search
  // only highlights and steps between hits.
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return [];
    return lines
      .map((line, index) => (line.text.toLowerCase().includes(needle) ? index : -1))
      .filter((index) => index >= 0);
  }, [lines, query]);

  // Keep the stepped-to match in view — but only on a selection or query
  // change. Lines landing mid-recording must not yank the view away from
  // what the user is reading; the thread follow rule owns that.
  const lastFocusRef = useRef({ match: 0, query: "" });
  useEffect(() => {
    const previous = lastFocusRef.current;
    lastFocusRef.current = { match: activeMatch, query };
    if (previous.match === activeMatch && previous.query === query) return;
    if (matches.length === 0) return;
    const index = matches[Math.min(activeMatch, matches.length - 1)];
    const bubble =
      index === undefined ? undefined : bubbleRefs.current.get(lines[index].id);
    bubble?.scrollIntoView({ block: "center" });
  }, [activeMatch, lines, matches, query]);

  const stepMatch = (step: number) => {
    if (matches.length === 0) return;
    setActiveMatch((current) => (current + step + matches.length) % matches.length);
  };

  // One copy for the whole transcript, as the meeting template.
  const copyText = transcriptTemplate(entryTitle, entryCreatedAt, userName, lines);
  const searching = matches.length > 0 || query.trim() !== "";
  const isEmpty =
    !query && lines.length === 0 && partials.length === 0;

  return (
    <section
      className={full ? "relative flex min-h-0 flex-1 flex-col" : `relative ${BOX}`}
      aria-label="Transcript"
    >
      <header
        className={`flex flex-none items-center border-b border-ink-line dark:border-paper-line ${
          full ? "px-4 py-1.5" : "px-3 pb-2 pt-2.5"
        }`}
      >
        <div className={`flex w-full items-center gap-1.5 ${full ? "mx-auto max-w-3xl" : ""}`}>
        {full && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to note"
            title="Back to note (Esc)"
            className={HEADER_BUTTON}
          >
            <BackIcon />
          </button>
        )}
        <input
          value={query}
          onChange={(event) => {
            // One atomic change: the new query starts at its first match.
            setQuery(event.target.value);
            setActiveMatch(0);
          }}
          placeholder="Search transcript"
          aria-label="Search transcript"
          className="min-w-0 flex-1 bg-transparent text-xs text-ink outline-none placeholder:text-ink-faint focus:placeholder:text-ink-mute dark:text-paper dark:placeholder:text-paper-mute dark:focus:placeholder:text-paper-mute"
        />
        {searching && (
          <>
            <span className="flex-none text-[10px] font-medium tabular-nums text-ink-faint dark:text-paper-mute">
              {matches.length === 0 ? "0/0" : `${activeMatch + 1}/${matches.length}`}
            </span>
            <button
              type="button"
              onClick={() => stepMatch(-1)}
              disabled={matches.length === 0}
              aria-label="Previous match"
              title="Previous match"
              className={HEADER_BUTTON}
            >
              <ChevronUpIcon />
            </button>
            <button
              type="button"
              onClick={() => stepMatch(1)}
              disabled={matches.length === 0}
              aria-label="Next match"
              title="Next match"
              className={HEADER_BUTTON}
            >
              <ChevronDownIcon />
            </button>
          </>
        )}
        {recordingStartedAt !== null && <RecordingBadge startedAt={recordingStartedAt} />}
        <CopyButton text={copyText} className="flex-none" />
        {!full && (
          <>
            <button
              type="button"
              onClick={onExpand}
              aria-label="Open full transcript"
              title="Open full transcript"
              className={HEADER_BUTTON}
            >
              <ExpandIcon />
            </button>
            <button
              type="button"
              onClick={onCollapse}
              aria-label="Close transcript"
              title="Close transcript"
              className={HEADER_BUTTON}
            >
              <CloseIcon />
            </button>
          </>
        )}
        </div>
      </header>

      {error && (
        <p className={`px-3 pb-2 text-xs leading-relaxed text-red-500 ${full ? "px-6" : ""}`}>
          {error}
        </p>
      )}

      {isEmpty ? (
        <p
          className={`text-center text-xs text-ink-faint dark:text-paper-mute ${
            full ? "mx-auto w-full max-w-3xl flex-1 self-center px-6 pt-6" : "px-3 pb-3 pt-6"
          }`}
        >
          {recording
            ? "Listening — the transcript streams in here as people speak."
            : "The transcript will appear here — press Record."}
        </p>
      ) : (
        <>
          <div
            ref={listRef}
            onScroll={thread.onScroll}
            className={`flex min-h-0 flex-1 flex-col overflow-y-auto ${
              full ? "gap-3 px-6 py-4" : "gap-2 px-3 pb-3 pt-1"
            }`}
          >
            <div
              className={`flex w-full flex-col ${
                full ? "mx-auto max-w-3xl gap-3" : "gap-2"
              }`}
            >
              {lines.map((line, index) => (
                <Bubble
                  key={line.id}
                  line={line}
                  query={query.trim()}
                  active={searching && matches[activeMatch] === index}
                  bubbleRef={(node) => {
                    if (node === null) bubbleRefs.current.delete(line.id);
                    else bubbleRefs.current.set(line.id, node);
                  }}
                />
              ))}
              {partials.map((partial) => (
                <PartialBubble key={partial.itemId} partial={partial} />
              ))}
            </div>
          </div>

          {thread.showJump && (
            <button
              type="button"
              onClick={thread.jumpToLatest}
              className={`absolute z-10 cursor-pointer rounded-full border border-ink-line bg-paper px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-ink-mute shadow-sm hover:text-ink dark:border-paper-line dark:bg-ink dark:text-paper-mute dark:hover:text-paper ${
                full ? "bottom-3 left-1/2 -translate-x-1/2" : "bottom-2 right-2"
              }`}
            >
              Latest ↓
            </button>
          )}
        </>
      )}
    </section>
  );
}
