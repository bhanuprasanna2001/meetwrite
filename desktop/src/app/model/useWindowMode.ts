import { useCallback, useEffect, useRef, useState } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  setWindowMode,
  syncWindowMode,
  type WindowMode,
} from "../../shared/platform/window";
import { log } from "../../shared/lib/logger";

export interface WindowModeController {
  mode: WindowMode;
  change: (mode: WindowMode) => void;
}

export function useWindowMode(onMeetingModeEntered: () => void): WindowModeController {
  const onMeetingModeEnteredRef = useRef(onMeetingModeEntered);
  const [mode, setMode] = useState<WindowMode>("normal");
  const modeRef = useRef<WindowMode>(mode);
  const confirmedModeRef = useRef<WindowMode>(mode);
  const beforeFullscreenRef = useRef<WindowMode>("normal");
  const commandChainRef = useRef<Promise<void>>(Promise.resolve());
  const commandIdRef = useRef(0);
  const pendingCommandsRef = useRef(0);

  useEffect(() => {
    onMeetingModeEnteredRef.current = onMeetingModeEntered;
  }, [onMeetingModeEntered]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let unlisten: UnlistenFn | undefined;
    let disposed = false;
    let resizeCheckId = 0;
    const nativeWindow = getCurrentWindow();
    void nativeWindow
      .onResized(() => {
        const checkId = ++resizeCheckId;
        void (async () => {
          const fullscreen = await nativeWindow.isFullscreen().catch(() => false);
          if (
            disposed ||
            checkId !== resizeCheckId ||
            pendingCommandsRef.current > 0
          ) {
            return;
          }
          if (fullscreen && modeRef.current !== "fullscreen") {
            beforeFullscreenRef.current = modeRef.current;
          }
          setMode((current) => {
            const next = syncWindowMode(current, fullscreen, beforeFullscreenRef.current);
            modeRef.current = next;
            confirmedModeRef.current = next;
            return next;
          });
        })();
      })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch((error) => log.warn("window.resize_listener_failed", undefined, error));
    return () => {
      disposed = true;
      ++resizeCheckId;
      unlisten?.();
    };
  }, []);

  const change = useCallback((requested: WindowMode) => {
    const current = modeRef.current;
    const next =
      requested === "fullscreen" && current === "fullscreen"
        ? beforeFullscreenRef.current
        : requested;
    if (requested === "fullscreen" && current !== "fullscreen") {
      beforeFullscreenRef.current = current;
    }
    modeRef.current = next;
    setMode(next);
    const commandId = ++commandIdRef.current;
    ++pendingCommandsRef.current;
    commandChainRef.current = commandChainRef.current.then(async () => {
      const succeeded = await setWindowMode(requested);
      --pendingCommandsRef.current;
      if (succeeded) {
        confirmedModeRef.current = next;
        log.info("window.mode_changed", { mode: requested });
      } else if (commandId === commandIdRef.current) {
        const fallback = confirmedModeRef.current;
        modeRef.current = fallback;
        setMode(fallback);
      }
    });
    if (next === "meeting") onMeetingModeEnteredRef.current();
  }, []);

  return { mode, change };
}
