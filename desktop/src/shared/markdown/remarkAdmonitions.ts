import type { Root } from "mdast";

/**
 * GitHub-style admonitions (`> [!NOTE]`, `> [!WARNING]`, …) as a small
 * remark plugin. A blockquote whose first paragraph starts with a marker
 * line becomes a `div.admonition.admonition-<type>`; the marker is removed
 * and whatever follows it stays inside. Anything else — extra text on the
 * marker's own line, an unknown type, no marker — stays an ordinary
 * blockquote. The label row comes from CSS.
 */

export const ADMONITION_TYPES = [
  "note",
  "tip",
  "important",
  "warning",
  "caution",
] as const;
export type AdmonitionType = (typeof ADMONITION_TYPES)[number];

const MARKER = /^\[!([A-Za-z]+)\]$/;

/** The small slice of mdast this plugin reads and rewrites. */
interface MdastNode {
  type: string;
  value?: string;
  children?: MdastNode[];
  data?: object;
}

/** The visible text of one paragraph (text and inline-code content). */
function paragraphText(paragraph: MdastNode): string {
  return (paragraph.children ?? []).map((child) => child.value ?? "").join("");
}

/** The paragraph's first line and whatever lazy continuation follows it. */
function firstLineAndRest(paragraph: MdastNode): {
  firstLine: string;
  rest: string;
} {
  const text = paragraphText(paragraph).trim();
  const newline = text.indexOf("\n");
  if (newline === -1) return { firstLine: text, rest: "" };
  return {
    firstLine: text.slice(0, newline).trim(),
    rest: text.slice(newline + 1).trim(),
  };
}

function isAdmonitionType(value: string): value is AdmonitionType {
  return (ADMONITION_TYPES as readonly string[]).includes(value);
}

function markAdmonitions(node: MdastNode): void {
  for (const child of node.children ?? []) {
    if (child.type === "blockquote") {
      const first = child.children?.[0];
      if (first?.type === "paragraph") {
        const { firstLine, rest } = firstLineAndRest(first);
        const match = MARKER.exec(firstLine);
        const type = match?.[1]?.toLowerCase();
        if (type !== undefined && isAdmonitionType(type)) {
          child.data = {
            hName: "div",
            hProperties: { className: ["admonition", `admonition-${type}`] },
          };
          if (rest === "") {
            child.children = (child.children ?? []).slice(1);
          } else {
            // A lazy continuation (`> [!NOTE]` directly above `> text`) is
            // one paragraph in CommonMark — keep the text, drop the marker.
            first.children = [{ type: "text", value: rest }];
          }
        }
      }
    }
    markAdmonitions(child);
  }
}

/** A remark plugin: run it in `remarkPlugins`, before react-markdown renders. */
export default function remarkAdmonitions() {
  return (tree: Root): void => {
    markAdmonitions(tree);
  };
}
