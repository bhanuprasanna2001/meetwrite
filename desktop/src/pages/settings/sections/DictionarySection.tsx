import { useState } from "react";
import {
  DICTIONARY_MAX_TERMS,
  TERM_MAX_LENGTH,
} from "../../../features/dictionary/model/limits";
import {
  addDictionaryTerms,
  deleteDictionaryTerm,
  type DictionaryTerm,
} from "../../../shared/api/sidecar";
import { Card, FIELD_INPUT, SectionHeading } from "../ui/SettingsControls";

export default function DictionarySection({
  terms,
  onTermsSaved,
  onTermRemoved,
  onBusyChange,
}: {
  terms: DictionaryTerm[];
  onTermsSaved: (terms: DictionaryTerm[]) => void;
  onTermRemoved: (id: number) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setBusyState = (value: boolean) => {
    setBusy(value);
    onBusyChange(value);
  };

  // One term per Enter: the input clears and stays focused, ready for the
  // next word. Duplicates are a server no-op, so they just clear too.
  const add = async () => {
    const term = draft.trim();
    setDraft("");
    if (busy || term === "") return;
    setBusyState(true);
    setError(null);
    try {
      onTermsSaved(await addDictionaryTerms([term]));
    } catch {
      setError("Couldn't save — is the sidecar running?");
    } finally {
      setBusyState(false);
    }
  };

  const remove = async (term: DictionaryTerm) => {
    if (busy) return;
    setBusyState(true);
    setError(null);
    try {
      await deleteDictionaryTerm(term.id);
      onTermRemoved(term.id);
    } catch {
      setError("Couldn't remove — is the sidecar running?");
    } finally {
      setBusyState(false);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <SectionHeading
        title="Dictionary"
        hint="Prefer these words while transcribing."
      />
      <Card>
        <div className="flex flex-col gap-2 px-4 py-4">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void add();
              }
            }}
            placeholder="Add a word, then press Enter"
            aria-label="New dictionary term"
            maxLength={TERM_MAX_LENGTH}
            className={FIELD_INPUT}
          />
          <span className="text-[11px] text-ink-faint dark:text-paper-mute">
            {terms.length} of {DICTIONARY_MAX_TERMS} terms — press Enter to add
          </span>
        </div>
      </Card>

      {terms.length === 0 ? (
        <div className="flex min-h-36 flex-col items-center justify-center rounded-xl border border-dashed border-ink-line px-6 text-center dark:border-paper-line">
          <p className="text-sm font-medium text-ink-soft dark:text-paper">
            Your dictionary is empty
          </p>
          <p className="mt-1 max-w-sm text-xs leading-relaxed text-ink-mute dark:text-paper-mute">
            Add team names, acronyms, and product terms so transcription
            spells them the way you do.
          </p>
        </div>
      ) : (
        <Card>
          {terms.map((term) => (
            <div
              key={term.id}
              className="flex items-center justify-between gap-4 px-4 py-2.5"
            >
              <span className="min-w-0 truncate text-sm text-ink-soft dark:text-paper">
                {term.value}
              </span>
              <button
                type="button"
                onClick={() => void remove(term)}
                disabled={busy}
                aria-label={`Remove ${term.value}`}
                className="flex-none p-1 text-sm text-ink-faint transition-colors hover:text-ink disabled:cursor-not-allowed dark:text-paper-mute dark:hover:text-paper"
              >
                ✕
              </button>
            </div>
          ))}
        </Card>
      )}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
