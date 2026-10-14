import { queryContextCatalog } from "../../../app/features/assistant/contextCatalogQuery";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { ContextAssetBrowser } from "../../../app/features/assistant/ContextAssetBrowser";
import type { AssistantComposerSuggestion, AssistantContextToken } from "../../../app/features/assistant/assistant.types";

const imageUrls = (window as unknown as { catalogImageUrls: string[] }).catalogImageUrls;
let bodyReads = 0;
const summary = "# 注意力机制与实验结果\n\n本节比较三种注意力结构，记录训练效率与迁移效果。\n\n## 实验设置\n\n在相同语料与训练预算下，分别测量准确率、延迟和显存占用。\n\n| 方法 | 准确率 | 延迟 |\n| --- | --- | --- |\n| 基线 | 82.4% | 26 ms |\n| 稀疏注意力 | 84.1% | 19 ms |\n\n下一步复核不同随机种子下的结果。";
const projects = ["注意力机制研究", "语言模型评测", "检索增强生成"];
const suggestions: AssistantComposerSuggestion[] = projects.flatMap((projectTitle, group) => [
  { id: `paper-${group}`, label: ["Attention Is All You Need", "Evaluating Language Model Reliability", "Retrieval-Augmented Generation"][group], category: "论文", searchMetadata: { kind: "paper", format: "pdf", origin: "import", tags: ["精读", "机器学习"] } },
  { id: `text-${group}`, label: "实验设置与结果分析", category: "原文", searchMetadata: { kind: "text", format: "markdown", origin: "import", tags: ["实验"] } },
  { id: `note-${group}`, label: "方法对比与复现记录", category: "笔记", searchMetadata: { kind: "note", format: "markdown", origin: "user", tags: ["复现"] } },
  ...imageUrls.map((url, index) => ({ id: `image-${group}-${index}`, label: ["实验架构总览", "分层注意力结构", "性能对比曲线", "数据处理流程"][index], category: "图片", searchMetadata: { kind: "image", format: ["png", "png", "jpg", "svg"][index], origin: "import", tags: ["图表"] }, loadThumbnail: async () => ({ text: "", images: [{ url, label: "论文图表" }] }), loadPreview: async () => { bodyReads++; return { text: "图表来自论文实验部分。", images: [{ url, label: "论文图表" }] }; } })),
].map((asset) => ({ trigger: "@" as const, projectId: `project-${group}`, projectTitle, scopeId: "catalog-browser-fixture", updatedAt: "2026-10-14T00:00:00Z", readOnly: asset.category !== "笔记", loadPreview: async () => { bodyReads++; return { text: summary }; }, token: { id: asset.id, kind: "object" as const, label: asset.label, prompt: "", contextRefs: [{ objectId: asset.id, revision: "fixture-r1" }] }, ...asset })));
let largeCatalog: AssistantComposerSuggestion[] | undefined;
const getLargeCatalog = () => largeCatalog ??= Array.from({ length: 10000 }, (_, index) => ({ ...suggestions[index % suggestions.length], id: `large-${index}`, label: `材料 ${index}`, projectId: `project-${index % 20}` }));
function Fixture() {
  const [catalog, setCatalog] = useState(suggestions);
  Object.assign(window, { loadLargeCatalog: () => setCatalog(getLargeCatalog()) });
  const [tokens, setTokens] = useState<AssistantContextToken[]>([]);
  return <FluentProvider theme={webLightTheme} style={{ minHeight: "100vh", background: "#f5f5f5" }}><ContextAssetBrowser suggestions={catalog} contextTokens={tokens} onClose={() => undefined} onAddContextToken={(token) => setTokens((current) => [...current, token])} /></FluentProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);

Object.assign(window, { measureCatalogQuery() {
  const items = getLargeCatalog();
  const durations: number[] = [];
  for (let index = 0; index < 25; index++) { const start = performance.now(); queryContextCatalog(items, { query: `材料 ${index}`, groupBy: "project", sort: "updated" }); durations.push(performance.now() - start); }
  durations.sort((a, b) => a - b);
  return { items: items.length, samples: durations.length, p50Ms: durations[12], p95Ms: durations[23], bodyReads, renderedRows: document.querySelectorAll(".context-asset-card").length, userAgent: navigator.userAgent, platform: navigator.platform };
} });
