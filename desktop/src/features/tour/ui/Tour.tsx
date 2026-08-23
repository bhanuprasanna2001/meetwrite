import { useState } from "react";
import { log } from "../../../shared/lib/logger";
import { TOUR_STEPS } from "../model/tour";

/**
 * The first-run tour: five short cards over the
 * note, once. The backdrop click, Esc, Skip, and Done all close it — App
 * marks it seen, so it never comes back.
 */

interface TourProps {
  onClose: () => void;
}

export default function Tour({ onClose }: TourProps) {
  const [index, setIndex] = useState(0);
  const step = TOUR_STEPS[index];
  const last = index === TOUR_STEPS.length - 1;

  const close = () => {
    log.info("tour.dismissed");
    onClose();
  };

  const next = () => {
    if (last) close();
    else setIndex(index + 1);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="How meetwrite works"
        tabIndex={-1}
        autoFocus
        className="w-[420px] rounded-xl border border-ink-line bg-paper shadow-2xl dark:border-paper-line dark:bg-ink"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="px-6 pb-2 pt-6">
          <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-ink-faint dark:text-paper-mute">
            {index + 1} / {TOUR_STEPS.length}
          </p>
          <h2 className="mt-3 text-lg font-semibold text-ink dark:text-paper">{step.title}</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-mute dark:text-paper-mute">
            {step.body}
          </p>
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-ink-line px-6 py-4 dark:border-paper-line">
          <button
            type="button"
            className="text-xs font-medium text-ink-mute underline underline-offset-2 hover:text-ink dark:text-paper-mute dark:hover:text-paper"
            onClick={close}
          >
            Skip
          </button>
          <div className="flex gap-1.5" aria-hidden="true">
            {TOUR_STEPS.map((item, i) => (
              <span
                key={item.id}
                className={`h-1.5 w-1.5 rounded-full ${
                  i === index ? "bg-ink dark:bg-paper" : "bg-ink-line dark:bg-paper-line"
                }`}
              />
            ))}
          </div>
          <button
            type="button"
            className="text-sm font-medium text-ink-soft hover:text-ink dark:text-paper-dim dark:hover:text-paper"
            onClick={next}
          >
            {last ? "Done" : "Next →"}
          </button>
        </div>
      </div>
    </div>
  );
}
