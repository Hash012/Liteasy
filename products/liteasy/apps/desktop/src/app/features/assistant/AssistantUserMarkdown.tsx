import { useContext, useMemo } from "react";
import type { Root, RootContent } from "mdast";
import { visit, SKIP } from "unist-util-visit";
import { AssistantMarkdown } from "./AssistantMarkdown";
import { inlineContextParts } from "./inlineContext";
import { compactContextLabel } from "./assistantPresentation";
import type { AssistantContextToken } from "./assistant.types";
import { ResourceLink } from "../resource-links/ResourceReferenceView";
import { ResourceReferencesContext } from "../resource-links/ResourceReferencesContext";
import { liteasyPath } from "../resource-filesystem/liteasyPath";
import { displayPath } from "../resource-filesystem/displayPath";

type MentionMarker = { marker: string; text: string; token: AssistantContextToken };

/** Mask only validated host-owned ranges before Markdown parses titles as syntax. The persisted source is untouched. */
function prepareMentions(value: string, tokens: AssistantContextToken[]) {
  let prefix = "liteasymention";
  while (value.includes(prefix)) prefix += "x";
  const markers: MentionMarker[] = [];
  const source = inlineContextParts(value, tokens).map(part => {
    if (!part.token) return part.text;
    const marker = `${prefix}${markers.length}end`;
    markers.push({ marker, text: part.text, token: part.token });
    return marker;
  }).join("");
  return { source, markers };
}

/** Restore title strings as literal host-created AST nodes; all ordinary prose keeps the shared Markdown renderer. */
function remarkAssistantContext(markers: MentionMarker[]) {
  const restore = (value: string) => markers.reduce((text, entry) => text.replaceAll(entry.marker, () => entry.text), value);
  const restoreSubtree = (node: { type?: string; value?: string; url?: string; title?: string | null; alt?: string | null; children?: unknown[] }) => {
    for (const key of ["value", "url", "title", "alt"] as const) if (typeof node[key] === "string") node[key] = restore(node[key]);
    node.children?.forEach(child => restoreSubtree(child as Parameters<typeof restoreSubtree>[0]));
  };
  return (tree: Root) => visit(tree, (node, index, parent) => {
    if (["link", "linkReference", "code", "inlineCode", "html", "image", "definition"].includes(node.type)) { restoreSubtree(node); return SKIP; }
    if (node.type !== "text") { if (!("children" in node)) restoreSubtree(node); return; }
    if (index === undefined || !parent) return;
    const matches = markers.flatMap(entry => {
      const at = node.value.indexOf(entry.marker);
      return at < 0 ? [] : [{ ...entry, at }];
    }).sort((left, right) => left.at - right.at);
    if (!matches.length) return;
    const children: RootContent[] = [];
    let cursor = 0;
    for (const entry of matches) {
      if (entry.at > cursor) children.push({ type: "text", value: node.value.slice(cursor, entry.at) });
      children.push({ type: "text", value: entry.text, data: { hName: "span", hProperties: { dataAssistantContext: entry.token.id } } });
      cursor = entry.at + entry.marker.length;
    }
    if (cursor < node.value.length) children.push({ type: "text", value: node.value.slice(cursor) });
    parent.children.splice(index, 1, ...children as typeof parent.children);
    return index + children.length;
  });
}

export function AssistantUserMarkdown({ value, tokens }: { value: string; tokens: AssistantContextToken[] }) {
  const references = useContext(ResourceReferencesContext);
  const prepared = useMemo(() => prepareMentions(value, tokens), [value, tokens]);
  const plugins = useMemo(() => [[remarkAssistantContext, prepared.markers]] as NonNullable<import("../markdown/MarkdownContent").MarkdownContentProps["remarkPlugins"]>, [prepared]);
  const components = useMemo<NonNullable<import("../markdown/MarkdownContent").MarkdownContentProps["components"]>>(() => ({
    span: ({ node, children, ...props }) => {
      const token = tokens.find((item) => item.id === node?.properties?.dataAssistantContext);
      if (!token) return <span {...props}>{children}</span>;
      const detail = token.detail && displayPath(token.detail);
      const ref = token.contextRefs?.find(value => "objectId" in value);
      const locator = (ref && "objectId" in ref && references ? liteasyPath(references.service.scope, { kind: "object", ref }) : token.resourcePath);
      const content = <strong className="assistant-inline-context" aria-label={token.label} title={detail && detail !== token.label ? `${token.label}\n${detail}` : token.label}>{compactContextLabel(String(children))}</strong>;
      return locator ? <ResourceLink locator={locator} ariaLabel={token.label} previewOnClick>{content}</ResourceLink> : content;
    }
  }), [tokens, references]);
  return <AssistantMarkdown value={prepared.source} components={components} remarkPlugins={plugins} />;
}
