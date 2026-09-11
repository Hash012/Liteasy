import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { createRoot } from "react-dom/client";
import { ReaderPane } from "../../app/layout/ReaderPane";
import { AssistantMessageList } from "../../app/features/assistant/AssistantMessageList";
import { savePdfAnnotations, pdfAnnotationStorageKey } from "../../app/features/pdf/pdfAnnotationStorage";
import { resolvePaperIdentity } from "../../app/features/paper-identity/paperIdentity";
import { applyAgentActivityEvent, completeAgentActivity, createAgentActivity } from "../../app/features/assistant/agentActivity";
import type { AgentEvent } from "../../app/features/agent-api/agentApi.types";

export function mountReaderPresentationFixture(element: HTMLElement) {
  const paper = { id: "local-internal-paper-id", title: "A paper with a long title already shown in its tab", sourcePath: new URL("/manual-preview/das24a.pdf", location.origin).href };
  savePdfAnnotations(pdfAnnotationStorageKey(paper), [{
    id: "color-highlight", paperIdentity: resolvePaperIdentity(paper), kind: "highlight", color: "yellow", page: 1,
    excerpt: "Highlighted evidence", text: "高亮", rects: [{ left: 10, top: 30, width: 35, height: 3 }],
    revision: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    publication: { desiredVisibility: "private", state: "not_published" }
  }]);
  const activity = completeAgentActivity(applyAgentActivityEvent(createAgentActivity(), {
    type: "manager.activity", activityId: "read", kind: "reasoning_summary", label: "核对论文证据",
    detail: "已读取选中文献，核对回答与原文的对应关系。", status: "completed"
  } as AgentEvent), "completed");
  createRoot(element).render(<FluentProvider className="reader-presentation-fixture" theme={webLightTheme} style={{ height: "100vh" }}>
    <style>{`.reader-presentation-fixture .pane.center { grid-column: 1; min-width: 0; } .reader-presentation-fixture > div > aside { grid-column: 2; min-width: 0; }`}</style>
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 360px", height: "100%", gap: 8 }}>
      <ReaderPane analysisHint="" artifactTabs={[]} artifactTasks={[]} onStartAnalysis={() => {}}
        selectedPapers={[paper]} selectedPaperIds={[paper.id]} selectionLocked showArtifactRegion={false}
        onResolveLiteratureIdentity={() => {}} onToggleLeftPane={() => {}} onToggleRightPane={() => {}} onToggleBottomPane={() => {}} />
      <aside className="pane" style={{ overflow: "auto" }}>
        <AssistantMessageList mode="qa" onModeChange={() => {}} papers={[paper]} onOpenCitation={() => {}} messages={[{
          id: "answer", role: "assistant", content: "这篇论文提出的方法可以从研究问题、方法和实验结果三个方面理解。\n引用: local-internal-paper-id p.1\n可信度: 0.96",
          agentActivity: activity, citations: [{ paperId: paper.id, page: 1, snippet: "A short piece of original evidence." }]
        }]} />
      </aside>
    </div>
  </FluentProvider>);
}
