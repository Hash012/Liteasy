import { createRoot } from "react-dom/client";
import { useState } from "react";
import { ApplicationThemeProvider } from "../../../app/features/theme/ApplicationThemeProvider";
import { notifyAppearancePreference } from "../../../app/features/theme/appearancePreference";
import { ThinReadingTab } from "../../../app/features/thin-reading/ThinReadingTab";
import { createThinReadingDocument } from "../../../app/features/thin-reading/thinReadingProjection";
import { AssistantMessageList } from "../../../app/features/assistant/AssistantMessageList";
import { RecommendationList } from "../../../app/features/recommendations/RecommendationList";
import { LibraryPane } from "../../../app/features/library/LibraryPane";
import "../../../app/styles/app.css";
import "../../../app/features/theme/appearance.css";

const noop = () => undefined;
function Fixture() {
  const [width, setWidth] = useState(280);
  const [notice, setNotice] = useState("");
  const [document, setDocument] = useState(() => createThinReadingDocument({ artifactId: "ui-synthetic",
    papers: [{ id: "synthetic-paper", title: "离线界面验证资料" }], targetLanguage: "zh-CN",
    rootSeed: { summary: "## 合成资料\n\n正文保留段落与 **证据**。不使用真实论文，不调用模型。", omittedSections: [], recommendations: [], withinPaperClosure: true, evidence: { paperEvidence: ["synthetic-evidence"], externalKnowledge: [], paperEvidenceSpans: [{ id: "synthetic-evidence", paperId: "synthetic-paper", page: 1, quote: "仅用于界面验收的合成资料。", confidence: 1 }] } } }));
  return <ApplicationThemeProvider><div style={{ minHeight: "100vh", padding: 12 }}>
    <button onClick={() => notifyAppearancePreference("dark")}>深色主题</button>
    <button onClick={() => notifyAppearancePreference("light")}>浅色主题</button>
    <div style={{ display: "grid", gridTemplateColumns: "280px minmax(0,1fr)", gap: 12 }}>
      <LibraryPane accountScopeId="ui-synthetic" accountSessionAvailable={false} canOpenOrganizationWorkspace={false} cloudEndpoint="" importJobs={{}}
        localLibrarySnapshot={null} papers={[]} recommendationItems={[]} recommendationMessage="" recommendationPending={false} recommendationStatus="idle"
        selectedPaperIds={[]} selectionLocked={false} workspaceLabel="隔离演示" workspaceSourceType="local_library"
        onClearRecommendations={noop} onDismissRecommendation={noop} onOpenOrganizationWorkspace={noop} onReturnToLocalWorkspace={noop}
        onToggleLock={noop} onToggleSelection={noop} onLoginRequired={() => setNotice("已触发登录入口")} />
      <ThinReadingTab artifactId={document.artifactId} document={document} papers={[{ id: "synthetic-paper", title: "离线界面验证资料" }]}
        communityRecommendationState={{ recommendations: [], status: "unconfigured" }} onUpdateDocument={(_, value) => setDocument(value)} />
    </div>
    <label>推荐区域宽度<select aria-label="推荐区域宽度" value={width} onChange={event => setWidth(Number(event.target.value))}>{[280, 360, 480].map(n => <option key={n}>{n}</option>)}</select></label>
    <section aria-label="推荐宽度验收" style={{ width, maxWidth: "100%" }}><RecommendationList
      items={[{ id: "reason", title: "很长的推荐标题：Memory systems concurrency control and reproducible scientific results", authors: ["Synthetic author"], reason: "来源提供的理由：主题与并发控制有关", source: "Synthetic", sourceKind: "live", sourceUrl: "https://example.test/synthetic", discoveredAt: "2026-10-13", relevanceBand: "high", relevanceScore: 0.9 },
        { id: "no-reason", title: "没有个别理由的推荐", authors: [], reason: "", source: "Synthetic", sourceKind: "live", sourceUrl: "https://example.test/other", discoveredAt: "2026-10-13", relevanceBand: "medium", relevanceScore: 0.6 }]}
      pendingIds={[]} canSave onSave={item => setNotice(`已收藏：${item.id}`)} onDismiss={item => setNotice(`已忽略：${item.id}`)}
    /></section>
    <AssistantMessageList mode="qa" onModeChange={noop} messages={[{ id: "synthetic-complete", role: "assistant", content: "合成完成回复" }]} />
    <output>{notice}</output>
  </div></ApplicationThemeProvider>;
}
createRoot(window.document.getElementById("root")!).render(<Fixture />);
