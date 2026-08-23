import { invoke } from "@tauri-apps/api/core";
import type { Theme } from "../api/sidecar";
import { log } from "../lib/logger";

const THEME_CACHE_KEY = "meetwrite.theme";

/**
 * Paint the theme everywhere it lives:
 * - the webview (the `dark:` variant follows the data-theme attribute),
 * - localStorage (instant repaint before the sidecar answers next launch),
 * - the native window (title-bar appearance + resize background) via a shell
 *   command, because only the shell can paint outside the webview.
 */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_CACHE_KEY, theme);
  invoke("apply_theme", { theme }).catch((error) =>
    log.error("theme.native_apply_failed", { theme }, error),
  );
}

/** The last saved theme, if any — used before the sidecar answers. */
export function cachedTheme(): Theme | null {
  const theme = localStorage.getItem(THEME_CACHE_KEY);
  return theme === "light" || theme === "dark" ? theme : null;
}

/** The OS's effective appearance — the first-launch theme until the user
 * finishes onboarding, which persists the resolved value. */
export function systemPreferredTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/**
 * The theme for the first painted frame, strongest signal first: the shell
 * injects the saved theme before the page scripts run, then the localStorage
 * cache, then the OS appearance. All three agree wherever possible, so the
 * splash never repaints in a different theme than the native window.
 */
export function startupTheme(): Theme {
  const painted = document.documentElement.dataset.theme;
  if (painted === "light" || painted === "dark") return painted;
  return cachedTheme() ?? systemPreferredTheme();
}
