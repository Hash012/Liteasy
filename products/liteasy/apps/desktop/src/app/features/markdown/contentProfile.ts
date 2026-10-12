import { defaultSchema } from "hast-util-sanitize";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import type { Options } from "react-markdown";

export const RESEARCH_CONTENT_PROFILE = "liteasy-research-markdown/v1" as const;
/** Host-owned allowlist. Content cannot select plugins, CSS, handlers or protocols. */
const researchSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "caption"],
  protocols: { ...defaultSchema.protocols, href: ["http", "https", "mailto", "liteasy", "liteasy-reference"], src: ["http", "https", "data", "blob", "attachment", "liteasy", "liteasy-reference"] },
  attributes: {
    ...defaultSchema.attributes,
    "*": (defaultSchema.attributes?.["*"] ?? []).filter((attribute) =>
      !["className", "style"].includes(typeof attribute === "string" ? attribute : String(attribute[0]))),
    span: [...(defaultSchema.attributes?.span ?? []), "dataLiteasyHost"],
    td: ["align", "colSpan", "rowSpan", "headers"],
    th: ["align", "colSpan", "rowSpan", "scope", "headers"],
    table: [],
  },
};
function boundTableAttributes() {
  return (tree: { children?: unknown[] }) => {
    let count = 0;
    let bounded = false;
    const ids = new Set<string>();
    const cells: any[] = [];
    const visit = (node: any, depth: number) => {
      if (++count > 30000 || depth > 64) { bounded = true; node.children = []; if (node.type === "text") node.value = ""; return; }
      if (typeof node.properties?.id === "string") ids.add(node.properties.id);
      if (node.type === "element" && ["th", "td"].includes(node.tagName)) {
        cells.push(node);
        for (const key of ["colSpan", "rowSpan"]) {
          if (node.properties?.[key] !== undefined) {
            const value = Number(node.properties[key]);
            node.properties[key] = Number.isInteger(value) && value > 0 && value <= 100 ? value : 1;
          }
        }
      }
      if (node.type === "element" && ["table", "thead", "tbody", "tfoot", "tr"].includes(node.tagName)) node.children = node.children?.filter((child: any) => child.type !== "text" || child.value.trim());
      node.children?.forEach((child: unknown) => visit(child, depth + 1));
    };
    visit(tree, 0);
    // Sanitization prefixes IDs to prevent DOM clobbering. Keep header references aligned.
    for (const cell of cells) {
      const headers = cell.properties?.headers;
      if (headers) cell.properties.headers = (Array.isArray(headers) ? headers : String(headers).split(/\s+/)).map((id: string) =>
        ids.has(id) ? id : ids.has(`user-content-${id}`) ? `user-content-${id}` : id);
    }
    if (bounded) tree.children?.push({ type: "element", tagName: "p", properties: { role: "status" }, children: [{ type: "text", value: "内容结构超过展示限制，部分预览已收起；完整来源未修改，请分段读取。" }] });
  };
}
// Preserve only properties created by trusted remark transforms, never attributes from raw HTML.
// The per-render random marker is removed again after sanitization.
function captureHostMarks() {
  return (tree: any, file: any) => {
    const marks = new Map<string, Record<string, unknown>>();
    const visit = (node: any) => {
      if (node.type === "element" && node.tagName === "span") {
        const properties = Object.fromEntries(Object.entries(node.properties ?? {}).filter(([key]) => /^data[-A-Z]/.test(key) || key === "className"));
        if (Object.keys(properties).length) { const key = crypto.randomUUID(); marks.set(key, properties); node.properties.dataLiteasyHost = key; }
      }
      node.children?.forEach(visit);
    };
    visit(tree); file.data.liteasyHostMarks = marks;
  };
}
function restoreHostMarks() {
  return (tree: any, file: any) => {
    const marks: Map<string, Record<string, unknown>> = file.data.liteasyHostMarks ?? new Map();
    const visit = (node: any) => {
      const key = node.properties?.dataLiteasyHost;
      if (key) { delete node.properties.dataLiteasyHost; Object.assign(node.properties, marks.get(key) ?? {}); }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}
export const researchContentPlugins: NonNullable<Options["rehypePlugins"]> = [captureHostMarks, rehypeRaw, [rehypeSanitize, researchSchema], restoreHostMarks, boundTableAttributes];
