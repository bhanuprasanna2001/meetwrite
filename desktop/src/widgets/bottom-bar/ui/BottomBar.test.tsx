// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Settings } from "../../../shared/api/sidecar";
import BottomBar from "./BottomBar";

afterEach(cleanup);

const SETTINGS: Settings = {
  theme: "light",
  noteFont: "lato",
  noteFontSize: 20,
  enterMeetingOnRecord: true,
  aiEnabled: false,
  dailyNoteEnabled: false,
  dailyNoteFolderId: null,
  dailyNoteTime: "08:00",
};

const renderBar = (aiEnabled: boolean) =>
  render(
    <BottomBar
      settings={SETTINGS}
      caps={{ ai: aiEnabled }}
      onChange={vi.fn()}
      onHelp={vi.fn()}
      onNewEntry={vi.fn()}
      onToggleHistory={vi.fn()}
      historyOpen={false}
      windowMode="normal"
      onWindowMode={vi.fn()}
      onOpenSettings={vi.fn()}
      recording={false}
      stopping={false}
      keySet={false}
      copyText=""
      view="human"
      enhancing={false}
      enhanceEnabled={false}
      onPickVersion={vi.fn()}
      onEnhance={vi.fn()}
      onDownload={vi.fn()}
      onRecord={vi.fn()}
      noteMode="write"
      onNoteModeChange={vi.fn()}
      insertImages={true}
      addingImages={false}
      onPickImages={vi.fn()}
    />,
  );

describe("BottomBar window modes", () => {
  it("keeps Meeting (M) in notes-only mode — it is a note-taking layout", () => {
    renderBar(false);
    expect(
      screen.getByTitle("Meeting mode — right third of the screen").textContent,
    ).toBe("M");
  });

  it("hides every AI control in notes-only mode", () => {
    renderBar(false);
    expect(screen.queryByTitle(/Record the meeting/)).toBeNull();
    expect(screen.queryByText("Enhance")).toBeNull();
    expect(screen.queryByText("Human")).toBeNull();
  });
});

describe("BottomBar note controls", () => {
  it("shows the open-book toggle in write mode and the pencil in preview", () => {
    const onNoteModeChange = vi.fn();
    const { rerender } = render(
      <BottomBar
        settings={SETTINGS}
        caps={{ ai: false }}
        onChange={vi.fn()}
        onHelp={vi.fn()}
        onNewEntry={vi.fn()}
        onToggleHistory={vi.fn()}
        historyOpen={false}
        windowMode="normal"
        onWindowMode={vi.fn()}
        onOpenSettings={vi.fn()}
        recording={false}
        stopping={false}
        keySet={false}
        copyText=""
        view="human"
        enhancing={false}
        enhanceEnabled={false}
        onPickVersion={vi.fn()}
        onEnhance={vi.fn()}
        onDownload={vi.fn()}
        onRecord={vi.fn()}
        noteMode="write"
        onNoteModeChange={onNoteModeChange}
        insertImages={true}
        addingImages={false}
        onPickImages={vi.fn()}
      />,
    );

    // In write mode the button promises the preview (open book)…
    const button = screen.getByTitle("Preview note");
    fireEvent.click(button);
    expect(onNoteModeChange).toHaveBeenCalledWith("preview");

    // …and in preview mode it promises writing (pencil).
    rerender(
      <BottomBar
        settings={SETTINGS}
        caps={{ ai: false }}
        onChange={vi.fn()}
        onHelp={vi.fn()}
        onNewEntry={vi.fn()}
        onToggleHistory={vi.fn()}
        historyOpen={false}
        windowMode="normal"
        onWindowMode={vi.fn()}
        onOpenSettings={vi.fn()}
        recording={false}
        stopping={false}
        keySet={false}
        copyText=""
        view="human"
        enhancing={false}
        enhanceEnabled={false}
        onPickVersion={vi.fn()}
        onEnhance={vi.fn()}
        onDownload={vi.fn()}
        onRecord={vi.fn()}
        noteMode="preview"
        onNoteModeChange={onNoteModeChange}
        insertImages={true}
        addingImages={false}
        onPickImages={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTitle("Write note"));
    expect(onNoteModeChange).toHaveBeenCalledWith("write");
  });

  it("keeps the picture button in the bottom bar and drops it for enhanced notes", () => {
    const onPickImages = vi.fn();
    const { rerender } = render(
      <BottomBar
        settings={SETTINGS}
        caps={{ ai: false }}
        onChange={vi.fn()}
        onHelp={vi.fn()}
        onNewEntry={vi.fn()}
        onToggleHistory={vi.fn()}
        historyOpen={false}
        windowMode="normal"
        onWindowMode={vi.fn()}
        onOpenSettings={vi.fn()}
        recording={false}
        stopping={false}
        keySet={false}
        copyText=""
        view="human"
        enhancing={false}
        enhanceEnabled={false}
        onPickVersion={vi.fn()}
        onEnhance={vi.fn()}
        onDownload={vi.fn()}
        onRecord={vi.fn()}
        noteMode="write"
        onNoteModeChange={vi.fn()}
        insertImages={true}
        addingImages={false}
        onPickImages={onPickImages}
      />,
    );
    const pictureButton = screen.getByTitle("Add a picture (or paste / drop one)");
    expect(pictureButton).toBeTruthy();
    fireEvent.click(pictureButton);
    expect(onPickImages).toHaveBeenCalled();

    // An enhanced version never accepts pictures: the button disappears.
    rerender(
      <BottomBar
        settings={SETTINGS}
        caps={{ ai: false }}
        onChange={vi.fn()}
        onHelp={vi.fn()}
        onNewEntry={vi.fn()}
        onToggleHistory={vi.fn()}
        historyOpen={false}
        windowMode="normal"
        onWindowMode={vi.fn()}
        onOpenSettings={vi.fn()}
        recording={false}
        stopping={false}
        keySet={false}
        copyText=""
        view="enhanced"
        enhancing={false}
        enhanceEnabled={false}
        onPickVersion={vi.fn()}
        onEnhance={vi.fn()}
        onDownload={vi.fn()}
        onRecord={vi.fn()}
        noteMode="write"
        onNoteModeChange={vi.fn()}
        insertImages={false}
        addingImages={false}
        onPickImages={onPickImages}
      />,
    );
    expect(screen.queryByTitle("Add a picture (or paste / drop one)")).toBeNull();
  });

  it("turns the record button into a bare mic/stop icon with the same titles", () => {
    const onRecord = vi.fn();
    const { rerender } = render(
      <BottomBar
        settings={SETTINGS}
        caps={{ ai: true }}
        onChange={vi.fn()}
        onHelp={vi.fn()}
        onNewEntry={vi.fn()}
        onToggleHistory={vi.fn()}
        historyOpen={false}
        windowMode="normal"
        onWindowMode={vi.fn()}
        onOpenSettings={vi.fn()}
        recording={false}
        stopping={false}
        keySet={true}
        copyText=""
        view="human"
        enhancing={false}
        enhanceEnabled={false}
        onPickVersion={vi.fn()}
        onEnhance={vi.fn()}
        onDownload={vi.fn()}
        onRecord={onRecord}
        noteMode="write"
        onNoteModeChange={vi.fn()}
        insertImages={true}
        addingImages={false}
        onPickImages={vi.fn()}
      />,
    );
    const idle = screen.getByTitle(
      "Record the meeting (meeting mode + live transcript)",
    );
    fireEvent.click(idle);
    expect(onRecord).toHaveBeenCalled();

    rerender(
      <BottomBar
        settings={SETTINGS}
        caps={{ ai: true }}
        onChange={vi.fn()}
        onHelp={vi.fn()}
        onNewEntry={vi.fn()}
        onToggleHistory={vi.fn()}
        historyOpen={false}
        windowMode="normal"
        onWindowMode={vi.fn()}
        onOpenSettings={vi.fn()}
        recording={true}
        stopping={false}
        keySet={true}
        copyText=""
        view="human"
        enhancing={false}
        enhanceEnabled={false}
        onPickVersion={vi.fn()}
        onEnhance={vi.fn()}
        onDownload={vi.fn()}
        onRecord={onRecord}
        noteMode="write"
        onNoteModeChange={vi.fn()}
        insertImages={true}
        addingImages={false}
        onPickImages={vi.fn()}
      />,
    );
    // The stop face keeps the exact title it always had.
    fireEvent.click(screen.getByTitle("Stop recording"));
    expect(onRecord).toHaveBeenCalledTimes(2);
  });
});
