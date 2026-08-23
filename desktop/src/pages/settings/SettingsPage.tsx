import { useState } from "react";
import type { DictionaryTerm, Folder, Settings, Template } from "../../shared/api/sidecar";
import type { Caps } from "../../app/model/caps";
import type { LegalKind } from "../../shared/lib/legal";
import { LegalPage } from "../../shared/ui/Legal";
import { SIDEBAR_WIDTH } from "../../shared/ui/layout";
import { ApiKeySection, PermissionsSection } from "./sections/AccessSections";
import { AppearanceSection, GeneralSection } from "./sections/GeneralSections";
import { AboutSection, FaqSection, HelpSection } from "./sections/HelpSections";
import DictionarySection from "./sections/DictionarySection";
import TemplatesSection, { type TemplateChange } from "./sections/TemplatesSection";
import WorkflowsSection from "./sections/WorkflowsSection";

export type SettingsSection =
  | "general"
  | "appearance"
  | "workflows"
  | "permissions"
  | "api"
  | "templates"
  | "dictionary"
  | "about"
  | "privacy"
  | "terms"
  | "faq"
  | "help";

const GROUPS: { label: string; items: SettingsSection[] }[] = [
  { label: "App", items: ["general", "appearance", "workflows", "permissions"] },
  { label: "AI", items: ["api", "templates", "dictionary"] },
  { label: "Help", items: ["faq", "help", "about", "privacy", "terms"] },
];

const SECTION_LABELS: Record<SettingsSection, string> = {
  general: "General",
  appearance: "Appearance",
  workflows: "Workflows",
  permissions: "Permissions",
  api: "API key",
  templates: "Templates",
  dictionary: "Dictionary",
  faq: "FAQ",
  help: "Help",
  about: "About",
  privacy: "Privacy Policy",
  terms: "Terms of Service",
};

interface SettingsPageProps {
  userName: string;
  settings: Settings;
  /** The one capability gate, derived at the composition layer. */
  caps: Caps;
  folders: Folder[];
  aiToggleBusy: boolean;
  aiToggleError: string | null;
  onSetAiEnabled: (enabled: boolean) => void;
  templates: Template[];
  onTemplatesChanged: (change: TemplateChange) => void;
  dictionaryTerms: DictionaryTerm[];
  onDictionarySaved: (terms: DictionaryTerm[]) => void;
  onDictionaryRemoved: (id: number) => void;
  onChangeSettings: (next: Settings) => void;
  /** The daily-note switch: save the setting and open today's note. */
  onEnableDailyNote: () => void;
  onSetupLeetCode: () => void;
  leetcodeBusy: boolean;
  leetcodeError: string | null;
  onSaveName: (name: string) => Promise<void>;
  saveError: string | null;
  onBack: () => void;
  onOperationBusyChange: (busy: boolean) => void;
}

/** Recording permissions and AI settings only exist to support AI features. */
const AI_ONLY_SECTIONS: readonly SettingsSection[] = [
  "permissions",
  "api",
  "templates",
  "dictionary",
];

export default function SettingsPage({
  userName,
  settings,
  caps,
  folders,
  aiToggleBusy,
  aiToggleError,
  onSetAiEnabled,
  templates,
  onTemplatesChanged,
  dictionaryTerms,
  onDictionarySaved,
  onDictionaryRemoved,
  onChangeSettings,
  onEnableDailyNote,
  onSetupLeetCode,
  leetcodeBusy,
  leetcodeError,
  onSaveName,
  saveError,
  onBack,
  onOperationBusyChange,
}: SettingsPageProps) {
  const [section, setSection] = useState<SettingsSection>("general");
  const [legalFrom, setLegalFrom] = useState<SettingsSection>("help");
  const [operationBusy, setOperationBusy] = useState(false);

  // Notes-only mode hides the AI and permission sections; the nav cannot
  // land on a section that no longer exists.
  const groups = GROUPS.filter(
    (group) => group.label !== "AI" || caps.ai,
  ).map((group) => ({
    ...group,
    items: group.items.filter((item) => caps.ai || !AI_ONLY_SECTIONS.includes(item)),
  }));
  const shownSection: SettingsSection =
    !caps.ai && AI_ONLY_SECTIONS.includes(section) ? "general" : section;

  const setBusy = (busy: boolean) => {
    setOperationBusy(busy);
    onOperationBusyChange(busy);
  };

  const openLegal = (kind: LegalKind) => {
    setLegalFrom(section);
    setSection(kind);
  };

  const itemClass = (active: boolean) =>
    `block w-full px-4 py-2 text-left text-sm ${
      active
        ? "bg-ink-line/60 text-ink dark:bg-paper-line/25 dark:text-paper"
        : "text-ink-mute hover:bg-ink-line/50 hover:text-ink dark:text-paper-mute dark:hover:bg-paper-line/20 dark:hover:text-paper"
    }`;
  const groupLabel =
    "px-4 pt-4 pb-1 text-[11px] font-medium uppercase tracking-wider text-ink-faint dark:text-paper-mute";

  return (
    <div className="flex h-full">
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-8 py-10">
          {saveError && (
            <p className="mb-5 text-xs leading-relaxed text-red-500">{saveError}</p>
          )}
          {shownSection === "general" && (
            <GeneralSection
              userName={userName}
              settings={settings}
              aiEnabled={caps.ai}
              aiToggleBusy={aiToggleBusy}
              aiToggleError={aiToggleError}
              onSetAiEnabled={onSetAiEnabled}
              onChangeSettings={onChangeSettings}
              onSaveName={onSaveName}
              onBusyChange={setBusy}
            />
          )}
          {shownSection === "appearance" && (
            <AppearanceSection settings={settings} onChangeSettings={onChangeSettings} />
          )}
          {shownSection === "workflows" && (
            <WorkflowsSection
              settings={settings}
              folders={folders}
              leetcodeBusy={leetcodeBusy}
              leetcodeError={leetcodeError}
              onChangeSettings={onChangeSettings}
              onEnableDailyNote={onEnableDailyNote}
              onSetupLeetCode={onSetupLeetCode}
            />
          )}
          {shownSection === "permissions" && <PermissionsSection onBusyChange={setBusy} />}
          {shownSection === "api" && <ApiKeySection onBusyChange={setBusy} />}
          {shownSection === "templates" && (
            <TemplatesSection
              templates={templates}
              onChanged={onTemplatesChanged}
              onBusyChange={setBusy}
            />
          )}
          {shownSection === "dictionary" && (
            <DictionarySection
              terms={dictionaryTerms}
              onTermsSaved={onDictionarySaved}
              onTermRemoved={onDictionaryRemoved}
              onBusyChange={setBusy}
            />
          )}
          {shownSection === "about" && <AboutSection onOpenLegal={openLegal} />}
          {(shownSection === "privacy" || shownSection === "terms") && (
            <LegalPage kind={shownSection} onBack={() => setSection(legalFrom)} />
          )}
          {shownSection === "faq" && <FaqSection />}
          {shownSection === "help" && <HelpSection />}
        </div>
      </div>

      <aside
        className="flex flex-none flex-col overflow-y-auto border-l border-ink-line bg-ink-surface dark:border-paper-line dark:bg-paper-surface"
        style={{ width: SIDEBAR_WIDTH }}
      >
        <header className="flex flex-none items-center border-b border-ink-line px-4 py-3 dark:border-paper-line">
          <h2 className="text-sm font-semibold text-ink dark:text-paper">Settings</h2>
        </header>
        <nav className="min-h-0 flex-1 overflow-y-auto py-1">
          <button
            type="button"
            onClick={onBack}
            disabled={operationBusy}
            className={`${itemClass(false)} disabled:cursor-not-allowed disabled:opacity-40`}
          >
            Back
          </button>
          {groups.map((group) => (
            <div key={group.label}>
              <div className={groupLabel}>{group.label}</div>
              {group.items.map((id) => (
                <button
                  key={id}
                  type="button"
                  disabled={operationBusy}
                  onClick={() => setSection(id)}
                  className={`${itemClass(shownSection === id)} disabled:cursor-not-allowed disabled:opacity-40`}
                >
                  {SECTION_LABELS[id]}
                </button>
              ))}
            </div>
          ))}
        </nav>
      </aside>
    </div>
  );
}
