import { createRoot } from "react-dom/client";
import { useState } from "react";
import { ApplicationThemeProvider } from "../../../app/features/theme/ApplicationThemeProvider";
import { DocumentExportDialog } from "../../../app/features/document-export/DocumentExportDialog";
import { compileDocument } from "../../../app/features/document-export/documentCompiler";
import { ExportPdfPreview } from "../../../app/features/document-export/ExportPdfPreview";
import type { ArtifactExportPayload } from "../../../app/features/artifacts/artifactExport.types";
import "../../../app/styles/app.css";
import "../../../app/features/theme/appearance.css";
// Offline, deterministic PDFs with real xref tables. These never touch a user library.
function pdf(marker: string): ArtifactExportPayload {
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Count 10 /Kids [${Array.from({ length: 10 }, (_, i) => `${4 + i * 2} 0 R`).join(" ")}] >>`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  for (let i = 0; i < 10; i++) {
    const stream = `BT /F1 32 Tf 50 720 Td (${marker}_PAGE_${i + 1}) Tj ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  let content = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, i) => { offsets.push(content.length); content += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = content.length;
  content += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return { title: marker, artifactId: marker, format: "pdf", contentEncoding: "base64", fileName: `${marker}.pdf`, content: btoa(content) };
}
const a = pdf("SOURCE_A"), b = pdf("SOURCE_B");
function Fixture() {
  const [payload, setPayload] = useState(a);
  const [hidden, setHidden] = useState(false);
  const [dialog, setDialog] = useState(false);
  return <ApplicationThemeProvider><main style={{ height: "90vh", padding: 16 }}><button onClick={() => setDialog(true)}>打开导出对话框</button>{dialog ? <DocumentExportDialog open title="用于验证布局的长标题：离线合成研究资料" sourceIdentity="offline-layout" jobScope="isolated-browser-fixture" initialFormat="pdf" compile={(options, signal) => compileDocument({ title: "合成报告", markdown: "# 合成报告\n\n结构预览保留正文。\n\n第二段用于检查导出选项与操作区域。", options, signal })} publish={async () => { throw new Error("browser PDF must use printing"); }} onClose={() => setDialog(false)} onOutcome={() => undefined} /> : null}<button onClick={() => setPayload(a)}>来源 A</button><button onClick={() => setPayload(b)}>来源 B</button><button onClick={() => setPayload({ ...a, content: btoa("invalid-pdf") })}>损坏 PDF</button><button onClick={() => setHidden(value => !value)}>切换预览区域</button><p>独立离线合成 PDF；同一预览实例。</p><div style={{ height: "75vh", display: hidden ? "none" : "block" }}><ExportPdfPreview payload={payload} /></div></main></ApplicationThemeProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
