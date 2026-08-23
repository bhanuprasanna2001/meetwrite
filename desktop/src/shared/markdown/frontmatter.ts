/**
 * The one rule for a note's leading metadata block. A `---` … `---` block
 * at the very top of the note is frontmatter only when it contains at least
 * one `key: value` line; otherwise the note is plain markdown all the way
 * down (a horizontal rule at the top stays a horizontal rule). Values may
 * be quoted and may carry an inline `# comment`; comment lines and blank
 * lines are skipped. The preview renders the fields as a small card, so the
 * write mode stays pure source.
 */

export interface FrontmatterField {
  key: string;
  value: string;
}

export interface SplitNote {
  fields: FrontmatterField[];
  body: string;
}

const START_MARKER = /^\s*---\s*$/;
const END_MARKER = /^\s*---\s*$/;
/** An inline comment: whitespace, then `#`, then anything. */
const INLINE_COMMENT = /\s+#.*$/;

export function splitFrontmatter(markdown: string): SplitNote {
  const lines = markdown.split("\n");
  if (lines.length === 0 || !START_MARKER.test(lines[0])) {
    return { fields: [], body: markdown };
  }

  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (END_MARKER.test(lines[i])) {
      end = i;
      break;
    }
  }
  if (end === -1) return { fields: [], body: markdown };

  const fields: FrontmatterField[] = [];
  for (const line of lines.slice(1, end)) {
    const cleaned = line.trim();
    if (cleaned === "" || cleaned.startsWith("#")) continue;
    const colon = cleaned.indexOf(":");
    if (colon <= 0) continue;
    const key = cleaned.slice(0, colon).trim();
    let value = cleaned.slice(colon + 1).trim().replace(INLINE_COMMENT, "").trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (quoted) value = value.slice(1, -1);
    fields.push({ key, value });
  }

  // A leading --- block with no fields is a plain horizontal rule, not
  // metadata — the note renders whole.
  if (fields.length === 0) return { fields: [], body: markdown };

  return { fields, body: lines.slice(end + 1).join("\n") };
}
