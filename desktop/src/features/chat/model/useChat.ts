import { useCallback, useRef, useState } from "react";
import {
  createChat,
  deleteChat,
  listChats,
  listMessages,
  renameChat,
  sendMessage,
  type Chat,
  type Message,
} from "../../../shared/api/sidecar";
import { log } from "../../../shared/lib/logger";

export interface ChatSnapshot {
  entryId: number;
  chats: Chat[];
  activeChatId: number | null;
  messages: Message[];
}

interface ChatState extends ChatSnapshot {
  status: "idle" | "working" | "sending";
  streaming: string;
  error: string | null;
  /** Unsent composer text per chat id. Lives here, not in the box, so it
   * survives compact ↔ full switches and panel unmounts. */
  drafts: Readonly<Record<number, string>>;
  /** Unsent composer text for the chat that does not exist yet. */
  newDraft: string;
}

const EMPTY_CHAT: ChatState = {
  entryId: -1,
  chats: [],
  activeChatId: null,
  messages: [],
  status: "idle",
  streaming: "",
  error: null,
  drafts: {},
  newDraft: "",
};

export interface ChatController extends ChatState {
  busy: boolean;
  replace: (snapshot: ChatSnapshot) => void;
  cancel: () => void;
  /** Creates a chat and returns its id (null when it failed) so callers
   * like the palette can open the new chat immediately. */
  start: () => Promise<number | null>;
  select: (chatId: number) => Promise<void>;
  rename: (id: number, title: string | null) => Promise<void>;
  remove: (id: number) => Promise<void>;
  setDraft: (chatId: number | null, text: string) => void;
  ask: (content: string, prepare?: () => Promise<boolean>) => Promise<boolean>;
}

export function useChat(): ChatController {
  const [state, setRenderedState] = useState<ChatState>(EMPTY_CHAT);
  const stateRef = useRef<ChatState>(EMPTY_CHAT);
  const operationRef = useRef(0);
  const optimisticIdRef = useRef(0);
  const streamAbortRef = useRef<AbortController | null>(null);

  const commit = useCallback((update: (current: ChatState) => ChatState) => {
    const next = update(stateRef.current);
    stateRef.current = next;
    setRenderedState(next);
  }, []);

  const replace = useCallback(
    (snapshot: ChatSnapshot) => {
      streamAbortRef.current?.abort();
      streamAbortRef.current = null;
      ++operationRef.current;
      // A new entry owns a fresh set of drafts.
      commit(() => ({
        ...snapshot,
        status: "idle",
        streaming: "",
        error: null,
        drafts: {},
        newDraft: "",
      }));
    },
    [commit],
  );

  const cancel = useCallback(() => {
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    ++operationRef.current;
    commit((current) => ({ ...current, status: "idle", streaming: "", error: null }));
  }, [commit]);

  const start = useCallback(async (): Promise<number | null> => {
    const current = stateRef.current;
    if (current.status !== "idle" || current.entryId < 0) return null;
    const operationId = ++operationRef.current;
    commit((latest) => ({ ...latest, status: "working", error: null }));
    try {
      const chat = await createChat(current.entryId);
      if (operationId !== operationRef.current) return null;
      commit((latest) => ({
        ...latest,
        chats: [...latest.chats, chat],
        activeChatId: chat.id,
        messages: [],
        status: "idle",
        streaming: "",
        error: null,
      }));
      return chat.id;
    } catch (error) {
      if (operationId !== operationRef.current) return null;
      commit((latest) => ({
        ...latest,
        status: "idle",
        error: "A new chat could not be created.",
      }));
      log.error("chat.create_failed", { entryId: current.entryId }, error);
      return null;
    }
  }, [commit]);

  const select = useCallback(
    async (chatId: number) => {
      const current = stateRef.current;
      if (current.status !== "idle" || current.activeChatId === chatId) return;
      const operationId = ++operationRef.current;
      commit((latest) => ({ ...latest, status: "working", error: null }));
      try {
        const messages = await listMessages(chatId);
        if (operationId !== operationRef.current) return;
        commit((latest) => ({
          ...latest,
          activeChatId: chatId,
          messages,
          status: "idle",
          streaming: "",
        }));
      } catch (error) {
        if (operationId !== operationRef.current) return;
        commit((latest) => ({
          ...latest,
          status: "idle",
          error: "This chat could not be loaded.",
        }));
        log.error("chat.load_failed", { chatId }, error);
      }
    },
    [commit],
  );

  const rename = useCallback(
    async (id: number, title: string | null) => {
      if (stateRef.current.status !== "idle") return;
      const operationId = ++operationRef.current;
      commit((current) => ({ ...current, status: "working", error: null }));
      try {
        const renamed = await renameChat(id, title);
        if (operationId !== operationRef.current) return;
        commit((current) => ({
          ...current,
          status: "idle",
          chats: current.chats.map((chat) => (chat.id === id ? renamed : chat)),
        }));
      } catch (error) {
        if (operationId !== operationRef.current) return;
        commit((current) => ({
          ...current,
          status: "idle",
          error: "The chat could not be renamed.",
        }));
        log.error("chat.rename_failed", { chatId: id }, error);
      }
    },
    [commit],
  );

  const remove = useCallback(
    async (id: number) => {
      const current = stateRef.current;
      if (current.status !== "idle") return;
      const operationId = ++operationRef.current;
      let deleted = false;
      commit((latest) => ({ ...latest, status: "working", error: null }));
      try {
        await deleteChat(id);
        deleted = true;
        if (operationId !== operationRef.current) return;
        const remaining = stateRef.current.chats.filter((chat) => chat.id !== id);
        if (stateRef.current.activeChatId !== id) {
          commit((latest) => ({ ...latest, chats: remaining, status: "idle" }));
          return;
        }
        const next = remaining[remaining.length - 1] ?? null;
        commit((latest) => ({
          ...latest,
          chats: remaining,
          activeChatId: next?.id ?? null,
          messages: [],
          status: "working",
          streaming: "",
          error: null,
        }));
        const messages = next ? await listMessages(next.id) : [];
        if (operationId !== operationRef.current) return;
        commit((latest) => ({
          ...latest,
          messages,
          status: "idle",
        }));
      } catch (error) {
        if (operationId !== operationRef.current) return;
        commit((latest) => ({
          ...latest,
          status: "idle",
          error: deleted
            ? "The chat was deleted, but the next chat could not be loaded."
            : "The chat could not be deleted.",
        }));
        log.error(deleted ? "chat.delete_recovery_failed" : "chat.delete_failed", { chatId: id }, error);
      }
    },
    [commit],
  );

  const setDraft = useCallback(
    (chatId: number | null, text: string) => {
      commit((latest) =>
        chatId === null
          ? { ...latest, newDraft: text }
          : { ...latest, drafts: { ...latest.drafts, [chatId]: text } },
      );
    },
    [commit],
  );

  const ask = useCallback(
    async (content: string, prepare?: () => Promise<boolean>) => {
      const current = stateRef.current;
      if (current.status !== "idle" || current.entryId < 0) return false;
      const operationId = ++operationRef.current;
      commit((latest) => ({ ...latest, status: "working", error: null }));
      if (prepare && !(await prepare())) {
        if (operationId === operationRef.current) {
          commit((latest) => ({
            ...latest,
            status: "idle",
            error: "Save the note successfully before asking about it.",
          }));
        }
        return false;
      }
      if (operationId !== operationRef.current) return false;

      const prepared = stateRef.current;
      const optimisticId = --optimisticIdRef.current;
      // The draft key for this send — a new chat clears `newDraft`, an
      // existing one clears its own slot.
      const draftChatId = prepared.activeChatId;
      const needsTitle =
        !prepared.chats.find((chat) => chat.id === prepared.activeChatId)?.title &&
        prepared.messages.length === 0;
      commit((latest) => ({
        ...latest,
        status: "sending",
        streaming: "",
        error: null,
        messages: [
          ...latest.messages,
          {
            id: optimisticId,
            chatId: latest.activeChatId ?? -1,
            role: "user",
            content,
            createdAt: new Date().toISOString(),
          },
        ],
      }));

      let chatId = prepared.activeChatId;
      let completedMessage: Message | null = null;
      const streamAbort = new AbortController();
      streamAbortRef.current = streamAbort;
      try {
        if (chatId === null) {
          const chat = await createChat(prepared.entryId);
          if (operationId !== operationRef.current) return false;
          chatId = chat.id;
          commit((latest) => ({
            ...latest,
            chats: [...latest.chats, chat],
            activeChatId: chat.id,
          }));
        }

        completedMessage = await sendMessage(
          chatId,
          content,
          (delta) => {
            if (operationId !== operationRef.current) return;
            commit((latest) => ({ ...latest, streaming: latest.streaming + delta }));
          },
          streamAbort.signal,
        );
        if (operationId !== operationRef.current) return false;
        const [messages, refreshedChats] = await Promise.all([
          listMessages(chatId),
          needsTitle ? listChats(prepared.entryId) : Promise.resolve(null),
        ]);
        if (operationId !== operationRef.current) return false;
        commit((latest) => ({
          ...latest,
          messages,
          chats: refreshedChats ?? latest.chats,
          status: "idle",
          streaming: "",
          // The send was accepted — clear this chat's draft. A rejected
          // send returns false and leaves it intact for a retry.
          ...(draftChatId === null
            ? { newDraft: "" }
            : { drafts: { ...latest.drafts, [draftChatId]: "" } }),
        }));
        log.info("chat.completed", { entryId: prepared.entryId, chatId, operationId });
        return true;
      } catch (error) {
        if (operationId !== operationRef.current) return false;
        const replyWasSaved = completedMessage !== null;
        commit((latest) => ({
          ...latest,
          messages:
            completedMessage !== null &&
            !latest.messages.some((message) => message.id === completedMessage?.id)
              ? [...latest.messages, completedMessage]
              : latest.messages,
          status: "idle",
          streaming: "",
          error: replyWasSaved
            ? "The reply was saved, but the chat could not be refreshed. Reopen this chat to retry the refresh."
            : error instanceof Error
              ? error.message
              : "Chat failed.",
        }));
        log.error(
          replyWasSaved ? "chat.refresh_failed" : "chat.failed",
          { entryId: prepared.entryId, chatId, operationId },
          error,
        );
        return replyWasSaved;
      } finally {
        if (streamAbortRef.current === streamAbort) streamAbortRef.current = null;
      }
    },
    [commit],
  );

  return {
    ...state,
    busy: state.status !== "idle",
    replace,
    cancel,
    start,
    select,
    rename,
    remove,
    setDraft,
    ask,
  };
}
