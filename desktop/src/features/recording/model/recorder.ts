/**
 * Live capture (see docs/USER_FLOWS.md): both audio streams are
 * captured natively by the Rust layer — the mic (the "me" side) and the
 * system audio tap (the "them" side) — and arrive here as `mic-audio` /
 * `system-audio` events. The recorder forwards them on the sidecar's
 * transcription WebSocket and keeps every chunk for the saved recording.
 *
 * Capture deliberately lives outside the webview: WebKit media capture
 * needs signing entitlements this app doesn't carry, and without them macOS
 * suspends the web content process mid-capture (a white screen).
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { BASE_URL } from "../../../shared/api/client";
import { appendEntryAudio } from "../../../shared/api/sidecar";
import { log } from "../../../shared/lib/logger";

/** The sidecar's transcription socket for an entry. */
export function transcribeUrl(entryId: number): string {
  return `${BASE_URL.replace(/^http/, "ws")}/entries/${entryId}/transcribe`;
}

/** How long stop() waits for the sidecar to finalize in-flight speech
 * before closing the socket anyway (an older sidecar that ignores the stop
 * frame still lets the recording close). */
const FLUSH_ACK_TIMEOUT_MS = 11_000;

/** Floats in [-1, 1] → 16-bit PCM. */
export function floatToPcm16(samples: Float32Array): Int16Array {
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    pcm[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return pcm;
}

/** One audio-upload chunk: 30 s of 24 kHz mono ≈ 1.4 MB → ~1.9 MB base64.
 * Bounded chunks keep one huge string and one huge request out of the stop
 * path (encoding 1 hour of PCM in one pass stalls the webview). */
export const AUDIO_UPLOAD_CHUNK_SAMPLES = 24_000 * 30;

/** Split a PCM16 recording into ordered, sample-aligned upload chunks. */
export function audioUploadChunks(pcm: Int16Array): Int16Array[] {
  const chunks: Int16Array[] = [];
  for (let offset = 0; offset < pcm.length; offset += AUDIO_UPLOAD_CHUNK_SAMPLES) {
    const end = Math.min(offset + AUDIO_UPLOAD_CHUNK_SAMPLES, pcm.length);
    chunks.push(pcm.subarray(offset, end));
  }
  return chunks;
}

/** Bytes → base64 without blowing the argument stack on big chunks. */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x4000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x4000));
  }
  return btoa(binary);
}

/** Base64 PCM16 (little-endian) → floats in [-1, 1]. */
export function pcmBase64ToFloats(base64: string): Float32Array {
  const binary = atob(base64);
  const pcm = new Int16Array(binary.length / 2);
  for (let i = 0; i < pcm.length; i += 1) {
    pcm[i] = binary.charCodeAt(i * 2) | (binary.charCodeAt(i * 2 + 1) << 8);
  }
  const floats = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i += 1) floats[i] = pcm[i] / 32768;
  return floats;
}

/** One flat buffer from the collected system-audio chunks. */
export function concatChunks(chunks: readonly Float32Array[]): Float32Array {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

/** Merge two mono tracks into one, sample-aligned and half-gained. The
 * shorter track is silence-padded, so a track that starts late never cuts
 * the other one short. */
export function mixToPcm16(me: Float32Array, them: Float32Array): Int16Array {
  if (me.length === 0) return floatToPcm16(them);
  if (them.length === 0) return floatToPcm16(me);
  const length = Math.max(me.length, them.length);
  const mixed = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const mine = i < me.length ? me[i] : 0;
    const theirs = i < them.length ? them[i] : 0;
    mixed[i] = (mine + theirs) * 0.5;
  }
  return floatToPcm16(mixed);
}

/** The Rust AEC loop holds the mic back six frames (60 ms at 48 kHz) so the
 * reference is always ahead of the echo — CAPTURE_DELAY_FRAMES in
 * microphone.rs. The saved mix pads the system track by the same delay, at
 * the 24 kHz upload rate, so the two tracks stay sample-aligned. */
export const MIC_DELAY_SAMPLES_24K = 1_440;

/** Prepend `delay` zero samples, so a late track starts where its real
 * first sample lands in wall time. */
export function delayTrack(samples: Float32Array, delay: number): Float32Array {
  const delayed = new Float32Array(samples.length + delay);
  delayed.set(samples, delay);
  return delayed;
}

interface RecorderCallbacks {
  /** A human-readable failure to show in the transcript box. */
  onError: (message: string) => void;
  /** An unexpected socket close started finalizing the captured audio. */
  onFinalizing: () => void;
  /** The transcription socket closed on its own (not via stop()). */
  onEnd: () => void;
}

/** One live recording: two native taps → transcription socket + saved mix. */
export class Recorder {
  private socket: WebSocket | null = null;
  private micChunks: Float32Array[] = []; // The whole recording, for the save.
  private systemChunks: Float32Array[] = []; // The whole system track, for the save.
  private entryId: number | null = null;
  private unlistenMic: UnlistenFn | null = null;
  private unlistenSystem: UnlistenFn | null = null;
  private cancelPendingStart: (() => void) | null = null;
  private finalization: Promise<void> | null = null;
  private stopped = false;
  private readonly callbacks: RecorderCallbacks;

  constructor(callbacks: RecorderCallbacks) {
    this.callbacks = callbacks;
  }

  /** Start the socket and both native taps. Rejects with a message for the
   * user if the socket can't open. */
  async start(entryId: number): Promise<void> {
    this.stopped = false;
    this.entryId = entryId;

    const socket = new WebSocket(transcribeUrl(entryId));
    this.socket = socket;
    socket.onmessage = (event) => {
      let frame: unknown;
      try {
        frame = JSON.parse(event.data as string) as unknown;
      } catch {
        return;
      }
      const message = (frame as { message?: unknown } | null)?.message;
      if (typeof message === "string") this.callbacks.onError(message);
    };
    socket.onclose = () => {
      // Save first: onEnd flips `recording`, which reloads the audio box —
      // the append must land before that reload sees the duration.
      this.callbacks.onFinalizing();
      void this.finishRecording().then(() => this.callbacks.onEnd());
    };
    await this.waitForOpen(socket);
    log.info("recording.socket_opened", { entryId });

    // Both taps are native; a plain browser (dev without the shell) has no
    // audio to capture.
    if (!("__TAURI_INTERNALS__" in window)) {
      throw new Error("Recording needs the desktop app — the audio taps are native.");
    }
    const micStarted = await this.startStream(
      "me",
      "start_mic_audio",
      "mic-audio",
      this.micChunks,
    );
    const systemStarted = await this.startStream(
      "them",
      "start_system_audio",
      "system-audio",
      this.systemChunks,
    );
    if (!micStarted && !systemStarted) {
      throw new Error("Recording could not access the microphone or system audio.");
    }
  }

  /** Start one native tap and forward its events to the socket (and into
   * `chunks`, which becomes the saved track). */
  private async startStream(
    source: "me" | "them",
    startCommand: "start_mic_audio" | "start_system_audio",
    event: string,
    chunks: Float32Array[],
  ): Promise<boolean> {
    if (this.stopped) return false;
    try {
      await invoke(startCommand);
      if (this.stopped) {
        void invoke(source === "me" ? "stop_mic_audio" : "stop_system_audio").catch(
          () => undefined,
        );
        return false;
      }
      const unlisten = await listen<{ audio: string }>(event, ({ payload }) => {
        if (this.stopped) return;
        const socket = this.socket;
        // Guard empty payloads — the server rejects a missing/empty audio
        // field, and a frame that fails validation surfaces as an error.
        if (socket && socket.readyState === WebSocket.OPEN && payload.audio) {
          socket.send(JSON.stringify({ source, audio: payload.audio }));
        }
        // Keep the same chunk for the saved recording.
        chunks.push(pcmBase64ToFloats(payload.audio));
      });
      if (this.stopped) {
        unlisten();
        void invoke(source === "me" ? "stop_mic_audio" : "stop_system_audio").catch(
          () => undefined,
        );
        return false;
      }
      if (source === "me") this.unlistenMic = unlisten;
      else this.unlistenSystem = unlisten;
      log.info("recording.capture_started", { source });
      return true;
    } catch (error) {
      log.warn("recording.capture_failed", { source }, error);
      // Tauri rejects a failing command with the Rust Err value — a plain
      // string, not an Error — which already carries the user-facing reason
      // (e.g. the permission hint from map_os_error).
      const message =
        typeof error === "string"
          ? error
          : error instanceof Error
            ? error.message
            : `${source} capture failed`;
      this.callbacks.onError(message);
      return false;
    }
  }

  /** Stop capture immediately, then finish the transcript and audio save together. */
  async stop(): Promise<void> {
    this.stopped = true;
    this.cancelPendingStart?.();
    const socket = this.socket;
    this.socket = null;
    const finalization = this.finishRecording();
    if (socket) {
      if (socket.readyState === WebSocket.OPEN) {
        await this.flushRemaining(socket).catch(() => undefined);
      }
      socket.onclose = null; // stop() must not fire onEnd
      socket.onmessage = null;
      socket.onerror = null;
      socket.close();
    }
    await finalization;
  }

  /** Send the stop frame and resolve when the sidecar acknowledges it — or
   * when the timeout passes, so a stale sidecar can't wedge the recorder.
   * A stale sidecar answers the stop frame with a validation error (it
   * doesn't know the frame) — that resolves too, without surfacing it. */
  private flushRemaining(socket: WebSocket): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.onmessage = null;
        resolve();
      };
      const timer = window.setTimeout(finish, FLUSH_ACK_TIMEOUT_MS);
      socket.onmessage = (event) => {
        let frame: unknown;
        try {
          frame = JSON.parse(event.data as string) as unknown;
        } catch {
          return;
        }
        const type = (frame as { type?: unknown } | null)?.type;
        if (type === "stopped" || type === "error") finish();
      };
      try {
        socket.send(JSON.stringify({ type: "stop" }));
      } catch {
        finish();
      }
    });
  }

  /** Stop the taps, mix the two tracks, and save the recording to the entry. */
  private async finishRecording(): Promise<void> {
    if (this.finalization !== null) return this.finalization;
    this.finalization = this.finalizeOnce();
    return this.finalization;
  }

  private async finalizeOnce(): Promise<void> {
    const entryId = this.entryId;
    this.stopStreams();
    const pcm = mixToPcm16(
      concatChunks(this.micChunks),
      delayTrack(concatChunks(this.systemChunks), MIC_DELAY_SAMPLES_24K),
    );
    this.teardown();
    if (entryId !== null && pcm.length > 0) await this.saveAudio(entryId, pcm);
  }

  /** Append the recording to the entry's saved audio (best effort). */
  private async saveAudio(entryId: number, pcm: Int16Array): Promise<void> {
    try {
      for (const chunk of audioUploadChunks(pcm)) {
        await appendEntryAudio(
          entryId,
          toBase64(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)),
        );
      }
      log.info("recording.audio_saved", {
        entryId,
        sampleCount: pcm.length,
        durationSeconds: Number((pcm.length / 24000).toFixed(1)),
      });
    } catch (error) {
      log.warn("recording.audio_save_failed", { entryId }, error);
      this.callbacks.onError("The recording audio couldn't be saved — is the sidecar up to date?");
    }
  }

  /** Stop both native taps and their event listeners. */
  private stopStreams(): void {
    this.unlistenMic?.();
    this.unlistenMic = null;
    this.unlistenSystem?.();
    this.unlistenSystem = null;
    if ("__TAURI_INTERNALS__" in window) {
      void invoke("stop_mic_audio").catch(() => undefined);
      void invoke("stop_system_audio").catch(() => undefined);
    }
  }

  /** Forget this recording's state. */
  private teardown(): void {
    this.micChunks = [];
    this.systemChunks = [];
    this.entryId = null;
  }

  /** Resolve once the socket is open; reject with a message for the user. */
  private waitForOpen(socket: WebSocket): Promise<void> {
    return new Promise((resolve, reject) => {
      const handleClose = socket.onclose;
      const cleanup = () => {
        socket.onerror = null;
        socket.onopen = null;
        socket.onclose = handleClose;
        this.cancelPendingStart = null;
      };
      const fail = (message: string) => {
        cleanup();
        reject(new Error(message));
      };
      this.cancelPendingStart = () => fail("Recording stopped before capture started.");
      socket.onopen = () => {
        cleanup();
        resolve();
      };
      socket.onerror = () => {
        fail("Couldn't reach the transcription service — is the sidecar running?");
      };
      socket.onclose = () => {
        fail("The transcription service closed before recording started.");
      };
    });
  }
}
