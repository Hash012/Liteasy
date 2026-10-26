import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ApplicationThemeProvider } from "../../../app/features/theme/ApplicationThemeProvider";
import { notifyAppearancePreference } from "../../../app/features/theme/appearancePreference";
import { ActionButton } from "../../../app/shared/ui/productPrimitives";
import { WorkspaceCommandBar } from "../../../app/layout/WorkspaceCommandBar";
import { ResearchWorkbench } from "../../../app/features/research-loop/ResearchWorkbench";
import type { ResearchWorkbenchModel } from "../../../app/features/research-loop/researchWorkbench.types";
import { LibraryPane } from "../../../app/features/library/LibraryPane";
import { AssistantHomePanel } from "../../../app/features/assistant/AssistantHomePanel";
import { AssistantSessionRow } from "../../../app/features/assistant/AssistantHistoryPanel";
import { createAssistantSession } from "../../../app/features/assistant/assistantSessionHistory";
import "../../../app/styles/app.css";
import "../../../app/features/theme/appearance.css";
import "../../../app/features/assistant/assistantView.css";

const paper = { id: "paper-one", title: "A Negative Result on Gradient Matching for Selective Backprop", sourcePath: "/library/paper.pdf", year: 2023 };
const noop = () => {};
function Fixture() {
  const [events, setEvents] = useState<string[]>([]);
  const record = (value: string) => setEvents(previous => [...previous, value]);
  const [goal, setGoal] = useState("在同样的缓存与 I/O 预算下，预取能否减少等待且保持样本、顺序与跨模态对齐？");
  const [tasks, setTasks] = useState<ResearchWorkbenchModel["tasks"]>([]);
  const [detail, setDetail] = useState<ResearchWorkbenchModel["detail"]>();
  const [busy, setBusy] = useState(false);
  const [pendingAction, setPendingAction] = useState<ResearchWorkbenchModel["pendingAction"]>();
  const [connectionStatus, setConnectionStatus] = useState<ResearchWorkbenchModel["connectionStatus"]>({ intent: "error", message: "chatgpt_discovery_failed" });
  const [connected, setConnected] = useState(false);
  const [selectedModel, setModel] = useState("");
  const [empty, setEmpty] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [policy, setPolicy] = useState<"manual" | undefined>();
  const model = {
    supported: true, goal, setGoal, tasks, detail, busy, pendingAction, connectionStatus,
    notice: "", answer: "", sources: [], model: selectedModel, setModel,
    connections: { activeAccount: connected ? "account-one" : null, accounts: connected ? [{ id: "account-one", name: "研究账号", email: "test@example.invalid" }] : [] },
    models: connected ? [{ slug: "model-one", displayName: "研究模型" }] : [],
    backend: { configured: false, requiredVersion: "0.154.0" }, harnessReceipt: "", candidate: "sequential", hypothesisId: "", runId: "",
    hypothesis: { question: "", proposedMechanism: "", changedAssumption: "", prediction: "", falsification: "" },
    refresh: async () => record("refresh"),
    createTask: async () => {
      const task = { taskId: "task-one", goal, state: "waiting_user", budget: { usedRuns: 0, maxRuns: 6 }, taskBrief: { nextCheck: "选择固定来源" } } as ResearchWorkbenchModel["tasks"][number];
      setTasks([task]); setDetail({ task, records: [], runs: [] }); record(`create:${goal}`);
    },
    open: async (id: string) => record(`open:${id}`),
    login: async () => { record("login"); setBusy(true); setPendingAction("login"); setConnectionStatus(undefined); },
    cancelLogin: async () => { record("cancel-login"); setBusy(false); setPendingAction(undefined); },
    selectAccount: async (id: string) => record(`account:${id}`),
    verifyModel: async () => { record(`verify:${selectedModel}`); setConnectionStatus({ intent: "success", message: "本次推理已完成。" }); },
    logout: async () => { record("logout"); setConnected(false); setModel(""); },
    configureBackend: async (path: string) => record(`backend:${path}`),
    configureHarness: async (...paths: string[]) => record(`harness:${paths.join(",")}`),
    checkHarness: async (operation: string) => record(`check:${operation}`),
  } as ResearchWorkbenchModel;
  return <ApplicationThemeProvider><div className="app-frame workspace-frame">
    <WorkspaceCommandBar onOpenAi={() => record("ai")} onOpenSearch={() => record("search")}
      windowControls={{ available: true, maximized, error: "", minimize: () => record("minimize"), toggleMaximize: () => setMaximized(!maximized), close: () => record("close") }}
      state={{ title: "Liteasy · 研究工作台与长标题资料", actions: [{ id: "layout", label: "布局", icon: "layout", onSelect: () => record("layout") }], overflowActions: [{ id: "settings", label: "设置", icon: "settings", onSelect: () => record("settings") }] }} />
    <main style={{ minHeight: 0, overflow: "auto" }}>
      <div aria-label="测试控制"><ActionButton onClick={() => notifyAppearancePreference("light")}>浅色</ActionButton><ActionButton onClick={() => notifyAppearancePreference("dark")}>深色</ActionButton>
        <ActionButton onClick={() => { setBusy(false); setPendingAction(undefined); setConnectionStatus({ intent: "error", message: "chatgpt_discovery_failed" }); }}>授权失败</ActionButton>
        <ActionButton onClick={() => { setConnected(true); setBusy(false); setPendingAction(undefined); setConnectionStatus(undefined); }}>提供已授权账号</ActionButton>
        <ActionButton onClick={() => setEmpty(!empty)}>切换空状态</ActionButton>
      </div>
      <div data-testid="review-columns" style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: 12 }}>
        <div data-testid="library-host" style={{ width: 300, minWidth: 0, flexShrink: 0, height: 720 }}><LibraryPane accountSessionAvailable={false} canOpenOrganizationWorkspace={false} cloudEndpoint="" importJobs={{}} localLibrarySnapshot={{ entries: [{ id: paper.id, contentHash: "hash", path: paper.sourcePath, relativePath: "paper.pdf", title: paper.title }], folders: [], libraryId: "test-library", revision: 1, rootPath: "/library", trashEntries: [] }} papers={[{ ...paper, processingPolicy: policy }]} selectedPaperIds={[paper.id]} selectionLocked={false} workspaceLabel="本地文献库" workspaceSourceType="local_library"
          recommendationItems={[]} recommendationMessage="" recommendationPending={false} recommendationStatus="ready" onClearRecommendations={noop} onDismissRecommendation={noop} onOpenOrganizationWorkspace={noop} onReturnToLocalWorkspace={noop} onToggleLock={noop} onToggleSelection={noop}
          paperInventory={{ [paper.id]: { state: "ready", extraction: "ready", items: [{ id: "text", kind: "extracted_text", label: "论文提取文本" }, { id: "multimodal", kind: "multimodal", label: "论文提取图文版" }] } }}
          onPreparePaper={value => record(`prepare:${value.id}`)} onSetPaperProcessingPolicy={(value, next) => { setPolicy(next as "manual"); record(`policy:${value.id}:${next}`); }} onOpenPaperChild={(child, value) => record(`child:${value.id}:${child.id}`)}
        /></div>
        <div data-testid="research-host" style={{ width: 520, minWidth: 0, flexShrink: 0, height: 720 }}><ResearchWorkbench model={model} /></div>
        <div className="assistant-pane" style={{ width: 320, minWidth: 0, flex: "0 0 320px" }}><AssistantHomePanel papers={empty ? [] : [paper]} emptyMaterialsMessage="尚未添加资料" onAskSelected={() => record(`ask:${paper.id}`)} onViewAll={() => record("history")}>
          {empty ? [] : [1, 2].map(id => <AssistantSessionRow key={id} session={{ ...createAssistantSession({ id: `session-${id}` }), title: `Liteasy 研究助手使用记录 ${id}`, updatedAt: "2026-10-15T10:00:00Z" }} onOpenSession={value => record(`session:${value}`)} />)}
        </AssistantHomePanel></div>
      </div>
    </main><output data-testid="events">{JSON.stringify(events)}</output>
  </div></ApplicationThemeProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
