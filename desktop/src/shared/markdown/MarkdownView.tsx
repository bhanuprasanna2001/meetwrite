import Markdown, { defaultUrlTransform } from "react-markdown";
import type { Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
// The one renderer's KaTeX stylesheet; rehype-katex does not import it.
import "katex/dist/katex.min.css";
import { entryImageUrl, type OutlineImage } from "../api/sidecar";
import { openExternal } from "../platform/externalLinks";
import { splitFrontmatter } from "./frontmatter";
import remarkAdmonitions from "./remarkAdmonitions";

/**
 * The one Markdown renderer: note previews, assistant answers, and enhanced
 * notes share it, so GFM, math, code highlighting, admonitions, and
 * frontmatter can never drift apart. It is safe by default — raw HTML never
 * renders, and every URL passes the GitHub-style protocol filter except the
 * app's own image refs. Links open in the system browser, never in the
 * webview.
 */

/** `![title](entry-image:3)` — a note-owned picture, not a web URL. */
const ENTRY_IMAGE_REF = /^entry-image:(\d+)$/;

interface MarkdownViewProps {
  markdown: string;
  /** The note owning the content — resolves entry-image refs to its files. */
  entryId?: number;
  /** The note's images. A ref to a missing id renders nothing (the note is
   * the source of truth, and deleting a picture must not leave a hole). */
  images?: OutlineImage[];
  /** Clicking an embedded picture (the image viewer's one entry point). */
  onImageClick?: (image: OutlineImage) => void;
}

/** The standard safe schemes, plus the app's own image reference scheme. */
function urlTransform(url: string): string {
  if (url.startsWith("entry-image:")) return url;
  return defaultUrlTransform(url);
}

const WEB_URL = /^https?:\/\//;

/** The frontmatter card's row: the key as a label, the value as text or a
 * link. Empty values stay in the source but never clutter the preview. */
function MetaBlock({
  fields,
}: {
  fields: { key: string; value: string }[];
}) {
  const visible = fields.filter((field) => field.value !== "");
  if (visible.length === 0) return null;
  return (
    <dl className="prose-meta">
      {visible.map((field) => (
        <div key={field.key} className="prose-meta-row">
          <dt>{field.key}</dt>
          <dd>
            {WEB_URL.test(field.value) ? (
              <a
                href={field.value}
                onClick={(event) => {
                  event.preventDefault();
                  openExternal(field.value);
                }}
              >
                {field.value}
              </a>
            ) : (
              field.value
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default function MarkdownView({
  markdown,
  entryId,
  images,
  onImageClick,
}: MarkdownViewProps) {
  const { fields, body } = splitFrontmatter(markdown);
  const components: Components = {
    a(props) {
      const href = props.href ?? "";
      return (
        <a
          href={href}
          title={props.title}
          onClick={(event) => {
            event.preventDefault();
            openExternal(href);
          }}
        >
          {props.children}
        </a>
      );
    },
    img(props) {
      const src = props.src;
      const match = src === undefined ? null : ENTRY_IMAGE_REF.exec(src);
      if (match === null) {
        // An ordinary http(s) image — already filtered by urlTransform.
        return <img className="note-img" src={src} alt={props.alt ?? ""} />;
      }
      if (entryId === undefined) return null;
      const imageId = Number(match[1]);
      const image = images?.find((item) => item.id === imageId);
      if (images !== undefined && image === undefined) return null;
      const title = image?.title ?? props.alt ?? "";
      return (
        <img
          className="note-img"
          src={entryImageUrl(entryId, imageId)}
          alt={title}
          title={title}
          onClick={
            onImageClick !== undefined
              ? () => onImageClick({ id: imageId, title })
              : undefined
          }
        />
      );
    },
  };

  return (
    <div className="prose-note">
      <MetaBlock fields={fields} />
      <Markdown
        remarkPlugins={[remarkGfm, remarkMath, remarkAdmonitions]}
        rehypePlugins={[
          rehypeHighlight,
          // Invalid TeX shows the error in red instead of breaking the
          // render — one defined outcome for every input.
          [rehypeKatex, { throwOnError: false, strict: false }],
        ]}
        urlTransform={urlTransform}
        components={components}
      >
        {body}
      </Markdown>
    </div>
  );
}
