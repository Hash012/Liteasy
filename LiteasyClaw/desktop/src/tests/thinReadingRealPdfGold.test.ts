import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, test } from "vitest";
import { evaluateThinReadingGoldCase, evaluateThinReadingSuite } from "../app/features/thin-reading/thinReadingEvaluation";
import { thinReadingRealPdfGoldFixtures } from "./fixtures/thinReadingRealPdfGoldFixtures";

function normalizeText(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    // PDF.js may split a glyph-run inside a word (for example, "ob jective").
    // Provenance checks compare page text, so ignore visual spacing and punctuation here.
    .replace(/[\p{P}\p{S}\s]+/gu, "");
}

async function extractPageText(sourcePath: string, pageNumber: number) {
  const data = new Uint8Array(await readFile(sourcePath));
  const document = await pdfjsLib.getDocument({
    data,
    standardFontDataUrl: `${resolve(process.cwd(), "node_modules/pdfjs-dist/standard_fonts")}/`
  }).promise;
  try {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    return content.items
      .flatMap((item) => "str" in item && typeof item.str === "string" ? [item.str] : [])
      .join(" ");
  } finally {
    await document.destroy();
  }
}

describe("thinReadingRealPdfGold", () => {
  test("keeps a diverse real PDF-backed evaluation set", () => {
    expect(thinReadingRealPdfGoldFixtures.length).toBeGreaterThanOrEqual(12);
    expect(thinReadingRealPdfGoldFixtures.filter(({ gold }) => gold.stage === "branch")).toHaveLength(3);
    expect(thinReadingRealPdfGoldFixtures.filter(({ gold }) => gold.stage === "branch" && gold.targetLanguage === "zh-CN"))
      .toHaveLength(1);
    const paperTypes = new Set(thinReadingRealPdfGoldFixtures.map(({ gold }) => gold.paperType));
    expect(paperTypes.has("benchmark")).toBe(true);
    expect(paperTypes.has("dataset")).toBe(true);
    expect(paperTypes.has("humanities")).toBe(true);
  });

  test("anchors each curated gold span to its checked-in public PDF", async () => {
    for (const fixture of thinReadingRealPdfGoldFixtures) {
      const sourcePath = resolve(process.cwd(), fixture.source.relativePath);
      const bytes = await readFile(sourcePath);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(fixture.source.sha256);

      const evidence = fixture.gold.requiredEvidence?.[0];
      expect(evidence).toBeDefined();
      const pageText = await extractPageText(sourcePath, evidence!.page);
      expect(normalizeText(pageText)).toContain(normalizeText(evidence!.quote));
    }
  }, 30_000);

  test("passes the PDF-backed suite and rejects a span moved to the wrong page", () => {
    const suite = evaluateThinReadingSuite(thinReadingRealPdfGoldFixtures);
    expect(suite.passed).toBe(true);
    expect(suite.averageScore).toBeGreaterThanOrEqual(0.9);

    const fixture = thinReadingRealPdfGoldFixtures[0];
    const candidate = {
      ...fixture.candidate,
      evidence: {
        ...fixture.candidate.evidence,
        paperEvidenceSpans: fixture.candidate.evidence.paperEvidenceSpans?.map((span) => ({
          ...span,
          page: span.page! + 1
        }))
      }
    };
    const report = evaluateThinReadingGoldCase({ candidate, gold: fixture.gold });
    expect(report.metrics.evidenceGrounding.score).toBe(0);
    expect(report.issues).toContainEqual(expect.objectContaining({
      code: "evidence_grounding_below_threshold"
    }));
  });
});
