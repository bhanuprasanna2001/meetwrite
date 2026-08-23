import { useCallback, useEffect, useRef, useState } from "react";
import { log } from "../../../shared/lib/logger";
import type { WindowMode } from "../../../shared/platform/window";
import { Recorder } from "./recorder";
import {
  IDLE_RECORDING,
  recordingOwnsAudio,
  recordingStartedAt,
  reduceRecording,
  type RecordingEvent,
  type RecordingState,
} from "./recordingFlow";

interface RecordingOptions {
  entryId: number | null;
  enabled: boolean;
  enterMeetingOnRecord: boolean;
  windowMode: WindowMode;
  changeWindowMode: (mode: WindowMode) => void;
  onStopped: (entryId: number) => void | Promise<void>;
}

interface ActiveRecorder {
  operationId: number;
  entryId: number;
  recorder: Recorder;
}

export interface RecordingController {
  state: RecordingState;
  recording: boolean;
  /** The REC timer's origin while capture is active, null otherwise. */
  startedAt: number | null;
  error: string | null;
  toggle: () => void;
  stop: () => Promise<void>;
  stopBeforeUnload: () => void;
}

export function useRecording(options: RecordingOptions): RecordingController {
  const optionsRef = useRef(options);
  const stateRef = useRef<RecordingState>(IDLE_RECORDING);
  const recorderRef = useRef<ActiveRecorder | null>(null);
  const stopPromiseRef = useRef<Promise<void> | null>(null);
  const nextOperationId = useRef(0);
  const [state, setState] = useState<RecordingState>(IDLE_RECORDING);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const transition = useCallback((event: RecordingEvent) => {
    const previous = stateRef.current;
    const next = reduceRecording(previous, event);
    if (next === previous) return;
    stateRef.current = next;
    setState(next);
    log.info("recording.transition", {
      from: previous.status,
      to: next.status,
      operationId: "operationId" in event ? event.operationId : null,
    });
  }, []);

  const leaveMeetingMode = useCallback(() => {
    const current = optionsRef.current;
    if (current.enterMeetingOnRecord && current.windowMode === "meeting") {
      current.changeWindowMode("normal");
    }
  }, []);

  const finishUnexpectedly = useCallback(
    (operationId: number, entryId: number) => {
      if (recorderRef.current?.operationId !== operationId) return;
      recorderRef.current = null;
      transition({ type: "capture_finished", operationId });
      leaveMeetingMode();
      log.warn("recording.ended_unexpectedly", {
        entryId,
        operationId,
      });
      void optionsRef.current.onStopped(entryId);
    },
    [leaveMeetingMode, transition],
  );

  const beginUnexpectedFinalization = useCallback(
    (operationId: number, entryId: number) => {
      if (recorderRef.current?.operationId !== operationId) return;
      transition({ type: "stop_requested", operationId });
      leaveMeetingMode();
      setError(
        (previous) => previous ?? "The recording ended unexpectedly. Captured audio is being saved.",
      );
      log.warn("recording.finalizing_after_disconnect", { entryId, operationId });
    },
    [leaveMeetingMode, transition],
  );

  const stop = useCallback(async () => {
    const active = recorderRef.current;
    if (active === null) {
      await stopPromiseRef.current;
      return;
    }
    recorderRef.current = null;
    transition({ type: "stop_requested", operationId: active.operationId });
    leaveMeetingMode();
    const operation = (async () => {
      try {
        await active.recorder.stop();
        transition({ type: "capture_finished", operationId: active.operationId });
        log.info("recording.stopped", {
          entryId: active.entryId,
          operationId: active.operationId,
        });
        await optionsRef.current.onStopped(active.entryId);
      } catch (stopError) {
        transition({ type: "capture_failed", operationId: active.operationId });
        setError("The recording could not be finalized.");
        log.error(
          "recording.stop_failed",
          { entryId: active.entryId, operationId: active.operationId },
          stopError,
        );
      }
    })();
    stopPromiseRef.current = operation;
    await operation;
  }, [leaveMeetingMode, transition]);

  const start = useCallback(() => {
    const current = optionsRef.current;
    if (
      current.entryId === null ||
      !current.enabled ||
      stateRef.current.status !== "idle"
    ) {
      return;
    }

    const operationId = ++nextOperationId.current;
    const entryId = current.entryId;
    stopPromiseRef.current = null;
    transition({ type: "start_requested", entryId, operationId });
    setError(null);

    const recorder = new Recorder({
      onError: setError,
      onFinalizing: () => beginUnexpectedFinalization(operationId, entryId),
      onEnd: () => finishUnexpectedly(operationId, entryId),
    });
    const active: ActiveRecorder = { operationId, entryId, recorder };
    recorderRef.current = active;
    log.info("recording.start_requested", { entryId, operationId });

    void recorder
      .start(entryId)
      .then(() => {
        if (recorderRef.current?.operationId !== operationId) return;
        transition({ type: "capture_started", operationId, startedAt: Date.now() });
        const latest = optionsRef.current;
        if (latest.enterMeetingOnRecord && latest.windowMode !== "meeting") {
          latest.changeWindowMode("meeting");
        }
      })
      .catch(async (startError: unknown) => {
        if (recorderRef.current?.operationId !== operationId) return;
        recorderRef.current = null;
        const cleanup = recorder.stop().catch(() => undefined);
        stopPromiseRef.current = cleanup;
        await cleanup;
        transition({ type: "capture_failed", operationId });
        const message =
          startError instanceof Error ? startError.message : "Recording failed to start";
        setError(message);
        leaveMeetingMode();
        log.error("recording.start_failed", { entryId, operationId }, startError);
      });
  }, [beginUnexpectedFinalization, finishUnexpectedly, leaveMeetingMode, transition]);

  const toggle = useCallback(() => {
    if (stateRef.current.status === "idle") start();
    else if (
      stateRef.current.status === "starting" ||
      stateRef.current.status === "active"
    ) {
      void stop();
    }
  }, [start, stop]);

  const stopBeforeUnload = useCallback(() => {
    const active = recorderRef.current;
    recorderRef.current = null;
    void active?.recorder.stop();
  }, []);

  return {
    state,
    recording: recordingOwnsAudio(state),
    startedAt: recordingStartedAt(state),
    error,
    toggle,
    stop,
    stopBeforeUnload,
  };
}
