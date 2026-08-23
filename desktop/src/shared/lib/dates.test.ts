import { describe, expect, it } from "vitest";
import {
  dayLabel,
  millisUntilNextTime,
  timePassedToday,
  todayLocalIso,
} from "./dates";

describe("dayLabel", () => {
  const now = new Date(2026, 7, 18, 15, 0, 0); // Aug 18 2026, local time.

  it("says Today for today", () => {
    expect(dayLabel(new Date(2026, 7, 18, 9, 30, 0).toISOString(), now)).toBe("Today");
  });

  it("says Yesterday for the day before", () => {
    expect(dayLabel(new Date(2026, 7, 17, 23, 0, 0).toISOString(), now)).toBe("Yesterday");
  });

  it("shows the date for older notes, with the year for other years", () => {
    expect(dayLabel(new Date(2026, 7, 2, 12, 0, 0).toISOString(), now)).toBe("Aug 2");
    expect(dayLabel(new Date(2025, 7, 2, 12, 0, 0).toISOString(), now)).toBe("Aug 2, 2025");
  });

  it("parses Python microsecond timestamps (Safari-safe)", () => {
    const iso = new Date(2026, 7, 18, 1, 0, 0).toISOString().replace(".000", ".123456");
    expect(dayLabel(iso, now)).toBe("Today");
  });

  it("is empty for an invalid date", () => {
    expect(dayLabel("nonsense", now)).toBe("");
  });
});

describe("todayLocalIso", () => {
  it("formats a local Date as zero-padded YYYY-MM-DD", () => {
    expect(todayLocalIso(new Date(2026, 7, 22))).toBe("2026-08-22");
    expect(todayLocalIso(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("uses local calendar fields, never UTC", () => {
    // Late evening local time can already be the next day in UTC — the
    // daily note's identity is the local day, always.
    const lateEvening = new Date(2026, 11, 31, 23, 30);
    expect(todayLocalIso(lateEvening)).toBe("2026-12-31");
  });
});

describe("millisUntilNextTime", () => {
  it("counts down to the same day when the time is still ahead", () => {
    const now = new Date(2026, 7, 23, 7, 30, 0);
    expect(millisUntilNextTime("08:00", now)).toBe(30 * 60_000);
  });

  it("rolls to tomorrow once the time has passed", () => {
    const now = new Date(2026, 7, 23, 9, 0, 0);
    expect(millisUntilNextTime("08:00", now)).toBe(23 * 3_600_000);
  });

  it("treats exactly-at-the-time as passed — a firing timer lands on the next day", () => {
    const now = new Date(2026, 7, 23, 8, 0, 0);
    expect(millisUntilNextTime("08:00", now)).toBe(24 * 3_600_000);
  });

  it("crosses midnight cleanly for a late time", () => {
    const now = new Date(2026, 7, 23, 22, 0, 0);
    // 23:00 is in one hour; the clock face doesn't care about dates.
    expect(millisUntilNextTime("23:00", now)).toBe(60 * 60_000);
  });
});

describe("timePassedToday", () => {
  it("is true once the minute arrives, false before it", () => {
    const before = new Date(2026, 7, 23, 7, 59, 0);
    expect(timePassedToday("08:00", before)).toBe(false);
    expect(timePassedToday("07:59", before)).toBe(true);
    expect(timePassedToday("08:00", new Date(2026, 7, 23, 8, 0, 0))).toBe(true);
  });
});
