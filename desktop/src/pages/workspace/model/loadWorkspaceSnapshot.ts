import {
  getEnhancedVersions,
  getTranscriptLines,
  listChats,
  listMessages,
  type Chat,
  type EnhancedVersion,
  type Entry,
  type Message,
} from "../../../shared/api/sidecar";
import { orderLines, EMPTY_PARTIALS } from "../../../features/transcript/model/transcript";
import type { TranscriptState } from "../../../features/transcript/model/useTranscript";
import type { ChatSnapshot } from "../../../features/chat/model/useChat";

export interface WorkspaceSnapshot {
  entry: Entry;
  transcript: TranscriptState;
  versions: EnhancedVersion[];
  chat: ChatSnapshot;
}

/** Fetch first, commit later: an entry can never render with another entry's data. */
export async function loadWorkspaceSnapshot(entry: Entry): Promise<WorkspaceSnapshot> {
  const [lines, versions, chats] = await Promise.all([
    getTranscriptLines(entry.id),
    getEnhancedVersions(entry.id),
    listChats(entry.id),
  ]);
  const activeChat: Chat | null = chats[chats.length - 1] ?? null;
  const messages: Message[] = activeChat ? await listMessages(activeChat.id) : [];
  return {
    entry,
    transcript: {
      lines: orderLines(lines),
      partials: EMPTY_PARTIALS,
    },
    versions,
    chat: {
      entryId: entry.id,
      chats,
      activeChatId: activeChat?.id ?? null,
      messages,
    },
  };
}
