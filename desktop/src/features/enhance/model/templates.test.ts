import { describe, expect, it } from "vitest";
import type { Template } from "../../../shared/api/sidecar";
import { DEFAULT_TEMPLATE_ID, filterTemplates, templateNameById } from "./templates";

const TEMPLATES: Template[] = [
  {
    id: "auto",
    name: "Auto",
    description: "General-purpose meeting notes",
    instructions: "",
    isBuiltin: true,
  },
  {
    id: "sales-call",
    name: "Sales Call",
    description: "Prospect conversation",
    instructions: "",
    isBuiltin: true,
  },
  {
    id: "custom-abc12345",
    name: "My Weekly",
    description: "Team sync",
    instructions: "",
    isBuiltin: false,
  },
];

describe("templates", () => {
  it("keeps auto as the default", () => {
    expect(DEFAULT_TEMPLATE_ID).toBe("auto");
  });

  it("filters by name or description, case-insensitively", () => {
    expect(filterTemplates(TEMPLATES, "sales").map((template) => template.id)).toEqual([
      "sales-call",
    ]);
    expect(filterTemplates(TEMPLATES, "PROSPECT").map((template) => template.id)).toEqual([
      "sales-call",
    ]);
    expect(filterTemplates(TEMPLATES, "team")).toEqual([TEMPLATES[2]]);
    expect(filterTemplates(TEMPLATES, "")).toBe(TEMPLATES);
  });

  it("finds a template name by id", () => {
    expect(templateNameById(TEMPLATES, "custom-abc12345")).toBe("My Weekly");
    expect(templateNameById(TEMPLATES, null)).toBeNull();
    expect(templateNameById(TEMPLATES, "deleted")).toBeNull();
  });
});
