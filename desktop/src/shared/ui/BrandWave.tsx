interface BrandWaveProps {
  className?: string;
}

const BARS = Array.from({ length: 40 }, (_, index) => index);

export default function BrandWave({ className = "" }: BrandWaveProps) {
  return (
    <span
      className={`flex h-10 w-56 items-end justify-center gap-[3px] ${className}`}
      aria-hidden="true"
    >
      {BARS.map((bar) => (
        <span
          key={bar}
          className="h-full w-px rounded-full bg-current"
          style={{
            animation: `eq-breathe ${1.4 + (bar % 7) * 0.22}s ease-in-out ${(bar % 11) * 0.18}s infinite`,
          }}
        />
      ))}
    </span>
  );
}
