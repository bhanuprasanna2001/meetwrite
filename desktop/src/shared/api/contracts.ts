/** Domain-shaped values returned by the sidecar client. */

export type TranscriptSource = "me" | "them";

export interface TranscriptLine {
  id: number;
  /** Canonical position in the meeting — the thread's only sort key. */
  sequence: number;
  source: TranscriptSource;
  text: string;
  createdAt: string;
}
