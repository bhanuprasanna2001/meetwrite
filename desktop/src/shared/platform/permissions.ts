import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { log } from "../lib/logger";

/**
 * Live macOS permission state, shared by the onboarding screen and the
 * settings page. macOS (TCC)
 * owns the state — meetwrite only asks and reports it.
 */

export type PermissionState = "granted" | "denied" | "notDetermined";

export interface Permissions {
  microphone: PermissionState;
  systemAudio: PermissionState;
}

/** Open the exact System Settings pane through the shell. The plugin's JS API
 * is scope-limited to http(s) schemes and silently drops the
 * x-apple.systempreferences link — the Rust command has no such scope. */
export async function openSystemSettings(
  pane: "microphone" | "screenCapture",
): Promise<void> {
  await invoke("open_system_settings", { pane });
}

/** Ask macOS for Microphone access through the shell's AVFoundation. The
 * webview never touches the media path — WebKit media capture is what macOS
 * suspends without the signing entitlement (the original white screen). */
export async function requestMicrophone(): Promise<boolean> {
  return invoke<boolean>("request_microphone_permission");
}

/** Creating the system-audio tap raises macOS's Audio Capture prompt
 * (System Audio Recording Only) — there is no dedicated request API. */
export async function requestSystemAudio(): Promise<boolean> {
  return invoke<boolean>("request_system_audio_permission");
}

/** Live status from the shell; falls back to "denied" rows when the shell
 * errors or returns an unexpected shape. */
export async function refreshPermissions(): Promise<Permissions> {
  try {
    const status: unknown = await invoke("check_permissions");
    const perms = status as Partial<Permissions> | null | undefined;
    if (perms && perms.microphone && perms.systemAudio) {
      return { microphone: perms.microphone, systemAudio: perms.systemAudio };
    }
  } catch {
    // Fall through to the safe default.
  }
  return { microphone: "denied", systemAudio: "denied" };
}

/**
 * Live permission status plus the two grant actions. Re-checks whenever the
 * window regains focus, so granting in System Settings flips the rows without
 * a restart (mic takes effect immediately; Screen Recording may need one).
 */
export function usePermissions(initial?: Permissions) {
  const [permissions, setPermissions] = useState<Permissions>(
    initial ?? { microphone: "denied", systemAudio: "denied" },
  );
  const [requesting, setRequesting] = useState<"microphone" | "systemAudio" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestingRef = useRef<"microphone" | "systemAudio" | null>(null);
  const refreshIdRef = useRef(0);

  const refresh = useCallback(async () => {
    const refreshId = ++refreshIdRef.current;
    const next = await refreshPermissions();
    if (refreshId === refreshIdRef.current) setPermissions(next);
  }, []);

  useEffect(() => {
    let active = true;
    void refresh();
    const refreshOnFocus = () => {
      if (active) void refresh();
    };
    window.addEventListener("focus", refreshOnFocus);
    return () => {
      active = false;
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, [refresh]);

  const allowMicrophone = async () => {
    if (requestingRef.current !== null) return;
    requestingRef.current = "microphone";
    setRequesting("microphone");
    setError(null);
    try {
      await requestMicrophone();
      await refresh();
    } catch (requestError) {
      setError("Microphone permission could not be requested.");
      log.error("permissions.microphone_request_failed", undefined, requestError);
    } finally {
      requestingRef.current = null;
      setRequesting(null);
    }
  };

  const allowSystemAudio = async () => {
    if (requestingRef.current !== null) return;
    requestingRef.current = "systemAudio";
    setRequesting("systemAudio");
    setError(null);
    try {
      const granted = await requestSystemAudio();
      await refresh();
      if (!granted) {
        setPermissions((current) => ({ ...current, systemAudio: "denied" }));
      }
    } catch (requestError) {
      setError("System-audio permission could not be requested.");
      log.error("permissions.system_audio_request_failed", undefined, requestError);
    } finally {
      requestingRef.current = null;
      setRequesting(null);
    }
  };

  return { permissions, requesting, error, allowMicrophone, allowSystemAudio };
}
