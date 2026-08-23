import { useCallback, useRef, useState } from "react";
import {
  createEntry,
  createFolder,
  deleteEntry,
  deleteEntryImage,
  deleteFolder,
  deleteTag,
  getEntry,
  getEntryOutline,
  listEntries,
  listFolders,
  moveEntry,
  renameEntry,
  renameEntryImage,
  renameFolder,
  renameTag as renameTagRequest,
  replaceEntryTags,
  suggestEntryTitle,
  uploadEntryImage,
  type Chat,
  type Entry,
  type EntryImage,
  type EntryOutline,
  type EntrySummary,
  type EnhancedVersion,
  type Folder,
  type Message,
} from "../../../shared/api/sidecar";
import { log } from "../../../shared/lib/logger";
import type { WindowMode } from "../../../shared/platform/window";
import { useChat } from "../../../features/chat/model/useChat";
import { useEnhance } from "../../../features/enhance/model/useEnhance";
import { useAutosave } from "../../../features/notes/model/autosave";
import { addImagesToNote } from "../../../features/notes/model/imageMarkdown";
import { useRecording } from "../../../features/recording/model/useRecording";
import type {
  Partials,
  TranscriptLine,
} from "../../../features/transcript/model/transcript";
import { useTranscript } from "../../../features/transcript/model/useTranscript";
import { loadWorkspaceSnapshot, type WorkspaceSnapshot } from "./loadWorkspaceSnapshot";

export type WorkspaceStatus =
  | { status: "idle" }
  | {
      status: "transitioning";
      action: "boot" | "new" | "open" | "delete" | "folder" | "settings" | "version";
    };

/**
 * Where an opened note should land. Absent = the note view (the resting
 * state); otherwise the center switches to full Chat or full Transcript
 * after the snapshot has committed.
 */
export type EntryOpenTarget =
  | { type: "chat"; chatId: number }
  | { type: "transcript" };

interface WorkspaceOptions {
  keySet: boolean;
  aiEnabled: boolean;
  enterMeetingOnRecord: boolean;
  windowMode: WindowMode;
  changeWindowMode: (mode: WindowMode) => void;
  onEntryLoaded: (entryId: number, target?: EntryOpenTarget) => void;
  onFolderLoaded: (folderId: number) => void;
  /** Called after a folder delete with the fresh Inbox id (null if unknown),
   * so the controller can move a dead folder view onto the Inbox. */
  onFolderDeleted: (folderId: number, inboxId: number | null) => void;
  onTagLoaded: (tag: string) => void;
}

export interface WorkspaceAutosaveView {
  readonly error: string | null;
}

export interface WorkspaceRecordingView {
  readonly recording: boolean;
  readonly stopping: boolean;
  readonly error: string | null;
  /** The REC timer's origin — null until capture is active. */
  readonly startedAt: number | null;
  readonly toggle: () => void;
}

export interface WorkspaceTranscriptView {
  readonly lines: TranscriptLine[];
  readonly partials: Partials;
}

export interface WorkspaceChatView {
  readonly chats: Chat[];
  readonly activeChatId: number | null;
  readonly messages: Message[];
  readonly streaming: string;
  readonly error: string | null;
  readonly busy: boolean;
  /** Unsent composer text per chat id — survives compact ↔ full switches. */
  readonly drafts: Readonly<Record<number, string>>;
  /** Unsent composer text for the chat that does not exist yet. */
  readonly newDraft: string;
  /** Creates a chat and resolves to its id (null when it failed). */
  readonly start: () => Promise<number | null>;
  readonly select: (chatId: number) => Promise<void>;
  readonly rename: (id: number, title: string | null) => Promise<void>;
  readonly remove: (id: number) => Promise<void>;
  readonly setDraft: (chatId: number | null, text: string) => void;
}

export interface WorkspaceEnhanceView {
  readonly versions: EnhancedVersion[];
  readonly activeVersionId: number | null;
  readonly activeVersion: EnhancedVersion | null;
  readonly busy: boolean;
  readonly error: string | null;
}

export interface WorkspaceController {
  entry: Entry | null;
  entries: EntrySummary[];
  folders: Folder[];
  status: WorkspaceStatus;
  error: string | null;
  autosave: WorkspaceAutosaveView;
  recording: WorkspaceRecordingView;
  transcript: WorkspaceTranscriptView;
  chat: WorkspaceChatView;
  enhance: WorkspaceEnhanceView;
  initialize: () => Promise<void>;
  newEntry: (folderId?: number) => Promise<void>;
  openEntry: (id: number, target?: EntryOpenTarget) => Promise<void>;
  openFolder: (folderId: number) => Promise<void>;
  openTag: (tag: string) => Promise<void>;
  createFolder: (name: string) => Promise<void>;
  renameFolder: (id: number, name: string) => Promise<void>;
  removeFolder: (id: number) => Promise<void>;
  loadOutline: (entryId: number) => Promise<EntryOutline>;
  removeEntry: (id: number) => Promise<void>;
  renameEntry: (id: number, title: string | null) => Promise<void>;
  replaceTags: (entryId: number, values: string[]) => Promise<void>;
  /** Uploads one picture onto the loaded note; null when it failed. */
  addImage: (file: File, title: string | null) => Promise<EntryImage | null>;
  /** The bottom bar's picture button: upload and append to the note. */
  addImages: (files: File[]) => Promise<void>;
  renameImage: (entryId: number, imageId: number, title: string | null) => Promise<void>;
  /** Deletes one picture; false = nothing changed (error shown). */
  removeImage: (entryId: number, imageId: number) => Promise<boolean>;
  /** Deletes the tag from every note; false = nothing changed (error shown). */
  removeTag: (value: string) => Promise<boolean>;
  renameTag: (value: string, newValue: string) => Promise<void>;
  moveEntryToFolder: (entryId: number, folderId: number) => Promise<void>;
  /** One suggested title, or null on failure (the error is already shown). */
  suggestEntryTitle: () => Promise<string | null>;
  prepareForSettings: () => Promise<boolean>;
  prepareForClose: () => Promise<boolean>;
  prepareForAiOff: () => Promise<boolean>;
  changeHumanNote: (content: string) => void;
  changeEnhancedNote: (content: string) => void;
  selectVersion: (id: number | null) => Promise<void>;
  runEnhance: (templateId: string | null, instructions: string | null) => Promise<void>;
  askChat: (content: string) => Promise<boolean>;
  refreshEntries: () => Promise<void>;
  refreshFolders: () => Promise<Folder[]>;
  saveBeforeUnload: () => void;
}

export function useWorkspace(options: WorkspaceOptions): WorkspaceController {
  const onEntryLoaded = options.onEntryLoaded;
  const [entry, setRenderedEntry] = useState<Entry | null>(null);
  const entryRef = useRef<Entry | null>(null);
  const [entries, setEntries] = useState<EntrySummary[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [status, setStatus] = useState<WorkspaceStatus>({ status: "idle" });
  const [error, setError] = useState<string | null>(null);
  const transitionRef = useRef(false);
  const entriesRequestRef = useRef(0);
  const foldersRequestRef = useRef(0);
  const renameOperationRef = useRef(0);
  const renameBusyRef = useRef(false);
  const titleRequestRef = useRef(0);

  const commitEntry = useCallback((next: Entry | null) => {
    entryRef.current = next;
    setRenderedEntry(next);
  }, []);

  const updateCurrentEntry = useCallback((update: (current: Entry) => Entry) => {
    const current = entryRef.current;
    if (current === null) return;
    const next = update(current);
    entryRef.current = next;
    setRenderedEntry(next);
  }, []);

  const commitEntries = useCallback((next: EntrySummary[]) => {
    ++entriesRequestRef.current;
    setEntries(next);
  }, []);

  const commitFolders = useCallback((next: Folder[]) => {
    ++foldersRequestRef.current;
    setFolders(next);
  }, []);

  const removeEntrySummary = useCallback((id: number) => {
    ++entriesRequestRef.current;
    setEntries((current) => current.filter((item) => item.id !== id));
  }, []);

  const refreshEntries = useCallback(async () => {
    const requestId = ++entriesRequestRef.current;
    try {
      const next = await listEntries();
      if (requestId === entriesRequestRef.current) setEntries(next);
    } catch (refreshError) {
      log.error("entries.refresh_failed", undefined, refreshError);
    }
  }, []);

  const refreshFolders = useCallback(async (): Promise<Folder[]> => {
    const requestId = ++foldersRequestRef.current;
    const next = await listFolders();
    if (requestId === foldersRequestRef.current) setFolders(next);
    return next;
  }, []);

  /** The sidebar outline is read-only and cheap; it loads fresh on every
   * expand so it can never go stale after a recording or a chat change. */
  const loadOutline = useCallback(async (entryId: number): Promise<EntryOutline> => {
    return getEntryOutline(entryId);
  }, []);

  const autosave = useAutosave({ onSaved: refreshEntries });
  const chat = useChat();
  const enhance = useEnhance();

  const refreshAfterRecording = useCallback(
    async (entryId: number) => {
      try {
        const fresh = await getEntry(entryId);
        const current = entryRef.current;
        if (current?.id === entryId) {
          // Recording refreshes server-derived fields. Never repaint an older
          // note/title over local edits that are still inside the debounce.
          commitEntry({ ...fresh, noteMd: current.noteMd, title: current.title });
        }
        await refreshEntries();
      } catch (refreshError) {
        log.error("recording.entry_refresh_failed", { entryId }, refreshError);
      }
    },
    [commitEntry, refreshEntries],
  );

  const recording = useRecording({
    entryId: entry?.id ?? null,
    enabled: options.keySet && options.aiEnabled,
    enterMeetingOnRecord: options.enterMeetingOnRecord,
    windowMode: options.windowMode,
    changeWindowMode: options.changeWindowMode,
    onStopped: refreshAfterRecording,
  });
  const transcript = useTranscript(entry?.id ?? null, recording.recording);
  const flushSave = autosave.flush;
  const discardSave = autosave.discard;
  const queueSave = autosave.queue;
  const saveAutosaveBeforeUnload = autosave.saveBeforeUnload;
  const cancelChat = chat.cancel;
  const replaceChat = chat.replace;
  const chatSelect = chat.select;
  const cancelEnhance = enhance.cancel;
  const replaceEnhance = enhance.replace;
  const editActiveVersion = enhance.editActive;
  const selectEnhancedVersion = enhance.select;
  const runEnhancement = enhance.run;
  const askChatQuestion = chat.ask;
  const replaceTranscript = transcript.replace;
  const stopRecording = recording.stop;
  const stopRecordingBeforeUnload = recording.stopBeforeUnload;

  const commitSnapshot = useCallback(
    (snapshot: WorkspaceSnapshot) => {
      commitEntry(snapshot.entry);
      replaceTranscript(snapshot.transcript);
      replaceEnhance(snapshot.entry.id, snapshot.versions);
      replaceChat(snapshot.chat);
      setError(null);
    },
    [commitEntry, replaceChat, replaceEnhance, replaceTranscript],
  );

  const begin = useCallback((action: WorkspaceStatus & { status: "transitioning" }): boolean => {
    if (transitionRef.current) return false;
    transitionRef.current = true;
    setStatus(action);
    setError(null);
    return true;
  }, []);

  const finish = useCallback(() => {
    transitionRef.current = false;
    setStatus({ status: "idle" });
  }, []);

  const prepareForNavigation = useCallback(async (): Promise<boolean> => {
    await stopRecording();
    if (!(await flushSave())) return false;
    cancelChat();
    cancelEnhance();
    return true;
  }, [cancelChat, cancelEnhance, flushSave, stopRecording]);

  const initialize = useCallback(async () => {
    if (!begin({ status: "transitioning", action: "boot" })) return;
    try {
      const [list, folderList] = await Promise.all([listEntries(), listFolders()]);
      const initial = list.length > 0 ? await getEntry(list[0].id) : await createEntry();
      let refreshed = list;
      if (list.length === 0) refreshed = await listEntries();
      const snapshot = await loadWorkspaceSnapshot(initial);
      commitEntries(refreshed);
      commitFolders(folderList);
      commitSnapshot(snapshot);
      onEntryLoaded(initial.id);
      log.info("workspace.ready", {
        entryId: initial.id,
        entryCount: refreshed.length,
        folderCount: folderList.length,
      });
    } catch (bootError) {
      setError("Your notes could not be loaded. Check the local service and try again.");
      log.error("workspace.boot_failed", undefined, bootError);
      throw bootError;
    } finally {
      finish();
    }
  }, [begin, commitEntries, commitFolders, commitSnapshot, finish, onEntryLoaded]);

  const newEntry = useCallback(
    async (folderId?: number) => {
      if (!begin({ status: "transitioning", action: "new" })) return;
      let created: Entry | null = null;
      try {
        if (!(await prepareForNavigation())) return;
        created = await createEntry(folderId);
        const snapshot = await loadWorkspaceSnapshot(created);
        commitSnapshot(snapshot);
        onEntryLoaded(created.id);
        await refreshEntries();
        log.info("entry.created", { entryId: created.id, folderId: created.folderId });
      } catch (createError) {
        if (created !== null) await refreshEntries();
        setError(
          created === null
            ? "A new note could not be created."
            : "The note was created, but it could not be opened. Choose it in History to try again.",
        );
        log.error(
          created === null ? "entry.create_failed" : "entry.create_recovery_failed",
          created === null ? undefined : { entryId: created.id },
          createError,
        );
      } finally {
        finish();
      }
    },
    [begin, commitSnapshot, finish, onEntryLoaded, prepareForNavigation, refreshEntries],
  );

  const openEntry = useCallback(
    async (id: number, target?: EntryOpenTarget) => {
      const sameEntry = id === entryRef.current?.id;
      if (!begin({ status: "transitioning", action: "open" })) return;
      try {
        if (sameEntry) {
          // The note is already loaded and the hidden editor keeps its live
          // state — nothing to fetch, only the view event is needed. This is
          // also what lets a folder view (or the palette) open the note that
          // happens to be the loaded one.
          if (target?.type === "chat") {
            if (chat.chats.some((item) => item.id === target.chatId)) {
              await chatSelect(target.chatId);
              onEntryLoaded(id, target);
            } else {
              onEntryLoaded(id);
            }
          } else {
            onEntryLoaded(id, target);
          }
          return;
        }
        if (!(await prepareForNavigation())) return;
        const snapshot = await loadWorkspaceSnapshot(await getEntry(id));
        commitSnapshot(snapshot);
        if (target?.type === "chat") {
          // The requested chat must exist; a stale sidebar outline falls
          // back to the note view — one defined outcome either way.
          if (snapshot.chat.chats.some((item) => item.id === target.chatId)) {
            await chatSelect(target.chatId);
            onEntryLoaded(id, target);
          } else {
            onEntryLoaded(id);
          }
        } else {
          onEntryLoaded(id, target);
        }
        log.info("entry.opened", { entryId: id });
      } catch (openError) {
        setError("That note could not be opened. Your current note is unchanged.");
        log.error("entry.open_failed", { entryId: id }, openError);
      } finally {
        finish();
      }
    },
    [begin, chat.chats, chatSelect, commitSnapshot, finish, onEntryLoaded, prepareForNavigation],
  );

  const openFolder = useCallback(
    async (folderId: number) => {
      if (!begin({ status: "transitioning", action: "folder" })) return;
      try {
        // The folder view is derived from data already loaded, so the only
        // work is to settle the current note before the center switches.
        if (!(await flushSave())) return;
        options.onFolderLoaded(folderId);
        log.info("folder.opened", { folderId });
      } catch (openError) {
        setError("That folder could not be opened. Your current note is unchanged.");
        log.error("folder.open_failed", { folderId }, openError);
      } finally {
        finish();
      }
    },
    [begin, finish, flushSave, options],
  );

  const openTag = useCallback(
    async (tag: string) => {
      if (!begin({ status: "transitioning", action: "folder" })) return;
      try {
        // Same rule as folders: the tag view derives from loaded data, so
        // only the current note needs settling first.
        if (!(await flushSave())) return;
        options.onTagLoaded(tag);
        log.info("tag.opened");
      } catch (openError) {
        setError("That tag could not be opened. Your current note is unchanged.");
        log.error("tag.open_failed", undefined, openError);
      } finally {
        finish();
      }
    },
    [begin, finish, flushSave, options],
  );

  const createFolderAction = useCallback(
    async (name: string) => {
      if (!begin({ status: "transitioning", action: "folder" })) return;
      try {
        const folder = await createFolder(name);
        await refreshFolders();
        log.info("folder.created", { folderId: folder.id });
      } catch (folderError) {
        setError("The folder could not be created. A folder with that name may already exist.");
        log.error("folder.create_failed", undefined, folderError);
      } finally {
        finish();
      }
    },
    [begin, finish, refreshFolders],
  );

  const renameFolderAction = useCallback(
    async (id: number, name: string) => {
      if (!begin({ status: "transitioning", action: "folder" })) return;
      try {
        await renameFolder(id, name);
        await refreshFolders();
        log.info("folder.renamed", { folderId: id });
      } catch (folderError) {
        setError("The folder could not be renamed.");
        log.error("folder.rename_failed", { folderId: id }, folderError);
      } finally {
        finish();
      }
    },
    [begin, finish, refreshFolders],
  );

  const removeFolder = useCallback(
    async (id: number) => {
      if (!begin({ status: "transitioning", action: "folder" })) return;
      try {
        if (!(await flushSave())) return;
        await deleteFolder(id);
        const freshFolders = await refreshFolders();
        await refreshEntries();
        const inboxId = freshFolders.find((folder) => folder.isInbox)?.id ?? null;
        options.onFolderDeleted(id, inboxId);
        log.info("folder.deleted", { folderId: id });
      } catch (folderError) {
        setError("The folder could not be deleted. Its notes are unchanged.");
        log.error("folder.delete_failed", { folderId: id }, folderError);
      } finally {
        finish();
      }
    },
    [begin, finish, flushSave, options, refreshEntries, refreshFolders],
  );

  const removeEntry = useCallback(
    async (id: number) => {
      if (!begin({ status: "transitioning", action: "delete" })) return;
      const removingCurrent = entryRef.current?.id === id;
      let deleted = false;
      try {
        if (removingCurrent && !(await prepareForNavigation())) return;
        if (!removingCurrent && !(await flushSave())) return;
        await deleteEntry(id);
        deleted = true;
        discardSave(id);
        removeEntrySummary(id);
        if (removingCurrent) commitEntry(null);
        let list = await listEntries();
        commitEntries(list);
        if (removingCurrent) {
          const next = list.length > 0 ? await getEntry(list[0].id) : await createEntry();
          if (list.length === 0) {
            list = await listEntries();
            commitEntries(list);
          }
          commitSnapshot(await loadWorkspaceSnapshot(next));
          onEntryLoaded(next.id);
        }
        log.info("entry.deleted", { entryId: id });
      } catch (deleteError) {
        setError(
          deleted
            ? removingCurrent
              ? "The note was deleted, but the next note could not be loaded. Choose another note or create one."
              : "The note was deleted, but History could not be refreshed."
            : "The note could not be deleted.",
        );
        log.error(deleted ? "entry.delete_recovery_failed" : "entry.delete_failed", { entryId: id }, deleteError);
      } finally {
        finish();
      }
    },
    [begin, commitEntries, commitEntry, commitSnapshot, discardSave, finish, flushSave, onEntryLoaded, prepareForNavigation, removeEntrySummary],
  );

  const rename = useCallback(
    async (id: number, title: string | null) => {
      if (transitionRef.current || renameBusyRef.current) return;
      renameBusyRef.current = true;
      const operationId = ++renameOperationRef.current;
      const ownerEntryId = entryRef.current?.id ?? null;
      try {
        const renamed = await renameEntry(id, title);
        if (operationId !== renameOperationRef.current) return;
        if (entryRef.current?.id === id) {
          updateCurrentEntry((current) => ({ ...current, title: renamed.title }));
        }
        await refreshEntries();
      } catch (renameError) {
        if (operationId !== renameOperationRef.current) return;
        if (entryRef.current?.id === ownerEntryId) {
          setError("The note could not be renamed.");
        }
        log.error("entry.rename_failed", { entryId: id }, renameError);
      } finally {
        if (operationId === renameOperationRef.current) renameBusyRef.current = false;
      }
    },
    [refreshEntries, updateCurrentEntry],
  );

  const replaceTags = useCallback(
    async (entryId: number, values: string[]) => {
      try {
        await replaceEntryTags(entryId, values);
        await refreshEntries();
        log.info("entry.tags_replaced", { entryId });
      } catch (tagsError) {
        setError("The note's tags could not be saved.");
        log.error("entry.tags_save_failed", { entryId }, tagsError);
      }
    },
    [refreshEntries],
  );

  const removeTag = useCallback(
    async (value: string): Promise<boolean> => {
      try {
        await deleteTag(value);
        await refreshEntries();
        log.info("tag.deleted", { value });
        return true;
      } catch (deleteError) {
        setError("The tag could not be deleted.");
        log.error("tag.delete_failed", { value }, deleteError);
        return false;
      }
    },
    [refreshEntries],
  );

  const renameTag = useCallback(
    async (value: string, newValue: string) => {
      try {
        await renameTagRequest(value, newValue);
        await refreshEntries();
        log.info("tag.renamed", { value });
      } catch (renameError) {
        setError("The tag could not be renamed.");
        log.error("tag.rename_failed", { value }, renameError);
      }
    },
    [refreshEntries],
  );

  const moveEntryToFolder = useCallback(
    async (entryId: number, folderId: number) => {
      try {
        await moveEntry(entryId, folderId);
        await refreshEntries();
        log.info("entry.moved", { entryId, folderId });
      } catch (moveError) {
        setError("The note could not be moved.");
        log.error("entry.move_failed", { entryId, folderId }, moveError);
      }
    },
    [refreshEntries],
  );

  const addImage = useCallback(
    async (file: File, title: string | null): Promise<EntryImage | null> => {
      const current = entryRef.current;
      if (current === null) return null;
      try {
        const image = await uploadEntryImage(current.id, file, title);
        // The loaded note keeps its pictures, so the preview can resolve
        // the new ref the moment the markdown line lands.
        updateCurrentEntry((latest) => ({
          ...latest,
          images: [...latest.images, { id: image.id, title: image.title }],
        }));
        await refreshEntries();
        log.info("image.uploaded", {
          entryId: current.id,
          imageId: image.id,
          bytes: file.size,
        });
        return image;
      } catch (uploadError) {
        setError("The picture could not be added.");
        log.error("image.upload_failed", { entryId: current.id }, uploadError);
        return null;
      }
    },
    [refreshEntries, updateCurrentEntry],
  );

  const addImages = useCallback(
    async (files: File[]): Promise<void> => {
      const current = entryRef.current;
      if (current === null || files.length === 0) return;
      // The bottom bar's button never holds the caret: pictures append at
      // the end — the same rule paste/drop follow when the editor isn't
      // focused. The shared helper walks the batch and inserts each one.
      await addImagesToNote(files, addImage, {
        current: current.noteMd ?? "",
        caret: null,
        onChange: (text) => {
          updateCurrentEntry((latest) => ({ ...latest, noteMd: text }));
          queueSave({ entryId: current.id, noteMd: text });
        },
      });
    },
    [addImage, queueSave, updateCurrentEntry],
  );

  const renameImage = useCallback(
    async (entryId: number, imageId: number, title: string | null) => {
      try {
        const updated = await renameEntryImage(entryId, imageId, title);
        if (entryRef.current?.id === entryId) {
          updateCurrentEntry((latest) => ({
            ...latest,
            images: latest.images.map((image) =>
              image.id === imageId ? { id: imageId, title: updated.title } : image,
            ),
          }));
        }
        await refreshEntries();
        log.info("image.renamed", { entryId, imageId });
      } catch (renameError) {
        setError("The picture's title could not be saved.");
        log.error("image.rename_failed", { entryId, imageId }, renameError);
      }
    },
    [refreshEntries, updateCurrentEntry],
  );

  const removeImage = useCallback(
    async (entryId: number, imageId: number): Promise<boolean> => {
      try {
        await deleteEntryImage(entryId, imageId);
        if (entryRef.current?.id === entryId) {
          updateCurrentEntry((latest) => ({
            ...latest,
            images: latest.images.filter((image) => image.id !== imageId),
          }));
        }
        await refreshEntries();
        log.info("image.deleted", { entryId, imageId });
        return true;
      } catch (deleteError) {
        setError("The picture could not be deleted.");
        log.error("image.delete_failed", { entryId, imageId }, deleteError);
        return false;
      }
    },
    [refreshEntries, updateCurrentEntry],
  );

  const suggestTitle = useCallback(
    async (): Promise<string | null> => {
      const current = entryRef.current;
      if (current === null || !options.aiEnabled || !options.keySet) return null;
      const requestId = ++titleRequestRef.current;
      try {
        if (!(await flushSave())) return null;
        const suggested = await suggestEntryTitle(current.id);
        // A late result must never surface for another note or request.
        if (requestId !== titleRequestRef.current) return null;
        if (entryRef.current?.id !== current.id) return null;
        return suggested;
      } catch (titleError) {
        if (requestId !== titleRequestRef.current) return null;
        setError("A title could not be suggested. Try again.");
        log.error("title.suggest_failed", { entryId: current.id }, titleError);
        return null;
      }
    },
    [flushSave, options.aiEnabled, options.keySet],
  );

  const prepareForSettings = useCallback(async (): Promise<boolean> => {
    if (!begin({ status: "transitioning", action: "settings" })) return false;
    try {
      return await prepareForNavigation();
    } finally {
      finish();
    }
  }, [begin, finish, prepareForNavigation]);

  /**
   * The workspace half of turning AI off: finalize recording, flush the note,
   * cancel in-flight AI work, then drop back to the human note version. Any
   * failure returns false and leaves the current AI-mode workspace untouched.
   */
  const prepareForAiOff = useCallback(async (): Promise<boolean> => {
    if (!begin({ status: "transitioning", action: "settings" })) return false;
    try {
      if (!(await prepareForNavigation())) return false;
      if (enhance.activeVersionId !== null) selectEnhancedVersion(null);
      return true;
    } finally {
      finish();
    }
  }, [begin, enhance.activeVersionId, finish, prepareForNavigation, selectEnhancedVersion]);

  const prepareForClose = useCallback(async (): Promise<boolean> => {
    const ownsTransition = !transitionRef.current;
    if (ownsTransition) transitionRef.current = true;
    try {
      await stopRecording();
      if (!(await flushSave())) return false;
      cancelChat();
      cancelEnhance();
      return true;
    } finally {
      if (ownsTransition) transitionRef.current = false;
    }
  }, [cancelChat, cancelEnhance, flushSave, stopRecording]);

  const changeHumanNote = useCallback(
    (content: string) => {
      const current = entryRef.current;
      if (current === null) return;
      updateCurrentEntry((latest) => ({ ...latest, noteMd: content }));
      queueSave({ entryId: current.id, noteMd: content });
    },
    [queueSave, updateCurrentEntry],
  );

  const changeEnhancedNote = useCallback(
    (content: string) => {
      const current = entryRef.current;
      const versionId = enhance.activeVersionId;
      if (current === null || versionId === null) return;
      editActiveVersion(content);
      queueSave({ entryId: current.id, version: { id: versionId, content } });
    },
    [editActiveVersion, enhance.activeVersionId, queueSave],
  );

  const selectVersion = useCallback(
    async (id: number | null) => {
      if (id === enhance.activeVersionId || enhance.busy) return;
      if (!begin({ status: "transitioning", action: "version" })) return;
      const entryId = entryRef.current?.id ?? null;
      try {
        if (!(await flushSave())) return;
        if (entryRef.current?.id === entryId) selectEnhancedVersion(id);
      } finally {
        finish();
      }
    },
    [begin, enhance.activeVersionId, enhance.busy, finish, flushSave, selectEnhancedVersion],
  );

  const runEnhance = useCallback(
    async (templateId: string | null, instructions: string | null) => {
      const current = entryRef.current;
      if (current === null) return;
      await runEnhancement({
        entryId: current.id,
        templateId,
        instructions,
        flush: async () => {
          const saved = await flushSave();
          return saved && !transitionRef.current;
        },
        onTitle: (title) => {
          if (entryRef.current?.id !== current.id || entryRef.current.title) return;
          updateCurrentEntry((latest) => ({ ...latest, title }));
        },
        onCompleted: refreshEntries,
      });
    },
    [flushSave, refreshEntries, runEnhancement, updateCurrentEntry],
  );

  const askChat = useCallback(
    async (content: string) => {
      return askChatQuestion(content, async () => {
        const saved = await flushSave();
        return saved && !transitionRef.current;
      });
    },
    [askChatQuestion, flushSave],
  );

  const saveBeforeUnload = useCallback(() => {
    saveAutosaveBeforeUnload();
    stopRecordingBeforeUnload();
  }, [saveAutosaveBeforeUnload, stopRecordingBeforeUnload]);

  return {
    entry,
    entries,
    folders,
    status,
    error,
    autosave: { error: autosave.error },
    recording: {
      recording: recording.recording,
      startedAt: recording.startedAt,
      stopping: recording.state.status === "stopping",
      error: recording.error,
      toggle: recording.toggle,
    },
    transcript: {
      lines: transcript.lines,
      partials: transcript.partials,
    },
    chat: {
      chats: chat.chats,
      activeChatId: chat.activeChatId,
      messages: chat.messages,
      streaming: chat.streaming,
      error: chat.error,
      busy: chat.busy,
      drafts: chat.drafts,
      newDraft: chat.newDraft,
      start: chat.start,
      select: chat.select,
      rename: chat.rename,
      remove: chat.remove,
      setDraft: chat.setDraft,
    },
    enhance: {
      versions: enhance.versions,
      activeVersionId: enhance.activeVersionId,
      activeVersion: enhance.activeVersion,
      busy: enhance.busy,
      error: enhance.error,
    },
    initialize,
    newEntry,
    openEntry,
    openFolder,
    openTag,
    createFolder: createFolderAction,
    renameFolder: renameFolderAction,
    removeFolder,
    loadOutline,
    removeEntry,
    renameEntry: rename,
    replaceTags,
    addImage,
    addImages,
    renameImage,
    removeImage,
    removeTag,
    renameTag,
    moveEntryToFolder,
    suggestEntryTitle: suggestTitle,
    prepareForSettings,
    prepareForClose,
    prepareForAiOff,
    changeHumanNote,
    changeEnhancedNote,
    selectVersion,
    runEnhance,
    askChat,
    refreshEntries,
    refreshFolders,
    saveBeforeUnload,
  };
}
