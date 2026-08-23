import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  getKeyStatus,
  getOrCreateDailyNote,
  getSettings,
  getUser,
  listDictionary,
  listTemplates,
  saveName,
  saveSettings,
  setupLeetCodeWorkflow,
  type DictionaryTerm,
  type OutlineImage,
  type Settings,
  type Template,
  type Theme,
  type User,
} from "../../shared/api/sidecar";
import { isApiError } from "../../shared/api/client";
import { downloadFileName, downloadMarkdown, type NoteView } from "../../shared/lib/download";
import { millisUntilNextTime, timePassedToday, todayLocalIso } from "../../shared/lib/dates";
import { log } from "../../shared/lib/logger";
import type { Permissions } from "../../shared/platform/permissions";
import { matchShortcut, registerAppMenu } from "../../shared/platform/shortcuts";
import { applyTheme, startupTheme } from "../../shared/platform/theme";
import { hasSeenTour, markTourSeen } from "../../features/tour/model/tour";
import { hasEnhanceSource } from "../../features/transcript/model/transcript";
import type { NoteMode } from "../../features/notes/ui/NoteEditor";
import { useWorkspace, type EntryOpenTarget } from "../../pages/workspace/model/useWorkspace";
import type { PaletteItem } from "../../features/command-palette/model/palette";
import { closeInOrder } from "./closeFlow";
import { deriveCaps, type Caps } from "./caps";
import {
  describeView,
  INITIAL_UI_STATE,
  reduceAppUi,
  type AppUiEvent,
  type AppUiState,
  type Overlay,
  type Peek,
} from "./uiState";
import { useWindowMode } from "./useWindowMode";

export type BootState =
  | { status: "loading" }
  | { status: "onboarding"; permissions: Permissions }
  | { status: "ready"; settings: Settings }
  | { status: "error"; message: string };

/** The title dialog: idle (rename), loading (suggest in flight), or ready. */
export type TitleDialog =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; suggested: string };

const NO_PERMISSIONS: Permissions = { microphone: "denied", systemAudio: "denied" };
const SIDECAR_WAIT_ATTEMPTS = 20;
const SIDECAR_WAIT_DELAY_MS = 500;

const DEFAULT_SETTINGS: Settings = {
  theme: "light",
  noteFont: "lato",
  noteFontSize: 20,
  enterMeetingOnRecord: true,
  aiEnabled: true,
  dailyNoteEnabled: false,
  dailyNoteFolderId: null,
  dailyNoteTime: "08:00",
};

const wait = (durationMs: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, durationMs));

/** Retry only genuine connection failures. A server error is never onboarding. */
export async function getUserWhenReady(): Promise<User | null> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= SIDECAR_WAIT_ATTEMPTS; attempt += 1) {
    try {
      return await getUser();
    } catch (error) {
      if (
        !isApiError(error) ||
        (error.kind !== "offline" && error.kind !== "timeout")
      ) {
        throw error;
      }
      lastError = error;
      if (attempt < SIDECAR_WAIT_ATTEMPTS) await wait(SIDECAR_WAIT_DELAY_MS);
    }
  }
  throw lastError;
}

export function useAppController() {
  const [boot, setBoot] = useState<BootState>({ status: "loading" });
  const [user, setUser] = useState<User | null>(null);
  const [keySet, setKeySet] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [dictionaryTerms, setDictionaryTerms] = useState<DictionaryTerm[]>([]);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [aiToggleBusy, setAiToggleBusy] = useState(false);
  const [aiToggleError, setAiToggleError] = useState<string | null>(null);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [bootAttempt, setBootAttempt] = useState(0);
  const [titleDialog, setTitleDialog] = useState<TitleDialog>({ status: "idle" });
  // Which note the tag editor targets — the loaded one by default, but the
  // folder view can open it for any row.
  const [tagsTargetEntryId, setTagsTargetEntryId] = useState<number | null>(null);
  // Write|Preview is one value for the whole app, like the theme.
  const [noteMode, setNoteMode] = useState<NoteMode>("write");
  // True while a picture batch uploads — the BottomBar button shows it.
  const [addingImages, setAddingImages] = useState(false);
  // The picture the image viewer shows (the "image" overlay's target).
  const [imageViewer, setImageViewer] = useState<{
    entryId: number;
    image: OutlineImage;
  } | null>(null);
  const [leetcodeBusy, setLeetcodeBusy] = useState(false);
  const [leetcodeError, setLeetcodeError] = useState<string | null>(null);
  const bootRunRef = useRef(0);
  const titleRequestRef = useRef(0);
  // The folder to return to when Back is pressed in the tag space: the
  // folder it was opened from, or the Inbox when opened from elsewhere.
  const tagBackRef = useRef<number | null>(null);

  const uiRef = useRef<AppUiState>(INITIAL_UI_STATE);
  const [ui, setUi] = useState<AppUiState>(INITIAL_UI_STATE);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const keyHandlerRef = useRef<(event: KeyboardEvent) => void>(() => undefined);
  const settingsRef = useRef<Settings>(DEFAULT_SETTINGS);
  const aiBusyRef = useRef(false);
  const settingsSaveChainRef = useRef<Promise<void>>(Promise.resolve());
  const settingsSaveIdRef = useRef(0);
  const settingsSaveFailedRef = useRef(false);
  const settingsOperationWaitRef = useRef<Promise<void>>(Promise.resolve());
  const settingsOperationDoneRef = useRef<(() => void) | null>(null);
  const closeOperationRef = useRef<Promise<void> | null>(null);
  const closeHandlerRef = useRef<() => Promise<void>>(() => Promise.resolve());

  const transitionUi = useCallback((event: AppUiEvent) => {
    const previous = uiRef.current;
    const next = reduceAppUi(previous, event);
    uiRef.current = next;
    setUi(next);
    if (next.view !== previous.view) {
      log.info("ui.view_changed", { view: describeView(next.view) });
    }
  }, []);

  const handleMeetingModeEntered = useCallback(
    () => transitionUi({ type: "meeting_mode_entered" }),
    [transitionUi],
  );
  // Every note load (open, new, delete-successor) lands on the note with
  // no meeting panel open — the one defined resting state — unless the open
  // requested a full Chat or Transcript view.
  const handleEntryLoaded = useCallback(
    (entryId: number, target?: EntryOpenTarget) => {
      if (target?.type === "chat") {
        transitionUi({ type: "chat_opened", entryId, chatId: target.chatId });
      } else if (target?.type === "transcript") {
        transitionUi({ type: "transcript_opened", entryId });
      } else {
        transitionUi({ type: "note_opened", entryId });
      }
    },
    [transitionUi],
  );
  const handleFolderLoaded = useCallback(
    (folderId: number) => transitionUi({ type: "folder_opened", folderId }),
    [transitionUi],
  );
  const handleTagLoaded = useCallback(
    (tag: string) => {
      const previous = uiRef.current.view;
      if (previous?.kind === "folder") tagBackRef.current = previous.folderId;
      transitionUi({ type: "tag_opened", tag });
    },
    [transitionUi],
  );
  // Deleting the folder on screen must not leave a dead view: land on the
  // Inbox instead. Deleting any other folder leaves the current view alone.
  const handleFolderDeleted = useCallback(
    (folderId: number, inboxId: number | null) => {
      const view = uiRef.current.view;
      if (view?.kind !== "folder" || view.folderId !== folderId) return;
      if (inboxId !== null) {
        transitionUi({ type: "folder_opened", folderId: inboxId });
      }
    },
    [transitionUi],
  );
  const windowMode = useWindowMode(handleMeetingModeEntered);
  const settings = boot.status === "ready" ? boot.settings : DEFAULT_SETTINGS;
  const aiEnabled = settings.aiEnabled;
  // The one derived capability gate the whole tree consumes.
  const caps: Caps = deriveCaps(settings);
  const workspace = useWorkspace({
    keySet,
    aiEnabled,
    enterMeetingOnRecord: settings.enterMeetingOnRecord,
    windowMode: windowMode.mode,
    changeWindowMode: windowMode.change,
    onEntryLoaded: handleEntryLoaded,
    onFolderLoaded: handleFolderLoaded,
    onFolderDeleted: handleFolderDeleted,
    onTagLoaded: handleTagLoaded,
  });
  // The live controller, read through a ref so boot and workflow flows can
  // use it without depending on the (unstable) controller object itself —
  // depending on it would restart the boot effect every render.
  const workspaceRef = useRef(workspace);
  useEffect(() => {
    workspaceRef.current = workspace;
  }, [workspace]);

  // Pictures can only be added to the human note — the one gate for the
  // BottomBar button, the palette action, and the shortcut.
  const insertImages =
    workspace.entry !== null &&
    (caps.ai ? workspace.enhance.activeVersion === null : true);

  /** The one picture path: the BottomBar button, the palette action, and
   * ⌘⇧I all open a file dialog, and the chosen batch uploads to the loaded
   * note. The input is created on the fly, so nothing stays mounted and no
   * ref crosses layers. */
  const pickImages = useCallback(() => {
    if (!insertImages) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.addEventListener("change", () => {
      const files = Array.from(input.files ?? []);
      if (files.length === 0) return;
      setAddingImages(true);
      void workspace.addImages(files).finally(() => setAddingImages(false));
    });
    input.click();
  }, [insertImages, workspace]);

  /** The one creation path the daily-note clock, launch, and the settings
   * switch share: get-or-create today's note in its folder and refresh
   * history. It never navigates — the note lands in the folder, and a
   * failure logs without disturbing the user. */
  const createDailyNoteSilently = useCallback(
    async (folderId: number | null) => {
      try {
        const daily = await getOrCreateDailyNote(todayLocalIso(), folderId);
        if (daily.created) {
          await workspaceRef.current.refreshEntries();
          log.info("daily.created", { entryId: daily.entry.id, folderId });
        }
      } catch (error) {
        log.error("daily.create_failed", undefined, error);
      }
    },
    [],
  );

  // The daily-note clock: while enabled, one timer chains to the next
  // occurrence of dailyNoteTime and creates today's note on the dot.
  // Changing the time, the folder, or the switch restarts the chain.
  useEffect(() => {
    if (!settings.dailyNoteEnabled) return;
    let cancelled = false;
    let timer: number | null = null;
    const schedule = () => {
      timer = window.setTimeout(() => {
        if (cancelled) return;
        void createDailyNoteSilently(settingsRef.current.dailyNoteFolderId);
        schedule();
      }, millisUntilNextTime(settingsRef.current.dailyNoteTime));
    };
    schedule();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [
    createDailyNoteSilently,
    settings.dailyNoteEnabled,
    settings.dailyNoteFolderId,
    settings.dailyNoteTime,
  ]);
  const initializeWorkspace = workspace.initialize;
  const prepareForAiOff = workspace.prepareForAiOff;
  const saveWorkspaceBeforeUnload = workspace.saveBeforeUnload;
  const prepareWorkspaceForSettings = workspace.prepareForSettings;
  const prepareWorkspaceForClose = workspace.prepareForClose;
  const createNewEntry = workspace.newEntry;
  const toggleRecording = workspace.recording.toggle;
  const workspaceStatus = workspace.status.status;

  /** Back in the tag space: the folder it was opened from, else Inbox. */
  const backFromTagView = useCallback(() => {
    const inbox = workspace.folders.find((folder) => folder.isInbox);
    const folderId = tagBackRef.current ?? inbox?.id ?? null;
    if (folderId !== null) transitionUi({ type: "folder_opened", folderId });
  }, [transitionUi, workspace.folders]);

  const openPeek = useCallback(
    (peek: Peek) => transitionUi({ type: "peek_opened", peek }),
    [transitionUi],
  );
  const collapsePeek = useCallback(
    () => transitionUi({ type: "peek_closed" }),
    [transitionUi],
  );
  const openFullChat = useCallback(() => {
    const current = workspace.entry;
    if (current === null) return;
    transitionUi({
      type: "chat_opened",
      entryId: current.id,
      chatId: workspace.chat.activeChatId,
    });
  }, [transitionUi, workspace.chat.activeChatId, workspace.entry]);
  const openFullTranscript = useCallback(() => {
    const current = workspace.entry;
    if (current === null) return;
    transitionUi({ type: "transcript_opened", entryId: current.id });
  }, [transitionUi, workspace.entry]);
  const returnToNote = useCallback(
    () => transitionUi({ type: "view_returned" }),
    [transitionUi],
  );

  const openOverlay = useCallback(
    (overlay: Overlay, restoreFocus = false) => {
      if (uiRef.current.overlay === "tour" && overlay !== "tour") return;
      if (
        restoreFocus &&
        returnFocusRef.current === null &&
        document.activeElement instanceof HTMLElement
      ) {
        returnFocusRef.current = document.activeElement;
      }
      transitionUi({ type: "overlay_opened", overlay });
    },
    [transitionUi],
  );

  const closeOverlay = useCallback(() => {
    const closing = uiRef.current.overlay;
    if (closing === "tour") markTourSeen();
    if (closing === "title") {
      // Closing the dialog also invalidates any in-flight suggestion, so a
      // late result can never re-open the dialog on its own.
      ++titleRequestRef.current;
      setTitleDialog({ status: "idle" });
    }
    if (closing === "image") setImageViewer(null);
    transitionUi({ type: "overlay_closed" });
  }, [transitionUi]);

  useEffect(() => {
    if (
      ui.overlay !== null ||
      workspaceStatus !== "idle" ||
      workspace.enhance.busy
    ) {
      return;
    }
    const target = returnFocusRef.current;
    if (target === null) return;
    returnFocusRef.current = null;
    if (target.isConnected && !(target instanceof HTMLButtonElement && target.disabled)) {
      target.focus();
    }
  }, [ui.overlay, workspace.enhance.busy, workspaceStatus]);

  const togglePalette = useCallback(() => {
    if (
      boot.status !== "ready" ||
      workspaceStatus !== "idle" ||
      uiRef.current.overlay === "tour"
    ) {
      return;
    }
    if (uiRef.current.overlay === "palette") closeOverlay();
    else openOverlay("palette", true);
  }, [boot.status, closeOverlay, openOverlay, workspaceStatus]);

  const toggleHelp = useCallback(() => {
    if (uiRef.current.overlay === "tour") return;
    if (uiRef.current.overlay === "help") closeOverlay();
    else openOverlay("help", true);
  }, [closeOverlay, openOverlay]);

  const changeTemplate = useCallback((change:
    | { type: "saved"; template: Template }
    | { type: "deleted"; id: string }) => {
    setTemplates((current) => {
      if (change.type === "deleted") {
        return current.filter((template) => template.id !== change.id);
      }
      const index = current.findIndex((template) => template.id === change.template.id);
      if (index < 0) return [...current, change.template];
      const next = [...current];
      next[index] = change.template;
      return next;
    });
  }, []);

  // Dictionary adds return the full updated list; removes only need the id.
  const replaceDictionary = useCallback((terms: DictionaryTerm[]) => {
    setDictionaryTerms(terms);
  }, []);

  const removeDictionaryTerm = useCallback((id: number) => {
    setDictionaryTerms((current) =>
      current.filter((term) => term.id !== id),
    );
  }, []);

  const setSettingsOperationBusy = useCallback((busy: boolean) => {
    if (busy) {
      if (settingsOperationDoneRef.current !== null) return;
      settingsOperationWaitRef.current = new Promise<void>((resolve) => {
        settingsOperationDoneRef.current = resolve;
      });
      return;
    }
    settingsOperationDoneRef.current?.();
    settingsOperationDoneRef.current = null;
  }, []);

  /** Paint and record settings in one place; every settings write goes through here. */
  const commitSettings = useCallback((next: Settings) => {
    settingsRef.current = next;
    applyTheme(next.theme);
    setBoot({ status: "ready", settings: next });
  }, []);

  /** Append one settings write to the ordered chain and return its result. */
  const enqueueSettingsSave = useCallback((next: Settings): Promise<void> => {
    const save = settingsSaveChainRef.current.then(() => saveSettings(next));
    settingsSaveChainRef.current = save.then(
      () => undefined,
      () => undefined,
    );
    return save;
  }, []);

  const startWorkspace = useCallback(
    async (currentUser: User) => {
      const nextSettings = await getSettings();
      const [hasKey, templateList, dictionaryList] = await Promise.all([
        getKeyStatus(),
        listTemplates(),
        listDictionary(),
      ]);
      setUser(currentUser);
      setKeySet(hasKey);
      setTemplates(templateList);
      setDictionaryTerms(dictionaryList);
      await initializeWorkspace();
      commitSettings(nextSettings);
      transitionUi({ type: "workspace_opened" });
      // The tour teaches recording and chat, so notes-only mode skips it.
      if (nextSettings.aiEnabled && !hasSeenTour()) openOverlay("tour");
      // The daily note is get-or-created at launch when its clock has
      // already fired while the app was closed — a launch after the chosen
      // time catches it up, a launch before it leaves the clock to it. It
      // never opens itself: the note lands in its folder. A failure never
      // blocks boot — the workspace is already on screen and it is logged.
      if (
        nextSettings.dailyNoteEnabled &&
        timePassedToday(nextSettings.dailyNoteTime)
      ) {
        void createDailyNoteSilently(nextSettings.dailyNoteFolderId);
      }
      log.info("app.boot_completed", { aiEnabled: nextSettings.aiEnabled });
    },
    [commitSettings, createDailyNoteSilently, initializeWorkspace, openOverlay, transitionUi],
  );

  useEffect(() => {
    const runId = ++bootRunRef.current;
    log.info("app.boot_started", { attempt: bootAttempt + 1 });
    void (async () => {
      try {
        // The startup theme (shell-injected saved value, cache, or OS
        // appearance) is already painted; re-apply it so the native window
        // matches while the sidecar settings load.
        applyTheme(startupTheme());
        const currentUser = await getUserWhenReady();
        if (runId !== bootRunRef.current) return;
        if (currentUser === null) {
          const permissions = await invoke<Permissions>("check_permissions").catch(
            () => NO_PERMISSIONS,
          );
          if (runId === bootRunRef.current) {
            setBoot({ status: "onboarding", permissions });
          }
          return;
        }
        await startWorkspace(currentUser);
      } catch (error) {
        if (runId !== bootRunRef.current) return;
        // In development the sidecar runs separately (`make dev-api`); say so
        // instead of leaving the user with a bare connection error.
        const devHint = import.meta.env.DEV
          ? " In development, start the local service first (`make dev-api`)."
          : "";
        setBoot({
          status: "error",
          message: `meetwrite could not reach its local service.${devHint} Reopen the app or try again.`,
        });
        log.error("app.boot_failed", { attempt: bootAttempt + 1 }, error);
      }
    })();
  }, [bootAttempt, startWorkspace]);

  useEffect(() => {
    const onPageHide = () => saveWorkspaceBeforeUnload();
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [saveWorkspaceBeforeUnload]);

  const closeSafely = useCallback(async () => {
    if (closeOperationRef.current !== null) {
      await closeOperationRef.current;
      return;
    }
    setCloseError(null);
    setClosing(true);
    const operation = (async () => {
      try {
        const result = await closeInOrder({
          prepareWorkspace: () =>
            boot.status === "ready" ? prepareWorkspaceForClose() : Promise.resolve(true),
          waitForSettingsMutation: () => settingsOperationWaitRef.current,
          waitForSettingsWrites: () => settingsSaveChainRef.current,
          settingsWriteFailed: () => settingsSaveFailedRef.current,
          destroyWindow: () => {
            log.info("app.close_ready");
            return getCurrentWindow().destroy();
          },
        });
        if (result !== "closed") {
          setClosing(false);
          return;
        }
      } catch (error) {
        setClosing(false);
        setCloseError("meetwrite could not finish closing safely. Try again.");
        log.error("app.close_failed", undefined, error);
      }
    })();
    closeOperationRef.current = operation;
    try {
      await operation;
    } finally {
      if (closeOperationRef.current === operation) closeOperationRef.current = null;
    }
  }, [boot.status, prepareWorkspaceForClose]);

  useEffect(() => {
    closeHandlerRef.current = closeSafely;
  }, [closeSafely]);

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        event.preventDefault();
        await closeHandlerRef.current();
      })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch((error) => log.warn("app.close_listener_failed", undefined, error));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => keyHandlerRef.current(event);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    registerAppMenu(togglePalette, () => {
      void closeHandlerRef.current();
    });
  }, [togglePalette]);

  const updateSettings = useCallback((next: Settings) => {
    const saveId = ++settingsSaveIdRef.current;
    settingsSaveFailedRef.current = false;
    commitSettings(next);
    setSettingsError(null);
    void enqueueSettingsSave(next)
      .then(() => {
        if (saveId === settingsSaveIdRef.current) {
          settingsSaveFailedRef.current = false;
          setSettingsError(null);
        }
      })
      .catch((error) => {
        if (saveId === settingsSaveIdRef.current) {
          settingsSaveFailedRef.current = true;
          setSettingsError("Your settings could not be saved. Your current choices remain on screen.");
        }
        log.error("settings.save_failed", undefined, error);
      });
  }, [commitSettings, enqueueSettingsSave]);

  /**
   * The AI-mode switch is one controlled transition. Turning AI off first
   * finalizes recording, flushes the note, cancels in-flight AI work, and
   * drops back to the human version; only then is the setting persisted.
   * Any failure leaves AI mode on with a retryable error. Turning AI on is
   * a plain settings save.
   */
  const setAiEnabled = useCallback(
    async (enabled: boolean) => {
      if (boot.status !== "ready" || aiBusyRef.current) return;
      if (settingsRef.current.aiEnabled === enabled) return;
      aiBusyRef.current = true;
      setAiToggleBusy(true);
      setAiToggleError(null);
      log.info("ai_mode.toggle_requested", { aiEnabled: enabled });
      try {
        if (!enabled && !(await prepareForAiOff())) {
          setAiToggleError(
            "meetwrite could not finish saving your note, so AI is still on. Try again.",
          );
          log.warn("ai_mode.disable_aborted");
          return;
        }
        const next = { ...settingsRef.current, aiEnabled: enabled };
        await enqueueSettingsSave(next);
        commitSettings(next);
        if (!enabled) {
          const current = workspace.entry;
          if (current !== null) {
            transitionUi({ type: "note_opened", entryId: current.id });
          }
        }
        log.info("ai_mode.changed", { aiEnabled: enabled });
      } catch (error) {
        setAiToggleError(
          "The change could not be saved. Your current mode is unchanged — try again.",
        );
        log.error("ai_mode.toggle_failed", { aiEnabled: enabled }, error);
      } finally {
        aiBusyRef.current = false;
        setAiToggleBusy(false);
      }
    },
    [
      boot.status,
      commitSettings,
      enqueueSettingsSave,
      prepareForAiOff,
      transitionUi,
      workspace.entry,
    ],
  );

  const openSettings = useCallback(async () => {
    if (!(await prepareWorkspaceForSettings())) return;
    transitionUi({ type: "settings_opened" });
  }, [prepareWorkspaceForSettings, transitionUi]);

  const closeSettings = useCallback(() => {
    transitionUi({ type: "workspace_opened" });
    void getKeyStatus()
      .then(setKeySet)
      .catch((error) => log.error("key.status_refresh_failed", undefined, error));
  }, [transitionUi]);

  const finishOnboarding = useCallback(
    async (name: string, chosenAiEnabled: boolean, chosenTheme: Theme) => {
      setBoot({ status: "loading" });
      try {
        const currentUser = await saveName(name);
        // Onboarding's single branch: persist the chosen theme and AI mode
        // before the workspace boots, so the first screen already matches them.
        const currentSettings = await getSettings();
        await saveSettings({
          ...currentSettings,
          aiEnabled: chosenAiEnabled,
          theme: chosenTheme,
        });
        await startWorkspace(currentUser);
      } catch (error) {
        setBoot({
          status: "error",
          message: "Setup could not be completed. Check the local service and try again.",
        });
        log.error("onboarding.finish_failed", undefined, error);
      }
    },
    [startWorkspace],
  );

  const saveUserName = useCallback(async (name: string) => {
    setUser(await saveName(name));
  }, []);

  const enhanceEnabled = workspace.entry && !workspace.recording.recording
    ? hasEnhanceSource(workspace.entry.noteMd ?? "", workspace.entry.transcript ?? "")
    : false;

  const openEnhance = useCallback(() => {
    if (
      !aiEnabled ||
      !workspace.entry ||
      !keySet ||
      !enhanceEnabled ||
      workspace.enhance.busy ||
      workspace.status.status !== "idle"
    ) {
      return;
    }
    openOverlay("enhance", true);
  }, [aiEnabled, enhanceEnabled, keySet, openOverlay, workspace.enhance.busy, workspace.entry, workspace.status.status]);

  const toggleVersions = useCallback(() => {
    if (!aiEnabled || workspace.status.status !== "idle" || workspace.enhance.busy) return;
    if (uiRef.current.overlay === "versions") closeOverlay();
    else openOverlay("versions", true);
  }, [aiEnabled, closeOverlay, openOverlay, workspace.enhance.busy, workspace.status.status]);

  const downloadNote = useCallback(() => {
    const current = workspace.entry;
    if (current === null) return;
    const shownVersion = workspace.enhance.activeVersion;
    const view: NoteView = shownVersion ? "enhanced" : "human";
    downloadMarkdown(
      downloadFileName(current.title, view),
      shownVersion?.content ?? current.noteMd ?? "",
    );
  }, [workspace.enhance.activeVersion, workspace.entry]);

  /** Meeting mode is a toggle: the same command enters and leaves it. */
  const toggleMeetingMode = useCallback(() => {
    if (boot.status !== "ready") return;
    windowMode.change(windowMode.mode === "meeting" ? "normal" : "meeting");
  }, [boot.status, windowMode]);

  const requestSuggestedTitle = useCallback(async () => {
    if (workspace.entry === null) return;
    const requestId = ++titleRequestRef.current;
    setTitleDialog({ status: "loading" });
    openOverlay("title");
    const suggested = await workspace.suggestEntryTitle();
    // A closed dialog or a newer request discards the result; the
    // workspace guard already discards results for a different note.
    if (
      requestId !== titleRequestRef.current ||
      uiRef.current.overlay !== "title"
    ) {
      return;
    }
    if (suggested === null) {
      setTitleDialog({ status: "idle" });
      return;
    }
    setTitleDialog({ status: "ready", suggested });
  }, [openOverlay, workspace]);

  const saveSuggestedTitle = useCallback(
    async (value: string | null) => {
      const current = workspace.entry;
      ++titleRequestRef.current;
      setTitleDialog({ status: "idle" });
      closeOverlay();
      if (current !== null) await workspace.renameEntry(current.id, value);
    },
    [closeOverlay, workspace],
  );

  const openTagEditor = useCallback(
    (entryId: number) => {
      setTagsTargetEntryId(entryId);
      openOverlay("tags");
    },
    [openOverlay],
  );

  /** Every image click — sidebar rows, folder thumbnails, preview pictures —
   * opens the same viewer. */
  const openImage = useCallback(
    (entryId: number, image: OutlineImage) => {
      setImageViewer({ entryId, image });
      openOverlay("image");
    },
    [openOverlay],
  );

  const renameViewerImage = useCallback(
    (title: string | null) => {
      const current = imageViewer;
      if (current === null) return;
      setImageViewer({ ...current, image: { ...current.image, title } });
      void workspace.renameImage(current.entryId, current.image.id, title);
    },
    [imageViewer, workspace],
  );

  const deleteViewerImage = useCallback(() => {
    const current = imageViewer;
    if (current === null) return;
    void workspace.removeImage(current.entryId, current.image.id).then((deleted) => {
      // One defined outcome: deleted → the viewer closes; failed → the
      // viewer stays with the workspace error visible behind it.
      if (deleted) closeOverlay();
    });
  }, [closeOverlay, imageViewer, workspace]);

  /** Open today's note (get-or-create) — the palette's one daily-note
   * command, and the only place that navigates to it. */
  const openDailyNote = useCallback(async () => {
    const current = settingsRef.current;
    try {
      const daily = await getOrCreateDailyNote(
        todayLocalIso(),
        current.dailyNoteFolderId,
      );
      await workspace.refreshEntries();
      transitionUi({ type: "workspace_opened" });
      await workspace.openEntry(daily.entry.id);
      log.info("daily.opened", { entryId: daily.entry.id, created: daily.created });
    } catch (error) {
      log.error("daily.open_failed", undefined, error);
    }
  }, [transitionUi, workspace]);

  /** The daily-note switch: save the setting, then create today's note
   * right away — it lands in the folder while settings stay on screen.
   * Turning it off is a plain settings save. */
  const enableDailyNote = useCallback(() => {
    if (boot.status !== "ready") return;
    const next = { ...settingsRef.current, dailyNoteEnabled: true };
    updateSettings(next);
    void createDailyNoteSilently(next.dailyNoteFolderId);
  }, [boot.status, createDailyNoteSilently, updateSettings]);

  /** Settings → one click → the LeetCode folder with its starter note, open
   * in the center. Failure leaves settings on screen with one retryable
   * error. */
  const setupLeetCode = useCallback(async () => {
    if (boot.status !== "ready" || leetcodeBusy) return;
    setLeetcodeBusy(true);
    setLeetcodeError(null);
    log.info("workflow.leetcode_started");
    try {
      const result = await setupLeetCodeWorkflow();
      await workspace.refreshFolders();
      await workspace.refreshEntries();
      closeSettings();
      await workspace.openFolder(result.folderId);
      log.info("workflow.leetcode_completed", {
        folderId: result.folderId,
        folderCreated: result.folderCreated,
        starterCreated: result.starterCreated,
      });
    } catch (error) {
      setLeetcodeError("The LeetCode folder could not be set up. Try again.");
      log.error("workflow.leetcode_failed", undefined, error);
    } finally {
      setLeetcodeBusy(false);
    }
  }, [boot.status, closeSettings, leetcodeBusy, workspace]);

  /** One exhaustive switch owns every palette command — availability was
   * already decided by the palette model, so each case is one action. */
  const runPaletteCommand = useCallback(
    (item: PaletteItem) => {
      if (item.kind === "entry") {
        transitionUi({ type: "workspace_opened" });
        void workspace.openEntry(item.id);
        return;
      }
      if (item.kind === "chat") {
        void workspace.openEntry(item.entryId, { type: "chat", chatId: item.id });
        return;
      }
      switch (item.id) {
        case "new-entry":
          transitionUi({ type: "workspace_opened" });
          void createNewEntry();
          return;
        case "open-folder":
          if (item.folderId === undefined) return;
          transitionUi({ type: "workspace_opened" });
          void workspace.openFolder(item.folderId);
          return;
        case "open-transcript":
          openFullTranscript();
          return;
        case "daily-note":
          void openDailyNote();
          return;
        case "new-chat": {
          const entryId = workspace.entry?.id ?? null;
          if (entryId === null) return;
          void workspace.chat.start().then((chatId) => {
            if (chatId !== null) {
              transitionUi({ type: "chat_opened", entryId, chatId });
            }
          });
          return;
        }
        case "rename-note":
          setTitleDialog({ status: "idle" });
          openOverlay("title");
          return;
        case "edit-tags": {
          const entryId = workspace.entry?.id;
          if (entryId !== undefined) openTagEditor(entryId);
          return;
        }
        case "move-to-folder":
          openOverlay("move");
          return;
        case "toggle-preview":
          setNoteMode((current) => (current === "write" ? "preview" : "write"));
          return;
        case "add-image":
          pickImages();
          return;
        case "suggest-title":
          void requestSuggestedTitle();
          return;
        case "record":
          toggleRecording();
          return;
        case "toggle-meeting":
          toggleMeetingMode();
          return;
        case "history":
          transitionUi({ type: "history_opened" });
          return;
        case "theme":
          updateSettings({
            ...settingsRef.current,
            theme: settingsRef.current.theme === "light" ? "dark" : "light",
          });
          return;
        case "toggle-ai":
          void setAiEnabled(!settingsRef.current.aiEnabled);
          return;
        case "settings":
          void openSettings();
          return;
        case "help":
          toggleHelp();
          return;
      }
    },
    [
      createNewEntry,
      openDailyNote,
      openFullTranscript,
      openOverlay,
      openSettings,
      openTagEditor,
      pickImages,
      requestSuggestedTitle,
      setAiEnabled,
      toggleHelp,
      toggleMeetingMode,
      toggleRecording,
      transitionUi,
      updateSettings,
      workspace,
    ],
  );

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    const shortcut = matchShortcut(event);
    if (shortcut === null) return;
    if (shortcut === "escape") {
      // One cascade, no ambiguity: overlay → back to the note from a full
      // view → fold the compact panel away. Each press is one step.
      if (uiRef.current.overlay !== null) closeOverlay();
      else {
        const view = uiRef.current.view;
        if (view !== null && view.kind !== "note") {
          transitionUi({ type: "view_returned" });
        } else if (view !== null && view.peek !== null) {
          transitionUi({ type: "peek_closed" });
        }
      }
      return;
    }
    if (boot.status !== "ready") return;
    if (workspaceStatus !== "idle") return;
    event.preventDefault();
    if (shortcut === "search") {
      togglePalette();
      return;
    }
    if (uiRef.current.overlay !== null || uiRef.current.page !== "workspace") return;
    switch (shortcut) {
      case "new-entry":
        void createNewEntry();
        break;
      case "enhance":
        openEnhance();
        break;
      case "record":
        toggleRecording();
        break;
      case "history":
        if (windowMode.mode !== "meeting") transitionUi({ type: "history_toggled" });
        break;
      case "toggle-preview":
        setNoteMode((current) => (current === "write" ? "preview" : "write"));
        break;
      case "add-image":
        pickImages();
        break;
      case "settings":
        void openSettings();
        break;
      case "help":
        toggleHelp();
        break;
      case "meeting-mode":
        toggleMeetingMode();
        break;
    }
  }, [
    boot.status,
    closeOverlay,
    createNewEntry,
    openEnhance,
    openSettings,
    pickImages,
    toggleHelp,
    toggleMeetingMode,
    togglePalette,
    toggleRecording,
    transitionUi,
    windowMode.mode,
    workspaceStatus,
  ]);

  useEffect(() => {
    keyHandlerRef.current = handleKeyDown;
  }, [handleKeyDown]);

  const retryBoot = useCallback(() => {
    setBoot({ status: "loading" });
    setBootAttempt((attempt) => attempt + 1);
  }, []);

  return {
    boot,
    user,
    keySet,
    templates,
    dictionaryTerms,
    caps,
    aiToggleBusy,
    aiToggleError,
    settingsError,
    closeError,
    closing,
    titleDialog,
    tagsTargetEntryId,
    noteMode,
    imageViewer,
    leetcodeBusy,
    leetcodeError,
    ui,
    windowMode,
    workspace,
    enhanceEnabled,
    retryBoot,
    transitionUi,
    closeOverlay,
    togglePalette,
    toggleHelp,
    openPeek,
    collapsePeek,
    openFullChat,
    openFullTranscript,
    returnToNote,
    openEnhance,
    toggleVersions,
    setAiEnabled,
    openSettings,
    closeSettings,
    runPaletteCommand,
    toggleMeetingMode,
    saveSuggestedTitle,
    openTagEditor,
    backFromTagView,
    setNoteMode,
    openImage,
    renameViewerImage,
    deleteViewerImage,
    openDailyNote,
    enableDailyNote,
    setupLeetCode,
    finishOnboarding,
    saveUserName,
    updateSettings,
    changeTemplate,
    replaceDictionary,
    removeDictionaryTerm,
    setSettingsOperationBusy,
    downloadNote,
    addingImages,
    insertImages,
    pickImages,
  };
}
