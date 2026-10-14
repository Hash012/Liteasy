import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { FluentProvider, webLightTheme, webDarkTheme, Button } from "@fluentui/react-components";
import { contextPickerSourceFixture } from "../../contextPickerSourceFixture";
import { refOf } from "../../../app/features/objects/object.types";
import { liteasyPath } from "../../../app/features/resource-filesystem/liteasyPath";
import { ContextAssetBrowser } from "../../../app/features/assistant/ContextAssetBrowser";
import { ResourceLink } from "../../../app/features/resource-links/ResourceReferenceView";
import { ResourceReferencesContext } from "../../../app/features/resource-links/ResourceReferencesContext";
import { createResourceReferenceService } from "../../../app/features/resource-links/resourceReferenceService";
import { resolveReferencePdf } from "../../../app/features/resource-links/referencePdfSource";
import { createPreviewResourceCache, resourcePreviewDiagnostics } from "../../../app/features/resource-links/previewResource";
import { createContextCatalogPort } from "../../../app/features/context-picker/catalogPort";
import type { AgentAssetService } from "../../../app/features/resource-filesystem/agentAssetService";
import type { AssistantComposerSuggestion } from "../../../app/features/assistant/assistant.types";

/** Deterministic 101-page PDF with real xref and independently verifiable page markers. */
function testPdf() {
  const objects: string[] = ["<< /Type /Catalog /Pages 2 0 R >>", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  const children: number[] = [];
  for (let page = 1; page <= 101; page++) {
    const id = objects.length + 1; children.push(id);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ${page === 50 || page === 101 ? `/CropBox [20 30 592 762] /Rotate ${page === 50 ? 90 : 270}` : ""} /Resources << /Font << /F1 3 0 R >> >> /Contents ${id + 1} 0 R >>`);
    const content = `BT /F1 32 Tf 70 650 Td (PHYSICAL PAGE ${page}) Tj 0 -60 Td /F1 16 Tf (101 page production source fixture) Tj ET`;
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  }
  objects[1] = `<< /Type /Pages /Kids [${children.map(id => `${id} 0 R`).join(" ")}] /Count 101 >>`;
  let pdf = "%PDF-1.4\n"; const offsets = [0];
  for (let i = 0; i < objects.length; i++) { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`; }
  const xref = pdf.length;
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}
const f = await contextPickerSourceFixture();
for (const page of [50, 101]) {
  const source = f.assets.find(asset => asset.page === page)!;
  const fragment = await f.repository.create({ kind: "content.fragment", title: `区域 ${page}`, sourceRefs: [source.ref!], content: { schema: "liteasy.fragment/v1", payload: { text: "region", partial: true, anchors: [{ type: "pdf", sourceRef: source.ref!, documentHash: f.paper.contentHash, page, quote: { exact: "", prefix: "", suffix: "" }, rects: [{ x: .2, y: page === 101 ? .8 : .3, width: .4, height: .1 }], extractor: "pdf", normalization: "lf-utf16", precision: "exact" }] } } });
  f.suggestions.push({ id: `region-${page}`, label: `区域 ${page}`, trigger: "@", category: "摘录", resourcePath: liteasyPath(f.scope, { kind: "object", ref: refOf(fragment) }) });
}
const counters = { bytes: 0, imageA: 0, imageB: 0, updates: 0 };
const bytes = testPdf();
const byteCache = createPreviewResourceCache<Uint8Array>(3, 64 * 1024 * 1024, bytes => bytes.byteLength);
const service = createResourceReferenceService({ scope: f.scope, active: () => true,
  catalog: () => f.suggestions.map(asset => ({ path: asset.resourcePath!, title: asset.label, kind: "source.document" })),
  assets: { stat: async (path: string) => { const asset = f.suggestions.find(asset => asset.resourcePath === path)!; return { path, title: asset.label, kind: "source.document", revision: "r1", capabilities: [] }; } } as unknown as AgentAssetService,
  async loadPdf(path, signal, intent) {
    const resolved = await resolveReferencePdf({ path, repository: f.repository, papers: [f.paper], signal, intent });
    if (!resolved) return;
    const lease = byteCache.acquire(resolved.target.documentKey, async () => { counters.bytes++; return bytes; }, signal);
    try { return { bytes: await lease.promise, path: resolved.path, page: resolved.page, documentKey: resolved.target.documentKey, target: resolved.target }; }
    finally { lease.release(); }
  },
});
const svg = (color: string) => `data:image/svg+xml;base64,${btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="${color}"/><text x="60" y="240" font-size="64" fill="white">${color}</text></svg>`)}`;
let slow = false;
function imageAsset(id: "imageA" | "imageB"): AssistantComposerSuggestion {
  return { id, label: id === "imageA" ? "实验流程 A" : "实验流程 B", trigger: "@", category: "图片", scopeId: f.scope, resourceRevision: "v1",
    token: { id, kind: "object", label: id, prompt: "" },
    loadPreview: async () => { counters[id]++; if (slow && id === "imageA") await new Promise(resolve => setTimeout(resolve, 1200)); return { text: "", images: [{ url: svg(id === "imageA" ? "navy" : "teal"), label: id }] }; },
  };
}
Object.assign(window, { contextV3: { counters, trace: resourcePreviewDiagnostics, slow: (value: boolean) => { slow = value; } } });
function Fixture() {
  const [open, setOpen] = useState(false), [tick, setTick] = useState(0), [rebuild, setRebuild] = useState(false), [dark, setDark] = useState(false);
  useEffect(() => { if (!rebuild) return; const timer = setInterval(() => { counters.updates++; setTick(value => value + 1); }, 200); return () => clearInterval(timer); }, [rebuild]);
  const assets = [...f.suggestions, imageAsset("imageA"), imageAsset("imageB")];
  const catalog = createContextCatalogPort({ scope: f.scope, revision: `catalog-${tick}`, assets, entries: [...f.catalog.entries.values()], collections: [], relations: [...f.catalog.relations.values()], inventories: { [f.paper.id]: { state: "ready", extraction: "ready", items: [] } } });
  const refs = { service, suggestions: assets, open: () => {}, capture: async () => { throw new Error("not used"); }, picker: { catalog, workspaceId: "v3" } };
  return <FluentProvider theme={dark ? webDarkTheme : webLightTheme} style={{ minHeight: "100vh" }}><ResourceReferencesContext.Provider value={refs}>
    <Button onClick={() => setOpen(true)}>添加上下文</Button><Button onClick={() => setRebuild(value => !value)}>对象重建 {rebuild ? "停止" : "开始"}</Button><Button onClick={() => setDark(value => !value)}>切换主题</Button>
    {f.suggestions.map(asset => <ResourceLink key={asset.id} locator={asset.resourcePath!} intent="origin" presentation="picker" previewOnClick>{asset.id}</ResourceLink>)}
    {open ? <ContextAssetBrowser targetDraftId="v3-evidence" catalogPort={catalog} suggestions={assets} onClose={() => setOpen(false)} onAddContextToken={() => {}} /> : null}
  </ResourceReferencesContext.Provider></FluentProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
