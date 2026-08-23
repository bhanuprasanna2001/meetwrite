import { useState } from "react";
import {
  createTemplate,
  deleteTemplate,
  resetTemplate,
  updateTemplate,
  type Template,
} from "../../../shared/api/sidecar";
import {
  Card,
  FIELD_INPUT,
  Field,
  SectionHeading,
} from "../ui/SettingsControls";

export type TemplateChange =
  | { type: "saved"; template: Template }
  | { type: "deleted"; id: string };

function TemplateEditor({
  template,
  templates,
  onBack,
  onChanged,
  onBusyChange,
}: {
  template: Template | null;
  templates: Template[];
  onBack: () => void;
  onChanged: (change: TemplateChange) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [name, setName] = useState(template?.name ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [instructions, setInstructions] = useState(template?.instructions ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameTaken = (candidate: string) =>
    templates.some(
      (item) =>
        item.id !== template?.id &&
        item.name.toLowerCase() === candidate.trim().toLowerCase(),
    );

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    if (nameTaken(trimmed)) {
      setError("A template with this name already exists");
      return;
    }
    setBusy(true);
    onBusyChange(true);
    setError(null);
    const input = {
      name: trimmed,
      description: description.trim(),
      instructions: instructions.trim(),
    };
    try {
      const saved =
        template === null
          ? await createTemplate(input)
          : await updateTemplate(template.id, input);
      onBusyChange(false);
      onChanged({ type: "saved", template: saved });
      onBack();
    } catch {
      setError("Couldn't save — is the sidecar running?");
      setBusy(false);
      onBusyChange(false);
    }
  };

  const reset = async () => {
    if (template === null || !template.isBuiltin || busy) return;
    setBusy(true);
    onBusyChange(true);
    setError(null);
    try {
      const resetTemplateValue = await resetTemplate(template.id);
      onBusyChange(false);
      onChanged({ type: "saved", template: resetTemplateValue });
      onBack();
    } catch {
      setError("Couldn't reset — is the sidecar running?");
      setBusy(false);
      onBusyChange(false);
    }
  };

  const remove = async () => {
    if (template === null || template.isBuiltin || busy) return;
    setBusy(true);
    onBusyChange(true);
    setError(null);
    try {
      await deleteTemplate(template.id);
      onBusyChange(false);
      onChanged({ type: "deleted", id: template.id });
      onBack();
    } catch {
      setError("Couldn't delete — is the sidecar running?");
      setBusy(false);
      onBusyChange(false);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <button
        type="button"
        onClick={onBack}
        disabled={busy}
        className="self-start text-sm font-medium text-ink-mute hover:text-ink dark:text-paper-mute dark:hover:text-paper"
      >
        ← Back
      </button>
      <SectionHeading
        title={template === null ? "New template" : template.name}
        hint="Instructions join the usual factual rules — they never replace them."
      />
      <Card>
        <div className="flex flex-col gap-5 px-4 py-4">
          <Field label="Name">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Weekly Sync"
              aria-label="Template name"
              className={FIELD_INPUT}
            />
          </Field>
          <Field label="Description">
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="One line shown in the picker"
              aria-label="Template description"
              className={FIELD_INPUT}
            />
          </Field>
          <Field label="Instructions">
            <textarea
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              placeholder="How should these notes be structured?"
              aria-label="Template instructions"
              rows={6}
              className={`${FIELD_INPUT} resize-y pt-2 leading-relaxed`}
            />
          </Field>
        </div>
      </Card>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy || name.trim() === ""}
          className="flex-none rounded-lg bg-ink px-4 py-1.5 text-sm font-medium text-paper disabled:cursor-not-allowed disabled:opacity-40 dark:bg-paper dark:text-ink"
        >
          {busy ? "Saving…" : template === null ? "Create template" : "Save changes"}
        </button>
        {template?.isBuiltin && (
          <button
            type="button"
            onClick={() => void reset()}
            disabled={busy}
            className="flex-none rounded-lg border border-ink-line px-3 py-1.5 text-sm text-ink-mute hover:text-ink dark:border-paper-line dark:text-paper-mute dark:hover:text-paper"
          >
            Reset to original
          </button>
        )}
        {template !== null && !template.isBuiltin && (
          <button
            type="button"
            onClick={() => void remove()}
            disabled={busy}
            className="flex-none rounded-lg border border-ink-line px-3 py-1.5 text-sm text-ink-mute hover:text-ink dark:border-paper-line dark:text-paper-mute dark:hover:text-paper"
          >
            Delete
          </button>
        )}
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

export default function TemplatesSection({
  templates,
  onChanged,
  onBusyChange,
}: {
  templates: Template[];
  onChanged: (change: TemplateChange) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [editing, setEditing] = useState<
    { kind: "new" } | { kind: "existing"; id: string } | null
  >(null);

  if (editing !== null) {
    const template =
      editing.kind === "new"
        ? null
        : (templates.find((item) => item.id === editing.id) ?? null);
    return (
      <TemplateEditor
        template={template}
        templates={templates}
        onBack={() => setEditing(null)}
        onChanged={onChanged}
        onBusyChange={onBusyChange}
      />
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <SectionHeading
        title="Templates"
        hint="How Enhance structures your notes — built-ins are editable and resettable, yours are deletable."
      />
      <Card>
        <button
          type="button"
          onClick={() => setEditing({ kind: "new" })}
          className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-ink-line/30 dark:hover:bg-paper-line/20"
        >
          <span className="text-sm font-medium text-ink-soft dark:text-paper">New Template</span>
          <span className="text-ink-mute dark:text-paper-mute">+</span>
        </button>
        {templates.map((template) => (
          <button
            key={template.id}
            type="button"
            onClick={() => setEditing({ kind: "existing", id: template.id })}
            className="flex w-full items-center justify-between gap-6 px-4 py-3 text-left hover:bg-ink-line/30 dark:hover:bg-paper-line/20"
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-ink-soft dark:text-paper">
                {template.name}
              </span>
              <span className="mt-0.5 block truncate text-xs text-ink-mute dark:text-paper-mute">
                {template.description || "No description"}
              </span>
            </span>
            <span className="flex-none text-[10px] font-medium uppercase tracking-wider text-ink-faint dark:text-paper-mute">
              {template.isBuiltin ? "Built-in" : "Custom"}
            </span>
          </button>
        ))}
      </Card>
    </div>
  );
}
