import { useState } from "react";
import type { NoteFont, Settings } from "../../../shared/api/sidecar";
import { FONT_LABELS, FONTS } from "../../../shared/lib/fonts";
import {
  Card,
  Row,
  SectionHeading,
  Segmented,
  Select,
  Switch,
} from "../ui/SettingsControls";

export function GeneralSection({
  userName,
  settings,
  aiEnabled,
  aiToggleBusy,
  aiToggleError,
  onSetAiEnabled,
  onChangeSettings,
  onSaveName,
  onBusyChange,
}: {
  userName: string;
  settings: Settings;
  aiEnabled: boolean;
  aiToggleBusy: boolean;
  aiToggleError: string | null;
  onSetAiEnabled: (enabled: boolean) => void;
  onChangeSettings: (next: Settings) => void;
  onSaveName: (name: string) => Promise<void>;
  onBusyChange: (busy: boolean) => void;
}) {
  const [name, setName] = useState(userName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === userName || busy) return;
    setBusy(true);
    onBusyChange(true);
    setError(null);
    try {
      await onSaveName(trimmed);
    } catch {
      setError("Your name could not be saved.");
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <SectionHeading title="General" />
      <Card>
        <div className="flex items-center justify-between gap-6 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink-soft dark:text-paper">Name</p>
            <p className="mt-0.5 text-xs leading-relaxed text-ink-mute dark:text-paper-mute">
              How meetwrite greets you — press Enter to save.
            </p>
          </div>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => void save()}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            placeholder="Your name"
            aria-label="Your name"
            disabled={busy}
            className="w-44 flex-none border-b border-ink-line bg-transparent pb-1 text-right text-sm text-ink outline-none placeholder:text-ink-faint focus:border-ink dark:border-paper-line dark:text-paper dark:focus:border-paper"
          />
        </div>
        {error && <p className="px-4 pb-3 text-xs text-red-500">{error}</p>}
        <Row title="Theme" description="Everything flips in one frame.">
          <Segmented
            value={settings.theme}
            onChange={(theme) => onChangeSettings({ ...settings, theme })}
            options={[
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
            ariaLabel="Theme"
          />
        </Row>
        <Row
          title="AI features"
          description={
            aiEnabled
              ? "Recording, live transcript, chat, and Enhance — with your own OpenAI key."
              : "Notes only. Everything you write stays on your Mac."
          }
        >
          <Segmented
            value={aiEnabled ? "notes-ai" : "notes-only"}
            onChange={(value) => onSetAiEnabled(value === "notes-ai")}
            options={[
              { value: "notes-only", label: "Notes only" },
              { value: "notes-ai", label: "Notes + AI" },
            ]}
            ariaLabel="AI features"
            disabled={aiToggleBusy}
          />
        </Row>
        {aiToggleBusy && (
          <p className="px-4 pb-3 text-xs text-ink-faint dark:text-paper-mute">
            {aiEnabled ? "Turning AI on…" : "Turning AI off…"}
          </p>
        )}
        {aiToggleError && (
          <p className="px-4 pb-3 text-xs leading-relaxed text-red-500">{aiToggleError}</p>
        )}
        {aiEnabled && (
          <Row
            title="Meeting mode on Record"
            description="Record moves the window to the right third of the screen."
          >
            <Switch
              on={settings.enterMeetingOnRecord}
              onClick={() =>
                onChangeSettings({
                  ...settings,
                  enterMeetingOnRecord: !settings.enterMeetingOnRecord,
                })
              }
              label="Enter Meeting mode when recording starts"
            />
          </Row>
        )}
      </Card>
    </div>
  );
}

export function AppearanceSection({
  settings,
  onChangeSettings,
}: {
  settings: Settings;
  onChangeSettings: (next: Settings) => void;
}) {
  return (
    <div className="flex flex-col gap-8">
      <SectionHeading title="Appearance" />
      <Card>
        <Row title="Note font" description="The typeface of your notes.">
          <Select
            ariaLabel="Note font"
            value={settings.noteFont}
            onChange={(font) => onChangeSettings({ ...settings, noteFont: font as NoteFont })}
            options={FONTS.map((font) => ({ value: font, label: FONT_LABELS[font] }))}
          />
        </Row>
        <Row title="Note font size" description="16 to 32 px, even steps.">
          <Select
            ariaLabel="Note font size"
            value={String(settings.noteFontSize)}
            onChange={(size) => onChangeSettings({ ...settings, noteFontSize: Number(size) })}
            options={[16, 18, 20, 22, 24, 26, 28, 30, 32].map((size) => ({
              value: String(size),
              label: `${size}px`,
            }))}
          />
        </Row>
      </Card>
    </div>
  );
}
