import { useState } from "react";
import { createRoot } from "react-dom/client";
import { FluentProvider, webDarkTheme, webLightTheme } from "@fluentui/react-components";
import { RecommendationList } from "../../../app/features/recommendations/RecommendationList";
import { RecommendationStyleControl } from "../../../app/features/recommendations/RecommendationStyleControl";
import type { RecommendationItem } from "../../../app/features/recommendations/recommendation.types";
import { FileStatusBar } from "../../../app/layout/FileStatusBar";
import "../../../app/styles/app.css";
import "../../../app/features/library/library.css";

const items: RecommendationItem[] = ["Cicada: Dependably Fast Multi-Core In-Memory Transactions", "Larimar: Large Language Models with Episodic Memory Control", "Memory and transactions in modern database systems"].map((title, index) => ({
  id: `paper-${index}`, title, authors: ["Researcher A", "Researcher B"], publishedAt: `${2024 - index}-06-12`,
  venue: "Systems Conference", abstract: "A detailed abstract with **evidence** and topic metadata.", source: "Crossref",
  sourceKind: "live", sourceUrl: "https://doi.org/10.1234/example", reason: "来自选中文献的主题信息。", discoveredAt: "2026-09-29",
  relatedDocumentTitle: "Cicada", relevanceBand: "high", relevanceScore: 0.9,
}));
function Fixture() {
  const [selected, select] = useState<RecommendationItem>();
  const [message, setMessage] = useState("");
  const dark = location.search.includes("dark");
  return <FluentProvider theme={dark ? webDarkTheme : webLightTheme}>
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "var(--colorNeutralBackground1)" }}>
      <main style={{ flex: 1, padding: 8, minHeight: 0 }}>
        <h3>关联推荐</h3><RecommendationStyleControl compact value="balanced" onChange={() => undefined} />
        <RecommendationList items={items} selectedId={selected?.id} onInspect={select} pendingIds={[]} canSave
          onSave={() => undefined} onDismiss={() => undefined} onDownload={(item) => setMessage(`下载请求：${item.title}`)} />
        <p role="status">{message}</p>
      </main>
      <FileStatusBar status={selected ? { name: selected.title, recommendation: selected, type: "推荐文献" } : undefined} />
    </div>
  </FluentProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
