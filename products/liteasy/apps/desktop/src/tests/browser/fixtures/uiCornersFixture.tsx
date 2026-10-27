import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ApplicationThemeProvider } from "../../../app/features/theme/ApplicationThemeProvider";
import { notifyAppearancePreference } from "../../../app/features/theme/appearancePreference";
import { ActionButton } from "../../../app/shared/ui/productPrimitives";
import { OrganizationCreateDialog } from "../../../app/features/organization/OrganizationCreateDialog";
import { OrganizationJoinDialog } from "../../../app/features/organization/OrganizationJoinDialog";
import { OrganizationInviteConfirmDialog } from "../../../app/features/organization/OrganizationInviteConfirmDialog";
import { OrganizationLeaveConfirmDialog } from "../../../app/features/organization/OrganizationLeaveConfirmDialog";
import { LightweightLoginDialog } from "../../../app/features/account/LightweightLoginDialog";
import { ClearProfileConfirmDialog } from "../../../app/features/profile/ClearProfileConfirmDialog";
import { AcademicArchiveDialog } from "../../../app/features/profile/AcademicArchiveDialog";
import { defaultAcademicProfile } from "../../../app/features/profile/profile.types";
import { organizationUiSummary } from "../../fixtures/organizationUiFixtures";
import { LibraryMetadataEditor } from "../../../app/features/library/LibraryMetadataEditor";
import { ModelConnectionPanel } from "../../../app/features/models/ModelConnectionPanel";
import { PaperResourceTab } from "../../../app/features/import/PaperResourceTab";
import { ReadingDocumentReader } from "../../../app/features/reading-library/ReadingDocumentReader";
import type { ParsedReadingDocument } from "../../../app/features/reading-library/readingDocument.types";
import { ThinReadingTab } from "../../../app/features/thin-reading/ThinReadingTab";
import { createThinReadingDocument } from "../../../app/features/thin-reading/thinReadingProjection";
import { createThinReadingFixture } from "../../fixtures/thinReadingFixtures";
import { WorkflowRuns } from "../../../app/features/workflows/WorkflowViews";
import { ExtensionWorkbenchContext, type ExtensionWorkbench } from "../../../app/features/extensions/extensionWorkbenchContext";
import { ObsidianLikeGraphCanvas } from "../../../app/features/layered-reading/ObsidianLikeGraphCanvas";
import { defaultGraphViewState } from "../../../app/features/layered-reading/layeredReading.types";
import CitationGraphDialog from "../../../app/features/citation-graph/CitationGraphDialog";
import type { createCitationGraphClient } from "../../../app/features/citation-graph/citationGraphClient";
import "../../../app/styles/app.css";
import "../../../app/features/theme/appearance.css";
import "../../../app/features/settings/settingsPage.css";
import "../../../app/features/library/library.css";
import "../../../app/features/extensions/extensionWorkbench.css";

const paper = { id: "corners-paper", title: "窄分栏中的论文图表与对照阅读", doi: "10.1234/fixture" };
const book: ParsedReadingDocument = { title: "研究手册", authors: ["研究者"], format: "markdown", resources: [], warnings: [],
  chapters: ["基础", "发现"].map((title, i) => ({ id: String(i), title, format: "markdown", content: `# ${title}\n\n可在窄分栏继续阅读的正文内容。`, plainText: "可在窄分栏继续阅读的正文内容。" })),
  toc: ["基础", "发现"].map((label, i) => ({ id: `toc-${i}`, label, chapterId: String(i), depth: 0 })) };
const thinBase = createThinReadingFixture();
const run = { id: "run-one", status: "failed", createdAt: "2026-10-27T00:00:00Z", elapsedMs: 1000, tokens: 0,
  error: "本次操作未完成，请检查连接后重试。", definition: { id: "test", title: "整理阅读来源", budget: { maxTokens: 1000 }, nodes: [] } };
const workflowHost = { workflows: { error: "", triggers: { list: async () => [] }, runner: {
  list: async () => [run], subscribe: () => () => {}, replay: async () => ({ run, nodes: {}, missing: [], receipts: {} }),
} } } as unknown as ExtensionWorkbench;
const citationClient = { loadLibrary: async () => ({ works: [], identified: 0, errors: [] }) } as unknown as ReturnType<typeof createCitationGraphClient>;

function Fixture() {
  const [view, setView] = useState("模型接入");
  const [dialog, setDialog] = useState("");
  const [pending, setPending] = useState(false), [message, setMessage] = useState("");
  const [events, setEvents] = useState<string[]>([]);
  const [thin, setThin] = useState(() => createThinReadingDocument(thinBase));
  const [graphView, setGraphView] = useState(defaultGraphViewState);
  const record = (value: unknown) => setEvents(previous => [...previous, JSON.stringify(value)]);
  const close = () => { setDialog(""); setPending(false); setMessage(""); };
  const confirm = (value: unknown) => { record(value); setPending(true); };
  useEffect(() => {
    const finish = () => { setPending(false); setMessage("操作未完成，请重试。已填写内容会保留。" ); };
    window.addEventListener("ui-review-finish", finish);
    return () => window.removeEventListener("ui-review-finish", finish);
  }, []);
  const org = { onCancel: close, pending, message };
  return <ApplicationThemeProvider><main style={{ padding: 12, boxSizing: "border-box", minWidth: 0 }}>
    <nav aria-label="审核页面" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      <ActionButton onClick={() => notifyAppearancePreference("light")}>浅色</ActionButton><ActionButton onClick={() => notifyAppearancePreference("dark")}>深色</ActionButton>
      {["模型接入", "解析图表", "翻译对照", "电子书", "薄读", "工作流", "认知图"].map(name => <ActionButton key={name} onClick={() => setView(name)}>{name}</ActionButton>)}
    </nav>
    <nav aria-label="审核弹窗" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBlock: 12 }}>
      {["创建组织", "加入组织", "邀请成员", "退出组织", "登录", "清空档案", "查看档案", "分类标签", "引用图"].map(name => <ActionButton key={name} onClick={() => setDialog(name)}>{name}</ActionButton>)}
    </nav>
    <div data-testid="corner-pane" style={{ width: 360, maxWidth: "100%", height: 780, overflow: "auto", border: "1px solid var(--border-subtle)", boxSizing: "border-box" }}>
      {view === "模型接入" ? <section className="settings-page"><div className="settings-content"><section className="settings-card"><div className="settings-card-content"><ModelConnectionPanel settings={{ "models.direct_provider": "openai", "models.direct_endpoint": "https://api.example.invalid/v1", "models.direct_model": "review-model" }} onUpdateSetting={record} /></div></section></div></section> : null}
      {view === "解析图表" || view === "翻译对照" ? <PaperResourceTab key={view} paper={paper} kind={view === "解析图表" ? "figures" : "multimodal"}
        figures={view === "解析图表" ? [{ id: "figure-one", page: 1, alt: "结果图表", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6wSAAAAAASUVORK5CYII=", sourcePath: "images/one.svg", analysis: { title: "论文结果", description: "图表说明在窄面板中应当排在图像下方，保持完整可读。", kind: "chart", importance: "primary", placement: "results", selectionReason: "结果" } }] : []}
        textChunks={[{ page: 1, paperId: paper.id, paperTitle: paper.title, snippet: "Original paper text.", summary: "", tags: [], textExtraction: "mineru" }]}
        onTranslate={async (source, target) => { record({ source, target }); return "<!-- liteasy-anchor:segment-001 -->\n已保存译文。"; }}
        onLoadTranslations={async () => [{ id: "saved", content: "<!-- liteasy-anchor:segment-001 -->\n已保存译文。", paperId: paper.id, sourceFingerprint: "fixture", sourceLanguage: "English", targetLanguage: "中文", updatedAt: "2026-10-27T00:00:00Z", version: "liteasy.paper-translation/v1" }]}
      /> : null}
      {view === "电子书" ? <ReadingDocumentReader document={book} documentId="review-book" storageScope="corners-review" /> : null}
      {view === "薄读" ? <ThinReadingTab artifactId={thinBase.artifactId} document={thin} papers={[...thinBase.papers]} onUpdateDocument={(_, value) => setThin(value)} /> : null}
      {view === "工作流" ? <ExtensionWorkbenchContext.Provider value={workflowHost}><WorkflowRuns /></ExtensionWorkbenchContext.Provider> : null}
      {view === "认知图" ? <ObsidianLikeGraphCanvas graph={{ version: "liteasy-intuition-graph/v1", id: "graph", workId: "work", revision: 1, rootNodeId: "root", nodes: [{ id: "root", status: "stub", label: "研究问题", expandable: true, tags: [] }], edges: [], provenance: { createdAt: "2026-10-27", generatedBy: "rule" } }} view={graphView} onViewChange={setGraphView} onExpand={id => record({ expand: id })} /> : null}
    </div>
    <output data-testid="corner-events" style={{ display: "block", overflowWrap: "anywhere" }}>{events.join("\n")}</output>
    {dialog === "创建组织" ? <OrganizationCreateDialog {...org} onConfirm={confirm} /> : null}
    {dialog === "加入组织" ? <OrganizationJoinDialog {...org} onConfirm={confirm} /> : null}
    {dialog === "邀请成员" ? <OrganizationInviteConfirmDialog {...org} summary={{ ...organizationUiSummary, myRole: "owner" }} onConfirm={confirm} /> : null}
    {dialog === "退出组织" ? <OrganizationLeaveConfirmDialog {...org} summary={organizationUiSummary} onConfirm={() => confirm("leave")} /> : null}
    {dialog === "清空档案" ? <ClearProfileConfirmDialog onCancel={close} onConfirm={() => { record("clear"); close(); }} /> : null}
    {dialog === "查看档案" ? <AcademicArchiveDialog academicProfile={defaultAcademicProfile} accountSession={null} onClose={close} onExport={() => record("export")} /> : null}
    {dialog === "登录" ? <LightweightLoginDialog controlPlaneEndpoint="http://127.0.0.1:8791" onSkip={close} accountMessage={message} accountPending={pending} onSubmitAccountLogin={confirm} onSubmitAccountRegistration={confirm} onSubmitSystemBrowserLogin={() => confirm("login")} onToggleSuppressReminder={record} /> : null}
    {dialog === "分类标签" ? <LibraryMetadataEditor entry={{ id: "metadata", title: "分类整理", format: "pdf", readingStatus: "unread" }} onClose={close} onSave={async value => record(value)} /> : null}
    {dialog === "引用图" ? <CitationGraphDialog papers={[paper]} client={citationClient} onClose={close} /> : null}
  </main></ApplicationThemeProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
