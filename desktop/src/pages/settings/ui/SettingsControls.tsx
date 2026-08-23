import type { ReactNode } from "react";

export function SectionHeading({ title, hint }: { title: string; hint?: string }) {
  return (
    <div>
      <h2 className="text-base font-semibold text-ink dark:text-paper">{title}</h2>
      {hint && <p className="mt-1 text-sm text-ink-mute dark:text-paper-mute">{hint}</p>}
    </div>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y divide-ink-line rounded-xl border border-ink-line dark:divide-paper-line dark:border-paper-line">
      {children}
    </div>
  );
}

export function Row({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-6 px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink-soft dark:text-paper">{title}</p>
        {description && (
          <p className="mt-0.5 text-xs leading-relaxed text-ink-mute dark:text-paper-mute">
            {description}
          </p>
        )}
      </div>
      {children && <div className="flex flex-none items-center gap-2">{children}</div>}
    </div>
  );
}

export function Switch({
  on,
  onClick,
  label,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      className={`relative h-5 w-9 flex-none rounded-full ${
        on ? "bg-ink dark:bg-paper" : "bg-ink-line dark:bg-paper-line"
      }`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full border border-ink-line bg-paper dark:border-paper-line dark:bg-ink ${
          on ? "right-0.5" : "left-0.5"
        }`}
      />
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  disabled = false,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  ariaLabel: string;
  disabled?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      aria-disabled={disabled}
      className={`inline-flex flex-none rounded-lg border border-ink-line p-0.5 dark:border-paper-line ${
        disabled ? "opacity-50" : ""
      }`}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
          className={`rounded-md px-3 py-1 text-sm font-medium disabled:cursor-not-allowed ${
            value === option.value
              ? "bg-ink text-paper dark:bg-paper dark:text-ink"
              : "text-ink-mute hover:text-ink dark:text-paper-mute dark:hover:text-paper"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Select({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  ariaLabel: string;
}) {
  return (
    <div className="relative flex-none">
      <select
        value={value}
        aria-label={ariaLabel}
        onChange={(event) => onChange(event.target.value)}
        className="w-32 appearance-none rounded-lg border border-ink-line bg-transparent py-1.5 pl-3 pr-7 text-sm text-ink outline-none dark:border-paper-line dark:text-paper"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[9px] text-ink-mute dark:text-paper-mute">
        ▼
      </span>
    </div>
  );
}

export function OpenButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-none rounded-lg border border-ink-line px-3 py-1.5 text-xs font-medium text-ink-soft hover:text-ink dark:border-paper-line dark:text-paper-dim dark:hover:text-paper"
    >
      Open
    </button>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium uppercase tracking-wider text-ink-faint dark:text-paper-mute">
        {label}
      </span>
      {children}
    </label>
  );
}

export const FIELD_INPUT =
  "w-full border-b border-ink-line bg-transparent pb-1 text-sm text-ink outline-none " +
  "placeholder:text-ink-faint focus:border-ink dark:border-paper-line dark:text-paper " +
  "dark:focus:border-paper dark:placeholder:text-paper-mute";
