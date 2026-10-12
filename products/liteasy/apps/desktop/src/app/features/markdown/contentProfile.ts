import { defaultSchema } from "hast-util-sanitize";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import type { Options } from "react-markdown";

export const RESEARCH_CONTENT_PROFILE = "liteasy-research-markdown/v1" as const;
/** Host-owned allowlist. Content cannot select plugins, CSS, handlers or protocols. */
const researchSchema = {
  ...defaultSchema,
  protocols: { ...defaultSchema.protocols, href: ["http", "https", "mailto", "liteasy", "liteasy-reference"], src: ["http", "https", "data", "blob", "liteasy", "liteasy-reference"] },
  attributes: {
    ...defaultSchema.attributes,
    "*": (defaultSchema.attributes?.["*"] ?? []).filter((attribute) =>
      !["className", "style"].includes(typeof attribute === "string" ? attribute : String(attribute[0]))),
    td: ["align", "colSpan", "rowSpan", "headers"],
    th: ["align", "colSpan", "rowSpan", "scope", "headers"],
    table: [],
  },
};
function boundTableAttributes() {
  return (tree: { children?: unknown[] }) => {
    let count = 0;
    const visit = (node: any, depth: number) => {
      if (++count > 30000 || depth > 64) { node.children = []; return; }
      if (node.type === "element" && ["th", "td"].includes(node.tagName)) {
        for (const key of ["colSpan", "rowSpan"]) {
          if (node.properties?.[key] !== undefined) {
            const value = Number(node.properties[key]);
            node.properties[key] = Number.isInteger(value) && value > 0 && value <= 100 ? value : 1;
          }
        }
      }
      node.children?.forEach((child: unknown) => visit(child, depth + 1));
    };
    visit(tree, 0);
  };
}
export const researchContentPlugins: NonNullable<Options["rehypePlugins"]> = [rehypeRaw, [rehypeSanitize, researchSchema], boundTableAttributes];
