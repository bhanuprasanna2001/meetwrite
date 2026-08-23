import { useCallback, useEffect, useRef, useState } from "react";
import {
  saveEntryKeepalive,
  saveEnhancedVersionKeepalive,
  updateEnhancedVersion,
  updateEntry,
} from "../../../shared/api/sidecar";
import { log } from "../../../shared/lib/logger";

export const SAVE_DELAY_MS = 600;

export interface PendingSave {
  entryId: number;
  /** Undefined means the human note was not edited in this batch. */
  noteMd?: string | null;
  /** Every edited enhanced version, keyed by its stable database id. */
  versions: Readonly<Record<number, string>>;
}

export interface PendingSaveUpdate {
  entryId: number;
  noteMd?: string | null;
  version?: { id: number; content: string };
}

/** Merge edits without allowing one enhanced version to erase another. */
export function mergePendingSave(
  current: PendingSave | null,
  update: PendingSaveUpdate,
): PendingSave {
  if (current !== null && current.entryId !== update.entryId) {
    throw new Error("Pending edits must be flushed before changing entries");
  }
  const versions: Record<number, string> = { ...(current?.versions ?? {}) };
  if (update.version) versions[update.version.id] = update.version.content;
  return {
    entryId: update.entryId,
    ...(update.noteMd !== undefined
      ? { noteMd: update.noteMd }
      : current?.noteMd !== undefined
        ? { noteMd: current.noteMd }
        : {}),
    versions,
  };
}

/** Newer edits win when a failed batch is restored behind fresh keystrokes. */
export function restoreFailedSave(
  failed: PendingSave,
  newer: PendingSave | null,
): PendingSave {
  if (newer === null) return failed;
  if (failed.entryId !== newer.entryId) return newer;
  return {
    entryId: newer.entryId,
    ...(newer.noteMd !== undefined
      ? { noteMd: newer.noteMd }
      : failed.noteMd !== undefined
        ? { noteMd: failed.noteMd }
        : {}),
    versions: { ...failed.versions, ...newer.versions },
  };
}

interface AutosaveOptions {
  onSaved: () => void | Promise<void>;
}

export interface AutosaveController {
  error: string | null;
  queue: (update: PendingSaveUpdate) => void;
  flush: () => Promise<boolean>;
  discard: (entryId: number) => void;
  saveBeforeUnload: () => void;
}

export function useAutosave({ onSaved }: AutosaveOptions): AutosaveController {
  const timerRef = useRef<number | null>(null);
  const pendingRef = useRef<PendingSave | null>(null);
  const activeBatchRef = useRef<PendingSave | null>(null);
  const activeFlushRef = useRef<Promise<boolean> | null>(null);
  const onSavedRef = useRef(onSaved);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onSavedRef.current = onSaved;
  }, [onSaved]);

  const clearTimer = useCallback(() => {
    if (timerRef.current === null) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  useEffect(() => () => clearTimer(), [clearTimer]);

  const flush = useCallback(async (): Promise<boolean> => {
    clearTimer();

    // Every caller joins the active write before it can take the next batch.
    // This prevents an older, slower PATCH from finishing after a newer edit.
    for (;;) {
      if (activeFlushRef.current !== null) {
        const succeeded = await activeFlushRef.current;
        if (!succeeded) return false;
        continue;
      }

      const pending = pendingRef.current;
      pendingRef.current = null;
      if (pending === null) return true;
      activeBatchRef.current = pending;

      const operation = (async (): Promise<boolean> => {
        try {
          if (pending.noteMd !== undefined) {
            await updateEntry(pending.entryId, pending.noteMd);
          }
          const versions = Object.entries(pending.versions)
            .map(([id, content]) => ({ id: Number(id), content }))
            .sort((left, right) => left.id - right.id);
          for (const version of versions) {
            await updateEnhancedVersion(version.id, version.content);
          }
          setError(null);
          await onSavedRef.current();
          log.info("autosave.flushed", {
            entryId: pending.entryId,
            versionCount: versions.length,
          });
          return true;
        } catch (saveError) {
          pendingRef.current = restoreFailedSave(pending, pendingRef.current);
          setError("Your latest edit could not be saved. It will be retried before navigation.");
          log.error("autosave.failed", { entryId: pending.entryId }, saveError);
          return false;
        }
      })();
      activeFlushRef.current = operation;
      const succeeded = await operation;
      if (activeFlushRef.current === operation) {
        activeFlushRef.current = null;
        activeBatchRef.current = null;
      }
      if (!succeeded) return false;
    }
  }, [clearTimer]);

  const queue = useCallback(
    (update: PendingSaveUpdate) => {
      pendingRef.current = mergePendingSave(pendingRef.current, update);
      setError(null);
      clearTimer();
      timerRef.current = window.setTimeout(() => void flush(), SAVE_DELAY_MS);
    },
    [clearTimer, flush],
  );

  const discard = useCallback(
    (entryId: number) => {
      if (pendingRef.current?.entryId !== entryId) return;
      clearTimer();
      pendingRef.current = null;
      setError(null);
    },
    [clearTimer],
  );

  const saveBeforeUnload = useCallback(() => {
    const active = activeBatchRef.current;
    const pending = active
      ? restoreFailedSave(active, pendingRef.current)
      : pendingRef.current;
    if (pending === null) return;
    if (pending.noteMd !== undefined) saveEntryKeepalive(pending.entryId, pending.noteMd);
    for (const [id, content] of Object.entries(pending.versions)) {
      saveEnhancedVersionKeepalive(Number(id), content);
    }
  }, []);

  return { error, queue, flush, discard, saveBeforeUnload };
}
