import { describe, expect, it } from "vitest";
import {
  dropPartial,
  formatLineTime,
  formatMeetingDate,
  orderLines,
  transcriptTemplate,
  upsertPartial,
  type LivePartial,
  type TranscriptLine,
} from "./transcript";

const line = (
  id: number,
  source: "me" | "them",
  text: string,
  sequence: number,
  createdAt = "2026-08-18T10:30:00+00:00",
): TranscriptLine => ({
  id,
  sequence,
  source,
  text,
  createdAt,
});

const partial = (itemId: string, sequence: number, text: string): LivePartial => ({
  itemId,
  source: "me",
  sequence,
  text,
});

describe("orderLines", () => {
  it("sorts by sequence first, then id — never by timestamp", () => {
    const ordered = orderLines([
      line(3, "them", "later timestamp", 1, "2026-08-18T11:00:00+00:00"),
      line(1, "me", "first", 2),
      line(2, "them", "second", 1),
    ]);

    expect(ordered.map((l) => l.id)).toEqual([2, 3, 1]);
  });
});

describe("upsertPartial and dropPartial", () => {
  it("keeps overlapping turns separate, ordered by sequence", () => {
    let partials = upsertPartial([], partial("first", 2, "hel"));
    partials = upsertPartial(partials, partial("second", 1, "wor"));
    partials = upsertPartial(partials, partial("first", 2, "hello"));

    expect(partials.map((p) => p.itemId)).toEqual(["second", "first"]);
    expect(partials.map((p) => p.text)).toEqual(["wor", "hello"]);
  });

  it("dropping one turn leaves the other live", () => {
    const partials = [
      partial("first", 1, "hello"),
      partial("second", 2, "world"),
    ];
    expect(dropPartial(partials, "first").map((p) => p.itemId)).toEqual(["second"]);
  });
});

describe("formatLineTime", () => {
  it("renders hh:mm", () => {
    expect(formatLineTime("2026-08-18T10:05:00+00:00")).toMatch(/^\d{1,2}:\d{2}$/);
  });

  it("parses Python microsecond timestamps (Safari-safe)", () => {
    // Safari rejects more than 3 fractional digits — these must never be
    // "Invalid Date".
    expect(formatLineTime("2026-08-18T16:11:35.593475+00:00")).toMatch(/^\d{1,2}:\d{2}$/);
    expect(formatLineTime("2026-08-18T16:11:35.593475+00:00")).not.toContain("Invalid");
  });
});

describe("formatMeetingDate", () => {
  it("renders Aug 13 independent of locale", () => {
    const local = new Date(2026, 7, 13, 12, 0, 0); // Round-trips to the same instant.
    expect(formatMeetingDate(local.toISOString())).toBe("Aug 13");
  });

  it("renders Aug 13 from a microsecond timestamp", () => {
    const local = new Date(2026, 7, 13, 12, 0, 0);
    expect(formatMeetingDate(local.toISOString().replace(".000", ".123456"))).toBe("Aug 13");
  });

  it("is empty for an invalid date", () => {
    expect(formatMeetingDate("nonsense")).toBe("");
  });
});

describe("transcriptTemplate", () => {
  it("renders the full meeting document from the flat thread", () => {
    const template = transcriptTemplate(
      "Meeting with myself",
      new Date(2026, 7, 13, 12, 0, 0).toISOString(),
      "Bhanu prasanna",
      [
        line(1, "me", "So hi.", 1),
        line(2, "them", "Use that fat to cook your rice.", 2),
        line(3, "me", "It's me.", 3),
      ],
    );

    expect(template).toBe(
      [
        "---",
        "Meeting Title: Meeting with myself",
        "",
        "Date: Aug 13",
        "",
        "Meeting participants: Bhanu prasanna",
        "",
        "Transcript:",
        "",
        "Me: So hi. It's me.",
        "",
        "Them: Use that fat to cook your rice.",
        "",
        "---",
      ].join("\n"),
    );
  });

  it("fills title and participants fallbacks", () => {
    const template = transcriptTemplate(null, null, null, []);

    expect(template).toContain("Meeting Title: Untitled");
    expect(template).not.toContain("Meeting participants:");
    expect(template).toContain("Transcript:\n\n---");
  });
});
