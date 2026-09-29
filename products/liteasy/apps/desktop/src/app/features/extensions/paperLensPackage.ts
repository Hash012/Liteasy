import { paperComparisonWorkflow } from "../workflows/paperComparisonWorkflow";
import { buildExtensionPackage } from "./extensionPackage";

/** An ordinary installable package, using exactly the public loader and renderer. */
export function paperLensPackage() {
  const id = "plugin.paper-lens";
  const titles = ["研究问题", "方法与假设", "证据与推理", "局限与下一步"];
  const manifest = { apiVersion: "liteasy.extension/v2", id, name: "论文比较板", version: "1.2.0", engines: { extensionApi: "2.0.0" }, activationEvents: [], permissions: [{ capability: "resources.metadata.read", scopeRef: "invocation.selection" }, { capability: "resources.content.read", scopeRef: "invocation.selection" }, { capability: "resources.create", scopeRef: "invocation.output", kinds: ["content.note"] }, { capability: "model.invoke", scopeRef: "invocation.modelConnection" }], contributes: {
    blockTypes: [{ id: "reasoning-card", path: "blocks/reasoning-card.json" }], boardTemplates: [{ id: "comparison", path: "templates/comparison.json" }],
    views: [{ id: "overview", title: "论文比较台", icon: "BoardRegular", placement: "main", entry: { kind: "declarative", path: "ui/overview.json" }, instancePolicy: "singleton" }],
    settings: [{ id: "reading", title: "比较板阅读", category: "extensions", schema: "settings/schema.json" }],
    workflows: [{ id: "analyze", path: "workflows/compare.json" }],
    menus: [{ location: "library.item.context", command: "analyze" }],
    commands: [{ id: "analyze", title: "比较论文并保存笔记", workflow: "analyze" }, { id: "compare", title: "新建论文比较板", boardTemplate: "comparison" }],
  } };
  const definition = { id: `${id}/reasoning-card`, version: "1.0.0", title: "推理卡", base: { id: "liteasy/RichTextBlock", version: "1.0.0" }, dataSchema: { type: "object", properties: { evidence: { type: "string", maxLength: 20000, default: "" } }, additionalProperties: false }, defaults: {}, template: { component: "Card", props: { title: "依据与来源" }, children: [{ component: "MarkdownView", props: { text: { $field: "evidence" } } }] } };
  const template = { schema: "liteasy.board-template/v1", id: "comparison", title: "论文比较板", cards: titles.map((title, index) => ({ id: `column-${index}`, title, type: { id: `${id}/reasoning-card`, version: "1.0.0" }, data: { text: `## ${title}\n\n拖入论文后整理此项内容。`, evidence: "" }, position: { x: index * 350, y: 20 }, size: { width: 320, height: 400 } })) };
  const settings = { type: "object", properties: { explanationLevel: { type: "string", title: "解释详略", enum: ["brief", "balanced", "deep"], default: "balanced" }, fontSize: { type: "integer", title: "默认字号", minimum: 10, maximum: 48, default: 16 } }, additionalProperties: false };
  return buildExtensionPackage({ "workflows/compare.json": JSON.stringify(paperComparisonWorkflow()), "liteasy.extension.json": JSON.stringify(manifest), "ui/overview.json": JSON.stringify({ component: "Stack", children: [{ component: "MarkdownView", props: { text: "# 我的论文比较台\n\n从下方创建可编辑的比较板。每张卡都支持公式、图片、字体设置和加入上下文。" } }, { component: "Card", props: { title: "当前解释详略" }, children: [{ component: "MarkdownView", props: { text: { $field: "settings.reading.explanationLevel" } } }] } ] }), "blocks/reasoning-card.json": JSON.stringify(definition), "templates/comparison.json": JSON.stringify(template), "settings/schema.json": JSON.stringify(settings) });
}
