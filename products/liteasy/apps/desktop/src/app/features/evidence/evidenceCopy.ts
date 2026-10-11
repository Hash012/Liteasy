import type { AssistantMessage } from "../assistant/assistant.types";
import { getAnswerDisplayText } from "../assistant/answerFormatter";
import { formatPaperAnchorText, type PaperAnchorEntity } from "../paper-anchors/paperAnchorEntity";
import { liteasyPath, parseLiteasyPath } from "../resource-filesystem/liteasyPath";
import { evidenceReportFromAnchors } from "./evidenceAdapters";
import { parseEvidenceReport } from "./evidenceReport";
const label = (value: string) => value.replace(/[\\\[\]]/g, character => `\\${character}`).replace(/\r?\n/g, " ");

/** Portable source appendix; never exports an uncalibrated score or a generated assertion of support. */
export function copyAnswerWithEvidence(message: AssistantMessage, anchors: readonly PaperAnchorEntity[], scopeId?: string) {
  const text = formatPaperAnchorText(getAnswerDisplayText(message.content), anchors);
  const report = parseEvidenceReport(message.evidenceReport) ?? evidenceReportFromAnchors({ id: message.id, answer: message.content, anchors });
  const lines = report.sources.flatMap(source => {
    if (source.scopeId && source.scopeId !== scopeId) return [];
    let path = source.resourcePath;
    if (path) {
      try { parseLiteasyPath(path, scopeId ?? "local"); } catch { return []; }
    } else if (source.paperId) path = liteasyPath(scopeId ?? "local", { kind: "paper", paperId: source.paperId });
    const title = path ? `[${label(source.title)}](<${path}>)` : label(source.title);
    const quotes = report.passages.filter(passage => passage.sourceId === source.id).map(passage =>
      `${passage.locator.page ? `第 ${passage.locator.page} 页` : "位置未核对"}\n${passage.quote.split(/\r?\n/).map(line => `> ${line}`).join("\n")}`);
    return [`- ${title}${source.revision || source.documentHash ? ` · 来源版本：${label(source.revision ?? source.documentHash!)}` : " · 来源版本未核对"}`, ...quotes];
  });
  return lines.length ? `${text}\n\n---\n来源快照（未随复制执行逐条核验）\n\n${lines.join("\n\n")}` : text;
}
