import { CompositePrimitive } from "./CompositePrimitives";
import { AssetImage } from "./AssetImage";
import { Button } from "@fluentui/react-components";
import { RichTextBlock } from "./VisualBlockBase";
import type { ComponentTree } from "./blockRegistry";
import type { JsonObject, JsonValue } from "../extensions/extensionSchema";

export function ComponentTreeView({ tree, data, openPath }: { tree: ComponentTree; data: JsonObject; openPath?(path: string): Promise<void> }) {
  const read = (key: string): JsonValue | undefined => {
    const value = tree.props?.[key];
    if (value && typeof value === "object" && !Array.isArray(value) && typeof value.$field === "string") {
      let current: JsonValue = data;
      if (value.$field.split(".").length > 12) return undefined;
      for (const key of value.$field.split(".")) {
        if (["__proto__", "constructor", "prototype"].includes(key) || !current || typeof current !== "object" || Array.isArray(current)) return undefined;
        current = current[key];
      }
      return current;
    }
    return value;
  };
  const text = (key: string) => { const value = read(key); return typeof value === "string" ? value : value == null ? "" : JSON.stringify(value); };
  const children = tree.children?.map((child, index) => <ComponentTreeView key={index} tree={child} data={data} openPath={openPath} />);
  if (tree.component === "MarkdownView") return <RichTextBlock text={text("text")} onOpenPath={openPath} />;
  if (tree.component === "Divider") return <hr />;
  if (tree.component === "Image") {
    return <AssetImage source={text("source")} alt={text("alt") || "图片"} />;
  }
  if (tree.component === "ResourceCard") {
    const path = text("path");
    return path ? <div className="visual-resource-card"><Button appearance="subtle" disabled={!openPath || !path.startsWith("liteasy://")} onClick={() => void openPath?.(path)}>{text("title") || "打开引用资源"}</Button><RichTextBlock text={path.startsWith("liteasy://") ? `[查看内容](${path})` : path} onOpenPath={openPath} /></div> : null;
  }
  if (tree.component === "Table") {
    const rows = read("rows");
    return <div className="visual-block-table"><table><tbody>{Array.isArray(rows) && rows.slice(0, 200).map((row, index) => <tr key={index}>{Array.isArray(row) && row.slice(0, 12).map((cell, column) => <td key={column}><RichTextBlock text={typeof cell === "string" ? cell : JSON.stringify(cell)} onOpenPath={openPath} /></td>)}</tr>)}</tbody></table></div>;
  }
  if (!["Stack", "Grid", "Card"].includes(tree.component)) return <CompositePrimitive tree={tree} read={read} openPath={openPath} children={children} />;
  const gap = Math.max(0, Math.min(32, Number(read("gap")) || 8));
  return <section className={`visual-component visual-component-${tree.component.toLowerCase()}`} style={{ display: "grid", gap, ...(tree.component === "Grid" ? { gridTemplateColumns: `repeat(${Math.max(1, Math.min(6, Number(read("columns")) || 2))}, minmax(0, 1fr))` } : {}) }}>
    {tree.component === "Card" && text("title") ? <RichTextBlock text={`### ${text("title")}`} /> : null}{children}
  </section>;
}
