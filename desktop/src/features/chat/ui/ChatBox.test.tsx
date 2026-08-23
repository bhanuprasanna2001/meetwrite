// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ChatBox from "./ChatBox";

afterEach(cleanup);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

const renderChat = (
  overrides: {
    mode?: "compact" | "full";
    draft?: string;
    onDraftChange?: (text: string) => void;
    onSend?: (content: string) => Promise<boolean>;
    onExpand?: () => void;
    onCollapse?: () => void;
    onBack?: () => void;
  } = {},
) => {
  const {
    mode = "compact",
    draft = "",
    onDraftChange = vi.fn(),
    onSend = vi.fn(() => Promise.resolve(true)),
    onExpand,
    onCollapse,
    onBack,
  } = overrides;
  return render(
    <ChatBox
      mode={mode}
      chats={[]}
      activeChatId={null}
      messages={[]}
      streaming=""
      error={null}
      disabled={false}
      busy={false}
      draft={draft}
      onDraftChange={onDraftChange}
      onNewChat={vi.fn()}
      onSelectChat={vi.fn()}
      onRenameChat={vi.fn()}
      onDeleteChat={vi.fn()}
      onSend={onSend}
      onExpand={onExpand}
      onCollapse={onCollapse}
      onBack={onBack}
    />,
  );
};

describe("ChatBox composer", () => {
  it("renders the controlled draft", () => {
    renderChat({ draft: "draft text" });
    const input = screen.getByLabelText<HTMLTextAreaElement>("Message");
    expect(input.value).toBe("draft text");
  });

  it("forwards typing to the draft owner", () => {
    const onDraftChange = vi.fn();
    renderChat({ onDraftChange, draft: "hello" });
    const input = screen.getByLabelText<HTMLTextAreaElement>("Message");

    fireEvent.change(input, { target: { value: "hello again" } });
    expect(onDraftChange).toHaveBeenCalledWith("hello again");
  });

  it("sends the trimmed draft on Enter, once per in-flight send", () => {
    const reply = deferred<boolean>();
    const onSend = vi.fn(() => reply.promise);
    // The draft is controlled, so it starts with the text to send.
    renderChat({ onSend, draft: "  hello  " });
    const input = screen.getByLabelText<HTMLTextAreaElement>("Message");

    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith("hello");
  });

  it("Shift+Enter starts a new line instead of sending", () => {
    const onSend = vi.fn(() => Promise.resolve(true));
    renderChat({ onSend, draft: "text" });
    const input = screen.getByLabelText<HTMLTextAreaElement>("Message");

    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("ignores Enter while the draft is empty", () => {
    const onSend = vi.fn(() => Promise.resolve(true));
    renderChat({ onSend });
    const input = screen.getByLabelText<HTMLTextAreaElement>("Message");

    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("disables the send button until there is something to send", () => {
    const onSend = vi.fn(() => Promise.resolve(true));
    renderChat({ onSend });
    const button = screen.getByLabelText<HTMLButtonElement>("Send");
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onSend).not.toHaveBeenCalled();
  });
});

describe("ChatBox modes", () => {
  it("compact offers expand and collapse, and calls them", () => {
    const onExpand = vi.fn();
    const onCollapse = vi.fn();
    renderChat({ onExpand, onCollapse });

    fireEvent.click(screen.getByLabelText("Open full chat"));
    expect(onExpand).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByLabelText("Close chat"));
    expect(onCollapse).toHaveBeenCalledOnce();
  });

  it("full mode backs out to the note", () => {
    const onBack = vi.fn();
    renderChat({ mode: "full", onBack });

    fireEvent.click(screen.getByLabelText("Back to note"));
    expect(onBack).toHaveBeenCalledOnce();
  });
});
