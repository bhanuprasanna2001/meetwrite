import type { Template } from "../../../shared/api/sidecar";

/** The safe default: no meeting-specific instructions at all. */
export const DEFAULT_TEMPLATE_ID = "auto";

/** The templates matching a picker query (name or description). */
export function filterTemplates(templates: Template[], query: string): Template[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return templates;
  return templates.filter((template) =>
    `${template.name} ${template.description}`.toLowerCase().includes(needle),
  );
}

/** The template with this id, by name — the version picker's subtitle. */
export function templateNameById(
  templates: Template[],
  templateId: string | null,
): string | null {
  return templates.find((template) => template.id === templateId)?.name ?? null;
}
