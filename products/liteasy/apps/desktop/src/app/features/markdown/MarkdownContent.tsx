import {
  Children, Component, createContext, isValidElement, lazy, memo, Suspense, useContext, useMemo,
  type ReactNode
} from "react";
import ReactMarkdown, { type Components, type Options, type UrlTransform } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { remarkPaperAnchorReferences, type PaperAnchorEntity } from "../paper-anchors/paperAnchorEntity";
import "katex/dist/katex.min.css";
import "./markdownContent.css";

const MermaidPreview = lazy(() => import("../mermaid/MermaidPreview").then((module) => ({ default: module.MermaidPreview })));
const StreamingContext = createContext(false);
const InlineContext = createContext(false);
const emptyPlugins: NonNullable<Options["remarkPlugins"]> = [];
const baseRemarkPlugins: NonNullable<Options["remarkPlugins"]> = [remarkGfm, remarkMath];
const mathPlugin: NonNullable<Options["rehypePlugins"]> = [[rehypeKatex, { maxExpand: 500, maxSize: 20, trust: false }]];
const emptyAnchors: readonly PaperAnchorEntity[] = [];

export type MarkdownContentProps = {
  className?: string;
  components?: Components;
  emptyLabel?: string;
  /** HTML is omitted by default. Sanitized mode requires an explicit sanitizer pipeline. */
  html?: "text" | "skip" | "sanitized";
  inline?: boolean;
  normalizeMath?: boolean;
  paperAnchors?: readonly PaperAnchorEntity[];
  rehypePluginsBeforeMath?: NonNullable<Options["rehypePlugins"]>;
  remarkPlugins?: NonNullable<Options["remarkPlugins"]>;
  streaming?: boolean;
  /** Domain adapters resolve local resources here; unresolved or unsafe URLs must return an empty string. */
  urlTransform?: UrlTransform;
  value: string;
};

export function safeMarkdownUrl(value: string | undefined, key = "href") {
  if (!value) return undefined;
  if (key === "href" && value.startsWith("#")) return value;
  try {
    const url = new URL(value);
    return ["https:", "http:", ...(key === "href" ? ["mailto:"] : [])].includes(url.protocol)
      ? value : undefined;
  } catch {
    return undefined;
  }
}

export const markdownUrlTransform: UrlTransform = (url, key) => safeMarkdownUrl(url, key) ?? "";

/** Resource adapters can admit document images/relative links, never executable URLs. */
function safeResolvedUrl(value: string | null | undefined, key: string) {
  if (!value || /[\u0000-\u0020\u007f]/.test(value)) return "";
  if (safeMarkdownUrl(value, key)) return value;
  if (key === "src" && (/^data:image\/(?:avif|gif|jpe?g|png|svg\+xml|webp);/i.test(value) || value.startsWith("blob:"))) return value;
  if (key === "href" && !/^[a-z][a-z0-9+.-]*:/i.test(value) && !value.startsWith("//") && !value.startsWith("\\")) return value;
  return "";
}

function normalizeMathOutsideCode(value: string) {
  return value.split(/(`+[^`\n]*`+)/g).map((part, index) => index % 2 === 1 ? part : part
    .replace(/\\\[([\s\S]*?)\\\]/g, (_match, content: string) => `\n$$\n${content.trim()}\n$$\n`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_match, content: string) => `$${content.trim()}$`)
  ).join("");
}

/** Preserve both complete and still-streaming fenced code, including longer fences. */
export function normalizeMarkdownMathDelimiters(value: string) {
  let fence: string | undefined;
  let prose = "";
  const parts: string[] = [];
  for (const line of value.split(/(?<=\n)/)) {
    const marker = line.replace(/\r?\n$/, "").match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      parts.push(line);
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = undefined;
    } else if (marker) {
      parts.push(normalizeMathOutsideCode(prose), line);
      prose = "";
      fence = marker[1];
    } else {
      prose += line;
    }
  }
  parts.push(normalizeMathOutsideCode(prose));
  return parts.join("");
}

class DiagramBoundary extends Component<{ children: ReactNode; code: string }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? <div className="markdown-content__code-block">
      <p role="status">图表暂时无法显示，已保留文本内容。</p>
      <pre><code>{this.props.code}</code></pre>
    </div> : this.props.children;
  }
}

const MarkdownDiagram = memo(function MarkdownDiagram({ code }: { code: string }) {
  return (
    <DiagramBoundary code={code} key={code}>
      <Suspense fallback={<p role="status">正在加载图表…</p>}>
        <MermaidPreview code={code} defaultView="diagram" title="Mermaid 图表" />
      </Suspense>
    </DiagramBoundary>
  );
});

function MarkdownPre({ children }: { children?: ReactNode }) {
  const streaming = useContext(StreamingContext);
  const inline = useContext(InlineContext);
  const child = Children.count(children) === 1 ? Children.only(children) : null;
  const code = isValidElement<{ children?: ReactNode; className?: string }>(child) ? child : null;
  const language = code?.props.className?.match(/(?:^|\s)language-([\w-]+)/)?.[1];
  const text = code ? String(code.props.children).replace(/\n$/, "") : "";
  const diagram = language === "mermaid";
  const oversized = diagram && (text.length > 20_000 || text.split("\n").length > 300);
  if (diagram && !streaming && !oversized && !inline) return <MarkdownDiagram code={text} />;
  if (inline) return <code>{text || children}</code>;
  return (
    <div className="markdown-content__code-block">
      {language ? <span className="markdown-content__code-language">{language}</span> : null}
      {diagram && streaming ? <p role="status">图表生成完成后显示预览。</p> : null}
      {oversized ? <p>图表内容较多，已保留文本视图。</p> : null}
      <pre>{children}</pre>
    </div>
  );
}

export const markdownComponents: Components = {
  a: ({ children, href, node: _node, ...props }) => href
    ? <a {...props} href={href} rel="noreferrer" target={href.startsWith("#") ? undefined : "_blank"}>{children}</a>
    : <span>{children}</span>,
  code: ({ children, node: _node, ...props }) => <code {...props}>{children}</code>,
  img: ({ alt, src, title }) => src ? (
    <span className="markdown-content__image">
      <img alt={alt?.trim() || "图片"} decoding="async" loading="lazy" referrerPolicy="no-referrer" src={src} title={title} />
      {title ? <span>{title}</span> : null}
    </span>
  ) : <span className="markdown-content__image-unavailable">图片地址不可访问</span>,
  pre: MarkdownPre
};

const inlineComponents: Components = {
  p: ({ children }) => <span>{children}</span>,
  a: ({ children }) => <span>{children}</span>
};

/** Shared rich-text foundation. Adapters add source links, attachment lookup and domain AST marks. */
export const MarkdownContent = memo(function MarkdownContent({
  className = "", components, emptyLabel, html = "skip", inline = false, normalizeMath = true,
  paperAnchors = emptyAnchors, rehypePluginsBeforeMath = emptyPlugins, remarkPlugins = emptyPlugins, streaming = false,
  urlTransform = markdownUrlTransform, value
}: MarkdownContentProps) {
  const markdown = useMemo(() => normalizeMath ? normalizeMarkdownMathDelimiters(value) : value, [normalizeMath, value]);
  const mergedComponents = useMemo(() => ({ ...markdownComponents, ...(inline ? inlineComponents : {}), ...components }), [components, inline]);
  const remark = useMemo(() => [...baseRemarkPlugins, ...remarkPlugins, remarkPaperAnchorReferences(paperAnchors)], [paperAnchors, remarkPlugins]);
  const rehype = useMemo(() => [...rehypePluginsBeforeMath, ...mathPlugin], [rehypePluginsBeforeMath]);
  const resolveUrl = useMemo<UrlTransform>(() => (url, key, node) => safeResolvedUrl(urlTransform(url, key, node), key), [urlTransform]);
  const Root = inline ? "span" : "div";
  if (!value.trim()) return emptyLabel ? <Root className={`markdown-content ${className} is-empty`}>{emptyLabel}</Root> : null;
  return (
    <Root className={`markdown-content${inline ? " markdown-content--inline" : ""} ${className}`.trim()}>
      <StreamingContext.Provider value={streaming}>
        <InlineContext.Provider value={inline}>
          <ReactMarkdown components={mergedComponents} rehypePlugins={rehype} remarkPlugins={remark} skipHtml={html === "skip"} urlTransform={resolveUrl}>
            {markdown}
          </ReactMarkdown>
        </InlineContext.Provider>
      </StreamingContext.Provider>
    </Root>
  );
});
