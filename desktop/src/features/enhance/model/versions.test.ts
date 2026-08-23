import { describe, expect, it } from "vitest";
import type { EnhancedVersion, Template } from "../../../shared/api/sidecar";
import { newestFirst, versionLabel, versionTemplateName } from "./versions";

const version = (id: number, title: string | null, templateId: string | null): EnhancedVersion => ({
  id,
  entryId: 1,
  title,
  content: "notes",
  templateId,
  createdAt: "2026-08-19T10:00:00+00:00",
});

const TEMPLATES: Template[] = [
  {
    id: "daily-standup",
    name: "Daily Standup",
    description: "",
    instructions: "",
    isBuiltin: true,
  },
];

describe("versions", () => {
  it("orders versions newest first", () => {
    const ordered = newestFirst([
      version(1, "First", null),
      version(3, "Third", null),
      version(2, "Second", null),
    ]);
    expect(ordered.map((item) => item.id)).toEqual([3, 2, 1]);
  });

  it("labels an untitled version Enhanced", () => {
    expect(versionLabel(version(1, null, null))).toBe("Enhanced");
    expect(versionLabel(version(2, "  Launch plan  ", null))).toBe("Launch plan");
  });

  it("names the template that produced a version", () => {
    expect(versionTemplateName(TEMPLATES, version(1, null, "daily-standup"))).toBe(
      "Daily Standup",
    );
    expect(versionTemplateName(TEMPLATES, version(2, null, null))).toBeNull();
    expect(versionTemplateName(TEMPLATES, version(3, null, "deleted"))).toBeNull();
  });
});
