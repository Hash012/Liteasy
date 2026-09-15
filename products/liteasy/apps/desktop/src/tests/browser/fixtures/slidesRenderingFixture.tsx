import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { SlideDeckView } from "../../../app/features/generative-ui/SlideDeckView";
import { paperAnchorFromEvidence, type PaperAnchorEntity } from "../../../app/features/paper-anchors/paperAnchorEntity";
import "./slidesRenderingFixture.css";

// Deterministic rendering data only: this entry never mounts AppShell or calls a model/business service.
const anchor = paperAnchorFromEvidence({
  id: "evidence-browser-slide-fixture",
  paperId: "paper-browser-slide-fixture",
  paperTitle: "可视化测试论文",
  page: 3,
  quote: "这是用于渲染验收的引用摘录，验证来源卡片始终保留可读原文。",
  summary: "测试资料：观察统一文本组件与来源实体的呈现。",
});
// Resolve against this HTML entry so Vite does not inline the SVG as a data URL.
const figureUrl = new URL("./slide-figure.svg", window.location.href).href;
const slides = [
  {
    id: "rendering-page-1",
    title: "方法与来源",
    markdown: [
      "本页使用 **统一 Markdown** 呈现研究材料。来源：[evidence-browser-slide-fixture]。",
      "| 内容 | 预期呈现 |\n| --- | --- |\n| 结构化结果 | 可读表格 |\n| 引用证据 | 论文名称与页码 |",
      "均值公式：$\\bar{x}=\\frac{1}{n}\\sum_{i=1}^{n}x_i$。",
      "```mermaid\nflowchart LR\n  A[输入材料] --> B[分析证据]\n  B --> C[组织幻灯片]\n```",
      `![渲染测试示意图](${figureUrl})`,
    ].join("\n\n"),
    notes: "**第一页备注**：先说明输入材料，再结合 $n=3$ 解释图表和来源。",
    evidenceIds: [anchor.id],
  },
  {
    id: "rendering-page-2",
    title: "结论与下一步",
    markdown: "## 第二页独立内容\n\n- 复核研究结论。\n- 补充下一步实验。\n\n本页不含第一张幻灯片的表格、图表或图片。",
    notes: "**第二页备注**：安排复核，记录尚未回答的问题。",
    evidenceIds: [],
  },
];

function SlidesRenderingFixture() {
  const [openedAnchor, setOpenedAnchor] = useState<PaperAnchorEntity>();
  return <FluentProvider theme={webLightTheme}>
    <main className="slides-rendering-fixture">
      <header>
        <h1>幻灯片渲染验收</h1>
        <p>固定渲染测试资料，仅验证界面；不调用模型或业务服务。</p>
      </header>
      <SlideDeckView
        onOpenPaperAnchor={setOpenedAnchor}
        paperAnchors={[anchor]}
        slides={slides}
        title="统一文本与来源展示"
      />
      {openedAnchor ? <aside aria-label="已打开的来源">
        已打开：{openedAnchor.presentation.title} · {openedAnchor.presentation.location}
        <p>{openedAnchor.snapshot.quote}</p>
      </aside> : null}
    </main>
  </FluentProvider>;
}

createRoot(document.getElementById("root")!).render(<SlidesRenderingFixture />);
