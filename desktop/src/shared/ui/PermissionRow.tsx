import { useState } from "react";
import { log } from "../lib/logger";
import { openSystemSettings, type PermissionState } from "../platform/permissions";

/**
 * One macOS permission row:
 * title + description on the left, and the live action on the right —
 * ✓ when granted, "Allow" when never asked, "Open System Settings" when
 * denied. Shared by onboarding and the settings page.
 */

interface PermissionRowProps {
  title: string;
  description: string;
  status: PermissionState;
  busy?: boolean;
  onAllow: () => void;
  settingsPane: "microphone" | "screenCapture";
}

export default function PermissionRow({
  title,
  description,
  status,
  busy = false,
  onAllow,
  settingsPane,
}: PermissionRowProps) {
  const [settingsError, setSettingsError] = useState<string | null>(null);

  const openSettings = async () => {
    setSettingsError(null);
    try {
      await openSystemSettings(settingsPane);
    } catch (error) {
      setSettingsError("System Settings could not be opened.");
      log.error("permissions.settings_open_failed", { settingsPane }, error);
    }
  };

  return (
    <div className="px-3 py-2.5">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-ink-soft dark:text-paper">{title}</div>
          <div className="text-xs text-ink-mute dark:text-paper-mute">{description}</div>
        </div>

        {status === "granted" && (
          <span className="text-sm font-semibold text-emerald-500">✓</span>
        )}
        {status === "notDetermined" && (
          <button
            type="button"
            onClick={onAllow}
            disabled={busy}
            className="text-xs font-medium text-ink-soft hover:text-ink disabled:opacity-40 dark:text-paper-dim dark:hover:text-paper"
          >
            {busy ? "Requesting…" : "Allow"}
          </button>
        )}
        {status === "denied" && (
          <button
            type="button"
            onClick={() => void openSettings()}
            disabled={busy}
            className="text-xs font-medium text-ink-mute underline underline-offset-2 hover:text-ink disabled:opacity-40 dark:text-paper-mute dark:hover:text-paper"
          >
            Open System Settings
          </button>
        )}
      </div>
      {settingsError && <p className="mt-1 text-xs text-red-500">{settingsError}</p>}
    </div>
  );
}
