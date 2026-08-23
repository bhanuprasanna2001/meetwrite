import { useEffect, useState } from "react";
import { formatTime } from "../lib/time";
import Wave from "./Wave";

/**
 * The one live-recording indicator: a small breathing waveform plus the
 * elapsed time. Mounted only while capture is active, so the timer starts
 * with it.
 */

interface RecordingBadgeProps {
  startedAt: number;
  className?: string;
}

export default function RecordingBadge({ startedAt, className = "" }: RecordingBadgeProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const elapsed = formatTime((now - startedAt) / 1000);
  return (
    <span
      className={`flex flex-none items-center gap-1.5 ${className}`}
      title={`Recording — ${elapsed}`}
      aria-label={`Recording, ${elapsed} elapsed`}
    >
      <Wave bars={5} className="h-3 gap-[2px]" />
      <span className="text-[10px] font-medium tabular-nums text-ink-faint dark:text-paper-mute">
        {elapsed}
      </span>
    </span>
  );
}
