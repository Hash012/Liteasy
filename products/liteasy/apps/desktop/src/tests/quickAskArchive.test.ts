import { resolvePaperIdentity } from "../app/features/paper-identity/paperIdentity";
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { normalizePdfAnnotations, recoverPdfAnnotationPrivateState } from "../../../../packages/reading-core/src/pdfAnnotations";
import { isQuickAskGenerationReceipt } from "../../../../packages/reading-core/src/quickAskValidation";
import { quickAskEvidence } from "../app/features/pdf/QuickAskProvenance";
import { evidenceReportSchema } from "../app/features/evidence/evidenceReport";
const receipt = JSON.parse(readFileSync("../../../../development/test-data/quick-ask/receipt-v1.json", "utf8"));
const annotation = { id: "a", kind: "note", page: 1, excerpt: "Synthetic source only.", text: "速问", rects: [],
  createdAt: "2026-10-13T00:00:00.000Z", updatedAt: "2026-10-13T00:00:00.000Z", paperIdentity: resolvePaperIdentity({ id: "synthetic-paper", title: "Synthetic paper" }),
  revision: 1, publication: { desiredVisibility: "private", state: "not_published" },
  quickAsk: { question: "Explain", answer: "**Synthetic answer**", pageText: "Synthetic source only.", abstractText: "", introductionText: "", receipt } };
test("new receipt and pinned source survive annotation JSON round trip with a single canonical answer", () => {
  expect(isQuickAskGenerationReceipt(receipt)).toBe(true);
  const restored = normalizePdfAnnotations(JSON.parse(JSON.stringify([annotation])));
  expect(restored).toHaveLength(1);
  expect(restored[0].quickAsk).toEqual(annotation.quickAsk);
  expect(JSON.stringify(restored[0].quickAsk?.receipt)).not.toContain("Synthetic answer");
  expect(evidenceReportSchema.safeParse(quickAskEvidence(receipt.context, annotation.quickAsk.answer)).success).toBe(true);
});
test("four-field historical answers retain all text without invented introduction or provenance", () => {
  const { receipt: _receipt, introductionText: _introduction, ...legacy } = annotation.quickAsk;
  const [restored] = normalizePdfAnnotations([{ ...annotation, quickAsk: legacy }]);
  expect(restored.quickAsk).toEqual(legacy);
  expect(restored.quickAsk?.receipt).toBeUndefined();
});
test("invalid and future provenance is rejected by runtime validation", () => {
  for (const change of [{ schema: "future" }, { modelAttempts: 2 }, { terminal: "success" }, { scopeGeneration: -1 }]) expect(isQuickAskGenerationReceipt({ ...receipt, ...change })).toBe(false);
  expect(isQuickAskGenerationReceipt({ ...receipt, context: { ...receipt.context, sourcePages: [0] } })).toBe(false);
  expect(() => recoverPdfAnnotationPrivateState({ version: 100, annotations: [annotation] })).toThrow("不支持");
});
