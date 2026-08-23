/**
 * Thin red bars breathing — the app's recording indicator, at any size:
 * the transcript tab pill, the compact transcript box, and the full one.
 * `eq-breathe` is the only motion besides the recording dot, so the bars
 * read as "live" without pulsing the rest of the UI.
 */

interface WaveProps {
  /** How many bars to draw. */
  bars?: number;
  /** Container sizing (height + gaps) for the context it lives in. */
  className?: string;
}

export default function Wave({ bars = 5, className = "h-4 gap-[3px]" }: WaveProps) {
  return (
    <span
      className={`flex flex-none items-end ${className}`}
      title="Recording"
      aria-label="Recording"
    >
      {Array.from({ length: bars }, (_, bar) => (
        <span
          key={bar}
          className="h-full w-[1.5px] rounded-full bg-red-500"
          style={{
            animation: `eq-breathe ${1.1 + bar * 0.15}s ease-in-out ${bar * 0.12}s infinite`,
          }}
        />
      ))}
    </span>
  );
}
