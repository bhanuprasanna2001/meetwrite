import { describe, expect, it } from "vitest";
import { mergePendingSave, restoreFailedSave, type PendingSave } from "./autosave";

describe("mergePendingSave", () => {
  it("keeps the latest human note and every edited enhanced version", () => {
    const first = mergePendingSave(null, { entryId: 4, noteMd: "latest note" });
    const second = mergePendingSave(first, {
      entryId: 4,
      version: { id: 10, content: "version ten" },
    });
    const third = mergePendingSave(second, {
      entryId: 4,
      version: { id: 11, content: "version eleven" },
    });

    expect(third).toEqual({
      entryId: 4,
      noteMd: "latest note",
      versions: { 10: "version ten", 11: "version eleven" },
    });
  });

  it("rejects cross-entry merging so navigation must flush first", () => {
    const pending = mergePendingSave(null, { entryId: 4, noteMd: "note" });
    expect(() => mergePendingSave(pending, { entryId: 5, noteMd: "other" })).toThrow(
      "flushed before changing entries",
    );
  });
});

describe("restoreFailedSave", () => {
  it("restores failed fields without overwriting newer keystrokes", () => {
    const failed: PendingSave = {
      entryId: 4,
      noteMd: "old note",
      versions: { 10: "old ten", 11: "eleven" },
    };
    const newer: PendingSave = {
      entryId: 4,
      noteMd: "new note",
      versions: { 10: "new ten" },
    };

    expect(restoreFailedSave(failed, newer)).toEqual({
      entryId: 4,
      noteMd: "new note",
      versions: { 10: "new ten", 11: "eleven" },
    });
  });
});
