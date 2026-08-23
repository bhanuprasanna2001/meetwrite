import { describe, expect, it } from "vitest";
import {
  IDLE_RECORDING,
  recordingOwnsAudio,
  recordingStartedAt,
  reduceRecording,
} from "./recordingFlow";

describe("recording flow", () => {
  it("follows the only successful lifecycle", () => {
    const starting = reduceRecording(IDLE_RECORDING, {
      type: "start_requested",
      entryId: 7,
      operationId: 1,
    });
    const active = reduceRecording(starting, {
      type: "capture_started",
      operationId: 1,
      startedAt: 1_000,
    });
    const stopping = reduceRecording(active, { type: "stop_requested", operationId: 1 });
    const idle = reduceRecording(stopping, { type: "capture_finished", operationId: 1 });

    expect([starting.status, active.status, stopping.status, idle.status]).toEqual([
      "starting",
      "active",
      "stopping",
      "idle",
    ]);
    expect(active).toMatchObject({ status: "active", startedAt: 1_000 });
    expect(recordingOwnsAudio(stopping)).toBe(true);
    expect(recordingOwnsAudio(idle)).toBe(false);
  });

  it("exposes the REC timer origin only while capture is active", () => {
    const active = reduceRecording(IDLE_RECORDING, {
      type: "start_requested",
      entryId: 7,
      operationId: 9,
    });
    const started = reduceRecording(active, {
      type: "capture_started",
      operationId: 9,
      startedAt: 123,
    });
    expect(recordingStartedAt(active)).toBeNull();
    expect(recordingStartedAt(started)).toBe(123);
    const stopping = reduceRecording(started, { type: "stop_requested", operationId: 9 });
    expect(recordingStartedAt(stopping)).toBeNull();
  });

  it("can stop deterministically while capture is still starting", () => {
    const starting = reduceRecording(IDLE_RECORDING, {
      type: "start_requested",
      entryId: 7,
      operationId: 2,
    });
    const stopping = reduceRecording(starting, { type: "stop_requested", operationId: 2 });
    expect(stopping.status).toBe("stopping");
    expect(reduceRecording(stopping, { type: "capture_finished", operationId: 2 })).toEqual(
      IDLE_RECORDING,
    );
  });

  it("ignores duplicate starts and stale completions", () => {
    const starting = reduceRecording(IDLE_RECORDING, {
      type: "start_requested",
      entryId: 7,
      operationId: 3,
    });
    expect(
      reduceRecording(starting, { type: "start_requested", entryId: 8, operationId: 4 }),
    ).toEqual(starting);
    expect(reduceRecording(starting, { type: "capture_failed", operationId: 2 })).toEqual(
      starting,
    );
  });
});
