import { getCurrentWindow } from "@tauri-apps/api/window";
import { log } from "../shared/lib/logger";
import "./styles.css";
import { useAppController } from "./model/useAppController";
import StartupFailure from "./ui/StartupFailure";
import WorkspacePage from "../pages/workspace/ui/WorkspacePage";
import OnboardingPage from "../pages/onboarding/ui/OnboardingPage";
import SettingsPage from "../pages/settings/SettingsPage";
import Palette from "../features/command-palette/ui/Palette";
import EnhancePicker from "../features/enhance/ui/EnhancePicker";
import VersionPicker from "../features/enhance/ui/VersionPicker";
import TagEditor from "../features/entries/ui/TagEditor";
import MovePicker from "../features/folders/ui/MovePicker";
import TitleOverlay from "../features/notes/ui/TitleOverlay";
import ImageViewer from "../features/notes/ui/ImageViewer";
import HelpOverlay from "../features/help/ui/HelpOverlay";
import Tour from "../features/tour/ui/Tour";

export default function App() {
  const app = useAppController();
  const settings = app.boot.status === "ready" ? app.boot.settings : null;
  // One capability object, derived once in the controller, consumed by
  // every component below — no component re-derives the AI gate.
  const caps = app.caps;
  // The tag editor targets the note chosen from the folder view or palette,
  // falling back to the loaded note.
  const tagsTargetId = app.tagsTargetEntryId ?? app.workspace.entry?.id ?? null;
  const tagsSummary =
    tagsTargetId === null
      ? null
      : (app.workspace.entries.find((summary) => summary.id === tagsTargetId) ?? null);

  const toggleMaximize = (event: React.MouseEvent<HTMLDivElement>) => {
    if (
      app.ui.overlay !== null ||
      (event.target instanceof Element &&
        event.target.closest(
          "button, input, textarea, select, a, [contenteditable='true']",
        ))
    ) {
      return;
    }
    if (!("__TAURI_INTERNALS__" in window)) return;
    void getCurrentWindow()
      .toggleMaximize()
      .catch((error) => log.warn("window.toggle_maximize_failed", undefined, error));
  };

  return (
    <div
      className="flex h-full flex-col bg-paper text-ink dark:bg-ink dark:text-paper"
      data-tauri-drag-region="deep"
      onDoubleClick={toggleMaximize}
      inert={app.closing}
      aria-busy={app.closing}
    >
      <div className="flex min-h-0 flex-1 flex-col" inert={app.ui.overlay !== null}>
        {app.boot.status === "loading" && (
          <div
            className="flex min-h-0 flex-1 items-center justify-center"
            role="status"
            aria-label="Loading meetwrite"
          >
            <span className="text-sm font-medium tracking-wide text-ink-faint dark:text-paper-mute">
              meetwrite
            </span>
          </div>
        )}

        {app.boot.status === "error" && (
          <StartupFailure message={app.boot.message} onRetry={app.retryBoot} />
        )}

        {app.boot.status === "onboarding" && (
          <OnboardingPage
            permissions={app.boot.permissions}
            onDone={app.finishOnboarding}
            onOperationBusyChange={app.setSettingsOperationBusy}
          />
        )}

        {settings && app.ui.page === "workspace" && (
          <WorkspacePage
            workspace={app.workspace}
            settings={settings}
            userName={app.user?.name ?? null}
            keySet={app.keySet}
            caps={caps}
            view={app.ui.view}
            historyOpen={app.ui.historyOpen}
            windowMode={app.windowMode}
            enhanceEnabled={app.enhanceEnabled}
            settingsError={app.settingsError}
            noteMode={app.noteMode}
            onNoteModeChange={app.setNoteMode}
            onOpenImage={app.openImage}
            onOpenPeek={app.openPeek}
            onCollapsePeek={app.collapsePeek}
            onOpenChat={app.openFullChat}
            onOpenTranscript={app.openFullTranscript}
            onReturnToNote={app.returnToNote}
            onToggleHistory={() => app.transitionUi({ type: "history_toggled" })}
            onChangeSettings={app.updateSettings}
            onHelp={app.toggleHelp}
            onOpenSettings={() => void app.openSettings()}
            onPickVersion={app.toggleVersions}
            onEnhance={app.openEnhance}
            onDownload={app.downloadNote}
            onSearch={app.togglePalette}
            onEditTags={(id) => app.openTagEditor(id)}
            onBackFromTag={app.backFromTagView}
            insertImages={app.insertImages}
            addingImages={app.addingImages}
            onPickImages={app.pickImages}
          />
        )}

        {settings && app.ui.page === "settings" && app.user && (
          <SettingsPage
            userName={app.user.name}
            settings={settings}
            caps={caps}
            folders={app.workspace.folders}
            aiToggleBusy={app.aiToggleBusy}
            aiToggleError={app.aiToggleError}
            onSetAiEnabled={(enabled) => void app.setAiEnabled(enabled)}
            templates={app.templates}
            onTemplatesChanged={app.changeTemplate}
            dictionaryTerms={app.dictionaryTerms}
            onDictionarySaved={app.replaceDictionary}
            onDictionaryRemoved={app.removeDictionaryTerm}
            onChangeSettings={app.updateSettings}
            onEnableDailyNote={app.enableDailyNote}
            onSetupLeetCode={() => void app.setupLeetCode()}
            leetcodeBusy={app.leetcodeBusy}
            leetcodeError={app.leetcodeError}
            onSaveName={app.saveUserName}
            saveError={app.settingsError}
            onBack={app.closeSettings}
            onOperationBusyChange={app.setSettingsOperationBusy}
          />
        )}
      </div>

      {app.closeError && (
        <p
          role="alert"
          className="fixed bottom-4 left-1/2 z-[60] -translate-x-1/2 rounded-lg bg-ink px-4 py-2 text-xs text-paper shadow-lg dark:bg-paper dark:text-ink"
        >
          {app.closeError}
        </p>
      )}

      {settings && app.ui.overlay === "palette" && (
        <Palette
          entries={app.workspace.entries}
          folders={app.workspace.folders}
          chats={app.workspace.chat.chats}
          currentEntryId={app.workspace.entry?.id ?? null}
          aiEnabled={caps.ai}
          keySet={app.keySet}
          recording={app.workspace.recording.recording}
          meetingMode={app.windowMode.mode === "meeting"}
          dailyNoteEnabled={settings.dailyNoteEnabled}
          theme={settings.theme}
          noteMode={app.noteMode}
          insertImages={app.insertImages}
          onClose={app.closeOverlay}
          onRun={app.runPaletteCommand}
        />
      )}

      {app.ui.overlay === "tags" && tagsTargetId !== null && (
        <TagEditor
          key={tagsTargetId}
          initial={tagsSummary?.tags ?? []}
          suggestions={Array.from(
            new Set(app.workspace.entries.flatMap((summary) => summary.tags)),
          ).sort()}
          onSave={(tags) => {
            app.closeOverlay();
            void app.workspace.replaceTags(tagsTargetId, tags);
          }}
          onClose={app.closeOverlay}

        />
      )}

      {app.ui.overlay === "move" && app.workspace.entry && (
        <MovePicker
          folders={app.workspace.folders}
          currentFolderId={app.workspace.entry.folderId}
          onMove={(folderId) => {
            const entryId = app.workspace.entry?.id;
            app.closeOverlay();
            if (entryId !== undefined) {
              void app.workspace.moveEntryToFolder(entryId, folderId);
            }
          }}
          onClose={app.closeOverlay}
        />
      )}

      {app.ui.overlay === "title" && app.workspace.entry && (
        <TitleOverlay
          initial={app.workspace.entry.title ?? ""}
          suggested={app.titleDialog.status === "ready" ? app.titleDialog.suggested : null}
          loading={app.titleDialog.status === "loading"}
          onSave={(title) => void app.saveSuggestedTitle(title)}
          onClose={app.closeOverlay}
        />
      )}

      {app.ui.overlay === "help" && (
        <HelpOverlay caps={caps} onClose={app.closeOverlay} />
      )}
      {caps.ai && app.ui.overlay === "enhance" && (
        <EnhancePicker
          templates={app.templates}
          onClose={app.closeOverlay}
          onEnhance={(templateId, instructions) =>
            void app.workspace.runEnhance(templateId, instructions)
          }
        />
      )}
      {caps.ai && app.ui.overlay === "versions" && (
        <VersionPicker
          versions={app.workspace.enhance.versions}
          templates={app.templates}
          activeVersionId={app.workspace.enhance.activeVersionId}
          onClose={app.closeOverlay}
          onSelect={(id) => void app.workspace.selectVersion(id)}
        />
      )}
      {caps.ai && app.ui.overlay === "tour" && <Tour onClose={app.closeOverlay} />}
      {app.ui.overlay === "image" && app.imageViewer && (
        <ImageViewer
          entryId={app.imageViewer.entryId}
          imageId={app.imageViewer.image.id}
          title={app.imageViewer.image.title}
          onRename={(title) => app.renameViewerImage(title)}
          onDelete={app.deleteViewerImage}
          onClose={app.closeOverlay}
        />
      )}
    </div>
  );
}
