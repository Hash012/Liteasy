import { useEffect, useState } from "react";
import type { ObjectEnvelope } from "../objects/object.types";
import { refOf, objectText } from "../objects/object.types";
import type { ObjectRepository } from "../objects/objectRepository";
import type { StructuredBlock } from "../objects/visualBlock.types";
import type { createBlockRegistry } from "./blockRegistry";
import { ComponentTreeView } from "./ComponentTreeView";
import { RichTextBlock } from "./VisualBlockBase";

export function DerivedBlockContent({ object, repository, registry, openPath }: { object: ObjectEnvelope; repository: ObjectRepository; registry: ReturnType<typeof createBlockRegistry>; openPath(path: string): Promise<void> }) {
  const [block, setBlock] = useState<StructuredBlock>();
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true; setBlock(undefined); setError("");
    void repository.getStructuredBlock(refOf(object)).then((value) => { if (alive) setBlock(value); }).catch((e) => { if (alive) setError(String(e)); });
    return () => { alive = false; };
  }, [object.objectId, object.revision, repository]);
  if (!block) return <><RichTextBlock text={objectText(object)} onOpenPath={openPath} />{error ? <p role="status">类型数据暂不可用，已保留可读内容。</p> : null}</>;
  try {
    const type = registry.resolve(block.type.id, block.type.version);
    const data = registry.instantiate(block.type.id, block.type.version, block.data);
    return <div className="derived-block-content" data-block-type={block.type.id}>{type.templates.map((tree, index) => <ComponentTreeView key={index} tree={tree} data={data} openPath={openPath} />)}</div>;
  } catch {
    return <><p role="status">此组件版本未启用，显示已保存的内容。</p><RichTextBlock text={objectText(object)} onOpenPath={openPath} /></>;
  }
}
