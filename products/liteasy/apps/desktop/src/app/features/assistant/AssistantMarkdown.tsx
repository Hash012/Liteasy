import { Children, isValidElement, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { MermaidPreview } from "../mermaid/MermaidPreview";
import "katex/dist/katex.min.css";

type AssistantMarkdownProps = {
  className?: string;
  value: string;
};

function safeWebUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function codeText(children: ReactNode) {
  return String(children).replace(/\n$/, "");
}

function normalizeMathOutsideCode(value: string) {
  return value
    .split(/(`+[^`\n]*`+)/g)
    .map((part, index) => {
      if (index % 2 === 1) return part;
      return part
        .replace(/\\\[([\s\S]*?)\\\]/g, (_match, content: string) =>
          `\n$$\n${content.trim()}\n$$\n`)
        .replace(/\\\(([\s\S]*?)\\\)/g, (_match, content: string) =>
          `$${content.trim()}$`);
    })
    .join("");
}

/** Makes common LaTeX delimiters equivalent without changing fenced or inline code. */
export function normalizeAssistantMathDelimiters(value: string) {
  return value
    .split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/g)
    .map((part, index) => index % 2 === 1 ? part : normalizeMathOutsideCode(part))
    .join("");
}

const components: Components = {
  a: ({ children, href, ...props }) => {
    const safeHref = safeWebUrl(href);
    return safeHref ? (
      <a {...props} href={safeHref} rel="noreferrer" target="_blank">
        {children}
      </a>
    ) : <span>{children}</span>;
  },
  code: ({ children, className, ...props }) => (
    <code {...props} className={className}>{children}</code>
  ),
  img: ({ alt, src, title }) => {
    const safeSrc = safeWebUrl(src);
    if (!safeSrc) {
      return <span className="assistant-markdown-image-unavailable">图片地址不可访问</span>;
    }
    const accessibleAlt = alt?.trim() || "AI 回复中的网络图片";
    return (
      <span className="assistant-markdown-image">
        <img
          alt={accessibleAlt}
          decoding="async"
          loading="lazy"
          referrerPolicy="no-referrer"
          src={safeSrc}
          title={title}
        />
        {title ? <span>{title}</span> : null}
      </span>
    );
  },
  pre: ({ children }) => {
    const child = Children.count(children) === 1 ? Children.only(children) : null;
    if (isValidElement<{ children?: ReactNode; className?: string }>(child)) {
      const language = child.props.className?.match(/(?:^|\s)language-([\w-]+)/)?.[1];
      if (language === "mermaid") {
        return (
          <MermaidPreview
            code={codeText(child.props.children)}
            defaultView="diagram"
            title="Mermaid 图表"
          />
        );
      }
      return (
        <div className="assistant-markdown-code-block">
          {language ? <span className="assistant-markdown-code-language">{language}</span> : null}
          <pre>{children}</pre>
        </div>
      );
    }
    return <pre>{children}</pre>;
  }
};

/** Safe rich Markdown for model output: GFM, math, code, Mermaid and web images. */
export function AssistantMarkdown({ className = "assistant-markdown", value }: AssistantMarkdownProps) {
  if (!value.trim()) return null;
  return (
    <div className={className}>
      <ReactMarkdown
        components={components}
        rehypePlugins={[rehypeKatex]}
        remarkPlugins={[remarkGfm, remarkMath]}
        urlTransform={(url) => safeWebUrl(url) ?? ""}
      >
        {normalizeAssistantMathDelimiters(value)}
      </ReactMarkdown>
    </div>
  );
}
