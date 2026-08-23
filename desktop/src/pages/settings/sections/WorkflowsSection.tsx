import type { Folder, Settings } from "../../../shared/api/sidecar";
import {
  Card,
  Row,
  SectionHeading,
  Select,
  Switch,
} from "../ui/SettingsControls";

interface WorkflowsSectionProps {
  settings: Settings;
  folders: Folder[];
  leetcodeBusy: boolean;
  leetcodeError: string | null;
  onChangeSettings: (next: Settings) => void;
  /** Turning the daily note on saves the setting and creates today's note
   * right away — settings stay on screen. */
  onEnableDailyNote: () => void;
  onSetupLeetCode: () => void;
}

/**
 * The two life-organizing workflows, in one place:
 *
 * - Daily note: one note per day, created at the chosen time while the app
 *   is open (or caught up on the next launch) and dropped in the chosen
 *   folder. Creation is silent — the note simply lands in its folder.
 * - LeetCode starter: one idempotent click that makes the LeetCode folder
 *   with a Getting Started template, then opens it.
 */
export default function WorkflowsSection({
  settings,
  folders,
  leetcodeBusy,
  leetcodeError,
  onChangeSettings,
  onEnableDailyNote,
  onSetupLeetCode,
}: WorkflowsSectionProps) {
  // The server lists folders Inbox-first, so the select's default (the
  // first option) is already Inbox — no synthetic entries, no duplicates.
  const folderOptions = folders.map((folder) => ({
    value: String(folder.id),
    label: folder.name,
  }));
  const inboxId = folders.find((folder) => folder.isInbox)?.id;
  const dailyFolderValue = String(settings.dailyNoteFolderId ?? inboxId ?? "");

  return (
    <div className="flex flex-col gap-8">
      <SectionHeading
        title="Workflows"
        hint="Small automations that organize your day and your practice."
      />
      <Card>
        <Row
          title="Daily note"
          description="One note per day — it lands in the folder below, at the time you choose."
        >
          <Switch
            on={settings.dailyNoteEnabled}
            onClick={() =>
              settings.dailyNoteEnabled
                ? onChangeSettings({ ...settings, dailyNoteEnabled: false })
                : onEnableDailyNote()
            }
            label="Create a daily note"
          />
        </Row>
        {settings.dailyNoteEnabled && (
          <>
            <Row title="Folder" description="Today's note lands here.">
              <Select
                ariaLabel="Daily note folder"
                value={dailyFolderValue}
                onChange={(value) =>
                  onChangeSettings({
                    ...settings,
                    dailyNoteFolderId: Number(value),
                  })
                }
                options={folderOptions}
              />
            </Row>
            <Row
              title="Time"
              description="The note appears when the app is open at this time."
            >
              <input
                type="time"
                value={settings.dailyNoteTime}
                aria-label="Daily note time"
                onChange={(event) => {
                  // Only a complete HH:MM is a valid time — a cleared input
                  // keeps the last choice instead of failing to save.
                  if (/^\d{2}:\d{2}$/.test(event.target.value)) {
                    onChangeSettings({
                      ...settings,
                      dailyNoteTime: event.target.value,
                    });
                  }
                }}
                className="w-32 appearance-none rounded-lg border border-ink-line bg-transparent px-3 py-1.5 text-sm text-ink outline-none dark:border-paper-line dark:text-paper"
              />
            </Row>
          </>
        )}
      </Card>

      <Card>
        <Row
          title="LeetCode starter"
          description="A LeetCode folder with a Getting Started guide. New notes in it start from the problem template — frontmatter, review sections, and tags included."
        >
          <button
            type="button"
            disabled={leetcodeBusy}
            onClick={onSetupLeetCode}
            className="flex-none cursor-pointer rounded-lg border border-ink-line px-3 py-1.5 text-xs font-medium text-ink-soft hover:text-ink disabled:cursor-not-allowed disabled:opacity-50 dark:border-paper-line dark:text-paper-dim dark:hover:text-paper"
          >
            {leetcodeBusy ? "Setting up…" : "Set up"}
          </button>
        </Row>
        {leetcodeError && (
          <p className="px-4 pb-3 text-xs leading-relaxed text-red-500">{leetcodeError}</p>
        )}
      </Card>
    </div>
  );
}
