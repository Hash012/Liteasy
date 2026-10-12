import { invoke } from "@tauri-apps/api/core";
import { compileDocument } from "./app/features/document-export/documentCompiler";
import { renderExportDocument } from "./app/features/document-export/documentExportService";
import { sha256, type DocumentFormat } from "./app/features/document-export/documentExport.types";
import type { AgentAssetService } from "./app/features/resource-filesystem/agentAssetService";

async function run() {
  const source = await invoke<{ markdown: string; title: string; format: DocumentFormat }>("document_export_cli_source");
  const assets = { async resolveImages(_path: string, options: { relativePath?: string } = {}) {
    if (!options.relativePath) throw new Error("CLI images require a relative path within the source directory");
    return [await invoke<{ base64: string; mediaType: string }>("document_export_cli_image", { relative: options.relativePath })];
  } } as AgentAssetService;
  const document = await compileDocument({ title: source.title, markdown: source.markdown, assets, basePath: "liteasy://cli/source",
    sources: [{ identity: "explicit-local-file", state: "pinned", sha256: await sha256(source.markdown) }] });
  // CLI has no interactive degradation consent. Missing resources/unsupported math fail explicitly.
  const input = await renderExportDocument(document, source.format);
  await invoke("document_export_cli_complete", { input, error: null });
}
void run().catch(error => { void invoke("document_export_cli_complete", { input: null, error: error instanceof Error ? error.message : String(error) }); });
