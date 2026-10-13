import { paperLensPackage } from "../extensions/paperLensPackage";
import type { BoardTemplate } from "../extensions/extensionPackage";
export const studioTutorialPath = "studio/tutorial.json";
export type StudioTutorial = { version: 1; edited: boolean; previewed: boolean; saved: boolean };
export function readStudioTutorial(files: Record<string, string>): StudioTutorial | undefined {
  try {
    const value = JSON.parse(files[studioTutorialPath] ?? "null");
    return value?.version === 1 && [value.edited, value.previewed, value.saved].every(item => typeof item === "boolean") ? value : undefined;
  } catch { return undefined; }
}
export async function studioTutorialFiles() {
  const files = { ...(await paperLensPackage()).files };
  const manifest = JSON.parse(files["liteasy.extension.json"]);
  const original = manifest.id;
  manifest.id = `plugin.demo-${crypto.randomUUID().slice(0, 8)}`;
  manifest.name = "离线演示：四张研究卡片";
  manifest.version = "1.0.0";
  for (const path of Object.keys(files)) files[path] = files[path].split(original).join(manifest.id);
  files["liteasy.extension.json"] = JSON.stringify(manifest, null, 2);
  const cards: BoardTemplate["cards"] = [
    { id: "question", title: "研究问题", type: { id: "liteasy/RichTextBlock", version: "1.0.0" }, data: { text: "## 演示数据：研究问题\n\n不同缓存策略会怎样影响读取时间？\n\n请选择此卡片，修改正文，再校验预览。" }, position: { x: 20, y: 20 }, size: { width: 320, height: 320 } },
    { id: "comparison", title: "方法对照", type: { id: "liteasy/CollectionBlock", version: "1.0.0" }, data: { text: "## 合成对照表\n\n仅供练习，不代表真实实验结果。", rows: [["策略", "合成耗时"], ["方法 A", "12 ms"], ["方法 B", "9 ms"]] }, position: { x: 380, y: 20 }, size: { width: 320, height: 320 } },
    { id: "evidence", title: "证据占位", type: { id: "liteasy/ResourceBlock", version: "1.0.0" }, data: { text: "## 演示引用\n\n这里未连接真实论文。", path: "fixture://demo-evidence" }, position: { x: 20, y: 380 }, size: { width: 320, height: 320 } },
    { id: "next", title: "局限与下一步", type: { id: "liteasy/RichTextBlock", version: "1.0.0" }, data: { text: "## 练习步骤\n\n1. 选择卡片并修改正文。\n2. 对比实际组件预览。\n3. 保存草稿。\n\n类型决定字段与显示，组合保存卡片位置，流程描述执行步骤。" }, position: { x: 380, y: 380 }, size: { width: 320, height: 320 } },
  ];
  files["templates/comparison.json"] = JSON.stringify({ schema: "liteasy.board-template/v1", id: "comparison", title: manifest.name, cards }, null, 2);
  files[studioTutorialPath] = JSON.stringify({ version: 1, edited: false, previewed: false, saved: false } satisfies StudioTutorial);
  return files;
}
