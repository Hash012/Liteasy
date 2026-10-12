import { createAgentAssetNavigator } from "../../../app/controllers/agent/createAgentAssetNavigator";
import { createPaperProjectRepository } from "../../../app/features/paper-projects/paperProjectRepository";
import { ReferenceSourceContext } from "../../../app/features/resource-links/ResourceReferencesContext";
import { MarkdownSourceEditor } from "../../../app/features/markdown/MarkdownSourceEditor";
import { createDesktopAgentService, type DesktopAgentEnvironment } from "../../../app/controllers/agent/createDesktopAgentService";
import { createOpenAIAgentsSdkManager } from "../../../app/controllers/agent/createOpenAIAgentsSdkManager";
import { createSettingsStore } from "../../../app/features/settings/settings.store";
import { parseEvidenceReport } from "../../../app/features/evidence/evidenceReport";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { FluentProvider, webLightTheme, webDarkTheme } from "@fluentui/react-components";
import { createNoteFileService } from "../../../app/features/note-files/noteFileService";
import { createObjectRepository } from "../../../app/features/objects/objectRepository";
import { createObjectStorage } from "../../../app/features/objects/objectStorage";
import { createWorkspaceAgentAssetService } from "../../../app/features/resource-filesystem/workspaceAgentAssetService";
import { resolveLiteasyContext } from "../../../app/features/resource-filesystem/resourceContext";
import type { EvidenceReportV1 } from "../../../app/features/evidence/evidenceReport";
import { EvidenceLens } from "../../../app/features/evidence/components/EvidenceLens";
import { ContentView } from "../../../app/features/markdown/ContentView";
import { sourceContent } from "../../../app/features/markdown/contentStructure";
import { liteasyPath } from "../../../app/features/resource-filesystem/liteasyPath";
import { resolveContextSnapshot } from "../../../app/features/context/objectContext";
import "../../../app/styles/app.css";
import "../../../app/features/theme/appearance.css";

// Actual browser file handles/IndexedDB and production services; deterministic reads, no model call.
const theme = new URLSearchParams(location.search).get("theme") ?? "light";
document.documentElement.dataset.colorScheme = theme;
const scope = `content-browser-${crypto.randomUUID()}`;
const storage = createObjectStorage(scope, () => scope);
const repository = createObjectRepository(storage, scope);
const projects = createPaperProjectRepository(storage, scope);
const files = createNoteFileService(scope, () => scope);
const assets = createWorkspaceAgentAssetService({ repository, files, active: () => true,
  resolveContext: path => resolveLiteasyContext({ path, repository, files, active: () => true, artifactScopeId: "device", getPapers: () => [], getArtifacts: async () => [], capturePapers: async () => [], captureAnnotation: async () => [], resolveBoard: async () => { throw new Error("Not used"); } }) });
function Fixture() {
  const [report, setReport] = useState<EvidenceReportV1>();
  const [opened, setOpened] = useState<ReturnType<typeof sourceContent>>();
  const [status, setStatus] = useState("");
  return <FluentProvider theme={theme === "dark" ? webDarkTheme : webLightTheme} style={{ minHeight: "100vh", padding: 8, boxSizing: "border-box", overflowX: "hidden" }}>
    <h1 style={{ fontSize: 16 }}>内容链路验收</h1><p>合成研究资料；真实浏览器文件导入与读取，无模型调用。</p>
    <input aria-label="导入 Markdown" type="file" accept=".md" onChange={async event => {
      const file = event.target.files?.[0]; if (!file) return;
      try {
        const directory = await navigator.storage.getDirectory();
        const handle = await directory.getFileHandle(file.name, { create: true });
        const writer = await handle.createWritable(); await writer.write(await file.text()); await writer.close();
        Object.assign(window, { showDirectoryPicker: async () => directory });
        const mount = await files.chooseFolder();
        const path = liteasyPath(scope, { kind: "external-file", mountId: mount!.id, path: file.name });
        const context = await assets.context(path);
        const snapshot = await resolveContextSnapshot({ repository, refs: context[0].refs, purpose: "格式验收" });
        if (!snapshot.entries.length) throw new Error("Context missing");
        const text = await file.text(); const offset = text.indexOf('colspan="2"') + 3;
        const action = (value: Record<string, unknown>) => JSON.stringify({ action: "answer", message: "", query: "", path: "", text: "", expectedRevision: "", mode: "append", offset: 0, ...value });
        const responses = [action({ action: "search", query: file.name }), action({ action: "read", path, offset }),
          action({ action: "read", path, offset: text.indexOf("这句话") }), action({ message: "合成回归回答：请对照表格条件，未进行语义核验。" })];
        const environment: DesktopAgentEnvironment = { assets, assetScopeId: scope, runtime: {} as never,
          knowledge: { selectedPapers: [], importedChunksByPaperId: {}, settings: createSettingsStore().getState(), modelTransport: async () => {
            const answer = responses.shift(); if (!answer) throw new Error("Unexpected synthetic request");
            const payload = { answer, execution: { backend: "http_service", mode: "unknown", provider: "synthetic-fixture-no-network" } };
            return { ok: true, status: 200, json: async () => payload, body: new ReadableStream({ start(controller) {
              controller.enqueue(new TextEncoder().encode(`${JSON.stringify({ ...payload, type: "completed" })}\n`)); controller.close();
            } }) };
          } } };
        const api = createDesktopAgentService({ getEnvironment: () => environment, managerAgent: createOpenAIAgentsSdkManager() });
        try {
          const session = await api.createSession({ consumer: "frontend" }); if (!session.ok) throw new Error(session.error.message);
          const run = await api.submitTurn({ sessionId: session.data.sessionId, idempotencyKey: crypto.randomUUID(), input: { message: "读取两处表格和脚注。", mode: "qa" } });
          if (!run.ok) throw new Error(run.error.message);
          const event = run.data.events.find(event => event.type === "assistant.message");
          const report = event?.type === "assistant.message" ? parseEvidenceReport(event.metadata?.evidenceReport) : undefined;
          if (report?.readLedger?.reads.length !== 2) throw new Error("Expected two production Agent read receipts");
          setReport(report);
        } finally { api.dispose(); }
        setStatus("已导入并固定上下文，保留 2 次读取");
      } catch (error) { setStatus(String(error)); }
    }} />
    <p role="status">{status}</p>
    {report && <EvidenceLens report={report} canOpenPassage={passage => !!passage.content} onOpenPassage={async passage => {
      const source = report.sources.find(source => source.id === passage.sourceId)!;
      const navigate = createAgentAssetNavigator({ repository, projects, files, active: () => true,
        getPapers: () => [], openObject: async () => { throw new Error("Unexpected object"); },
        openPaper: () => { throw new Error("Unexpected paper"); }, openArtifact: () => { throw new Error("Unexpected artifact"); },
        openAttachment: async () => { throw new Error("Unexpected attachment"); },
        openFile: file => { setOpened(sourceContent({ text: file.text, path: source.resourcePath!, revision: file.version!, scopeId: scope })); },
      });
      await navigate(source.resourcePath!, { revision: source.revision!, scopeId: scope, line: passage.content?.sourceLine, quote: passage.quote });
      setStatus(`同版本原文，第 ${passage.content?.sourceLine} 行`);
    }} />}
    {opened && <ReferenceSourceContext.Provider value={opened.binding.kind === "pinned" ? opened.binding.path : undefined}>
      <section aria-label="同版本原文"><ContentView content={opened} />
        <MarkdownSourceEditor value={opened.exactSelection.text} onChange={() => {}} documentKey="source" readOnly label="被引用原文选区" />
      </section></ReferenceSourceContext.Provider>}
  </FluentProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
