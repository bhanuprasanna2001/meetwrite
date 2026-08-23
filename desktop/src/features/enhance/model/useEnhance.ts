import { useCallback, useRef, useState } from "react";
import {
  enhanceEntry,
  type EnhancedVersion,
} from "../../../shared/api/sidecar";
import { log } from "../../../shared/lib/logger";

interface EnhanceState {
  entryId: number;
  versions: EnhancedVersion[];
  activeVersionId: number | null;
  status: "idle" | "preparing" | "enhancing";
  error: string | null;
}

const EMPTY_ENHANCE: EnhanceState = {
  entryId: -1,
  versions: [],
  activeVersionId: null,
  status: "idle",
  error: null,
};

interface RunEnhanceOptions {
  entryId: number;
  templateId: string | null;
  instructions: string | null;
  flush: () => Promise<boolean>;
  onTitle: (title: string) => void;
  onCompleted: () => void | Promise<void>;
}

export interface EnhanceController extends EnhanceState {
  busy: boolean;
  activeVersion: EnhancedVersion | null;
  replace: (entryId: number, versions: EnhancedVersion[]) => void;
  cancel: () => void;
  select: (id: number | null) => void;
  editActive: (content: string) => void;
  run: (options: RunEnhanceOptions) => Promise<void>;
}

export function useEnhance(): EnhanceController {
  const [state, setRenderedState] = useState<EnhanceState>(EMPTY_ENHANCE);
  const stateRef = useRef<EnhanceState>(EMPTY_ENHANCE);
  const operationRef = useRef(0);

  const commit = useCallback((update: (current: EnhanceState) => EnhanceState) => {
    const next = update(stateRef.current);
    stateRef.current = next;
    setRenderedState(next);
  }, []);

  const replace = useCallback(
    (entryId: number, versions: EnhancedVersion[]) => {
      ++operationRef.current;
      commit(() => ({
        entryId,
        versions,
        activeVersionId: null,
        status: "idle",
        error: null,
      }));
    },
    [commit],
  );

  const cancel = useCallback(() => {
    ++operationRef.current;
    commit((current) => ({ ...current, status: "idle", error: null }));
  }, [commit]);

  const select = useCallback(
    (activeVersionId: number | null) => {
      if (stateRef.current.status !== "idle") return;
      commit((current) => ({ ...current, activeVersionId }));
    },
    [commit],
  );

  const editActive = useCallback(
    (content: string) => {
      const activeVersionId = stateRef.current.activeVersionId;
      if (activeVersionId === null) return;
      commit((current) => ({
        ...current,
        versions: current.versions.map((version) =>
          version.id === activeVersionId ? { ...version, content } : version,
        ),
      }));
    },
    [commit],
  );

  const run = useCallback(
    async (options: RunEnhanceOptions) => {
      if (
        stateRef.current.status !== "idle" ||
        stateRef.current.entryId !== options.entryId
      ) {
        return;
      }
      const operationId = ++operationRef.current;
      commit((current) => ({ ...current, status: "preparing", error: null }));

      if (!(await options.flush())) {
        if (operationId === operationRef.current) {
          commit((current) => ({
            ...current,
            status: "idle",
            error: "Save the note successfully before enhancing it.",
          }));
        }
        return;
      }

      if (operationId !== operationRef.current) return;
      commit((current) => ({ ...current, status: "enhancing" }));
      log.info("enhance.started", { entryId: options.entryId, operationId });
      try {
        const version = await enhanceEntry(options.entryId, {
          templateId: options.templateId,
          instructions: options.instructions,
        });
        if (operationId !== operationRef.current) return;
        commit((current) => ({
          ...current,
          versions: [...current.versions, version],
          activeVersionId: version.id,
        }));
        if (version.title) options.onTitle(version.title);
        await options.onCompleted();
        if (operationId !== operationRef.current) return;
        commit((current) => ({ ...current, status: "idle" }));
        log.info("enhance.completed", {
          entryId: options.entryId,
          versionId: version.id,
          operationId,
        });
      } catch (error) {
        if (operationId !== operationRef.current) return;
        commit((current) => ({
          ...current,
          status: "idle",
          error: error instanceof Error ? error.message : "Enhance failed.",
        }));
        log.error("enhance.failed", { entryId: options.entryId, operationId }, error);
      }
    },
    [commit],
  );

  const activeVersion =
    state.activeVersionId === null
      ? null
      : (state.versions.find((version) => version.id === state.activeVersionId) ?? null);

  return {
    ...state,
    busy: state.status !== "idle",
    activeVersion,
    replace,
    cancel,
    select,
    editActive,
    run,
  };
}
