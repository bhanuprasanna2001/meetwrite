import { invoke } from "@tauri-apps/api/core";
import { log } from "../lib/logger";

/**
 * The three window states. The shell owns the
 * resize — the webview only picks a state. Fullscreen is special: macOS can
 * enter or leave it on its own (green button, dragging the window to a new
 * Space), so the app also follows what the shell reports.
 */

export type WindowMode = "normal" | "fullscreen" | "meeting";

/** Ask the shell to move the window into one of the three states. The shell
 * toggles native fullscreen on "fullscreen", so the same click enters and
 * exits it. */
export async function setWindowMode(mode: WindowMode): Promise<boolean> {
  try {
    await invoke("set_window_mode", { mode });
    return true;
  } catch (error) {
    log.error("window.mode_change_failed", { mode }, error);
    return false;
  }
}

/**
 * Reconcile the app's mode with the native window state.
 *
 * `before` is the last non-fullscreen mode; it is what the window returns
 * to when macOS leaves fullscreen.
 */
export function syncWindowMode(
  current: WindowMode,
  isFullscreen: boolean,
  before: WindowMode,
): WindowMode {
  if (isFullscreen && current !== "fullscreen") return "fullscreen";
  if (!isFullscreen && current === "fullscreen") return before;
  return current;
}
