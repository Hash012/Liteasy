import { ComponentTreeView } from "../visual-blocks/ComponentTreeView";
import { VisualPreviewContext } from "../visual-blocks/visualPreviewContext";
import { createBlockRegistry, type DerivedBlockDefinition } from "../visual-blocks/blockRegistry";
import type { BoardTemplate } from "../extensions/extensionPackage";

export function StudioCardPreview({ card, blocks = [] }: { card: BoardTemplate["cards"][number]; blocks?: DerivedBlockDefinition[] }) {
  try {
    const registry = createBlockRegistry(blocks);
    const type = registry.resolve(card.type.id, card.type.version);
    const data = registry.instantiate(card.type.id, card.type.version, card.data);
    return <VisualPreviewContext.Provider value={true}>{type.templates.map((tree, index) => <ComponentTreeView key={index} tree={tree} data={data} />)}</VisualPreviewContext.Provider>;
  } catch (error) {
    return <p role="status">无法预览 {card.type.id}@{card.type.version}：{error instanceof Error ? error.message : String(error)}。请检查类型文件和卡片属性；原始内容仍保留。</p>;
  }
}
