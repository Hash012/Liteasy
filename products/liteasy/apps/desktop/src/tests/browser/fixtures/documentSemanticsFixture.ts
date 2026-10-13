import { compileDocument } from "../../../app/features/document-export/documentCompiler";
import { renderDocumentHtml } from "../../../app/features/document-export/documentHtml";
import { renderDocumentMarkdown } from "../../../app/features/document-export/documentMarkdown";
Object.assign(window, { compilePrintFixture: async (markdown: string) => {
  const document = await compileDocument({ title: "独立离线排版验收", markdown, options: { acceptDegradations: true } });
  return { html: renderDocumentHtml(document), markdown: renderDocumentMarkdown(document), diagnostics: document.diagnostics };
} });
