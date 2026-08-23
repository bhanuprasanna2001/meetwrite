import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import type { LegalKind } from "../../../shared/lib/legal";
import { openSystemSettings } from "../../../shared/platform/permissions";
import {
  Card,
  OpenButton,
  Row,
  SectionHeading,
} from "../ui/SettingsControls";

const FAQS = [
  {
    q: "Where does my OpenAI API key live?",
    a: "In the macOS Keychain under meetwrite. Only the local sidecar can read it, and only the bytes you send to OpenAI leave your machine.",
  },
  {
    q: "What does Record capture?",
    a: "Your microphone and the meeting's system audio. Both are transcribed live by OpenAI into the transcript, labeled You and Them.",
  },
  {
    q: "Why does the other person's voice show up under You too?",
    a: "You is your microphone and Them is the meeting's audio. On speakerphone the mic also hears the other person — meetwrite silences the mic side while the other side is talking, so You only carries your own voice. If you talk at the same time as them, wear headphones or earphones so your mic only picks up you.",
  },
  {
    q: "What does Enhance use?",
    a: "It rewrites your notes and the transcript into clean plain-text notes, saved as a new version you can switch back to anytime. Pick a template — or write your own instructions — when you run it, and run it again whenever you want.",
  },
  {
    q: "Where are my notes stored?",
    a: "In a local SQLite file on your Mac. Notes, chats, and transcripts never leave the machine except the bytes you send to OpenAI.",
  },
  {
    q: "What does the chat know?",
    a: "The assistant answers from your notes, the meeting transcript, and the conversation so far — nothing else.",
  },
];

export function FaqSection() {
  return (
    <div className="flex flex-col gap-8">
      <SectionHeading title="FAQ" />
      <Card>
        {FAQS.map(({ q, a }) => (
          <details key={q} className="group px-4 py-3">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium text-ink-soft dark:text-paper [&::-webkit-details-marker]:hidden">
              {q}
              <span className="flex-none text-ink-faint group-open:rotate-90 dark:text-paper-mute">›</span>
            </summary>
            <p className="mt-2 max-w-prose text-sm leading-relaxed text-ink-mute dark:text-paper-mute">
              {a}
            </p>
          </details>
        ))}
      </Card>
    </div>
  );
}

export function HelpSection() {
  return (
    <div className="flex flex-col gap-8">
      <SectionHeading
        title="Help"
        hint="Recording needs two macOS permissions — open the right pane to grant them."
      />
      <Card>
        <Row title="Microphone" description="Recording your voice needs this permission.">
          <OpenButton onClick={() => void openSystemSettings("microphone")} />
        </Row>
        <Row
          title="Screen & audio"
          description="Capturing the meeting audio needs this permission — macOS may list meetwrite under 'System Audio Recording Only', which is the right place."
        >
          <OpenButton onClick={() => void openSystemSettings("screenCapture")} />
        </Row>
      </Card>
    </div>
  );
}

export function AboutSection({
  onOpenLegal,
}: {
  onOpenLegal: (kind: LegalKind) => void;
}) {
  const [version, setVersion] = useState("0.1.0");

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    getVersion().then(setVersion).catch(() => undefined);
  }, []);

  return (
    <div className="flex flex-col gap-8">
      <SectionHeading title="About" />
      <div className="flex flex-col items-center gap-4 py-2 text-center">
        {/* One visible icon per theme: the dark tile reads on paper, the
            light tile reads on ink. Both share the same slot and alt text. */}
        <img src="/icon.png" alt="meetwrite icon" className="h-24 w-24 rounded-2xl dark:hidden" />
        <img src="/icon-light.png" alt="meetwrite icon" className="hidden h-24 w-24 rounded-2xl dark:block" />
        <div>
          <p className="text-lg font-semibold text-ink dark:text-paper">meetwrite</p>
          <p className="mt-0.5 text-sm text-ink-mute dark:text-paper-mute">Version {version}</p>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-ink-mute dark:text-paper-mute">
            A private, local-first meeting note-taker for Mac. Record, write, ask.
          </p>
        </div>
      </div>
      <Card>
        <Row title="Privacy Policy" description="What stays on your Mac and what goes to OpenAI.">
          <OpenButton onClick={() => onOpenLegal("privacy")} />
        </Row>
        <Row title="Terms of Service" description="The short version of the fine print.">
          <OpenButton onClick={() => onOpenLegal("terms")} />
        </Row>
        <Row
          title="Setup music"
          description="Mellow · Distant Memory · Cloud Nine — Nightingale Lofi, CC BY-SA 4.0."
        />
      </Card>
    </div>
  );
}
