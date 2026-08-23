import { useCallback, useEffect, useState } from "react";
import {
  toTranscriptLine,
  transcriptEventsUrl,
  type TranscriptLinePayload,
  type TranscriptEventPayload,
} from "../../../shared/api/sidecar";
import { log } from "../../../shared/lib/logger";
import {
  dropPartial,
  EMPTY_PARTIALS,
  orderLines,
  upsertPartial,
  type Partials,
  type TranscriptLine,
  type TranscriptSource,
} from "./transcript";

export interface TranscriptState {
  /** Finished utterances, one flat thread ordered by sequence. */
  lines: TranscriptLine[];
  /** In-flight turns, keyed by item id so overlapping turns never merge. */
  partials: Partials;
}

const EMPTY_STATE: TranscriptState = {
  lines: [],
  partials: EMPTY_PARTIALS,
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function transcriptLine(value: unknown): TranscriptLinePayload | null {
  if (!isObject(value)) return null;
  return typeof value.id === "number" &&
    Number.isFinite(value.id) &&
    typeof value.sequence === "number" &&
    Number.isFinite(value.sequence) &&
    (value.source === "me" || value.source === "them") &&
    typeof value.text === "string" &&
    typeof value.created_at === "string" &&
    !Number.isNaN(Date.parse(value.created_at))
    ? {
        id: value.id,
        sequence: value.sequence,
        source: value.source,
        text: value.text,
        created_at: value.created_at,
      }
    : null;
}

/** Runtime validation keeps malformed sidecar frames from mutating or crashing UI state. */
export function parseTranscriptEvent(value: unknown): TranscriptEventPayload | null {
  if (!isObject(value) || typeof value.type !== "string") return null;
  if (value.type === "delta") {
    return (value.source === "me" || value.source === "them") &&
      typeof value.item_id === "string" &&
      typeof value.sequence === "number" &&
      Number.isFinite(value.sequence) &&
      typeof value.delta === "string"
      ? {
          type: "delta",
          source: value.source,
          item_id: value.item_id,
          sequence: value.sequence,
          delta: value.delta,
        }
      : null;
  }
  if (value.type === "final") {
    const line = transcriptLine(value.line);
    return line && typeof value.item_id === "string"
      ? { type: "final", item_id: value.item_id, line }
      : null;
  }
  if (value.type === "resync" && Array.isArray(value.lines)) {
    const lines = value.lines.map(transcriptLine);
    return lines.every((line): line is TranscriptLinePayload => line !== null)
      ? { type: "resync", lines }
      : null;
  }
  return null;
}

export function applyTranscriptEvent(
  state: TranscriptState,
  event: TranscriptEventPayload,
): TranscriptState {
  if (event.type === "resync") {
    return {
      lines: orderLines(event.lines.map(toTranscriptLine)),
      partials: EMPTY_PARTIALS,
    };
  }
  if (event.type === "delta") {
    const source: TranscriptSource = event.source === "them" ? "them" : "me";
    const existing = state.partials.find(
      (partial) => partial.itemId === event.item_id,
    );
    return {
      ...state,
      partials: upsertPartial(state.partials, {
        itemId: event.item_id,
        source,
        sequence: event.sequence,
        text: (existing?.text ?? "") + event.delta,
      }),
    };
  }
  const line = toTranscriptLine(event.line);
  return {
    // Finals drain in sequence order, so appending keeps the thread sorted.
    // The id guard makes a redelivered final a no-op instead of a duplicate.
    lines: state.lines.some((known) => known.id === line.id)
      ? state.lines
      : [...state.lines, line],
    partials: dropPartial(state.partials, event.item_id),
  };
}

export interface TranscriptController extends TranscriptState {
  replace: (state: TranscriptState) => void;
}

export function useTranscript(
  entryId: number | null,
  recording: boolean,
): TranscriptController {
  const [state, setState] = useState<TranscriptState>(EMPTY_STATE);

  const replace = useCallback((next: TranscriptState) => {
    setState(next);
  }, []);

  useEffect(() => {
    if (!recording || entryId === null) return;
    const source = new EventSource(transcriptEventsUrl(entryId));
    source.onmessage = (message) => {
      let value: unknown;
      try {
        if (typeof message.data !== "string") return;
        value = JSON.parse(message.data) as unknown;
      } catch (error) {
        log.warn("transcript.event_invalid", { entryId }, error);
        return;
      }
      const event = parseTranscriptEvent(value);
      if (event === null) {
        log.warn("transcript.event_invalid", { entryId });
        return;
      }
      setState((current) => applyTranscriptEvent(current, event));
    };
    return () => source.close();
  }, [entryId, recording]);

  return { ...state, replace };
}
