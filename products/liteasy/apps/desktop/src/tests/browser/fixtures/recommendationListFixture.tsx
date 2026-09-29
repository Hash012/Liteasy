import { useState } from "react";
import { createRoot } from "react-dom/client";
import { FluentProvider, webDarkTheme, webLightTheme } from "@fluentui/react-components";
import { RecommendationList } from "../../../app/features/recommendations/RecommendationList";
import { RecommendationDetails } from "../../../app/features/recommendations/RecommendationDetails";
import { RecommendationStyleControl } from "../../../app/features/recommendations/RecommendationStyleControl";
import type { RecommendationItem } from "../../../app/features/recommendations/recommendation.types";
import type { DownloadRecommendation } from "../../../app/features/recommendations/RecommendationDownload";
import { DockRegion } from "../../../app/features/dock/DockRegion";
import { useDockLayout } from "../../../app/features/dock/useDockLayout";
import { useWorkbenchNavigationController } from "../../../app/controllers/useWorkbenchNavigationController";
import { FileStatusBar } from "../../../app/layout/FileStatusBar";
import "../../../app/styles/app.css";
import "../../../app/features/theme/appearance.css";
import "../../../app/features/library/library.css";

const items: RecommendationItem[] = ["Larimar: Large Language Models with Episodic Memory Control", "Cicada: Dependably Fast Multi-Core In-Memory Transactions", "Memory and transactions in modern database systems"].map((title, index) => ({
  id: `paper-${index}`, title, authors: ["Researcher A", "Researcher B"], publishedAt: `${2024 - index}-06-12`,
  venue: "Systems Conference", abstract: "We study **episodic memory** and its role in reliable research systems. This paper describes the method, compares it against existing approaches, and evaluates its practical limitations.\n\nThe results suggest useful directions for future work, with an emphasis on reproducible evidence and interpretable evaluation.", source: "Crossref",
  subjects: ["Machine learning", "Memory systems"], openAccessAvailable: index !== 2, citationCount: 15 + index * 100,
  sourceKind: "live", sourceUrl: "https://doi.org/10.1234/example", reason: "与所选论文的记忆系统主题相关，可补充方法设计与实证比较。", discoveredAt: "2026-09-29",
  relatedDocumentTitle: "Cicada", relevanceBand: "high", relevanceScore: 0.9,
}));
const locations = { rootPath: "D:/Library", folders: [{ name: "Memory", path: "D:/Library/Memory", parentPath: "D:/Library" }] };
function Fixture() {
  const [selected, select] = useState<RecommendationItem>();
  const [opened, setOpened] = useState<RecommendationItem>();
  const [message, setMessage] = useState("");
  const dock = useDockLayout();
  const navigation = useWorkbenchNavigationController({ dock, collapsed: { left: false, right: false, bottom: true },
    setCollapsed: () => undefined, boardVisible: false, closeBoard: () => undefined, activate: dock.activateItem, activeDynamicItems: {} });
  const dark = location.search.includes("dark");
  document.documentElement.dataset.colorScheme = dark ? "dark" : "light";
  const download: DownloadRecommendation = async (item, options) => {
    const result = `已下载 ${item.title} 到 ${options?.targetFolderPath || "D:/Library/Download"}${options?.newFolderName ? "/" + options.newFolderName : ""}`;
    setMessage(result); return result;
  };
  return <FluentProvider theme={dark ? webDarkTheme : webLightTheme}>
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "var(--colorNeutralBackground1)", color: "var(--colorNeutralForeground1)" }}>
      <main className="recommendation-fixture-columns" style={{ display: "grid", gridTemplateColumns: "minmax(0, 340px) minmax(0, 1fr)", flex: 1, gap: 5, padding: 5, minHeight: 0 }}>
        <aside style={{ overflow: "auto", padding: 12, minWidth: 0, border: "1px solid var(--colorNeutralStroke2)", borderRadius: 8 }}>
          <h3>关联推荐</h3><RecommendationStyleControl compact value="balanced" onChange={() => undefined} />
          <RecommendationList items={items} selectedId={selected?.id} onInspect={select} pendingIds={[]} canSave
            onSave={() => undefined} onDismiss={() => undefined} onOpen={(item) => { setOpened(item); navigation.open("recommendation-reader"); }} />
        </aside>
        <DockRegion regionId="main" layout={dock.layout.regions.main} onActivateItem={dock.activateItem.bind(null, "main")}
          onCloseItem={dock.closeItem} onMoveItem={dock.moveItem} renderItem={() => opened ? <RecommendationDetails page key={opened.id} item={opened} locations={locations} onDownload={download} /> : null} />
      </main>
      <output aria-label="已下载文件" hidden>{message}</output>
      <FileStatusBar status={selected ? { name: selected.title, recommendation: selected, type: "推荐文献" } : undefined} recommendationLocations={locations} onDownloadRecommendation={download} />
    </div>
    <style>{"@media (max-width: 600px) { .recommendation-fixture-columns { grid-template-columns: minmax(0, 1fr) !important; } .recommendation-fixture-columns > .dock-region { display: none; } }"}</style>
  </FluentProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
