export type AppPage = "workspace" | "settings";
export type Overlay =
  | "palette"
  | "help"
  | "enhance"
  | "versions"
  | "tour"
  | "tags"
  | "move"
  | "title"
  | "image";

/** The one compact meeting panel that can sit under the note. */
export type Peek = "chat" | "transcript" | "audio";

/**
 * What owns the center of the workspace. Exactly one of these is true, so
 * impossible combinations (note + full chat, two peeks, full transcript +
 * peek) cannot be expressed:
 *
 * - `note`: the editor, with at most one compact meeting panel (`peek`).
 * - `chat`: full chat replaces the note. The editor stays mounted, hidden.
 * - `transcript`: full transcript replaces the note, same deal.
 * - `folder`: the folder's note list replaces the note — no peek, no full
 *   chat beneath it, nothing to "return" to.
 * - `tag`: every note with this tag, across all folders — same rules.
 *
 * `entryId` rides along on every note-owned variant so a view can never
 * outlive the note it belongs to — loading another note always rewrites the
 * whole view.
 */
export type WorkspaceView =
  | { kind: "note"; entryId: number; peek: Peek | null }
  | { kind: "chat"; entryId: number; chatId: number | null }
  | { kind: "transcript"; entryId: number }
  | { kind: "folder"; folderId: number }
  | { kind: "tag"; tag: string };

export interface AppUiState {
  page: AppPage;
  overlay: Overlay | null;
  view: WorkspaceView | null;
  historyOpen: boolean;
}

export const INITIAL_UI_STATE: AppUiState = {
  page: "workspace",
  overlay: null,
  view: null,
  historyOpen: false,
};

export type AppUiEvent =
  | { type: "workspace_opened" }
  | { type: "settings_opened" }
  | { type: "overlay_opened"; overlay: Overlay }
  | { type: "overlay_closed" }
  | { type: "note_opened"; entryId: number }
  | { type: "peek_opened"; peek: Peek }
  | { type: "peek_closed" }
  | { type: "chat_opened"; entryId: number; chatId: number | null }
  | { type: "transcript_opened"; entryId: number }
  | { type: "folder_opened"; folderId: number }
  | { type: "tag_opened"; tag: string }
  | { type: "view_returned" }
  | { type: "history_toggled" }
  | { type: "history_opened" }
  | { type: "meeting_mode_entered" };

/** Identifiers only — never content — for the view-transition log. */
export function describeView(view: WorkspaceView | null): object | null {
  if (view === null) return null;
  if (view.kind === "note") {
    return { kind: "note", entryId: view.entryId, peek: view.peek };
  }
  if (view.kind === "chat") {
    return { kind: "chat", entryId: view.entryId, chatId: view.chatId };
  }
  if (view.kind === "transcript") {
    return { kind: "transcript", entryId: view.entryId };
  }
  if (view.kind === "folder") {
    return { kind: "folder", folderId: view.folderId };
  }
  return { kind: "tag", tag: view.tag };
}

function unreachable(event: never): never {
  throw new Error(`Unhandled UI event: ${JSON.stringify(event)}`);
}

/**
 * One event has one defined result — the whole workspace view is a single
 * tagged value, so contradictory states cannot be stored. Events that do
 * not apply to the current view are no-ops, never partial transitions.
 * `overlay` is likewise a single value, so dialogs cannot stack, and the
 * first-run tour is modal until explicitly dismissed.
 */
export function reduceAppUi(state: AppUiState, event: AppUiEvent): AppUiState {
  switch (event.type) {
    case "workspace_opened":
      // The view survives a settings round-trip: coming back shows the same
      // note (and the same panel) the user left.
      return { ...state, page: "workspace", overlay: null };
    case "settings_opened":
      return {
        ...state,
        page: "settings",
        overlay: null,
        historyOpen: false,
      };
    case "overlay_opened":
      if (state.overlay === "tour" && event.overlay !== "tour") return state;
      return { ...state, overlay: event.overlay };
    case "overlay_closed":
      return { ...state, overlay: null };
    case "note_opened":
      return { ...state, view: { kind: "note", entryId: event.entryId, peek: null } };
    case "peek_opened":
      if (state.view === null || state.view.kind !== "note") return state;
      if (state.view.peek === event.peek) return state;
      return { ...state, view: { ...state.view, peek: event.peek } };
    case "peek_closed":
      if (state.view === null || state.view.kind !== "note") return state;
      if (state.view.peek === null) return state;
      return { ...state, view: { ...state.view, peek: null } };
    case "chat_opened":
      return {
        ...state,
        view: { kind: "chat", entryId: event.entryId, chatId: event.chatId },
      };
    case "transcript_opened":
      return { ...state, view: { kind: "transcript", entryId: event.entryId } };
    case "folder_opened":
      return { ...state, view: { kind: "folder", folderId: event.folderId } };
    case "tag_opened":
      return { ...state, view: { kind: "tag", tag: event.tag } };
    case "view_returned": {
      // Full chat/transcript → the same note with the matching compact
      // panel, so Escape is one reversible step. A note, folder, or tag
      // view is unchanged — those have no note beneath them to return to.
      const view = state.view;
      if (
        view === null ||
        view.kind === "note" ||
        view.kind === "folder" ||
        view.kind === "tag"
      ) {
        return state;
      }
      return {
        ...state,
        view: {
          kind: "note",
          entryId: view.entryId,
          peek: view.kind === "chat" ? "chat" : "transcript",
        },
      };
    }
    case "history_toggled":
      return { ...state, historyOpen: !state.historyOpen };
    case "history_opened":
      return { ...state, historyOpen: true };
    case "meeting_mode_entered":
      return { ...state, historyOpen: false };
    default:
      return unreachable(event);
  }
}
