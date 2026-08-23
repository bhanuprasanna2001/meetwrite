import { describe, expect, it } from "vitest";
import { EMPTY_PARTIALS } from "./transcript";
import {
  applyTranscriptEvent,
  parseTranscriptEvent,
  type TranscriptState,
} from "./useTranscript";

const empty: TranscriptState = {
  lines: [],
  partials: EMPTY_PARTIALS,
};

const wireLine = (id: number, sequence: number, source: string, text: string) => ({
  id,
  sequence,
  source,
  text,
  created_at: "2026-08-20T10:00:00+00:00",
});

describe("applyTranscriptEvent", () => {
  it("keeps overlapping partials apart by item id", () => {
    const state = applyTranscriptEvent(
      applyTranscriptEvent(empty, {
        type: "delta",
        source: "them",
        item_id: "first",
        sequence: 1,
        delta: "hel",
      }),
      { type: "delta", source: "me", item_id: "second", sequence: 2, delta: "wor" },
    );
    expect(state.partials.map((partial) => partial.itemId)).toEqual(["first", "second"]);

    const grown = applyTranscriptEvent(state, {
      type: "delta",
      source: "them",
      item_id: "first",
      sequence: 1,
      delta: "lo",
    });
    expect(grown.partials.map((partial) => partial.text)).toEqual(["hello", "wor"]);
  });

  it("a final clears only its own partial and appends the line", () => {
    let state = applyTranscriptEvent(empty, {
      type: "delta",
      source: "them",
      item_id: "first",
      sequence: 1,
      delta: "hello",
    });
    state = applyTranscriptEvent(state, {
      type: "delta",
      source: "me",
      item_id: "second",
      sequence: 2,
      delta: "wor",
    });
    state = applyTranscriptEvent(state, {
      type: "final",
      item_id: "first",
      line: wireLine(2, 1, "them", "hello"),
    });

    expect(state.lines.map((line) => line.text)).toEqual(["hello"]);
    expect(state.partials.map((partial) => partial.itemId)).toEqual(["second"]);
  });

  it("a redelivered final does not duplicate the line", () => {
    const final = {
      type: "final" as const,
      item_id: "first",
      line: wireLine(2, 1, "them", "hello"),
    };
    const once = applyTranscriptEvent(empty, final);
    const twice = applyTranscriptEvent(once, final);
    expect(twice.lines).toHaveLength(1);
  });

  it("resync replaces everything with sequence-ordered lines and no partials", () => {
    const state = applyTranscriptEvent(
      applyTranscriptEvent(empty, {
        type: "delta",
        source: "me",
        item_id: "live",
        sequence: 1,
        delta: "in flight",
      }),
      {
        type: "resync",
        lines: [wireLine(3, 2, "me", "later"), wireLine(2, 1, "them", "earlier")],
      },
    );

    expect(state.lines.map((line) => line.id)).toEqual([2, 3]);
    expect(state.partials).toEqual([]);
  });
});

describe("parseTranscriptEvent", () => {
  it("rejects incomplete and malformed frames", () => {
    expect(parseTranscriptEvent(null)).toBeNull();
    expect(parseTranscriptEvent({ type: "resync" })).toBeNull();
    expect(parseTranscriptEvent({ type: "delta", source: "me" })).toBeNull();
    expect(parseTranscriptEvent({ type: "delta", source: "garbage", delta: "x" })).toBeNull();
    expect(parseTranscriptEvent({
      type: "delta",
      source: "me",
      delta: "x",
      item_id: "id",
    })).toBeNull(); // Missing sequence.
    expect(parseTranscriptEvent({ type: "final", line: { id: 1 } })).toBeNull();
    expect(parseTranscriptEvent({
      type: "final",
      item_id: "id",
      line: { id: 1, sequence: 1, source: "me", text: "x", created_at: "not-a-date" },
    })).toBeNull();
    expect(parseTranscriptEvent({ type: "unknown" })).toBeNull();
  });

  it("accepts a complete final frame", () => {
    expect(parseTranscriptEvent({
      type: "final",
      item_id: "id",
      line: wireLine(1, 1, "me", "done"),
    })).toMatchObject({ type: "final", line: { text: "done" } });
  });

  it("accepts a complete delta frame", () => {
    expect(parseTranscriptEvent({
      type: "delta",
      source: "them",
      item_id: "id",
      sequence: 3,
      delta: "hel",
    })).toEqual({
      type: "delta",
      source: "them",
      item_id: "id",
      sequence: 3,
      delta: "hel",
    });
  });
});
