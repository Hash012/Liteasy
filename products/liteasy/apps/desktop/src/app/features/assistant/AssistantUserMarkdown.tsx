import { useMemo } from "react";
import type { Root, RootContent } from "mdast";
import { visit, SKIP } from "unist-util-visit";
import { AssistantMarkdown } from "./AssistantMarkdown";
import { inlineContextParts } from "./inlineContext";
import { compactContextLabel } from "./assistantPresentation";
import type { AssistantContextToken } from "./assistant.types";
import { displayPath } from "../resource-filesystem/displayPath";

/** Preserve Markdown structure; context marks are host-created AST nodes, never injected HTML. */
function remarkAssistantContext(tokens: AssistantContextToken[]) {
  return (tree: Root) => visit(tree, (node, index, parent) => {
    if (["link", "linkReference", "code", "inlineCode", "html"].includes(node.type)) return SKIP;
    if (node.type !== "text" || index === undefined || !parent) return;
    const parts = inlineContextParts(node.value, tokens);
    if (!parts.some((part) => part.token)) return;
    const children: RootContent[] = parts.map((part) => ({ type: "text", value: part.text,
      ...(part.token ? { data: { hName: "span", hProperties: { dataAssistantContext: part.token.id } } } : {}) }));
    parent.children.splice(index, 1, ...children as typeof parent.children);
    return index + children.length;
  });
}

export function AssistantUserMarkdown({ value, tokens }: { value: string; tokens: AssistantContextToken[] }) {
  const plugins = useMemo(() => [[remarkAssistantContext, tokens]] as NonNullable<import("../markdown/MarkdownContent").MarkdownContentProps["remarkPlugins"]>, [tokens]);
  const components = useMemo<NonNullable<import("../markdown/MarkdownContent").MarkdownContentProps["components"]>>(() => ({
    span: ({ node, children, ...props }) => {
      const token = tokens.find((item) => item.id === node?.properties?.dataAssistantContext);
      if (!token) return <span {...props}>{children}</span>;
      const detail = token.detail && displayPath(token.detail);
      return <strong className="assistant-inline-context" aria-label={token.label} title={detail && detail !== token.label ? `${token.label}\n${detail}` : token.label}>{compactContextLabel(String(children))}</strong>;
    }
  }), [tokens]);
  return <AssistantMarkdown value={value} components={components} remarkPlugins={plugins} />;
}
