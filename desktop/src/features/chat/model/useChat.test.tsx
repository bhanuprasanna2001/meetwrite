// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sidecar = vi.hoisted(() => ({
  createChat: vi.fn(),
  deleteChat: vi.fn(),
  listChats: vi.fn(),
  listMessages: vi.fn(),
  renameChat: vi.fn(),
  sendMessage: vi.fn(),
}));

vi.mock("../../../shared/api/sidecar", () => sidecar);
vi.mock("../../../shared/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import type { Chat, Message } from "../../../shared/api/sidecar";
import { useChat } from "./useChat";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

const chat = (id: number, entryId = 4): Chat => ({
  id,
  entryId,
  title: `Chat ${id}`,
  createdAt: "2026-08-20T10:00:00Z",
});

const message = (id: number, chatId: number, content: string): Message => ({
  id,
  chatId,
  role: "assistant",
  content,
  createdAt: "2026-08-20T10:01:00Z",
});

describe("useChat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sidecar.listChats.mockResolvedValue([]);
    sidecar.listMessages.mockResolvedValue([]);
  });

  it("allows only one New chat request at a time", async () => {
    const creation = deferred<Chat>();
    sidecar.createChat.mockReturnValue(creation.promise);
    const { result } = renderHook(() => useChat());
    act(() => result.current.replace({
      entryId: 4,
      chats: [],
      activeChatId: null,
      messages: [],
    }));

    let first!: Promise<number | null>;
    act(() => {
      first = result.current.start();
      void result.current.start();
    });
    expect(sidecar.createChat).toHaveBeenCalledTimes(1);
    expect(result.current.busy).toBe(true);

    await act(async () => {
      creation.resolve(chat(10));
      await first;
    });
    expect(result.current.activeChatId).toBe(10);
    expect(result.current.busy).toBe(false);
  });

  it("ignores a streamed reply after another entry replaces its owner", async () => {
    const reply = deferred<Message>();
    let emitDelta: ((delta: string) => void) | undefined;
    sidecar.sendMessage.mockImplementation(
      (_chatId: number, _content: string, onDelta: (delta: string) => void) => {
        emitDelta = onDelta;
        return reply.promise;
      },
    );
    const { result } = renderHook(() => useChat());
    act(() => result.current.replace({
      entryId: 4,
      chats: [chat(10)],
      activeChatId: 10,
      messages: [],
    }));

    let request!: Promise<boolean>;
    act(() => { request = result.current.ask("old question"); });
    act(() => emitDelta?.("old answer"));
    expect(result.current.streaming).toBe("old answer");

    act(() => result.current.replace({
      entryId: 5,
      chats: [],
      activeChatId: null,
      messages: [],
    }));
    await act(async () => {
      reply.resolve(message(20, 10, "old answer"));
      await request;
    });

    expect(result.current.entryId).toBe(5);
    expect(result.current.messages).toEqual([]);
    expect(result.current.streaming).toBe("");
    expect(sidecar.listMessages).not.toHaveBeenCalled();
  });

  it("never restores a deleted chat when loading its successor fails", async () => {
    sidecar.deleteChat.mockResolvedValue(undefined);
    sidecar.listMessages.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useChat());
    act(() => result.current.replace({
      entryId: 4,
      chats: [chat(10), chat(11)],
      activeChatId: 11,
      messages: [message(30, 11, "old")],
    }));

    await act(async () => result.current.remove(11));

    expect(result.current.chats.map((item) => item.id)).toEqual([10]);
    expect(result.current.activeChatId).toBe(10);
    expect(result.current.messages).toEqual([]);
    expect(result.current.error).toContain("was deleted");
  });
});

describe("useChat drafts", () => {
  it("keeps per-chat drafts independent", () => {
    const { result } = renderHook(() => useChat());
    act(() => result.current.replace({
      entryId: 4,
      chats: [chat(10)],
      activeChatId: 10,
      messages: [],
    }));
    act(() => result.current.setDraft(10, "for ten"));
    act(() => result.current.setDraft(11, "for eleven"));
    act(() => result.current.setDraft(null, "for the new chat"));

    expect(result.current.drafts[10]).toBe("for ten");
    expect(result.current.drafts[11]).toBe("for eleven");
    expect(result.current.newDraft).toBe("for the new chat");
  });

  it("clears the draft when the send is accepted", async () => {
    const reply = deferred<Message>();
    sidecar.sendMessage.mockReturnValue(reply.promise);
    sidecar.listMessages.mockResolvedValue([message(20, 10, "answer")]);
    const { result } = renderHook(() => useChat());
    act(() => result.current.replace({
      entryId: 4,
      chats: [chat(10)],
      activeChatId: 10,
      messages: [],
    }));
    act(() => result.current.setDraft(10, "question"));

    let accepted!: boolean;
    let request!: Promise<boolean>;
    act(() => {
      request = result.current.ask("question");
    });
    await act(async () => {
      reply.resolve(message(20, 10, "answer"));
      accepted = await request;
    });

    expect(accepted).toBe(true);
    expect(result.current.drafts[10] ?? "").toBe("");
  });

  it("retains the draft when the send is rejected", async () => {
    sidecar.sendMessage.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useChat());
    act(() => result.current.replace({
      entryId: 4,
      chats: [chat(10)],
      activeChatId: 10,
      messages: [],
    }));
    act(() => result.current.setDraft(10, "question"));

    let accepted!: boolean;
    await act(async () => {
      accepted = await result.current.ask("question");
    });

    expect(accepted).toBe(false);
    expect(result.current.drafts[10]).toBe("question");
  });

  it("starts fresh drafts when another entry loads", () => {
    const { result } = renderHook(() => useChat());
    act(() => result.current.replace({
      entryId: 4,
      chats: [chat(10)],
      activeChatId: 10,
      messages: [],
    }));
    act(() => result.current.setDraft(10, "keep me"));

    act(() => result.current.replace({
      entryId: 5,
      chats: [],
      activeChatId: null,
      messages: [],
    }));

    expect(result.current.drafts).toEqual({});
    expect(result.current.newDraft).toBe("");
  });
});
