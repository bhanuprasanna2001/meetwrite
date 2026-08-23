import {
  Menu,
  MenuItem,
  PredefinedMenuItem,
  Submenu,
} from "@tauri-apps/api/menu";
import { log } from "../lib/logger";

/**
 * The keyboard map. One list drives the ?
 * help overlay, and `matchShortcut` drives the window keydown handler. ⌘W,
 * ⌘K, and ⌘Q are owned by the native app menu — macOS accelerators fire
 * even when no app surface has focus, and with the traffic lights hidden
 * they are the only native way to close and quit. The Quit item is replaced
 * with a callback so it joins the same save gate as window close. Everything
 * else is matched in the webview.
 */

/** One row of the help overlay. `aiOnly` rows hide in notes-only mode. */
export interface Shortcut {
  keys: string;
  label: string;
  aiOnly?: boolean;
}

/** The full shortcut list, in the order the overlay shows it. */
export const SHORTCUTS: Shortcut[] = [
  { keys: "⌘K", label: "Search notes and actions" },
  { keys: "Esc", label: "Close overlays, leave full views, fold panels" },
  { keys: "↑ ↓", label: "Move the selection" },
  { keys: "↵", label: "Run the selected item" },
  { keys: "⌘N", label: "New entry" },
  { keys: "⌘E", label: "Enhance the current note", aiOnly: true },
  { keys: "⌘R", label: "Start / stop recording", aiOnly: true },
  { keys: "⌘⇧H", label: "Open history" },
  { keys: "⌘⇧P", label: "Preview / write the note" },
  { keys: "⌘⇧I", label: "Add a picture to the note" },
  { keys: "⌃⌘M", label: "Meeting mode / back to normal" },
  { keys: "⌘,", label: "Open settings" },
  { keys: "⌘/", label: "Open help" },
  { keys: "⌘W", label: "Close the window" },
  { keys: "⌘Q", label: "Quit meetwrite" },
];

/** The three window states, for the help overlay's second section. Meeting
 * is a note-taking layout, so it stays listed in notes-only mode too. */
export const WINDOW_MODES = [
  { name: "Normal", detail: "the base window (1100 × 600 minimum)" },
  { name: "Full screen", detail: "the entire screen" },
  {
    name: "Meeting",
    detail: "the right third of the screen, full height",
  },
];

/** What the webview keydown handler understands (the menu owns the rest). */
export type ShortcutName =
  | "search"
  | "new-entry"
  | "enhance"
  | "record"
  | "history"
  | "settings"
  | "help"
  | "meeting-mode"
  | "toggle-preview"
  | "add-image"
  | "escape";

/** The shape of a browser key event — just what matching needs. */
interface KeyLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** Match a key event against the keyboard map. ⌥ combos are left alone, and
 * plain ⌘H (macOS hide) is NOT captured — only ⌘⇧H means History. ⌃⌘M is
 * the meeting-mode toggle; ⌘M stays owned by macOS minimize. */
export function matchShortcut(event: KeyLike): ShortcutName | null {
  if (event.altKey) return null;
  const mod = event.metaKey || event.ctrlKey;
  if (!mod) return event.key === "Escape" ? "escape" : null;
  if (event.ctrlKey && event.metaKey) {
    return !event.shiftKey && event.key.toLowerCase() === "m"
      ? "meeting-mode"
      : null;
  }
  const key = event.key.toLowerCase();
  if (event.shiftKey) {
    if (key === "h") return "history";
    if (key === "p") return "toggle-preview";
    if (key === "i") return "add-image";
    return null;
  }
  switch (key) {
    case "k":
      return "search";
    case "n":
      return "new-entry";
    case "e":
      return "enhance";
    case "r":
      return "record";
    case ",":
      return "settings";
    case "/":
      return "help";
    default:
      return null;
  }
}

/** The menu's ⌘K action targets this. A module variable lets the menu be
 * registered exactly once while the handler stays fresh across renders. */
let onSearch: (() => void) | null = null;
let onQuit: (() => void) | null = null;

/** True once the native menu is up — the registration runs once even though
 * React StrictMode double-runs effects. */
let registered = false;

/**
 * Register the native app menu. Tauri already ships a full default macOS
 * menu (meetwrite / File / Edit / View / Window / Help). Close Window (⌘W)
 * reaches the close-request listener; the predefined Quit item is replaced
 * by a normal item that enters the same save gate before destroying the last
 * window.
 * A macOS menu bar renders ONLY top-level submenus (top-level plain items
 * are invisible), so the Search… item (⌘K) is appended INSIDE the first
 * submenu — the app menu — and the augmented menu is set back as the app
 * menu. The handler is re-pinned on every call so React closures never go
 * stale; the menu itself is only built once (StrictMode-safe).
 */
export function registerAppMenu(
  searchHandler: (() => void) | null,
  quitHandler: (() => void) | null,
): void {
  onSearch = searchHandler;
  onQuit = quitHandler;
  if (registered || !("__TAURI_INTERNALS__" in window)) return;
  registered = true;
  void (async () => {
    try {
      const menu = await Menu.default();
      const items = await menu.items();
      // The default menu starts with the app-name submenu on macOS.
      const appMenu = items.find((item) => item instanceof Submenu);
      if (!appMenu) {
        // If that ever changes, leave the default menu untouched — the
        // webview keydown handler still covers ⌘K.
        log.warn("menu.search_submenu_missing");
        return;
      }
      const appItems = await appMenu.items();
      if (appItems.length === 0) {
        log.warn("menu.app_items_missing");
        return;
      }
      const quitIndex = appItems.length - 1;
      const quitItem = appItems[quitIndex];
      const quitText =
        quitItem instanceof PredefinedMenuItem ? await quitItem.text() : "";
      if (quitText.toLowerCase().startsWith("quit")) {
        await appMenu.removeAt(quitIndex);
        await appMenu.insert(
          await MenuItem.new({
            id: "quit-safely",
            text: quitText,
            accelerator: "CmdOrCtrl+Q",
            action: () => onQuit?.(),
          }),
          quitIndex,
        );
      } else {
        log.warn("menu.quit_item_missing");
      }
      await appMenu.insert(
        await MenuItem.new({
          id: "search",
          text: "Search…",
          accelerator: "CmdOrCtrl+K",
          action: () => onSearch?.(),
        }),
        Math.min(1, quitIndex),
      );
      await menu.setAsAppMenu();
      log.info("menu.registered");
    } catch (error) {
      // Nothing was replaced if this fails: the default menu (with ⌘W and
      // ⌘Q) stays active, and the webview keydown handler covers ⌘K.
      log.warn("menu.registration_failed", undefined, error);
    }
  })();
}
