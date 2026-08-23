import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import type { Chat, Message } from "../../../shared/api/sidecar";
import { BOX, CloseIcon, ExpandIcon, BackIcon } from "../../../shared/ui/meetingBox";
import CopyButton from "../../../shared/ui/CopyButton";
import { useThreadScroll } from "../../../shared/ui/useThreadScroll";
import MarkdownView from "../../../shared/markdown/MarkdownView";

/**
 * The chat surface in two forms, one component so they can never drift:
 *
 * - compact: the panel under the note (h-72), header with the chat selector,
 *   New, expand, and collapse controls.
 * - full: replaces the note, borderless, with a Back control. The editor
 *   stays mounted underneath, so nothing is lost by expanding.
 *
 * The composer draft is controlled from the chat controller (keyed by chat
 * id) — switching compact ↔ full or between chats never loses text. Enter
 * sends, Shift+Enter starts a new line, and only an accepted send clears the
 * draft. Copy appears on hover and keyboard focus. The thread follows new
 * content only while the user is at the bottom; otherwise a "Latest" pill
 * offers the jump back.
 */

/** A user message longer than this starts collapsed. */
const COLLAPSE_CHARS = 320;

/** Composer height bounds: one line (the send button's height) to about six. */
const MIN_COMPOSER_HEIGHT_PX = 28;
const MAX_COMPOSER_HEIGHT_PX = 140;

interface ChatBoxProps {
  mode: "compact" | "full";
  chats: Chat[];
  activeChatId: number | null;
  messages: Message[];
  streaming: string;
  error: string | null;
  disabled: boolean;
  busy: boolean;
  draft: string;
  onDraftChange: (text: string) => void;
  onNewChat: () => void;
  onSelectChat: (id: number) => void;
  onRenameChat: (id: number, title: string | null) => void;
  onDeleteChat: (id: number) => void;
  onSend: (content: string) => Promise<boolean>;
  /** Compact only: open the full chat for this entry. */
  onExpand?: () => void;
  /** Compact only: fold the panel away (explicit — never an outside click). */
  onCollapse?: () => void;
  /** Full only: return to the note with the compact chat panel. */
  onBack?: () => void;
}

const MUTE_LINK =
  "text-[11px] font-medium uppercase tracking-wider text-ink-mute " +
  "hover:text-ink dark:text-paper-mute dark:hover:text-paper";

const HEADER_BUTTON =
  "flex h-6 w-6 cursor-pointer items-center justify-center rounded " +
  "text-ink-faint hover:text-ink dark:text-paper-mute dark:hover:text-paper";

/** Stroke icons at the bottom bar's 16px size, like History's row controls. */
function XIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11.3 2.7a1.5 1.5 0 0 1 2.1 2.1L5.5 12.7 2 14l1.3-3.5 8-7.8Z" />
    </svg>
  );
}

/** The header's toggle: a clock with a counterclockwise arrow. */
function HistoryIcon() {
  return (
    <svg
      className="h-4 w-4 flex-none"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l4 2" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg
      className="h-3.5 w-3.5"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 12.5v-9M4.5 7 8 3.5 11.5 7" />
    </svg>
  );
}

const LABEL =
  "text-[10px] font-semibold uppercase tracking-[0.2em] " +
  "text-ink-faint dark:text-paper-mute";

const TEXT = "whitespace-pre-wrap text-[13px] leading-relaxed [overflow-wrap:anywhere]";

/** The composer: rounded, auto-growing textarea plus an explicit send. */
function Composer({
  draft,
  onDraftChange,
  disabled,
  busy,
  full,
  onSubmit,
}: {
  draft: string;
  onDraftChange: (text: string) => void;
  disabled: boolean;
  busy: boolean;
  full: boolean;
  onSubmit: (content: string) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Grow with the content, clamped to one..six lines. `full` re-measures
  // too: the textarea is wider in full mode, so the same draft can wrap
  // onto fewer lines.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea === null) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(
      Math.max(textarea.scrollHeight, MIN_COMPOSER_HEIGHT_PX),
      MAX_COMPOSER_HEIGHT_PX,
    )}px`;
  }, [draft, full]);

  const locked = disabled || busy;
  const canSend = !locked && draft.trim() !== "";

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (canSend) onSubmit(draft.trim());
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends; Shift+Enter (and IME composition) make a newline.
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      if (canSend) onSubmit(draft.trim());
    }
  };

  return (
    <form
      onSubmit={submit}
      className={`flex-none ${full ? "px-6 pb-5" : "px-3 pb-3"}`}
    >
      <div className={`mx-auto w-full ${full ? "max-w-3xl" : ""}`}>
        <div className="flex items-center gap-2 rounded-2xl border border-ink-line bg-paper/40 px-3.5 py-1.5 transition-colors focus-within:border-ink-mute dark:border-paper-line dark:bg-ink/40 dark:focus-within:border-paper-mute">
          <textarea
            ref={textareaRef}
            rows={1}
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={onKeyDown}
            disabled={locked}
            aria-label="Message"
            placeholder={
              busy
                ? "Waiting for the assistant…"
                : disabled
                  ? "Set an API key in Settings to chat"
                  : "Ask about the meeting"
            }
            className="max-h-40 min-w-0 flex-1 resize-none overflow-y-auto bg-transparent py-1 text-[13px] leading-tight text-ink outline-none placeholder:text-ink-faint disabled:opacity-50 dark:text-paper dark:placeholder:text-paper-mute"
          />
          <button
            type="submit"
            disabled={!canSend}
            aria-label="Send"
            title="Send"
            className="flex h-7 w-7 flex-none cursor-pointer items-center justify-center rounded-full bg-ink text-paper transition-opacity disabled:cursor-default disabled:opacity-30 dark:bg-paper dark:text-ink"
          >
            <SendIcon />
          </button>
        </div>
      </div>
    </form>
  );
}

export default function ChatBox({
  mode,
  chats,
  activeChatId,
  messages,
  streaming,
  error,
  disabled,
  busy,
  draft,
  onDraftChange,
  onNewChat,
  onSelectChat,
  onRenameChat,
  onDeleteChat,
  onSend,
  onExpand,
  onCollapse,
  onBack,
}: ChatBoxProps) {
  const full = mode === "full";
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const [editingId, setEditingId] = useState<number | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  // The chat list starts folded away so the messages own the whole box.
  const [listOpen, setListOpen] = useState(false);
  // Mirrors editingId so commit/cancel is decided synchronously: Enter
  // commits and unmounts the input, and a blur right after must not commit
  // a second time (same pattern as the History sidebar).
  const editingRef = useRef<number | null>(null);
  const submittingRef = useRef(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const thread = useThreadScroll(listRef, [messages, streaming]);

  const toggleExpanded = (id: number) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const startRename = (id: number, title: string | null) => {
    editingRef.current = id;
    setTitleDraft(title ?? "");
    setEditingId(id);
  };

  const stopRename = () => {
    editingRef.current = null;
    setEditingId(null);
  };

  const commitRename = (id: number) => {
    if (editingRef.current !== id) return; // Already committed or cancelled.
    const title = titleDraft.trim();
    stopRename();
    onRenameChat(id, title || null);
  };

  const submit = (content: string) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    void onSend(content).finally(() => {
      submittingRef.current = false;
    });
  };

  /** Selecting (or starting) a chat hands the full box back to messages. */
  const openChat = (id: number) => {
    setListOpen(false);
    onSelectChat(id);
  };

  const newChat = () => {
    setListOpen(false);
    onNewChat();
  };

  const activeChat = chats.find((chat) => chat.id === activeChatId);
  const showEmptyState =
    messages.length === 0 && !streaming && !error;

  return (
    <section
      className={
        full ? "relative flex min-h-0 flex-1 flex-col" : `${BOX} relative`
      }
      aria-label="Chat"
    >
      <header
        className={`relative flex flex-none items-center border-b border-ink-line dark:border-paper-line ${
          full ? "px-4 py-1.5" : "px-3 pb-1.5 pt-2.5"
        }`}
      >
        <div className={`flex w-full items-center gap-1.5 ${full ? "mx-auto max-w-3xl" : ""}`}>
        {full && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to note"
            title="Back to note (Esc)"
            className={HEADER_BUTTON}
          >
            <BackIcon />
          </button>
        )}
        <button
          type="button"
          onClick={() => setListOpen((open) => !open)}
          aria-label={listOpen ? "Hide chats" : "Show chats"}
          title={listOpen ? "Hide chats" : "Show chats"}
          aria-expanded={listOpen}
          className={`flex min-w-0 flex-1 items-center gap-1.5 text-left hover:text-ink dark:hover:text-paper ${
            listOpen ? "text-ink dark:text-paper" : "text-ink-mute dark:text-paper-mute"
          }`}
        >
          <HistoryIcon />
          <span className="min-w-0 flex-1 truncate text-[12px] font-medium">
            {activeChat ? activeChat.title || "Untitled chat" : "Chats"}
          </span>
        </button>
        <button type="button" className={MUTE_LINK} onClick={newChat} disabled={busy}>
          New
        </button>
        {!full && (
          <>
            <button
              type="button"
              onClick={onExpand}
              aria-label="Open full chat"
              title="Open full chat"
              className={HEADER_BUTTON}
            >
              <ExpandIcon />
            </button>
            <button
              type="button"
              onClick={onCollapse}
              aria-label="Close chat"
              title="Close chat"
              className={HEADER_BUTTON}
            >
              <CloseIcon />
            </button>
          </>
        )}
        </div>

        {/* The chat list floats over the messages — it never pushes them. */}
        <div
          aria-hidden={!listOpen}
          className={`absolute left-3 top-full z-10 mt-1.5 w-64 max-w-[calc(100%-1.5rem)] origin-top rounded-lg border border-ink-line bg-paper py-1 shadow-md transition-all duration-150 dark:border-paper-line dark:bg-ink ${
            listOpen ? "visible translate-y-0 opacity-100" : "invisible -translate-y-1 opacity-0"
          }`}
        >
          <ul className="max-h-48 overflow-y-auto">
            {chats.length === 0 && (
              <li className="px-3 py-2 text-xs text-ink-faint dark:text-paper-mute">
                No chats yet
              </li>
            )}
            {chats.map((chat) => (
              <li key={chat.id} className="group relative">
                {editingId === chat.id ? (
                  <div className="px-3 py-1">
                    <input
                      autoFocus
                      value={titleDraft}
                      onChange={(event) => setTitleDraft(event.target.value)}
                      onBlur={() => commitRename(chat.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") commitRename(chat.id);
                        if (event.key === "Escape") stopRename();
                      }}
                      aria-label="Rename chat"
                      className="w-full border-b border-ink-line bg-transparent pb-0.5 text-[13px] text-ink outline-none dark:border-paper-line dark:text-paper"
                    />
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => openChat(chat.id)}
                      disabled={busy}
                      className={`block w-full truncate py-1.5 pl-3 pr-16 text-left text-[13px] text-ink-soft hover:bg-ink-line/50 dark:text-paper dark:hover:bg-paper-line/20 ${
                        chat.id === activeChatId ? "bg-ink-line/60 dark:bg-paper-line/25" : ""
                      }`}
                    >
                      {chat.title || "Untitled chat"}
                    </button>
                    <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                      <button
                        type="button"
                        onClick={() => startRename(chat.id, chat.title)}
                        disabled={busy}
                        aria-label="Rename chat"
                        title="Rename chat"
                        className="px-2 py-1 text-ink-faint hover:text-ink dark:text-paper-mute dark:hover:text-paper"
                      >
                        <PencilIcon />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteChat(chat.id)}
                        disabled={busy}
                        aria-label="Delete chat"
                        title="Delete chat"
                        className="px-2 py-1 text-ink-faint hover:text-ink dark:text-paper-mute dark:hover:text-paper"
                      >
                        <XIcon />
                      </button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={listRef}
          onScroll={thread.onScroll}
          onClick={() => listOpen && setListOpen(false)}
          className={`flex min-h-0 flex-1 flex-col overflow-y-auto ${
            full ? "gap-4 px-6 py-4" : "gap-2.5 px-3 pb-2"
          }`}
        >
        {showEmptyState && (
          <div
            className={`flex min-h-0 flex-1 flex-col justify-center text-center ${
              full ? "mx-auto w-full max-w-3xl" : ""
            }`}
          >
            <p className="text-xs leading-relaxed text-ink-faint dark:text-paper-mute">
              Ask about the meeting — answers come from the transcript and your notes.
            </p>
            {full && activeChatId === null && (
              <button
                type="button"
                onClick={newChat}
                disabled={busy}
                className="mx-auto mt-3 cursor-pointer rounded-lg border border-ink-line px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-mute hover:text-ink disabled:opacity-50 dark:border-paper-line dark:text-paper-mute dark:hover:text-paper"
              >
                New chat
              </button>
            )}
          </div>
        )}

        <div
          className={`flex w-full flex-col ${
            full ? "mx-auto max-w-3xl gap-4" : "gap-2.5"
          }`}
        >
          {messages.map((message) => {
            const isUser = message.role === "user";
            // Only the user's own long messages collapse — assistant answers
            // are always readable in full.
            const long = isUser && message.content.length > COLLAPSE_CHARS;
            const open = expanded.has(message.id);
            return (
              <div
                key={message.id}
                className={`group flex max-w-[85%] flex-col gap-1 ${
                  isUser ? "self-end items-end" : "self-start items-start"
                }`}
              >
                <div className="flex items-center gap-1.5">
                  {isUser && (
                    <CopyButton
                      text={message.content}
                      size="sm"
                      className="opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
                    />
                  )}
                  <p className={LABEL}>{isUser ? "You" : "Assistant"}</p>
                  {!isUser && (
                    <CopyButton
                      text={message.content}
                      size="sm"
                      className="opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
                    />
                  )}
                </div>
                {isUser ? (
                  // Restrained content-width bubble, flush right.
                  <p
                    className={`max-w-full rounded-2xl rounded-br-md bg-ink-surface px-3.5 py-2 text-ink-soft dark:bg-paper-surface dark:text-paper ${TEXT} ${
                      long && !open ? "line-clamp-5" : ""
                    }`}
                  >
                    {message.content}
                  </p>
                ) : (
                  // Assistant answers are rendered prose — the same markdown
                  // surface as the note preview, so formatting never drifts.
                  <div
                    className={`max-w-full text-ink dark:text-paper ${
                      long && !open ? "line-clamp-5" : ""
                    }`}
                  >
                    <MarkdownView markdown={message.content} />
                  </div>
                )}
                {long && (
                  <button
                    type="button"
                    onClick={() => toggleExpanded(message.id)}
                    className={`mt-0.5 w-full text-[11px] font-medium uppercase tracking-wider text-ink-faint hover:text-ink dark:text-paper-mute dark:hover:text-paper ${
                      isUser ? "text-right" : "text-left"
                    }`}
                  >
                    {open ? "Show less" : "Show more"}
                  </button>
                )}
              </div>
            );
          })}
          {streaming && (
            <div className="flex max-w-[85%] flex-col gap-1 self-start">
              <p className={LABEL}>Assistant</p>
              <p className={`${TEXT} text-ink-soft dark:text-paper-mute`}>{streaming}</p>
            </div>
          )}
          {error && (
            <p className="self-start text-xs leading-relaxed text-ink-mute dark:text-paper-mute">
              {error}
            </p>
          )}
        </div>
      </div>

      {thread.showJump && (
        <button
          type="button"
          onClick={thread.jumpToLatest}
          className={`absolute z-10 cursor-pointer rounded-full border border-ink-line bg-paper px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-ink-mute shadow-sm hover:text-ink dark:border-paper-line dark:bg-ink dark:text-paper-mute dark:hover:text-paper ${
            full ? "bottom-3 left-1/2 -translate-x-1/2" : "bottom-2 right-2"
          }`}
        >
          Latest ↓
        </button>
      )}
      </div>

      <Composer
        draft={draft}
        onDraftChange={onDraftChange}
        disabled={disabled}
        busy={busy}
        full={full}
        onSubmit={submit}
      />
    </section>
  );
}
