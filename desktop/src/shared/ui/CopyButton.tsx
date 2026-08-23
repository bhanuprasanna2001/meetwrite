import { useEffect, useRef, useState } from "react";
import { log } from "../lib/logger";

/**
 * A tiny copy control: copies `text` to the clipboard and flashes a check
 * for a moment. Shared by the bottom bar, chat messages, and transcript
 * lines.
 */

/** How long the check flashes after a copy. */
const FLASH_MS = 1200;

interface CopyButtonProps {
  /** The text to copy. */
  text: string;
  /** Extra classes for placement (padding, hover-reveal, …). */
  className?: string;
  /** Icon size: "md" for the bottom bar, "sm" for lines and bubbles. */
  size?: "sm" | "md";
}

export default function CopyButton({ text, className = "", size = "md" }: CopyButtonProps) {
  const [status, setStatus] = useState<"idle" | "copying" | "copied" | "failed">("idle");
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const resetLater = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setStatus("idle"), FLASH_MS);
  };

  const copy = async () => {
    if (status === "copying") return;
    setStatus("copying");
    try {
      await navigator.clipboard.writeText(text);
      setStatus("copied");
    } catch (error) {
      setStatus("failed");
      log.error("clipboard.copy_failed", undefined, error);
    }
    resetLater();
  };

  const copied = status === "copied";
  const icon = size === "md" ? "h-4 w-4" : "h-3 w-3";
  return (
    <button
      type="button"
      onClick={() => void copy()}
      disabled={status === "copying"}
      title={status === "failed" ? "Copy failed" : copied ? "Copied" : "Copy"}
      aria-label={status === "failed" ? "Copy failed" : copied ? "Copied" : "Copy"}
      className={`cursor-pointer text-ink-mute hover:text-ink dark:text-paper-mute dark:hover:text-paper ${
        copied ? "text-ink dark:text-paper" : ""
      } ${className}`}
    >
      {copied ? (
        <svg
          className={icon}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m4.5 12.5 5 5 10-11" />
        </svg>
      ) : (
        <svg
          className={icon}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M5 15V5a2 2 0 0 1 2-2h10" />
        </svg>
      )}
    </button>
  );
}
