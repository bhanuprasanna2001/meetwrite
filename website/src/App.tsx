import { useState } from "react";

// The published DMG lives on GitHub Releases (stable asset name); local
// previews fall back to the staged download.
const DMG_URL = import.meta.env.VITE_DOWNLOAD_URL || "/downloads/meetwrite.dmg";

const FEATURES = [
  {
    number: "01",
    title: "Listen",
    body: "The meeting streams into a live transcript — every word, as it happens.",
  },
  {
    number: "02",
    title: "Ask",
    body: "Chat with the transcript and get answers from what was actually said.",
  },
  {
    number: "03",
    title: "Perfect",
    body: "One press turns scattered words into a clean, elegant note — in your voice.",
  },
];

type Theme = "light" | "dark";

const PRIMARY_BUTTON =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-red px-6 py-3 text-sm " +
  "font-medium text-alabaster transition-colors hover:bg-red-600";

const GHOST_BUTTON =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-jet-line px-6 py-3 " +
  "text-sm font-medium text-jet transition-colors hover:border-jet-soft hover:text-jet-soft " +
  "dark:border-alabaster-line dark:text-alabaster dark:hover:border-alabaster-soft " +
  "dark:hover:text-alabaster-soft";

const TAB_CLASS =
  "flex h-10 w-full items-center justify-center rounded-lg border border-jet-line bg-jet-surface " +
  "text-[11px] font-medium uppercase tracking-wider text-jet-mute dark:border-alabaster-line " +
  "dark:bg-alabaster-surface dark:text-alabaster-mute";

// Toolbar controls: hover is text-only, like the app's freewrite look.
const TOOLBAR_ITEM = "px-2 py-1 font-medium text-jet-mute dark:text-alabaster-mute";

/** An icon control — the same button padding as every text control. */
const TOOLBAR_ICON =
  "flex items-center justify-center px-2 py-1 text-jet-mute dark:text-alabaster-mute";

/** A control in its "on" state (the shown version, window mode, …). */
const TOOLBAR_ON = "px-2 py-1 font-medium text-jet dark:text-alabaster";

function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function ArrowDown() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true">
      <path
        d="M8 2v10M3.5 8.5 8 13l4.5-4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Sun() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true">
      <circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6 13 13M13 3l-1.4 1.4M4.4 11.6 3 13"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Moon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true">
      <path
        d="M13.5 9.5A5.5 5.5 0 1 1 6.5 2.5a4.5 4.5 0 0 0 7 7Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  );
}

function BookIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 3.5c-1.5-1.5-3.5-2-6-2v11c2.5 0 4.5.5 6 2 1.5-1.5 3.5-2 6-2v-11c-2.5 0-4.5.5-6 2Z" />
      <path d="M8 3.5v11" />
    </svg>
  );
}

function PhotoIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
      <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
      <circle cx="5.5" cy="6.5" r="1.5" />
      <path d="m2.5 12 3.5-3.5 2.5 2.5 2-2 3 3" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <rect x="6" y="1.5" width="4" height="7.5" rx="2" />
      <path d="M3 7.5a5 5 0 0 0 10 0M8 12.5V15M5.5 15h5" />
    </svg>
  );
}

function Bars() {
  return (
    <svg className="h-3.5 w-3.5 flex-none" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2" y="9" width="2.5" height="4" rx="1.25" fill="currentColor" />
      <rect x="6.75" y="5" width="2.5" height="8" rx="1.25" fill="currentColor" />
      <rect x="11.5" y="2" width="2.5" height="11" rx="1.25" fill="currentColor" />
    </svg>
  );
}

/** The ◐ theme fidget — circle outline with one filled half. */
function ThemeIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M8 1.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="M8 1.5a6.5 6.5 0 0 1 0 13Z" fill="currentColor" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function DownloadLink({ className = PRIMARY_BUTTON }: { className?: string }) {
  return (
    <a href={DMG_URL} download className={className}>
      <ArrowDown />
      Download for macOS
    </a>
  );
}

function Nav({ theme, onToggleTheme }: { theme: Theme; onToggleTheme: () => void }) {
  return (
    <header className="fixed inset-x-0 top-0 z-10 border-b border-jet-line/70 bg-alabaster/85 backdrop-blur-sm dark:border-alabaster-line/70 dark:bg-jet/85">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
        <a href="#top" className="flex items-center gap-2.5">
          {/* The meetwrite mark — dark on light, light on dark. */}
          <img src="/meetwrite-dark.png" alt="" className="h-6 w-6 dark:hidden" />
          <img src="/meetwrite-light.png" alt="" className="hidden h-6 w-6 dark:block" />
          <span className="font-garamond text-xl italic tracking-tight">meetwrite</span>
        </a>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleTheme}
            title={theme === "dark" ? "Switch to light" : "Switch to dark"}
            aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-jet-line text-jet-mute transition-colors hover:text-jet dark:border-alabaster-line dark:text-alabaster-mute dark:hover:text-alabaster"
          >
            {theme === "dark" ? <Sun /> : <Moon />}
          </button>
          <DownloadLink className="inline-flex items-center justify-center gap-2 rounded-lg bg-red px-4 py-2 text-sm font-medium text-alabaster transition-colors hover:bg-red-600" />
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="px-6 pb-24 pt-40 text-center sm:pt-48">
      <p className="text-xs font-medium uppercase tracking-[0.35em] text-jet-mute dark:text-alabaster-mute">
        For macOS
      </p>
      <h1 className="mx-auto mt-10 max-w-3xl font-garamond text-6xl leading-[1.02] tracking-tight sm:text-7xl md:text-8xl">
        The meeting,
        <br />
        <em className="text-red">written.</em>
      </h1>
      <p className="mx-auto mt-9 max-w-xl text-lg leading-relaxed text-jet-mute dark:text-alabaster-mute">
        meetwrite listens to your meetings and turns them into notes — a live
        transcript, a chat that answers, and prose worth keeping. Everything
        stays on your Mac.
      </p>
      <div className="mt-11 flex flex-wrap items-center justify-center gap-4">
        <DownloadLink />
        <a href="#glimpse" className={GHOST_BUTTON}>
          See it in action
        </a>
      </div>
    </section>
  );
}

function Glimpse() {
  return (
    <section
      id="glimpse"
      className="border-y border-jet-line bg-jet-surface px-6 py-24 dark:border-alabaster-line dark:bg-black/25"
    >
      {/* The real window: 1100 × 600 — a huge note surface over one small
          toolbar. Same ratio, same proportions as the app. */}
      <div
        aria-hidden="true"
        className="mx-auto aspect-[11/6] w-full max-w-[1100px] overflow-hidden rounded-[10px] border border-jet-line bg-alabaster font-sans shadow-[0_24px_80px_-24px_rgba(37,37,37,0.3)] dark:border-alabaster-line dark:bg-jet dark:shadow-[0_24px_80px_-24px_rgba(0,0,0,0.8)]"
      >
        <div className="flex h-full flex-col">
          {/* The note surface — everything above the tab row. */}
          <div className="min-h-0 flex-1">
            <p
              className="px-8 pt-8 text-base leading-relaxed text-jet dark:text-alabaster"
              style={{ fontFamily: "Lato, system-ui, sans-serif", fontSize: 16 }}
            >
              <span className="text-jet-faint dark:text-alabaster-mute">Start typing</span>
              <span className="caret ml-px inline-block h-[1.1em] w-[2px] translate-y-[0.18em] bg-jet dark:bg-alabaster" />
            </p>
          </div>
          {/* The chat / transcript / audio row under the note. */}
          <div className="mx-auto flex w-full max-w-3xl flex-none gap-2 px-8 pb-2">
            <span className={TAB_CLASS}>Chat</span>
            <span className={TAB_CLASS}>Transcript</span>
            <span className="flex h-10 w-10 flex-none items-center justify-center rounded-lg border border-jet-line bg-jet-surface text-jet-mute dark:border-alabaster-line dark:bg-alabaster-surface dark:text-alabaster-mute">
              <Bars />
            </span>
          </div>
          {/* The one-bar toolbar — h-11, light grey, the app's exact order. */}
          <div className="no-scrollbar flex h-11 flex-none items-center gap-1 overflow-x-auto whitespace-nowrap border-t border-jet-line bg-jet-surface px-3 text-xs dark:border-alabaster-line dark:bg-alabaster-surface">
            <span className={TOOLBAR_ITEM}>?</span>
            <span className={TOOLBAR_ICON}>
              <CopyIcon />
            </span>
            <span className={TOOLBAR_ITEM}>16px</span>
            <span className={TOOLBAR_ITEM}>Lato</span>
            <span className={TOOLBAR_ICON}>
              <BookIcon />
            </span>
            <span className={TOOLBAR_ICON}>
              <PhotoIcon />
            </span>
            <span className="pointer-events-none flex flex-1 items-center justify-center self-stretch px-4 text-[10px] font-medium tracking-wide text-jet-faint opacity-60 dark:text-alabaster-mute">
              Drag to move
            </span>
            <span className={TOOLBAR_ICON}>
              <MicIcon />
            </span>
            <span className={TOOLBAR_ON}>Human</span>
            <span className={`${TOOLBAR_ITEM} opacity-40`}>Enhance</span>
            <span className={TOOLBAR_ITEM}>Download</span>
            <span className={TOOLBAR_ON}>N</span>
            <span className={TOOLBAR_ITEM}>F</span>
            <span className={TOOLBAR_ITEM}>M</span>
            <span className={TOOLBAR_ITEM}>New Entry</span>
            <span className={TOOLBAR_ITEM}>History</span>
            <span className={TOOLBAR_ICON}>
              <ThemeIcon />
            </span>
            <span className={TOOLBAR_ICON}>
              <GearIcon />
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

function Features() {
  return (
    <section className="border-t border-jet-line dark:border-alabaster-line">
      <div className="mx-auto max-w-5xl px-6 py-24">
        <h2 className="font-garamond text-4xl tracking-tight sm:text-5xl">
          Three moves. <em className="text-red">One flow.</em>
        </h2>
        <div className="mt-16 grid gap-12 sm:grid-cols-3 sm:gap-8">
          {FEATURES.map((feature) => (
            <article key={feature.number} className="border-t border-jet-line pt-6 dark:border-alabaster-line">
              <p className="font-garamond text-2xl italic text-red">{feature.number}</p>
              <h3 className="mt-4 font-garamond text-2xl">{feature.title}</h3>
              <p className="mt-3 text-[15px] leading-relaxed text-jet-mute dark:text-alabaster-mute">
                {feature.body}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function Download() {
  return (
    <section className="border-t border-jet-line dark:border-alabaster-line">
      <div className="mx-auto max-w-3xl px-6 py-28 text-center">
        <h2 className="font-garamond text-4xl tracking-tight sm:text-5xl">
          Keep your words <em className="text-red">at home.</em>
        </h2>
        <p className="mx-auto mt-6 max-w-lg text-lg leading-relaxed text-jet-mute dark:text-alabaster-mute">
          No account. No cloud. Notes, transcripts, and recordings stay on your
          Mac — exactly where they belong.
        </p>
        <div className="mt-10">
          <DownloadLink />
        </div>
        <p className="mt-6 text-xs tracking-wide text-jet-faint dark:text-alabaster-faint">
          v0.1.0 · Apple Silicon · Signed &amp; notarized · macOS 14.2+
        </p>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-jet-line dark:border-alabaster-line">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-8">
        <span className="font-garamond italic">meetwrite</span>
        <span className="text-xs tracking-wide text-jet-mute dark:text-alabaster-mute">
          © 2026 · Made with care.
        </span>
      </div>
    </footer>
  );
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(currentTheme);

  const toggleTheme = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem("meetwrite-theme", next);
  };

  return (
    <div id="top" className="min-h-screen bg-alabaster text-jet dark:bg-jet dark:text-alabaster">
      <Nav theme={theme} onToggleTheme={toggleTheme} />
      <main>
        <Hero />
        <Glimpse />
        <Features />
        <Download />
      </main>
      <Footer />
    </div>
  );
}
