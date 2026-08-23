import { afterEach, describe, expect, it, vi } from "vitest";
import { sendMessage, toTranscriptLine } from "./sidecar";

afterEach(() => vi.unstubAllGlobals());

describe("toTranscriptLine", () => {
  it("maps snake_case wire lines to app lines", () => {
    expect(
      toTranscriptLine({
        id: 7,
        sequence: 2,
        source: "me",
        text: "hello",
        created_at: "2026-08-18T10:30:00+00:00",
      }),
    ).toEqual({
      id: 7,
      sequence: 2,
      source: "me",
      text: "hello",
      createdAt: "2026-08-18T10:30:00+00:00",
    });
  });

  it("keeps the them source", () => {
    expect(
      toTranscriptLine({
        id: 8,
        sequence: 1,
        source: "them",
        text: "hi there",
        created_at: "2026-08-18T10:31:00+00:00",
      }).source,
    ).toBe("them");
  });

  it("rejects an unexpected source instead of misattributing the speaker", () => {
    expect(() =>
      toTranscriptLine({
        id: 9,
        sequence: 3,
        source: "assistant",
        text: "hi",
        created_at: "2026-08-18T10:32:00+00:00",
      }),
    ).toThrow("invalid transcript line");
  });

  it("rejects a line without its canonical sequence", () => {
    expect(() =>
      toTranscriptLine({
        id: 9,
        source: "me",
        text: "hi",
        created_at: "2026-08-18T10:32:00+00:00",
        sequence: Number.NaN,
      }),
    ).toThrow("invalid transcript line");
  });

  // Regression: the SSE stream used to feed raw wire lines into state, so
  // bubbles rendered with `createdAt === undefined` and `formatLineTime`
  // crashed the whole React tree (white screen, recording killed).
  it("always produces a usable createdAt for the bubble timestamp", () => {
    const line = toTranscriptLine({
      id: 10,
      sequence: 4,
      source: "me",
      text: "timestamped",
      created_at: "2026-08-18T10:33:00+00:00",
    });
    expect(new Date(line.createdAt).getTime()).not.toBeNaN();
  });
});

describe("sendMessage", () => {
  it("maps ordered deltas and the validated final message", async () => {
    const body = [
      'data: {"delta":"Hello "}\n\n',
      'data: {"delta":"there"}\n\n',
      'data: {"message":{"id":9,"chat_id":3,"role":"assistant","content":"Hello there","created_at":"2026-08-20T10:00:00Z"}}\n\n',
    ].join("");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
    const deltas: string[] = [];

    await expect(sendMessage(3, "hello", (delta) => deltas.push(delta))).resolves.toMatchObject({
      id: 9,
      chatId: 3,
      role: "assistant",
      content: "Hello there",
    });
    expect(deltas).toEqual(["Hello ", "there"]);
  });

  it("rejects a malformed event without mutating the reply", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("data: null\n\n")));
    const onDelta = vi.fn();

    await expect(sendMessage(3, "hello", onDelta)).rejects.toMatchObject({
      kind: "invalid-response",
    });
    expect(onDelta).not.toHaveBeenCalled();
  });
});
