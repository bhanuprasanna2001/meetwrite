import type { NoteFont } from "../api/sidecar";

/**
 * The note typography controls shared by the bottom bar and the settings
 * page: fonts cycle Lato → Arial → Serif → Mono,
 * and the size is a fidget control — +2px per click, 16 → 32 → 16.
 */

export const FONTS: NoteFont[] = ["lato", "arial", "serif", "mono"];

export const FONT_LABELS: Record<NoteFont, string> = {
  lato: "Lato",
  arial: "Arial",
  serif: "Serif",
  mono: "Mono",
};

export const MIN_SIZE = 16;
export const MAX_SIZE = 32;

export const nextSize = (size: number) => (size >= MAX_SIZE ? MIN_SIZE : size + 2);

export const nextFont = (font: NoteFont) => FONTS[(FONTS.indexOf(font) + 1) % FONTS.length];
