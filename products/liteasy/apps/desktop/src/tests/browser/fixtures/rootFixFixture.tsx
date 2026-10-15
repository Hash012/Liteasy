import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { FluentProvider, webLightTheme, Button } from "@fluentui/react-components";
import { useObjectWorkbenchController } from "../../../app/controllers/useObjectWorkbenchController";
import { useNotesController } from "../../../app/controllers/useNotesController";
import { createSettingsStore } from "../../../app/features/settings/settings.store";
import { ObjectWorkbenchContext } from "../../../app/features/objects/objectWorkbenchPort";
import { ResourceReferencesContext } from "../../../app/features/resource-links/ResourceReferencesContext";
import { createResourceReferenceService } from "../../../app/features/resource-links/resourceReferenceService";
import { ResourceLink } from "../../../app/features/resource-links/ResourceReferenceView";
import { resolveReferencePdf } from "../../../app/features/resource-links/referencePdfSource";
import { createContextCatalogPort } from "../../../app/features/context-picker/catalogPort";
import { ContextAssetBrowser } from "../../../app/features/assistant/ContextAssetBrowser";
import { NotesPanel } from "../../../app/features/notes/NotesPanel";
import { liteasyPath } from "../../../app/features/resource-filesystem/liteasyPath";
import { refOf } from "../../../app/features/objects/object.types";
import { pdfAnnotationStorageKey, savePdfAnnotations } from "../../../app/features/pdf/pdfAnnotationStorage";
import { resolvePaperIdentity } from "../../../app/features/paper-identity/paperIdentity";
import type { AssistantComposerSuggestion } from "../../../app/features/assistant/assistant.types";
import "../../../app/styles/app.css";
import "../../../app/features/theme/appearance.css";
const scopeId = "root-fix-production-browser", paper = { id: "root-fix-paper", title: "原生批注测试", sourcePath: "/fixture.pdf", contentHash: "fixture-v1" };
const settings = createSettingsStore(), getPapers = () => [paper], getSettings = () => settings.getState();
function pdfBytes() {
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"], children: number[] = [];
  for (let page = 1; page <= 10; page++) { const id = objects.length + 1; children.push(id); const text = `BT /F1 22 Tf 60 550 Td (ORIGINAL PAGE ${page}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] ${page === 10 ? "/CropBox [20 30 580 770] /Rotate 90" : ""} /Resources << /Font << /F1 3 0 R >> >> /Contents ${id + 1} 0 R >>`, `<< /Length ${text.length} >>\nstream\n${text}\nendstream`); }
  objects[1] = `<< /Type /Pages /Kids [${children.map(id => `${id} 0 R`).join(" ")}] /Count 10 >>`;
  let text = "%PDF-1.4\n"; const offsets = [0]; objects.forEach((body, i) => { offsets.push(text.length); text += `${i + 1} 0 obj\n${body}\nendobj\n`; }); const start = text.length;
  text += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`; return new TextEncoder().encode(text);
}
const bytes = pdfBytes();
function Fixture() {
  const [ready, setReady] = useState(false), [paths, setPaths] = useState<string[]>([]), [picker, setPicker] = useState(false);
  const workbench = useObjectWorkbenchController({ scopeId, getApi: () => { throw new Error("No model call in this fixture"); }, getPapers, getSettings, openEvidence() {} });
  const notes = useNotesController({ scopeId, repository: workbench.repository, visible: true, getPapers, onOpen() {}, openObject() {}, openAnnotation() {} });
  useEffect(() => { void (async () => {
    const stored = await workbench.repository.getSnapshot("root-fix-fixture").catch(() => undefined) as { paths?: string[] } | undefined;
    if (stored?.paths) setPaths(stored.paths);
    else {
      const members = [];
      for (let i = 0; i < 20; i++) members.push(await workbench.repository.create({ kind: "content.note", title: `成员 ${i}`, content: { schema: "liteasy.note/v1", payload: { text: `**研究证据 ${i}**\n\nhello placement ${i}`, origin: "user" } } }));
      const boards = [];
      for (const title of ["研究白板 A", "研究白板 B"]) { const board = await workbench.repository.create({ kind: "workspace.board", title, content: { schema: "liteasy.board/v1", payload: { description: "" } } }); await workbench.repository.applyBoardPatch({ boardRef: refOf(board), operationId: crypto.randomUUID(), add: members.map(refOf) }); boards.push(await workbench.repository.resolveLatest(board.objectId)); }
      const values = boards.map(board => liteasyPath(scopeId, { kind: "object", ref: refOf(board) }));
      await workbench.repository.saveSnapshot({ snapshotId: "root-fix-fixture", paths: values }); setPaths(values);
    }
    savePdfAnnotations(pdfAnnotationStorageKey(paper)!, [{ id: "native-10", kind: "highlight", paperIdentity: resolvePaperIdentity(paper), page: 10, text: "高亮", note: "**可读标题** `code`", excerpt: "ORIGINAL PAGE 10", rects: [{ left: 15, top: 20, width: 40, height: 4 }], revision: 1, createdAt: "2026-10-15T00:00:00Z", updatedAt: "2026-10-15T00:00:00Z", publication: { desiredVisibility: "private", state: "not_published" } }]);
    await notes.model.refresh(); setReady(true);
  })(); }, []);
  const assets: AssistantComposerSuggestion[] = paths.map((path, i) => ({ id: `board-${i}`, label: `研究白板 ${i ? "B" : "A"}`, trigger: "@", category: "白板", resourcePath: path }));
  const catalog = createContextCatalogPort({ scope: scopeId, revision: paths.join("|"), assets, entries: [], collections: [], relations: [], inventories: {} });
  const service = useMemo(() => createResourceReferenceService({ scope: scopeId, active: () => true, assets: workbench.agentAssets, catalog: () => [], loadPdf: async (path, signal, intent) => {
    const target = await resolveReferencePdf({ path, repository: workbench.repository, papers: [paper], signal, intent }); return target ? { ...target, bytes } : undefined;
  } }), [workbench.agentAssets]);
  const annotation = liteasyPath(scopeId, { kind: "pdf-annotation", paperId: paper.id, annotationId: "native-10" });
  const references = { service, suggestions: assets, open: async () => {}, capture: async () => { throw new Error("not used"); }, picker: { catalog, workspaceId: "root-fix" } };
  return <FluentProvider theme={webLightTheme} style={{ minHeight: "100vh", maxWidth: "100vw" }}><ObjectWorkbenchContext.Provider value={workbench.port}><ResourceReferencesContext.Provider value={references}>
    <p role="status">{ready ? "夹具已就绪" : "准备中"}</p>
    <Button onClick={() => notes.model.selectFolder("default/board")}>查看白板笔记</Button><Button onClick={() => notes.model.selectFolder("default/pdf")}>查看 PDF 批注</Button><Button onClick={() => setPicker(true)}>添加上下文</Button>
    <div aria-label="对话来源"><ResourceLink locator={paths[0] ?? ""} previewOnClick>白板聊天引用</ResourceLink><ResourceLink locator={annotation} intent="origin" previewOnClick>批注原始 PDF</ResourceLink></div>
    <div style={{ maxWidth: 680 }}><NotesPanel model={notes.model} /></div>
    {picker ? <ContextAssetBrowser targetDraftId="root-fix" catalogPort={catalog} suggestions={assets} onClose={() => setPicker(false)} onAddContextToken={() => {}} /> : null}
  </ResourceReferencesContext.Provider></ObjectWorkbenchContext.Provider></FluentProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
