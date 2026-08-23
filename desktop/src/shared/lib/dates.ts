/**
 * JavaScript's Date parses at most three fractional-seconds digits, and
 * Safari (the Tauri webview) is strict about it — Python's microsecond ISO
 * strings like "…T16:11:35.593475+00:00" become Invalid Date there. This
 * trims the fraction before parsing, so every sidecar timestamp is safe.
 */
export function parseIsoDate(iso: string): Date {
  return new Date(iso.replace(/\.\d+/, (fraction) => fraction.slice(0, 4)));
}

/**
 * "Today" / "Yesterday" for very recent dates, otherwise "Aug 18" (plus the
 * year when it isn't the current one) — the day prefix of a palette row.
 * `now` is injectable for tests. Day math goes through local midnight
 * timestamps so DST shifts never make "yesterday" spill over.
 */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const date = parseIsoDate(iso);
  if (Number.isNaN(date.getTime())) return "";
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  const options: Intl.DateTimeFormatOptions =
    date.getFullYear() === now.getFullYear()
      ? { month: "short", day: "numeric" }
      : { month: "short", day: "numeric", year: "numeric" };
  return date.toLocaleDateString("en-US", options);
}

/**
 * Today's date as YYYY-MM-DD in the user's local timezone — the daily
 * note's one identity. UTC must never be involved: "today" means today
 * where the user is sitting, not in Greenwich. `now` is injectable for
 * tests.
 */
export function todayLocalIso(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * Milliseconds until the next "HH:MM" (local time): today's when it is
 * still ahead, tomorrow's once it passed — exactly at the time counts as
 * passed, so a firing scheduler always lands on the next day.
 */
export function millisUntilNextTime(time: string, now: Date = new Date()): number {
  const [hours, minutes] = time.split(":").map(Number);
  const next = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    hours,
    minutes,
    0,
    0,
  );
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime() - now.getTime();
}

/** Whether "HH:MM" has already passed today (local time). */
export function timePassedToday(time: string, now: Date = new Date()): boolean {
  const [hours, minutes] = time.split(":").map(Number);
  return now.getHours() * 60 + now.getMinutes() >= hours * 60 + minutes;
}
