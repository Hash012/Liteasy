import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import type { PdfTextBoxImages } from "./pdfTextBoxImages";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";

type PdfAnnotationMarkdownProps = {
  className?: string;
  emptyLabel?: string;
  value: string;
  images?: PdfTextBoxImages;
};

/**
 * Annotation comments are persisted as Markdown, but are always presented as formatted content.
 * Raw HTML is deliberately not enabled: comments may later be synchronized from another user.
 */
export function PdfAnnotationMarkdown({
  className = "pdf-annotation-markdown",
  emptyLabel,
  value,
  images
}: PdfAnnotationMarkdownProps) {
  const markdown = value.trim();
  if (!markdown) {
    return emptyLabel ? <p className={`${className} is-empty`}>{emptyLabel}</p> : null;
  }

  return (
    <div className={className}>
      <ReactMarkdown
        urlTransform={(url, key) => key === "src" && url.startsWith("attachment:")
          ? images?.[url.slice("attachment:".length)] ?? ""
          : defaultUrlTransform(url)}
        components={{
          a: ({ children, ...props }) => (
            <a {...props} rel="noreferrer" target="_blank">{children}</a>
          )
        }}
        rehypePlugins={[rehypeKatex]}
        remarkPlugins={[remarkGfm, remarkMath]}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
