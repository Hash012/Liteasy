import { defaultSchema } from "hast-util-sanitize";
import { type ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { MineruFigure } from "./import.types";
import { resolveMineruImageSource } from "./mineruImageSources";
import "katex/dist/katex.min.css";

type MineruMarkdownProps = {
  content: string;
  figures?: readonly MineruFigure[];
};

const mineruSanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    img: [...(defaultSchema.attributes?.img ?? []), ["loading"], ["title"], ["alt"]],
    table: [...(defaultSchema.attributes?.table ?? []), ["className"]],
    td: [...(defaultSchema.attributes?.td ?? []), ["colSpan"], ["rowSpan"]],
    th: [...(defaultSchema.attributes?.th ?? []), ["colSpan"], ["rowSpan"]]
  },
  protocols: {
    ...defaultSchema.protocols,
    src: [...(defaultSchema.protocols?.src ?? []), "data"]
  }
};

function safeHref(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value, window.location.href);
    if (["http:", "https:", "mailto:"].includes(url.protocol)) return value;
    // MinerU commonly emits a relative path next to its Markdown export.
    if (!/^[a-z][a-z0-9+.-]*:/i.test(value) && !value.startsWith("//")) return value;
  } catch {
    if (!/^[a-z][a-z0-9+.-]*:/i.test(value) && !value.startsWith("//")) return value;
  }
  return undefined;
}

function MarkdownImage({
  alt,
  figures,
  src,
  ...props
}: ComponentPropsWithoutRef<"img"> & { figures: readonly MineruFigure[] }) {
  const safeSrc = resolveMineruImageSource(src, figures);
  if (!safeSrc) return <span className="mineru-markdown__blocked-image">[无法安全加载图片：{alt || "未命名图片"}]</span>;
  return <img {...props} alt={alt ?? ""} className="mineru-markdown__image" loading="lazy" src={safeSrc} />;
}

/**
 * MinerU returns CommonMark/GFM plus selected HTML (notably tables).  This pipeline
 * keeps the source expressive while sanitizing every HTML node before it reaches DOM.
 */
export function MineruMarkdown({ content, figures = [] }: MineruMarkdownProps) {
  return (
    <div className="mineru-markdown">
    <ReactMarkdown
      components={{
        a: ({ href, children, ...props }) => {
          const safe = safeHref(href);
          return safe
            ? <a {...props} href={safe} rel="noreferrer" target="_blank">{children}</a>
            : <span>{children}</span>;
        },
        img: (props) => <MarkdownImage {...props} figures={figures} />,
        table: ({ children, ...props }) => <div className="mineru-markdown__table-scroll"><table {...props}>{children}</table></div>
      }}
      rehypePlugins={[rehypeRaw, [rehypeSanitize, mineruSanitizeSchema], rehypeKatex]}
      remarkPlugins={[remarkGfm, remarkMath]}
      urlTransform={(url, key) => (
        key === "src" ? resolveMineruImageSource(url, figures) : safeHref(url)
      ) ?? ""}
    >
      {content}
    </ReactMarkdown>
    </div>
  );
}
