import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { log } from "../lib/logger";

/**
 * Open a web URL in the system browser — the app webview never navigates
 * away for a link. Non-web schemes are ignored, so internal references
 * like `entry-image:` can never leave the app.
 */
export function openExternal(url: string): void {
  if (!/^https?:\/\//.test(url)) return;
  if (isTauri()) {
    void openUrl(url).catch((error) => log.warn("external.open_failed", undefined, error));
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
