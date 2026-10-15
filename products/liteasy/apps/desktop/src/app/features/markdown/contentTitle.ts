import { researchMarkdownParser } from "./researchParser";
import { safeUtf16Range } from "./contentStructure";

const parser = researchMarkdownParser();
type TextNode = { type: string; value?: string; alt?: string; children?: TextNode[]; position?: { start: { offset?: number }; end: { offset?: number } } };
/** Derived titles only: user-provided titles remain literal and are never rewritten. */
export function deriveContentTitle(text: string, fallback = "笔记") {
  const tree = parser.parse(text.slice(0, 80000));
  const block = tree.children.find(node => !["definition", "footnoteDefinition", "yaml", "thematicBreak"].includes(node.type)) as TextNode | undefined;
  const plain = (node: TextNode): string => node.type === "html" ? "" : node.type === "image" || node.type === "imageReference" ? node.alt ?? "" :
    node.children ? node.children.map(plain).join(["list", "table", "tableRow"].includes(node.type) ? " " : "") : node.value ?? "";
  const value = block ? plain(block).replace(/\s+/g, " ").trim() : "";
  const range = safeUtf16Range(value, 0, 100);
  return { title: value.slice(range.start, range.end) || fallback, titleOrigin: "derived-body" as const,
    ...(block?.position?.start.offset !== undefined && block.position.end.offset !== undefined ? { repeatedBodyBlock: { start: block.position.start.offset, end: block.position.end.offset } } : {}) };
}
