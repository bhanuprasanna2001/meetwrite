import type { LegalKind } from "../lib/legal";
import { LEGAL_TITLES, legalSections } from "../lib/legal";

/**
 * The privacy policy and terms of service, shared by the settings sub-pages
 * and the onboarding overlay. `LegalPage` sits inside a settings section;
 * `LegalOverlay` floats above the onboarding screen like the help overlay.
 */

function LegalBody({ kind }: { kind: LegalKind }) {
  return (
    <div className="flex flex-col gap-6">
      {legalSections(kind).map((section) => (
        <section key={section.title}>
          <h3 className="text-sm font-semibold text-ink-soft dark:text-paper">
            {section.title}
          </h3>
          {section.paragraphs.map((paragraph) => (
            <p
              key={paragraph}
              className="mt-2 max-w-prose text-sm leading-relaxed text-ink-mute dark:text-paper-mute"
            >
              {paragraph}
            </p>
          ))}
        </section>
      ))}
    </div>
  );
}

export function LegalPage({ kind, onBack }: { kind: LegalKind; onBack: () => void }) {
  return (
    <div className="flex flex-col gap-8">
      <button
        type="button"
        onClick={onBack}
        className="self-start text-sm font-medium text-ink-mute hover:text-ink dark:text-paper-mute dark:hover:text-paper"
      >
        ← Back
      </button>
      <div>
        <h2 className="text-base font-semibold text-ink dark:text-paper">
          {LEGAL_TITLES[kind]}
        </h2>
        <p className="mt-1 text-sm text-ink-mute dark:text-paper-mute">
          Last updated: August 2026
        </p>
      </div>
      <LegalBody kind={kind} />
    </div>
  );
}

export function LegalOverlay({ kind, onClose }: { kind: LegalKind; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={LEGAL_TITLES[kind]}
        tabIndex={-1}
        autoFocus
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
        className="max-h-[85vh] w-[480px] overflow-y-auto rounded-xl border border-ink-line bg-paper shadow-2xl dark:border-paper-line dark:bg-ink"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex flex-none items-center justify-between border-b border-ink-line px-5 py-4 dark:border-paper-line">
          <h2 className="text-sm font-semibold text-ink dark:text-paper">
            {LEGAL_TITLES[kind]}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-sm font-medium text-ink-mute hover:text-ink dark:text-paper-mute dark:hover:text-paper"
          >
            Close
          </button>
        </header>
        <div className="px-5 py-4">
          <LegalBody kind={kind} />
        </div>
      </section>
    </div>
  );
}
