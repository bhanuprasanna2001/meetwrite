export type RecordingState =
  | { status: "idle" }
  | { status: "starting"; entryId: number; operationId: number }
  | { status: "active"; entryId: number; operationId: number; startedAt: number }
  | { status: "stopping"; entryId: number; operationId: number };

export type RecordingEvent =
  | { type: "start_requested"; entryId: number; operationId: number }
  | { type: "capture_started"; operationId: number; startedAt: number }
  | { type: "stop_requested"; operationId: number }
  | { type: "capture_finished"; operationId: number }
  | { type: "capture_failed"; operationId: number };

export const IDLE_RECORDING: RecordingState = { status: "idle" };

const belongsToCurrentRun = (state: RecordingState, operationId: number): boolean =>
  state.status !== "idle" && state.operationId === operationId;

/** Stale completions and invalid repeated clicks are deterministic no-ops. */
export function reduceRecording(
  state: RecordingState,
  event: RecordingEvent,
): RecordingState {
  switch (event.type) {
    case "start_requested":
      return state.status === "idle"
        ? {
            status: "starting",
            entryId: event.entryId,
            operationId: event.operationId,
          }
        : state;
    case "capture_started":
      return state.status === "starting" && belongsToCurrentRun(state, event.operationId)
        ? {
            status: "active",
            entryId: state.entryId,
            operationId: state.operationId,
            startedAt: event.startedAt,
          }
        : state;
    case "stop_requested":
      return (state.status === "starting" || state.status === "active") &&
        belongsToCurrentRun(state, event.operationId)
        ? { ...state, status: "stopping" }
        : state;
    case "capture_finished":
    case "capture_failed":
      return belongsToCurrentRun(state, event.operationId) ? IDLE_RECORDING : state;
  }
}

export function recordingOwnsAudio(state: RecordingState): boolean {
  return state.status !== "idle";
}

/** The REC timer's origin: set once capture is active, null otherwise. */
export function recordingStartedAt(state: RecordingState): number | null {
  return state.status === "active" ? state.startedAt : null;
}
