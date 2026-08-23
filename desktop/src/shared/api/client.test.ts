import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, readSseJson, request } from "./client";

const encoder = new TextEncoder();

function chunkedStream(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(body: ReadableStream<Uint8Array>): Promise<unknown[]> {
  const events: unknown[] = [];
  for await (const event of readSseJson(body)) events.push(event);
  return events;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("readSseJson", () => {
  it("decodes Unicode split across byte chunks and accepts CRLF frames", async () => {
    const bytes = encoder.encode('data: {"delta":"hello 👋"}\r\n\r\n');
    const expected = [{ delta: "hello 👋" }];
    for (let split = 1; split < bytes.length; split += 1) {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes.slice(0, split));
          controller.enqueue(bytes.slice(split));
          controller.close();
        },
      });
      await expect(collect(stream)).resolves.toEqual(expected);
    }
  });

  it("parses the same events at every network chunk boundary", async () => {
    const source = 'data: {"delta":"hello"}\n\ndata: {"message":{"id":1}}\n\n';
    const expected = [{ delta: "hello" }, { message: { id: 1 } }];
    for (let split = 1; split < source.length; split += 1) {
      await expect(collect(chunkedStream([source.slice(0, split), source.slice(split)]))).resolves.toEqual(
        expected,
      );
    }
  });

  it("rejects malformed JSON as a typed invalid-response error", async () => {
    await expect(collect(chunkedStream(["data: not-json\n\n"]))).rejects.toMatchObject({
      kind: "invalid-response",
    });
  });

  it("cancels the response body when its consumer stops early", async () => {
    const cancelled = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"done":true}\n\n'));
      },
      cancel: cancelled,
    });

    for await (const event of readSseJson(body)) {
      expect(event).toEqual({ done: true });
      break;
    }

    expect(cancelled).toHaveBeenCalledTimes(1);
  });

  it("maps a broken response body to a typed stream error", async () => {
    const body = new ReadableStream<Uint8Array>({
      pull() {
        throw new Error("socket lost");
      },
    });
    await expect(collect(body)).rejects.toMatchObject({
      kind: "offline",
      path: "stream",
    });
  });
});

describe("request", () => {
  it("rejects an empty success body when JSON is required", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    await expect(request("/entries")).rejects.toMatchObject({
      kind: "invalid-response",
      path: "/entries",
    });
  });

  it("maps a connection failure to offline", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(request("/entries")).rejects.toBeInstanceOf(ApiError);
    await expect(request("/entries")).rejects.toMatchObject({
      kind: "offline",
      path: "/entries",
      status: null,
    });
  });

  it("preserves the status and safe detail for server failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: "Sidecar is starting" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    await expect(request("/entries")).rejects.toMatchObject({
      kind: "server",
      status: 503,
      message: "Sidecar is starting",
    });
  });

  it("turns a hung request into a typed timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
      ),
    );
    const pending = request("/slow", undefined, 25);
    const assertion = expect(pending).rejects.toMatchObject({
      kind: "timeout",
      path: "/slow",
    });

    await vi.advanceTimersByTimeAsync(25);
    await assertion;
  });
});
