import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
}));

const sidecar = vi.hoisted(() => ({
  appendEntryAudio: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: native.listen }));
vi.mock("../../../shared/api/sidecar", () => ({
  appendEntryAudio: sidecar.appendEntryAudio,
}));
import {
  AUDIO_UPLOAD_CHUNK_SAMPLES,
  audioUploadChunks,
  concatChunks,
  delayTrack,
  floatToPcm16,
  MIC_DELAY_SAMPLES_24K,
  mixToPcm16,
  pcmBase64ToFloats,
  Recorder,
  toBase64,
} from "./recorder";

afterEach(() => vi.unstubAllGlobals());

describe("floatToPcm16", () => {
  it("maps -1..1 onto the full 16-bit range and clamps", () => {
    const pcm = floatToPcm16(new Float32Array([-1, 0, 1, 2]));
    expect(pcm[0]).toBe(-32768);
    expect(pcm[1]).toBe(0);
    expect(pcm[2]).toBe(32767);
    expect(pcm[3]).toBe(32767);
  });
});

describe("toBase64", () => {
  it("encodes bytes, including the empty input", () => {
    expect(toBase64(new Uint8Array([0, 1, 2]))).toBe("AAEC");
    expect(toBase64(new Uint8Array(0))).toBe("");
  });

  it("round-trips a chunk bigger than one encode step", () => {
    const bytes = new Uint8Array(20000);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = i % 256;
    const decoded = new Uint8Array(
      atob(toBase64(bytes))
        .split("")
        .map((char) => char.charCodeAt(0)),
    );
    expect(decoded).toEqual(bytes);
  });
});

describe("pcmBase64ToFloats", () => {
  it("round-trips with floatToPcm16 and toBase64", () => {
    const input = new Float32Array([-1, -0.5, 0, 0.5, 1]);

    const decoded = pcmBase64ToFloats(
      toBase64(new Uint8Array(floatToPcm16(input).buffer)),
    );

    expect(decoded.length).toBe(input.length);
    for (let i = 0; i < input.length; i += 1) {
      expect(decoded[i]).toBeCloseTo(input[i], 3);
    }
  });
});

describe("concatChunks", () => {
  it("joins chunks in order", () => {
    const merged = concatChunks([
      new Float32Array([1, 2]),
      new Float32Array([3]),
      new Float32Array(0),
    ]);

    expect(Array.from(merged)).toEqual([1, 2, 3]);
  });

  it("is empty for no chunks", () => {
    expect(concatChunks([]).length).toBe(0);
  });
});

describe("mixToPcm16", () => {
  it("uses one track alone when the other is empty", () => {
    const me = new Float32Array([0.5]);

    expect(Array.from(mixToPcm16(me, new Float32Array(0)))).toEqual(
      Array.from(floatToPcm16(me)),
    );
    expect(Array.from(mixToPcm16(new Float32Array(0), me))).toEqual(
      Array.from(floatToPcm16(me)),
    );
  });

  it("averages the two tracks and pads the shorter one with silence", () => {
    const me = new Float32Array([1, 1]);
    const them = new Float32Array([0, 0, 0]);

    const mixed = mixToPcm16(me, them);

    expect(mixed.length).toBe(3);
    expect(mixed[0]).toBe(16383); // (1 + 0) / 2 onto the 16-bit range
    expect(mixed[2]).toBe(0); // past the end of `me`, only silence remains
  });

  it("is empty when both tracks are empty", () => {
    expect(mixToPcm16(new Float32Array(0), new Float32Array(0)).length).toBe(0);
  });
});

describe("delayTrack", () => {
  it("prepends silence and keeps the samples in order", () => {
    const delayed = delayTrack(new Float32Array([1, 2, 3]), 2);
    expect(Array.from(delayed)).toEqual([0, 0, 1, 2, 3]);
  });

  it("is the identity for a zero delay", () => {
    expect(delayTrack(new Float32Array([1]), 0)).toEqual(new Float32Array([1]));
  });

  it("documents the Rust holdback contract at the upload rate", () => {
    // 6 frames × 480 samples @ 48 kHz, resampled to 24 kHz for upload.
    expect(MIC_DELAY_SAMPLES_24K).toBe(1_440);
  });
});

describe("audioUploadChunks", () => {
  it("splits sample-aligned and reassembles exactly", () => {
    const pcm = new Int16Array(AUDIO_UPLOAD_CHUNK_SAMPLES * 2 + 100);
    for (let i = 0; i < pcm.length; i += 1) pcm[i] = i % 16_384;

    const chunks = audioUploadChunks(pcm);

    expect(chunks).toHaveLength(3);
    expect(chunks[2]).toHaveLength(100);
    const merged = new Int16Array(pcm.length);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    expect(merged).toEqual(pcm);
  });
});

describe("Recorder lifecycle", () => {
  beforeEach(() => {
    native.invoke.mockReset().mockResolvedValue(undefined);
    native.listen.mockReset().mockResolvedValue(vi.fn());
    sidecar.appendEntryAudio.mockReset().mockResolvedValue(undefined);
  });

  it("settles start when Stop is requested while the socket is connecting", async () => {
    class ConnectingSocket {
      static readonly OPEN = 1;
      readyState = 0;
      onopen: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onmessage: (() => void) | null = null;

      close() { this.readyState = 3; }
      send() { /* no-op */ }
    }
    vi.stubGlobal("window", {});
    vi.stubGlobal("WebSocket", ConnectingSocket);
    const recorder = new Recorder({
      onError: vi.fn(),
      onFinalizing: vi.fn(),
      onEnd: vi.fn(),
    });

    const starting = recorder.start(7);
    await recorder.stop();

    await expect(starting).rejects.toThrow("stopped before capture started");
  });

  it("stops native capture and saves audio while the final transcript flushes", async () => {
    type SocketHandler = ((event: { data: string }) => void) | null;
    class OpenSocket {
      static readonly OPEN = 1;
      static instance: OpenSocket;
      readyState = 0;
      onopen: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onmessage: SocketHandler = null;
      sent: string[] = [];

      constructor() {
        OpenSocket.instance = this;
      }

      close() {
        this.readyState = 3;
      }

      send(message: string) {
        this.sent.push(message);
      }
    }

    type AudioListener = (event: { payload: { audio: string } }) => void;
    const listeners = new Map<string, AudioListener>();
    native.listen.mockImplementation((event: string, handler: AudioListener) => {
      listeners.set(event, handler);
      return Promise.resolve(vi.fn());
    });
    let finishSave: (() => void) | undefined;
    sidecar.appendEntryAudio.mockReturnValue(
      new Promise<void>((resolve) => {
        finishSave = resolve;
      }),
    );
    vi.stubGlobal("window", {
      __TAURI_INTERNALS__: {},
      setTimeout,
    });
    vi.stubGlobal("WebSocket", OpenSocket);
    const recorder = new Recorder({
      onError: vi.fn(),
      onFinalizing: vi.fn(),
      onEnd: vi.fn(),
    });

    const starting = recorder.start(7);
    OpenSocket.instance.readyState = OpenSocket.OPEN;
    OpenSocket.instance.onopen?.();
    await starting;
    listeners.get("mic-audio")?.({ payload: { audio: "AQA=" } });

    let stopped = false;
    const stopping = recorder.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();

    expect(native.invoke).toHaveBeenCalledWith("stop_mic_audio");
    expect(native.invoke).toHaveBeenCalledWith("stop_system_audio");
    expect(sidecar.appendEntryAudio).toHaveBeenCalledOnce();
    expect(OpenSocket.instance.sent).toContain(JSON.stringify({ type: "stop" }));
    expect(stopped).toBe(false);

    OpenSocket.instance.onmessage?.({ data: JSON.stringify({ type: "stopped" }) });
    await Promise.resolve();
    expect(stopped).toBe(false);

    finishSave?.();
    await stopping;
    expect(stopped).toBe(true);
  });
});
