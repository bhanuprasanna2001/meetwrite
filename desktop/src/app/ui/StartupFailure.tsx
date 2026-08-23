import { useEffect, useState } from "react";
import { AmbientMusic } from "../../shared/lib/ambientMusic";
import BrandWave from "../../shared/ui/BrandWave";

interface StartupFailureProps {
  message: string;
  onRetry: () => void;
}

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

export default function StartupFailure({ message, onRetry }: StartupFailureProps) {
  const [player] = useState(() => new AmbientMusic());
  const [muted, setMuted] = useState(false);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    player.start();
    const start = () => player.start();
    window.addEventListener("pointerdown", start);
    window.addEventListener("keydown", start);
    return () => {
      window.removeEventListener("pointerdown", start);
      window.removeEventListener("keydown", start);
      player.stop();
    };
  }, [player]);

  const toggleMusic = () => setMuted(player.toggleMute());

  const retry = () => {
    if (retrying) return;
    setRetrying(true);
    onRetry();
  };

  return (
    <main className="flex h-full min-h-0" aria-labelledby="startup-failure-title">
      {/* The calm half shares the theme: a quiet surface tone, never a dark/light
          split, so the window edge and the content stay one color. The column
          content sits vertically centered, like the onboarding screen. */}
      <aside className="relative flex w-[42%] flex-none items-center border-r border-ink-line bg-ink-surface p-10 dark:border-paper-line dark:bg-paper-surface">
        <div className="flex w-full flex-col items-center gap-10 px-2 text-center">
          <span className="text-sm font-medium tracking-wide text-ink-mute dark:text-paper-mute">
            meetwrite
          </span>
          <div className="flex flex-col items-center gap-8">
            <BrandWave className="text-ink-faint dark:text-paper-mute" />
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-ink-faint dark:text-paper-mute">
                Connection interrupted
              </p>
              <p className="mt-3 max-w-[24ch] text-sm leading-relaxed text-ink-mute dark:text-paper-mute">
                Your notes stay on this Mac. We just need to reconnect the local service.
              </p>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={toggleMusic}
          title={muted ? "Play ambient music" : "Mute ambient music"}
          className="absolute bottom-10 right-10 flex w-fit items-center gap-1.5 text-xs text-ink-mute hover:text-ink dark:text-paper-mute dark:hover:text-paper"
        >
          <SpeakerIcon muted={muted} />
          {muted ? "Muted" : player.title}
        </button>
      </aside>

      <section className="flex min-w-0 flex-1 items-center justify-center px-12">
        <div className="w-full max-w-sm animate-[fade-rise_0.35s_ease-out]">
          <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-ink-faint dark:text-paper-mute">
            Unable to continue
          </p>
          <h1
            id="startup-failure-title"
            className="mt-5 text-2xl font-semibold text-ink dark:text-paper"
          >
            meetwrite could not start.
          </h1>
          <p role="alert" className="mt-2 text-sm leading-relaxed text-ink-mute dark:text-paper-mute">
            {message}
          </p>
          <button
            type="button"
            onClick={retry}
            disabled={retrying}
            className="mt-7 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper disabled:cursor-wait disabled:opacity-50 dark:bg-paper dark:text-ink"
          >
            {retrying ? "Trying again…" : "Try again"}
          </button>
        </div>
      </section>
    </main>
  );
}
