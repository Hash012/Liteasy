import type { Root, RootContent } from "mdast";
import { visit, SKIP } from "unist-util-visit";
import { referenceHref } from "./referenceText";
/** AST only: code spans, fenced code and existing Markdown links remain intact. */
export function remarkResourceReferences() {
  return (tree: Root) => visit(tree, (node, index, parent) => {
    if (["link", "linkReference", "code", "inlineCode"].includes(node.type)) return SKIP;
    if (node.type !== "text" || index === undefined || !parent) return;
    const children: RootContent[] = []; let offset = 0;
    for (const match of node.value.matchAll(/(!?)\[\[([^\]\n]+)\]\]/g)) {
      children.push({ type: "text", value: node.value.slice(offset, match.index) });
      const raw = match[2].trim(), label = raw.split("|").at(-1)!;
      children.push(match[1] ? { type: "image", url: referenceHref(raw), alt: label }
        : { type: "link", url: referenceHref(raw), children: [{ type: "text", value: label }] });
      offset = match.index! + match[0].length;
    }
    if (!children.length) return;
    children.push({ type: "text", value: node.value.slice(offset) });
    parent.children.splice(index, 1, ...children as typeof parent.children); return index + children.length;
  });
}
