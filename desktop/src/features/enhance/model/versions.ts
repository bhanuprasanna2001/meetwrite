import type { EnhancedVersion, Template } from "../../../shared/api/sidecar";
import { templateNameById } from "./templates";

/** Versions newest first — creation order is id order. */
export function newestFirst(versions: EnhancedVersion[]): EnhancedVersion[] {
  return [...versions].sort((a, b) => b.id - a.id);
}

/** The picker label for a version: its AI title, falling back to "Enhanced". */
export function versionLabel(version: EnhancedVersion): string {
  return version.title?.trim() || "Enhanced";
}

/** The template that produced a version, by name — the picker's subtitle. */
export function versionTemplateName(
  templates: Template[],
  version: EnhancedVersion,
): string | null {
  return templateNameById(templates, version.templateId);
}
