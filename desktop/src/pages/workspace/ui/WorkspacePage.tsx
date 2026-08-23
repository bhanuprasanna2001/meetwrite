import type { Settings } from "../../../shared/api/sidecar";
import type { WindowMode } from "../../../shared/platform/window";
import type { Caps } from "../../../app/model/caps";
import type { Peek, WorkspaceView } from "../../../app/model/uiState";
import type { WorkspaceController } from "../model/useWorkspace";
import type { OutlineImage } from "../../../shared/api/sidecar";
import AudioBox from "../../../features/recording/ui/AudioBox";
import ChatBox from "../../../features/chat/ui/ChatBox";
import FolderView from "../../../features/folders/ui/FolderView";
import TagView from "../../../features/tags/ui/TagView";
import HistorySidebar from "../../../features/entries/ui/HistorySidebar";
import NoteEditor, { type NoteMode } from "../../../features/notes/ui/NoteEditor";
import TranscriptBox from "../../../features/transcript/ui/TranscriptBox";
import BottomBar from "../../../widgets/bottom-bar/ui/BottomBar";
import Wave from "../../../shared/ui/Wave";

interface WorkspacePageProps {
  workspace: WorkspaceController;
  settings: Settings;
  userName: string | null;
  keySet: boolean;
  /** The one capability gate, derived at the composition layer. */
  caps: Caps;
  /** The one center view. The reducer guarantees a single tagged state. */
  view: WorkspaceView | null;
  historyOpen: boolean;
  windowMode: { mode: WindowMode; change: (mode: WindowMode) => void };
  enhanceEnabled: boolean;
  settingsError: string | null;
  noteMode: NoteMode;
  onNoteModeChange: (mode: NoteMode) => void;
  /** Every image click — preview, sidebar, folder — opens the viewer. */
  onOpenImage: (entryId: number, image: OutlineImage) => void;
  onOpenPeek: (peek: Peek) => void;
  onCollapsePeek: () => void;
  onOpenChat: () => void;
  onOpenTranscript: () => void;
  onReturnToNote: () => void;
  onToggleHistory: () => void;
  onChangeSettings: (settings: Settings) => void;
  onHelp: () => void;
  onOpenSettings: () => void;
  onPickVersion: () => void;
  onEnhance: () => void;
  onDownload: () => void;
  onSearch: () => void;
  onEditTags: (entryId: number) => void;
  onBackFromTag: () => void;
  /** The one gate for the picture flow — the human note only. */
  insertImages: boolean;
  /** True while the picture batch uploads (BottomBar shows it). */
  addingImages: boolean;
  /** The one picture path — clicks the app's hidden file input. */
  onPickImages: () => void;
}

const TAB =
  "flex h-10 w-full cursor-pointer items-center justify-center rounded-lg border " +
  "border-ink-line bg-ink-surface text-[11px] font-medium uppercase tracking-wider " +
  "text-ink-mute hover:text-ink dark:border-paper-line dark:bg-paper-surface " +
  "dark:text-paper-mute dark:hover:text-paper";

function AudioTab({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg border border-ink-line bg-ink-surface text-ink-mute hover:text-ink dark:border-paper-line dark:bg-paper-surface dark:text-paper-mute dark:hover:text-paper"
      title="Audio"
      aria-label="Open audio"
    >
      <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" aria-hidden="true">
        <rect x="2" y="9" width="2.5" height="4" rx="1.25" fill="currentColor" />
        <rect x="6.75" y="5" width="2.5" height="8" rx="1.25" fill="currentColor" />
        <rect x="11.5" y="2" width="2.5" height="11" rx="1.25" fill="currentColor" />
      </svg>
    </button>
  );
}

function TranscriptTab({
  recording,
  onClick,
}: {
  recording: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className={`${TAB} gap-2`}>
      Transcript
      {recording && <Wave bars={5} className="h-3 gap-[2.5px]" />}
    </button>
  );
}

export default function WorkspacePage({
  workspace,
  settings,
  userName,
  keySet,
  caps,
  view,
  historyOpen,
  windowMode,
  enhanceEnabled,
  settingsError,
  noteMode,
  onNoteModeChange,
  onOpenImage,
  onOpenPeek,
  onCollapsePeek,
  onOpenChat,
  onOpenTranscript,
  onReturnToNote,
  onToggleHistory,
  onChangeSettings,
  onHelp,
  onOpenSettings,
  onPickVersion,
  onEnhance,
  onDownload,
  onSearch,
  onEditTags,
  onBackFromTag,
  insertImages,
  addingImages,
  onPickImages,
}: WorkspacePageProps) {
  const entry = workspace.entry;
  // Notes-only mode hides enhanced versions; the human note is the only view.
  const shownVersion = caps.ai ? workspace.enhance.activeVersion : null;
  const visibleError =
    workspace.error ??
    workspace.autosave.error ??
    workspace.enhance.error ??
    workspace.recording.error ??
    settingsError;
  const transitioning = workspace.status.status !== "idle";

  // A full view only owns the center while it still matches the loaded
  // entry — a note switch always rewrites the view first, so this guard
  // only covers the instant between the two. A folder view is matched
  // separately below.
  const full =
    view !== null &&
    (view.kind === "chat" || view.kind === "transcript") &&
    view.entryId === entry?.id
      ? view
      : null;
  const peek =
    view !== null && view.kind === "note" && view.entryId === entry?.id
      ? view.peek
      : null;
  // A folder or tag view replaces the editor like a full view does, but
  // neither has a note beneath it — no peek row, nothing to "return" to.
  const folderView =
    view !== null && view.kind === "folder"
      ? (workspace.folders.find((folder) => folder.id === view.folderId) ?? null)
      : null;
  const tagView = view !== null && view.kind === "tag" ? view.tag : null;
  const collectionView = folderView !== null || tagView !== null;

  const chat = workspace.chat;
  const chatDraft =
    chat.activeChatId === null
      ? chat.newDraft
      : (chat.drafts[chat.activeChatId] ?? "");

  return (
    // Clicking anywhere outside an open panel folds it (the panels row stops
    // propagation below). Collapse stays one defined action.
    <div
      className={`flex min-h-0 flex-1 flex-col ${transitioning ? "pointer-events-none" : ""}`}
      aria-busy={transitioning}
      inert={transitioning}
      onClick={() => {
        if (peek !== null) onCollapsePeek();
      }}
    >
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {entry && (
            // The editor stays mounted while a full or collection view owns
            // the center: hiding (not unmounting) keeps selection, autosave,
            // and focus.
            <div
              className={
                full !== null || collectionView
                  ? "hidden"
                  : "flex min-h-0 flex-1 flex-col"
              }
            >
              <NoteEditor
                key={entry.id}
                noteMd={(shownVersion ? shownVersion.content : entry.noteMd) ?? ""}
                settings={settings}
                readOnly={transitioning || workspace.enhance.busy}
                mode={noteMode}
                entryId={entry.id}
                images={entry.images}
                insertImages={insertImages}
                onChange={
                  shownVersion ? workspace.changeEnhancedNote : workspace.changeHumanNote
                }
                onUploadImage={workspace.addImage}
                onOpenImage={(image) => onOpenImage(entry.id, image)}
              />
            </div>
          )}

          {full?.kind === "chat" && (
            <ChatBox
              mode="full"
              key={full.entryId}
              chats={chat.chats}
              activeChatId={chat.activeChatId}
              messages={chat.messages}
              streaming={chat.streaming}
              error={chat.error}
              disabled={!keySet || chat.busy}
              busy={chat.busy}
              draft={chatDraft}
              onDraftChange={(text) => chat.setDraft(chat.activeChatId, text)}
              onNewChat={() => void chat.start()}
              onSelectChat={(id) => void chat.select(id)}
              onRenameChat={(id, title) => void chat.rename(id, title)}
              onDeleteChat={(id) => void chat.remove(id)}
              onSend={workspace.askChat}
              onBack={onReturnToNote}
            />
          )}

          {full?.kind === "transcript" && (
            <TranscriptBox
              mode="full"
              lines={workspace.transcript.lines}
              partials={workspace.transcript.partials}
              error={workspace.recording.error}
              recording={workspace.recording.recording}
              recordingStartedAt={workspace.recording.startedAt}
              entryTitle={entry?.title ?? null}
              entryCreatedAt={entry?.createdAt ?? null}
              userName={userName}
              onBack={onReturnToNote}
            />
          )}

          {folderView !== null && (
            <FolderView
              folder={folderView}
              entries={workspace.entries.filter(
                (summary) => summary.folderId === folderView.id,
              )}
              onOpenEntry={(id) => void workspace.openEntry(id)}
              onNewEntry={() => void workspace.newEntry(folderView.id)}
              onEditTags={onEditTags}
              onOpenTag={(tag) => void workspace.openTag(tag)}
              onOpenImage={(entryId, image) => onOpenImage(entryId, image)}
            />
          )}

          {tagView !== null && (
            <TagView
              tag={tagView}
              entries={workspace.entries.filter((summary) =>
                summary.tags.includes(tagView),
              )}
              folders={workspace.folders}
              onOpenEntry={(id) => void workspace.openEntry(id)}
              onOpenTag={(tag) => void workspace.openTag(tag)}
              onBack={onBackFromTag}
            />
          )}

          {entry && caps.ai && full === null && !collectionView && (
            <div
              className="mx-auto flex w-full max-w-3xl flex-none gap-2 px-8 pb-2"
              onClick={(event) => event.stopPropagation()}
            >
              {peek !== "transcript" && peek !== "audio" && (
                peek === "chat" ? (
                  <ChatBox
                    mode="compact"
                    key={entry.id}
                    chats={chat.chats}
                    activeChatId={chat.activeChatId}
                    messages={chat.messages}
                    streaming={chat.streaming}
                    error={chat.error}
                    disabled={!keySet || chat.busy}
                    busy={chat.busy}
                    draft={chatDraft}
                    onDraftChange={(text) => chat.setDraft(chat.activeChatId, text)}
                    onNewChat={() => void chat.start()}
                    onSelectChat={(id) => void chat.select(id)}
                    onRenameChat={(id, title) => void chat.rename(id, title)}
                    onDeleteChat={(id) => void chat.remove(id)}
                    onSend={workspace.askChat}
                    onExpand={onOpenChat}
                    onCollapse={onCollapsePeek}
                  />
                ) : (
                  <div className="flex min-w-0 flex-1">
                    <button type="button" className={TAB} onClick={() => onOpenPeek("chat")}>
                      Chat
                    </button>
                  </div>
                )
              )}
              {peek !== "chat" && peek !== "audio" && (
                peek === "transcript" ? (
                  <TranscriptBox
                    mode="compact"
                    lines={workspace.transcript.lines}
                    partials={workspace.transcript.partials}
                    error={workspace.recording.error}
                    recording={workspace.recording.recording}
                    recordingStartedAt={workspace.recording.startedAt}
                    entryTitle={entry.title}
                    entryCreatedAt={entry.createdAt}
                    userName={userName}
                    onExpand={onOpenTranscript}
                    onCollapse={onCollapsePeek}
                  />
                ) : (
                  <div className="flex min-w-0 flex-1">
                    <TranscriptTab
                      recording={workspace.recording.recording}
                      onClick={() => onOpenPeek("transcript")}
                    />
                  </div>
                )
              )}
              {peek !== "chat" && peek !== "transcript" && (
                peek === "audio" ? (
                  <AudioBox
                    entryId={entry.id}
                    recording={workspace.recording.recording}
                    onClose={onCollapsePeek}
                  />
                ) : (
                  <div className="flex-none">
                    <AudioTab onClick={() => onOpenPeek("audio")} />
                  </div>
                )
              )}
            </div>
          )}
          {visibleError && (
            <p className="mx-auto w-full max-w-3xl flex-none px-8 pb-1 text-xs leading-relaxed text-red-500">
              {visibleError}
            </p>
          )}
        </div>

        <HistorySidebar
          open={historyOpen && windowMode.mode !== "meeting"}
          folders={workspace.folders}
          entries={workspace.entries}
          activeId={entry?.id ?? null}
          activeFolderId={view?.kind === "folder" ? view.folderId : null}
          onOpen={(id) => void workspace.openEntry(id)}
          onOpenChatEntry={(id, chatId) =>
            void workspace.openEntry(id, { type: "chat", chatId })
          }
          onOpenTranscriptEntry={(id) =>
            void workspace.openEntry(id, { type: "transcript" })
          }
          onOpenFolder={(id) => void workspace.openFolder(id)}
          onOpenTag={(tag) => void workspace.openTag(tag)}
          activeTag={tagView}
          onCreateFolder={(name) => void workspace.createFolder(name)}
          onRenameFolder={(id, name) => void workspace.renameFolder(id, name)}
          onDeleteFolder={(id) => void workspace.removeFolder(id)}
          onDelete={(id) => void workspace.removeEntry(id)}
          onRename={(id, title) => void workspace.renameEntry(id, title)}
          onRenameTag={(tag, name) => void workspace.renameTag(tag, name)}
          onDeleteTag={(tag) => void workspace.removeTag(tag)}
          onLoadOutline={(id) => workspace.loadOutline(id)}
          onOpenImage={(entryId, image) => onOpenImage(entryId, image)}
          onSearch={onSearch}
        />
      </div>

      <BottomBar
        settings={settings}
        caps={caps}
        onChange={onChangeSettings}
        onHelp={onHelp}
        onNewEntry={() => void workspace.newEntry()}
        onToggleHistory={onToggleHistory}
        historyOpen={historyOpen}
        windowMode={windowMode.mode}
        onWindowMode={windowMode.change}
        onOpenSettings={onOpenSettings}
        recording={workspace.recording.recording}
        stopping={workspace.recording.stopping}
        keySet={keySet}
        copyText={(shownVersion?.content ?? entry?.noteMd) ?? ""}
        view={shownVersion ? "enhanced" : "human"}
        enhancing={workspace.enhance.busy}
        enhanceEnabled={enhanceEnabled}
        onPickVersion={onPickVersion}
        onEnhance={onEnhance}
        onDownload={onDownload}
        onRecord={workspace.recording.toggle}
        noteMode={noteMode}
        onNoteModeChange={onNoteModeChange}
        insertImages={insertImages}
        addingImages={addingImages}
        onPickImages={onPickImages}
      />
    </div>
  );
}
