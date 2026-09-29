import type { Root, RootContent } from "mdast";
import { SKIP, visit } from "unist-util-visit";
import { parseLiteasyPath } from "../resource-filesystem/liteasyPath";

/** Navigation still resolves in the active workspace; this is only URL syntax validation. */
export function safeLiteasyMarkdownUrl(value: string) {
  try {
    if (/[\s<>"'`]/.test(value)) return undefined;
    const url = new URL(value);
    parseLiteasyPath(value, url.searchParams.get("scope") ?? "local");
    return value;
  } catch {
    return undefined;
  }
}

export function assetMarkdownLink(title: string, path: string) {
  const label = title.replace(/([\\`*_[\]<>])/g, "\\$1").replace(/[\r\n]+/g, " ");
  return safeLiteasyMarkdownUrl(path) ? `[《${label}》](${path.replace(/\(/g, "%28").replace(/\)/g, "%29")})` : label;
}

const rawPathPattern = /liteasy:\/\/[^\s<>"'`)\]，。；）】]+/g;

/** Keep valid link destinations intact while removing opaque IDs from surrounding prose. */
export function transformOutsideLiteasyPaths(value: string, transform: (text: string) => string) {
  let offset = 0;
  let result = "";
  for (const match of value.matchAll(rawPathPattern)) {
    if (!safeLiteasyMarkdownUrl(match[0])) continue;
    result += transform(value.slice(offset, match.index)) + match[0];
    offset = match.index! + match[0].length;
  }
  return result + transform(value.slice(offset));
}

/** Older answers can contain bare paths. Linkify prose only, never code or existing links. */
export function remarkLiteasyLinks(titles?: ReadonlyMap<string, string>) {
  return () => (tree: Root) => {
    visit(tree, (node, index, parent) => {
      if (node.type === "link" || node.type === "linkReference") return SKIP;
      if (node.type !== "text" || index === undefined || !parent) return;
      const children: RootContent[] = [];
      let offset = 0;
      for (const match of node.value.matchAll(rawPathPattern)) {
        if (!safeLiteasyMarkdownUrl(match[0])) continue;
        children.push({ type: "text", value: node.value.slice(offset, match.index) });
        const title = titles?.get(match[0]);
        children.push({ type: "link", url: match[0], children: [{ type: "text", value: title ? `《${title}》` : "打开资产" }] });
        offset = match.index! + match[0].length;
      }
      if (!children.length) return;
      children.push({ type: "text", value: node.value.slice(offset) });
      parent.children.splice(index, 1, ...children as typeof parent.children);
      return index + children.length;
    });
  };
}
