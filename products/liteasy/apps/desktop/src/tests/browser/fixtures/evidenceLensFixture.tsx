import { FluentProvider, webDarkTheme, webLightTheme } from "@fluentui/react-components";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { EvidenceLens } from "../../../app/features/evidence/components/EvidenceLens";
import { MessageEvidence } from "../../../app/features/evidence/components/MessageEvidence";
import { evidenceReportFromAnchors } from "../../../app/features/evidence/evidenceAdapters";
import { projectEvidenceReport, type EvidenceReportV1 } from "../../../app/features/evidence/evidenceReport";
import { paperAnchorFromEvidence } from "../../../app/features/paper-anchors/paperAnchorEntity";
import type { AssistantMessage } from "../../../app/features/assistant/assistant.types";
import "./evidenceLensFixture.css";

// Test-only synthetic data. This entry is never imported by AppShell or a production entry.
const params = new URLSearchParams(location.search);
const dark = params.get("theme") === "dark";
const longDoi = `10.0000/${"long-doi".repeat(24)}`;
const report: EvidenceReportV1 = {
  schema: "liteasy.evidence-report/v1", id: "fixture-report", runId: "fixture-run", answerRevision: "fixture-answer", generatedAt: "2026-10-11",
  sources: [{ id: "s1", kind: "paper_pdf", title: `测试论文：跨文档证据与边界 ${longDoi}`, coverage: "full_text", revision: "fixture-v1" },
    { id: "s2", kind: "paper_abstract", title: "另一份材料：仅摘要", coverage: "abstract_only", revision: "fixture-v1" }],
  passages: Array.from({ length: 100 }, (_, index) => ({ id: `p${index}`, sourceId: index % 2 ? "s2" : "s1", quote: `摘录 ${index + 1}：实验只能说明这一组样本中的有限结果，不能推广到所有人群。<script>不执行</script>`, locator: { page: index + 1, precision: "page" }, locatorIntegrity: "page_only", sourceRevision: "fixture-v1" })),
  claims: Array.from({ length: 50 }, (_, index) => ({ id: `c${index}`, text: `论断 ${index + 1}：说明实验条件、保留不一致结果与仍未核验的边界。`, kind: "fact", assessment: "unverified", assessmentId: index % 4 ? "fixture-verifier" : undefined,
    edges: [{ passageId: `p${index * 2}`, relation: "direct_support", evaluatorId: "fixture-verifier" }, { passageId: `p${index * 2 + 1}`, relation: index % 3 ? "conditional_support" : "contradicts", evaluatorId: "fixture-verifier" }] })),
  verifications: [{ id: "fixture-verifier", checkerKind: "human", origin: "independent_verifier", status: "completed", checkerIdentity: "测试专用模拟核验记录", evaluatedClaimIds: Array.from({ length: 50 }, (_, i) => `c${i}`), reviewedPassageIds: Array.from({ length: 100 }, (_, i) => `p${i}`), answerRevision: "fixture-answer", runId: "fixture-run" }]
};
const projected = projectEvidenceReport(report, { answerRevision: "fixture-answer", currentRevisions: new Map([["s1", "fixture-v1"], ["s2", "fixture-v1"]]) });
const anchor = paperAnchorFromEvidence({ id: "fixture-evidence", paperId: "fixture-paper", paperTitle: "消息生产入口测试论文", page: 3, quote: "消息入口保存的真实测试摘录。" });
const message: AssistantMessage = { id: "fixture-message", role: "assistant", content: "测试回答，未逐条核验。", paperAnchors: [anchor], evidenceReport: evidenceReportFromAnchors({ id: "fixture-message", answer: "测试回答，未逐条核验。", anchors: [anchor] }) };
function Fixture() {
  const [opened, setOpened] = useState("");
  return <FluentProvider theme={dark ? webDarkTheme : webLightTheme} style={{ minHeight: "100vh" }}>
    <main><h1>证据界面验收</h1><p>固定测试资料：不调用模型或业务服务，不代表真实论文已核验。</p>
      <section className="fixture-answer"><p>正文与证据分层呈现。先看结论，需要时再展开来源、条件和反证。</p>
        {params.get("entry") === "message" ? <MessageEvidence message={message} papers={[{ id: "fixture-paper", title: "消息生产入口测试论文" }]} onOpenCitation={citation => setOpened(`消息原文：${citation.paperId} 第 ${citation.page} 页`)} />
          : <EvidenceLens report={projected} onOpenPassage={passage => setOpened(`原文第 ${passage.locator.page} 页`)} />}
      </section>
      {opened ? <aside aria-label="已打开的来源">{opened}</aside> : null}
    </main>
  </FluentProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
