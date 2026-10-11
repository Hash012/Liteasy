import { expect, it } from "vitest";
import { parseAssistantHistory } from "../app/features/assistant/assistantHistoryPersistence";
import { evidenceReportFromAnchors } from "../app/features/evidence/evidenceAdapters";
import { paperAnchorFromEvidence } from "../app/features/paper-anchors/paperAnchorEntity";

it("retains evidence snapshots when saving/reopening and drops only a damaged optional report", () => {
  const report = evidenceReportFromAnchors({ id: "run1", answer: "answer", anchors: [paperAnchorFromEvidence({ id: "e1", paperId: "p1", page: 2, quote: "real quote" })] });
  const snapshot = { version: "liteasy.assistant-history/v1", activeSessionId: "s1", sessions: [{ id: "s1", title: "chat", mode: "qa", messages: [
    { id: "m1", role: "assistant", content: "answer", evidenceReport: report },
    { id: "m2", role: "assistant", content: "old answer", evidenceReport: { schema: "broken" } },
  ] }] };
  const parsed = parseAssistantHistory(JSON.parse(JSON.stringify(snapshot)))!;
  expect(parsed.sessions[0].messages[0].evidenceReport).toEqual(report);
  expect(parsed.sessions[0].messages[1].content).toBe("old answer");
  expect(parsed.sessions[0].messages[1].evidenceReport).toBeUndefined();
});

it("copies actual source snapshots with canonical links without promoting old audit verdicts", async () => {
  const { copyAnswerWithEvidence } = await import("../app/features/evidence/evidenceCopy");
  const anchor = paperAnchorFromEvidence({ id: "e1", paperId: "p1", paperTitle: "Paper [one]", page: 2, quote: "source quote" });
  const text = copyAnswerWithEvidence({ id: "m1", role: "assistant", content: "answer", audit: { model: "fake", score: 0.99, verdict: "pass", rationale: "pass" } }, [anchor], "user:1");
  expect(text).toContain("liteasy://papers/p1?scope=user%3A1");
  expect(text).toContain("source quote");
  expect(text).toContain("未随复制执行逐条核验");
  expect(text).not.toContain("0.99");
});
