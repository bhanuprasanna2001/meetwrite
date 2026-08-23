import { describe, expect, it } from "vitest";
import {
  INITIAL_UI_STATE,
  reduceAppUi,
  type AppUiEvent,
  type AppUiState,
  type Peek,
} from "./uiState";

/** A reducer walk: fold a list of events over the state. */
function run(state: AppUiState, ...events: AppUiEvent[]): AppUiState {
  return events.reduce(reduceAppUi, state);
}

const noteView = (entryId: number, peek: Peek | null) => ({
  kind: "note" as const,
  entryId,
  peek,
});

describe("reduceAppUi — workspace view", () => {
  it("lands on the note, collapsed, when an entry loads", () => {
    const state = run(INITIAL_UI_STATE, { type: "note_opened", entryId: 4 });
    expect(state.view).toEqual(noteView(4, null));
  });

  it("opening another note always returns to note + collapsed", () => {
    const fullChat = run(
      INITIAL_UI_STATE,
      { type: "note_opened", entryId: 4 },
      { type: "chat_opened", entryId: 4, chatId: 9 },
    );
    const next = reduceAppUi(fullChat, { type: "note_opened", entryId: 5 });
    expect(next.view).toEqual(noteView(5, null));
  });

  it("opens and closes exactly one peek", () => {
    const state = run(
      INITIAL_UI_STATE,
      { type: "note_opened", entryId: 4 },
      { type: "peek_opened", peek: "chat" },
    );
    expect(state.view).toEqual(noteView(4, "chat"));

    const collapsed = reduceAppUi(state, { type: "peek_closed" });
    expect(collapsed.view).toEqual(noteView(4, null));
  });

  it("peek events are no-ops while a full view owns the center", () => {
    const full = run(
      INITIAL_UI_STATE,
      { type: "note_opened", entryId: 4 },
      { type: "transcript_opened", entryId: 4 },
    );
    const after = run(full, { type: "peek_opened", peek: "audio" }, { type: "peek_closed" });
    expect(after.view).toEqual({ kind: "transcript", entryId: 4 });
  });

  it("returning from a full view lands on the note with the matching peek", () => {
    const fromChat = reduceAppUi(
      run(
        INITIAL_UI_STATE,
        { type: "note_opened", entryId: 4 },
        { type: "chat_opened", entryId: 4, chatId: 9 },
      ),
      { type: "view_returned" },
    );
    expect(fromChat.view).toEqual(noteView(4, "chat"));

    const fromTranscript = reduceAppUi(
      run(
        INITIAL_UI_STATE,
        { type: "note_opened", entryId: 4 },
        { type: "transcript_opened", entryId: 4 },
      ),
      { type: "view_returned" },
    );
    expect(fromTranscript.view).toEqual(noteView(4, "transcript"));

    // From a note view, returning is a no-op — the note is already shown.
    const fromNote = reduceAppUi(
      run(INITIAL_UI_STATE, { type: "note_opened", entryId: 4 }),
      { type: "view_returned" },
    );
    expect(fromNote.view).toEqual(noteView(4, null));
  });

  it("keeps the view across a settings round-trip", () => {
    const state = run(
      INITIAL_UI_STATE,
      { type: "note_opened", entryId: 4 },
      { type: "peek_opened", peek: "chat" },
      { type: "settings_opened" },
      { type: "workspace_opened" },
    );
    expect(state.page).toBe("workspace");
    expect(state.view).toEqual(noteView(4, "chat"));
  });

  it("a folder is the one center view, with no peek beneath it", () => {
    const state = reduceAppUi(INITIAL_UI_STATE, {
      type: "folder_opened",
      folderId: 7,
    });
    expect(state.view).toEqual({ kind: "folder", folderId: 7 });

    // Peek and return events cannot touch a folder view.
    const afterPeek = run(
      state,
      { type: "peek_opened", peek: "chat" },
      { type: "peek_closed" },
      { type: "view_returned" },
    );
    expect(afterPeek.view).toEqual({ kind: "folder", folderId: 7 });
  });

  it("opening a note or another folder always replaces the folder view", () => {
    const folder = reduceAppUi(INITIAL_UI_STATE, {
      type: "folder_opened",
      folderId: 7,
    });
    const note = reduceAppUi(folder, { type: "note_opened", entryId: 4 });
    expect(note.view).toEqual(noteView(4, null));

    const otherFolder = reduceAppUi(folder, { type: "folder_opened", folderId: 9 });
    expect(otherFolder.view).toEqual({ kind: "folder", folderId: 9 });
  });

  it("a tag is a center view with no peek, and opening a note replaces it", () => {
    const tag = reduceAppUi(INITIAL_UI_STATE, { type: "tag_opened", tag: "dp" });
    expect(tag.view).toEqual({ kind: "tag", tag: "dp" });

    const afterEvents = run(
      tag,
      { type: "peek_opened", peek: "chat" },
      { type: "view_returned" },
    );
    expect(afterEvents.view).toEqual({ kind: "tag", tag: "dp" });

    const note = reduceAppUi(tag, { type: "note_opened", entryId: 4 });
    expect(note.view).toEqual(noteView(4, null));

    // Folder and tag views replace each other, like any two center views.
    const folder = reduceAppUi(tag, { type: "folder_opened", folderId: 7 });
    expect(folder.view).toEqual({ kind: "folder", folderId: 7 });
  });
});

describe("reduceAppUi — overlay and window chrome", () => {
  it("replaces one overlay with another instead of stacking flags", () => {
    const palette = reduceAppUi(INITIAL_UI_STATE, {
      type: "overlay_opened",
      overlay: "palette",
    });
    const help = reduceAppUi(palette, { type: "overlay_opened", overlay: "help" });
    expect(help.overlay).toBe("help");
  });

  it("makes the tour modal until it is explicitly dismissed", () => {
    const tour = reduceAppUi(INITIAL_UI_STATE, {
      type: "overlay_opened",
      overlay: "tour",
    });
    expect(
      reduceAppUi(tour, { type: "overlay_opened", overlay: "palette" }),
    ).toEqual(tour);
    expect(reduceAppUi(tour, { type: "overlay_closed" }).overlay).toBeNull();
  });

  it("closes transient UI when settings opens", () => {
    const busy = {
      ...INITIAL_UI_STATE,
      overlay: "help" as const,
      historyOpen: true,
    };
    expect(reduceAppUi(busy, { type: "settings_opened" })).toEqual({
      ...busy,
      page: "settings",
      overlay: null,
      historyOpen: false,
    });
  });

  it("closes history when meeting mode starts", () => {
    const open = { ...INITIAL_UI_STATE, historyOpen: true };
    expect(reduceAppUi(open, { type: "meeting_mode_entered" }).historyOpen).toBe(false);
  });
});

