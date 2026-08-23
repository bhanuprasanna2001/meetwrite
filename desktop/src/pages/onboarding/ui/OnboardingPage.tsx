import { useEffect, useState } from "react";
import type { Theme } from "../../../shared/api/sidecar";
import { useApiKey } from "../../../features/api-key/model/useApiKey";
import type { LegalKind } from "../../../shared/lib/legal";
import { AmbientMusic } from "../../../shared/lib/ambientMusic";
import { applyTheme, systemPreferredTheme } from "../../../shared/platform/theme";
import { usePermissions, type Permissions, type PermissionState } from "../../../shared/platform/permissions";
import BrandWave from "../../../shared/ui/BrandWave";
import { LegalOverlay } from "../../../shared/ui/Legal";
import PermissionRow from "../../../shared/ui/PermissionRow";
import {
  nextOnboardingStep,
  onboardingStepNumber,
  ONBOARDING_STEPS,
  type OnboardingAiChoice,
  type OnboardingStep,
} from "../model/onboardingFlow";

/**
 * First run (see docs/USER_FLOWS.md): two columns in one theme. The calm
 * left column holds the wordmark, wave, and copy; short steps flow on the
 * right. Setup music starts with this screen and stops the moment the note
 * opens.
 *
 * The steps choose the path once and are then fixed: theme (pre-picked from
 * the OS appearance) → mode (Notes only skips every AI and permission step;
 * Notes + AI keeps them) → name → … → done. Only the name gates Continue.
 */

/** The done screen's recap words for a permission. */
const permissionLabel = (status: PermissionState) =>
  status === "granted" ? "✓" : status === "denied" ? "Denied" : "Not asked";

/** The music chip's speaker: waves when on, a slash when muted. */
function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 6v4h2.5L8 13V3L4.5 6H2Z" fill="currentColor" />
      {muted ? (
        <path
          d="m10.5 6.5 3.5 3.5m0-3.5-3.5 3.5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          fill="none"
        />
      ) : (
        <path
          d="M10 5.5a3 3 0 0 1 0 5M11.5 4a5 5 0 0 1 0 8"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          fill="none"
        />
      )}
    </svg>
  );
}

/** One recap row on the done screen. */
function RecapRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <span className="text-sm text-ink-mute dark:text-paper-mute">{label}</span>
      <span className="text-sm font-medium text-ink-soft dark:text-paper">{value}</span>
    </div>
  );
}

/** One selectable product-path card on the mode step. */
function ModeCard({
  selected,
  title,
  description,
  onSelect,
}: {
  selected: boolean;
  title: string;
  description: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`rounded-xl border px-4 py-3.5 text-left transition-colors ${
        selected
          ? "border-ink bg-ink-surface dark:border-paper dark:bg-paper-surface"
          : "border-ink-line hover:border-ink dark:border-paper-line dark:hover:border-paper"
      }`}
    >
      <span className="block text-sm font-semibold text-ink dark:text-paper">{title}</span>
      <span className="mt-1 block text-xs leading-relaxed text-ink-mute dark:text-paper-mute">
        {description}
      </span>
    </button>
  );
}

/** One selectable theme card, with a swatch of the palette it picks. */
function ThemeCard({
  selected,
  title,
  description,
  swatchClass,
  onSelect,
}: {
  selected: boolean;
  title: string;
  description: string;
  swatchClass: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`rounded-xl border px-4 py-3.5 text-left transition-colors ${
        selected
          ? "border-ink bg-ink-surface dark:border-paper dark:bg-paper-surface"
          : "border-ink-line hover:border-ink dark:border-paper-line dark:hover:border-paper"
      }`}
    >
      <span className="flex items-center gap-2.5">
        <span className={`h-4 w-4 flex-none rounded-full border ${swatchClass}`} />
        <span className="text-sm font-semibold text-ink dark:text-paper">{title}</span>
      </span>
      <span className="mt-1 block text-xs leading-relaxed text-ink-mute dark:text-paper-mute">
        {description}
      </span>
    </button>
  );
}

interface OnboardingProps {
  permissions: Permissions;
  onDone: (name: string, aiEnabled: boolean, theme: Theme) => Promise<void>;
  onOperationBusyChange: (busy: boolean) => void;
}

export default function Onboarding({
  permissions: initial,
  onDone,
  onOperationBusyChange,
}: OnboardingProps) {
  const [name, setName] = useState("");
  const [step, setStep] = useState<OnboardingStep>("theme");
  // The OS appearance is the starting choice; one click switches it and the
  // whole screen follows immediately. The completion step persists it.
  const [themeChoice, setThemeChoice] = useState<Theme>(() => systemPreferredTheme());
  const [choice, setChoice] = useState<OnboardingAiChoice | null>(null);
  // The mode choice is null only on the mode step; both step lists start with it.
  const aiChoice: OnboardingAiChoice = choice ?? "notes-ai";
  const activeSteps = ONBOARDING_STEPS[aiChoice];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [legal, setLegal] = useState<LegalKind | null>(null);
  const [muted, setMuted] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const { keySet, busy: keyBusy, error: keyError, save: saveStoredKey } = useApiKey();
  const {
    permissions,
    requesting,
    error: permissionError,
    allowMicrophone,
    allowSystemAudio,
  } = usePermissions(initial);

  // One player for this screen's lifetime; state owns it so nothing lingers
  // after unmount.
  const [player] = useState(() => new AmbientMusic());

  // Setup music: start on mount, stop on unmount — the moment the note
  // opens, silence. Autoplay can be refused without a user gesture, so the
  // first pointer/key press retries.
  useEffect(() => {
    player.start();
    const startOnce = () => player.start();
    window.addEventListener("pointerdown", startOnce);
    window.addEventListener("keydown", startOnce);
    return () => {
      window.removeEventListener("pointerdown", startOnce);
      window.removeEventListener("keydown", startOnce);
      player.stop();
    };
  }, [player]);

  const toggleMusic = () => setMuted(player.toggleMute());

  const saveApiKey = async () => {
    const trimmed = apiKey.trim();
    if (!trimmed || keyBusy) return;
    onOperationBusyChange(true);
    try {
      if (await saveStoredKey(trimmed)) setApiKey("");
    } finally {
      onOperationBusyChange(false);
    }
  };

  const requestMicrophoneAccess = async () => {
    onOperationBusyChange(true);
    try {
      await allowMicrophone();
    } finally {
      onOperationBusyChange(false);
    }
  };

  const requestSystemAudioAccess = async () => {
    onOperationBusyChange(true);
    try {
      await allowSystemAudio();
    } finally {
      onOperationBusyChange(false);
    }
  };

  const submit = async () => {
    if (busy) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    onOperationBusyChange(true);
    setError(null);
    try {
      await onDone(trimmed, aiChoice === "notes-ai", themeChoice);
    } catch {
      setError("Couldn't reach the local service — is the sidecar running?");
      setBusy(false);
    } finally {
      onOperationBusyChange(false);
    }
  };

  const next = () => {
    if (step === "theme") {
      setStep("mode");
      return;
    }
    if (step === "mode") {
      if (choice === null) return;
      setStep("name");
      return;
    }
    if (step === "name" && name.trim() === "") return;
    if (step === "key" && keyBusy) return;
    if ((step === "microphone" || step === "systemAudio") && requesting !== null) return;
    if (step === "done") void submit();
    else setStep(nextOnboardingStep(step, aiChoice));
  };

  const selectTheme = (theme: Theme) => {
    setThemeChoice(theme);
    applyTheme(theme); // live preview; the done step persists the choice
  };

  const stepNumber = onboardingStepNumber(step, aiChoice);

  return (
    <>
    <div className="flex min-h-0 flex-1" inert={legal !== null}>
      <aside className="relative flex w-[42%] flex-none items-center border-r border-ink-line bg-ink-surface p-10 dark:border-paper-line dark:bg-paper-surface">
        <div className="flex w-full flex-col items-center gap-10 px-2 text-center">
          <span className="text-sm font-medium tracking-wide text-ink-mute dark:text-paper-mute">
            meetwrite
          </span>
          <div className="flex flex-col items-center gap-8">
            <BrandWave className="text-ink-faint dark:text-paper-mute" />
            <h1 className="text-[34px] leading-tight text-ink dark:text-paper" style={{ fontFamily: "Lora, Georgia, serif" }}>
              Every meeting, remembered.
            </h1>
            <p className="max-w-[26ch] text-sm leading-relaxed text-ink-mute dark:text-paper-mute">
              {aiChoice === "notes-only"
                ? "A quiet place for your notes — everything stays on your Mac."
                : "Transcription that listens, writes, and stays out of your way."}
            </p>
          </div>
        </div>
        <div className="absolute inset-x-10 bottom-10 flex items-center justify-between">
          <span className="text-[11px] font-medium tracking-widest text-ink-faint dark:text-paper-mute">
            {stepNumber} / {activeSteps.length}
          </span>
          <button
            type="button"
            onClick={toggleMusic}
            title={muted ? "Play setup music" : "Mute setup music"}
            className="flex items-center gap-1.5 text-xs text-ink-mute hover:text-ink dark:text-paper-mute dark:hover:text-paper"
          >
            <SpeakerIcon muted={muted} />
            {muted ? "Muted" : player.title}
          </button>
        </div>
      </aside>

      {/* The steps — one breath each, fading into the next. */}
      <section className="flex min-w-0 flex-1 justify-center overflow-y-auto px-12">
        <div
          key={step}
          className="my-auto flex w-full max-w-sm flex-col gap-8 animate-[fade-rise_0.35s_ease-out]"
        >
          <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-ink-faint dark:text-paper-mute">
            Getting started
          </p>

          {step === "theme" && (
            <>
              <div>
                <h2 className="text-2xl font-semibold text-ink dark:text-paper">
                  Light or dark?
                </h2>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-mute dark:text-paper-mute">
                  Your system appearance is picked for you — switch it any time in Settings.
                </p>
              </div>
              <div className="flex flex-col gap-3">
                <ThemeCard
                  selected={themeChoice === "light"}
                  title="Light"
                  description="The alabaster palette."
                  swatchClass="border-ink-line bg-paper"
                  onSelect={() => selectTheme("light")}
                />
                <ThemeCard
                  selected={themeChoice === "dark"}
                  title="Dark"
                  description="The jet palette."
                  swatchClass="border-paper-line bg-ink"
                  onSelect={() => selectTheme("dark")}
                />
              </div>
            </>
          )}

          {step === "mode" && (
            <>
              <div>
                <h2 className="text-2xl font-semibold text-ink dark:text-paper">
                  How will you use meetwrite?
                </h2>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-mute dark:text-paper-mute">
                  Pick once — you can switch any time later in Settings.
                </p>
              </div>
              <div className="flex flex-col gap-3">
                <ModeCard
                  selected={choice === "notes-only"}
                  title="Notes only"
                  description="Write, organize, and search your notes. Everything stays on your Mac."
                  onSelect={() => setChoice("notes-only")}
                />
                <ModeCard
                  selected={choice === "notes-ai"}
                  title="Notes + AI"
                  description="All of the above, plus recording, live transcript, chat, and Enhance — with your own OpenAI key."
                  onSelect={() => setChoice("notes-ai")}
                />
              </div>
            </>
          )}

          {step === "name" && (
            <>
              <div>
                <h2 className="text-2xl font-semibold text-ink dark:text-paper">
                  What should we call you?
                </h2>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-mute dark:text-paper-mute">
                  Your name appears on transcripts you copy, so you can always find what you
                  said.
                </p>
              </div>
              <input
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") next();
                }}
                placeholder="Your name"
                aria-label="Your name"
                className="w-full border-b border-ink-line bg-transparent pb-2 text-base text-ink outline-none placeholder:text-ink-faint focus:border-ink dark:border-paper-line dark:text-paper dark:focus:border-paper"
              />
            </>
          )}

          {step === "key" && (
            <>
              <div>
                <h2 className="text-2xl font-semibold text-ink dark:text-paper">Your AI key</h2>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-mute dark:text-paper-mute">
                  Record, chat, and Enhance run on your own OpenAI key. It stays in your
                  macOS Keychain — only what you send to OpenAI leaves your Mac.
                </p>
              </div>
              <div className="rounded-xl border border-ink-line dark:border-paper-line">
                <div className="flex items-center gap-3 px-3 pt-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-ink-soft dark:text-paper">
                      OpenAI API key
                    </div>
                    <div className="text-xs text-ink-mute dark:text-paper-mute">
                      Create one at platform.openai.com — you can skip for now.
                    </div>
                  </div>
                  {keySet === true && (
                    <span className="text-sm font-semibold text-emerald-500">✓</span>
                  )}
                </div>
                <div className="flex items-center gap-3 px-3 py-2.5">
                  <input
                    autoFocus
                    type="password"
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void saveApiKey();
                    }}
                    placeholder="sk-…"
                    aria-label="OpenAI API key"
                    className="min-w-0 flex-1 border-b border-ink-line bg-transparent pb-1 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-ink dark:border-paper-line dark:text-paper dark:focus:border-paper"
                  />
                  <button
                    type="button"
                    onClick={() => void saveApiKey()}
                    disabled={keyBusy || apiKey.trim() === ""}
                    className="flex-none rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-paper disabled:cursor-not-allowed disabled:opacity-40 dark:bg-paper dark:text-ink"
                  >
                    {keyBusy ? "Saving…" : "Save key"}
                  </button>
                </div>
                {keyError && <p className="px-3 pb-2.5 text-xs text-red-500">{keyError}</p>}
              </div>
            </>
          )}

          {step === "microphone" && (
            <>
              <div>
                <h2 className="text-2xl font-semibold text-ink dark:text-paper">Your voice</h2>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-mute dark:text-paper-mute">
                  meetwrite records your microphone so your side of the meeting is heard.
                </p>
              </div>
              <div className="rounded-xl border border-ink-line dark:border-paper-line">
                <PermissionRow
                  title="Microphone"
                  description="Record your voice in meetings."
                  status={permissions.microphone}
                  busy={requesting === "microphone"}
                  onAllow={() => void requestMicrophoneAccess()}
                  settingsPane="microphone"
                />
              </div>
            </>
          )}

          {step === "systemAudio" && (
            <>
              <div>
                <h2 className="text-2xl font-semibold text-ink dark:text-paper">Everyone else</h2>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-mute dark:text-paper-mute">
                  System audio captures the meeting itself — macOS asks for Audio Capture (System Audio Recording Only).
                </p>
              </div>
              <div className="rounded-xl border border-ink-line dark:border-paper-line">
                <PermissionRow
                  title="System audio"
                  description="Record the other participants in the meeting."
                  status={permissions.systemAudio}
                  busy={requesting === "systemAudio"}
                  onAllow={() => void requestSystemAudioAccess()}
                  settingsPane="screenCapture"
                />
              </div>
            </>
          )}

          {step === "done" && (
            <>
              <div>
                <h2 className="text-2xl font-semibold text-ink dark:text-paper">You're all set.</h2>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-mute dark:text-paper-mute">
                  {aiChoice === "notes-ai"
                    ? "Your note is ready. Anything missing can wait — Record needs the AI key and both permissions, and Settings has them anytime."
                    : "Your note is ready. Everything you write stays on this Mac."}
                </p>
              </div>
              <div className="divide-y divide-ink-line rounded-xl border border-ink-line dark:divide-paper-line dark:border-paper-line">
                <RecapRow label="Name" value={name.trim()} />
                {aiChoice === "notes-ai" ? (
                  <>
                    <RecapRow label="AI key" value={keySet === true ? "✓" : "Not set"} />
                    <RecapRow label="Microphone" value={permissionLabel(permissions.microphone)} />
                    <RecapRow label="System audio" value={permissionLabel(permissions.systemAudio)} />
                  </>
                ) : (
                  <RecapRow label="AI features" value="Off" />
                )}
              </div>
            </>
          )}

          {/* One footer block: progress dots and the action on a row, the
              consent line right beneath — both in the column flow. */}
          <div className="flex flex-col gap-3">
            {(error || permissionError) && (
              <p className="text-xs text-red-500">{error ?? permissionError}</p>
            )}
            <div className="flex items-center justify-between">
              <div className="flex gap-1.5" aria-label={`Step ${stepNumber} of ${activeSteps.length}`}>
                {activeSteps.map((item, index) => (
                  <span
                    key={item}
                    className={`h-1 w-4 rounded-full ${
                      index + 1 === stepNumber ? "bg-ink dark:bg-paper" : "bg-ink-line dark:bg-paper-line"
                    }`}
                  />
                ))}
              </div>
              <button
                type="button"
                onClick={next}
                disabled={
                  busy ||
                  (step === "mode" && choice === null) ||
                  (step === "name" && name.trim() === "") ||
                  (step === "key" && keyBusy) ||
                  ((step === "microphone" || step === "systemAudio") && requesting !== null)
                }
                className="rounded-lg bg-ink px-5 py-2 text-sm font-medium text-paper disabled:cursor-not-allowed disabled:opacity-40 dark:bg-paper dark:text-ink"
              >
                {busy
                  ? "Opening…"
                  : step === "done"
                    ? "Open your first note →"
                    : "Continue →"}
              </button>
            </div>
            <p className="text-center text-[11px] leading-relaxed text-ink-faint dark:text-paper-mute">
              By continuing, you agree to the{" "}
              <button
                type="button"
                onClick={() => setLegal("terms")}
                className="underline hover:text-ink dark:hover:text-paper"
              >
                Terms
              </button>{" "}
              and{" "}
              <button
                type="button"
                onClick={() => setLegal("privacy")}
                className="underline hover:text-ink dark:hover:text-paper"
              >
                Privacy Policy
              </button>
              .
            </p>
          </div>
        </div>
      </section>

    </div>
    {legal && <LegalOverlay kind={legal} onClose={() => setLegal(null)} />}
    </>
  );
}
