import { useState } from "react";
import { useApiKey } from "../../../features/api-key/model/useApiKey";
import { usePermissions } from "../../../shared/platform/permissions";
import PermissionRow from "../../../shared/ui/PermissionRow";
import { Card, Row, SectionHeading } from "../ui/SettingsControls";

export function PermissionsSection({
  onBusyChange,
}: {
  onBusyChange: (busy: boolean) => void;
}) {
  const {
    permissions,
    requesting,
    error,
    allowMicrophone,
    allowSystemAudio,
  } = usePermissions();

  return (
    <div className="flex flex-col gap-8">
      <SectionHeading
        title="Permissions"
        hint="macOS owns these — meetwrite only asks and reports."
      />
      <Card>
        <PermissionRow
          title="Microphone"
          description="Record your voice in meetings."
          status={permissions.microphone}
          busy={requesting !== null}
          onAllow={() => {
            onBusyChange(true);
            void allowMicrophone().finally(() => onBusyChange(false));
          }}
          settingsPane="microphone"
        />
        <PermissionRow
          title="System audio"
          description="Record the other participants in the meeting."
          status={permissions.systemAudio}
          busy={requesting !== null}
          onAllow={() => {
            onBusyChange(true);
            void allowSystemAudio().finally(() => onBusyChange(false));
          }}
          settingsPane="screenCapture"
        />
      </Card>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

export function ApiKeySection({
  onBusyChange,
}: {
  onBusyChange: (busy: boolean) => void;
}) {
  const [key, setKey] = useState("");
  const { keySet, busy, error, save: saveStoredKey, remove: removeStoredKey } = useApiKey();

  const save = async () => {
    const trimmed = key.trim();
    if (!trimmed || busy) return;
    onBusyChange(true);
    if (await saveStoredKey(trimmed)) setKey("");
    onBusyChange(false);
  };

  const remove = async () => {
    if (busy) return;
    onBusyChange(true);
    await removeStoredKey();
    onBusyChange(false);
  };

  return (
    <div className="flex flex-col gap-8">
      <SectionHeading
        title="API key"
        hint="Your own OpenAI key — powers Record, chat, and Enhance."
      />
      <Card>
        <Row title="Status" description="Whether an OpenAI key is saved.">
          {keySet === null && <span className="text-sm text-ink-faint dark:text-paper-mute">…</span>}
          {keySet === false && (
            <span className="text-sm font-medium text-ink-mute dark:text-paper-mute">Not set</span>
          )}
          {keySet === true && <span className="text-sm font-semibold text-emerald-500">Set ✓</span>}
        </Row>
        <div className="px-4 py-3">
          <div className="flex items-center gap-3">
            <input
              type="password"
              value={key}
              onChange={(event) => setKey(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void save();
              }}
              placeholder="sk-…"
              aria-label="OpenAI API key"
              className="min-w-0 flex-1 border-b border-ink-line bg-transparent pb-1 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-ink dark:border-paper-line dark:text-paper dark:focus:border-paper"
            />
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy || key.trim() === ""}
              className="flex-none rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-paper disabled:cursor-not-allowed disabled:opacity-40 dark:bg-paper dark:text-ink"
            >
              {busy ? "Saving…" : "Save key"}
            </button>
            {keySet === true && (
              <button
                type="button"
                onClick={() => void remove()}
                disabled={busy}
                className="flex-none rounded-lg border border-ink-line px-3 py-1.5 text-sm text-ink-mute hover:text-ink dark:border-paper-line dark:text-paper-mute dark:hover:text-paper"
              >
                Clear
              </button>
            )}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-ink-faint dark:text-paper-mute">
            The key lives in the macOS Keychain — only the local sidecar reads it,
            and only the bytes sent to OpenAI leave your machine.
          </p>
          {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
        </div>
      </Card>
    </div>
  );
}
