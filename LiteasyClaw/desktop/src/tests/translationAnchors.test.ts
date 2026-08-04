import { expect, test } from "vitest";
import {
  auditTranslationAnchors,
  buildAnchoredTranslationBatches,
  buildAnchoredTranslationDocument,
  restoreMissingMarkdownImages,
  restoreMissingTranslationImages,
  splitTranslationByAnchor
} from "../app/features/import/translationAnchors";

test("creates deterministic source anchors before a whole-document translation", () => {
  const document = buildAnchoredTranslationDocument([
    { page: 2, paperId: "paper", paperTitle: "Paper", snippet: "second page", summary: "", tags: [], textExtraction: "mineru" },
    { page: 1, paperId: "paper", paperTitle: "Paper", snippet: "first page", summary: "", tags: [], textExtraction: "mineru" }
  ]);

  expect(document.anchors.map((anchor) => anchor.label)).toEqual(["第 1 页", "第 2 页"]);
  expect(document.markedSource).toContain("<!-- liteasy-anchor:segment-001 -->");
  expect(document.markedSource).toContain("<!-- liteasy-anchor:segment-002 -->");
});

test("aligns model output to the source anchors without asking the model to segment it", () => {
  const document = buildAnchoredTranslationDocument([
    { page: 1, paperId: "paper", paperTitle: "Paper", snippet: "source one", summary: "", tags: [], textExtraction: "mineru" },
    { page: 2, paperId: "paper", paperTitle: "Paper", snippet: "source two", summary: "", tags: [], textExtraction: "mineru" }
  ]);
  const aligned = splitTranslationByAnchor(
    "<!-- liteasy-anchor:segment-001 -->\ntranslated one\n<!-- liteasy-anchor:segment-002 -->\ntranslated two",
    document.anchors
  );

  expect(aligned.map((entry) => entry.translated)).toEqual(["translated one", "translated two"]);
});

test("packs complete anchor segments into bounded batches", () => {
  const markedSource = [
    "<!-- liteasy-anchor:segment-001 -->\nsource one",
    "<!-- liteasy-anchor:segment-002 -->\nsource two",
    "<!-- liteasy-anchor:segment-003 -->\nsource three"
  ].join("\n\n");
  const batches = buildAnchoredTranslationBatches(markedSource, 100);

  expect(batches).toHaveLength(2);
  expect(batches.map(({ anchorIds }) => anchorIds)).toEqual([
    ["segment-001", "segment-002"],
    ["segment-003"]
  ]);
  expect(batches.every(({ markedSource: batch }) => batch.length <= 100)).toBe(true);
});

test("audits exact marker spelling, cardinality, order and anchored content", () => {
  const expected = ["segment-001", "segment-002"];
  const valid = auditTranslationAnchors(
    "<!-- liteasy-anchor:segment-001 -->\none\n\n<!-- liteasy-anchor:segment-002 -->\ntwo",
    expected
  );
  const invalid = auditTranslationAnchors(
    "preface\n<!-- liteasy-anchor:segment-002 -->\ntwo\n<!--  liteasy-anchor:segment-001 -->\none\n<!-- liteasy-anchor:segment-002 -->",
    expected
  );

  expect(valid.valid).toBe(true);
  expect(invalid).toMatchObject({
    duplicateIds: ["segment-002"],
    emptyIds: ["segment-002"],
    hasUnanchoredPrefix: true,
    malformedMarkers: ["<!--  liteasy-anchor:segment-001 -->"],
    missingIds: ["segment-001"],
    valid: false
  });
});

test("refuses to split one anchor across model batches", () => {
  expect(() => buildAnchoredTranslationBatches(
    "<!-- liteasy-anchor:segment-001 -->\ncontent exceeding the limit",
    20
  )).toThrow("无法安全拆分");
});

test("restores source-owned Markdown images inside their translation anchors", () => {
  const markedSource = [
    "<!-- liteasy-anchor:segment-001 -->\nSource text\n\n![Architecture](images/architecture.png)",
    "<!-- liteasy-anchor:segment-002 -->\nSecond source"
  ].join("\n\n");
  const translation = [
    "<!-- liteasy-anchor:segment-001 -->\n译文",
    "<!-- liteasy-anchor:segment-002 -->\n第二段"
  ].join("\n\n");

  const restored = restoreMissingTranslationImages(markedSource, translation);

  expect(restored).toContain("<!-- liteasy-anchor:segment-001 -->\n译文\n\n![Architecture](images/architecture.png)");
  expect(restored.match(/images\/architecture\.png/g)).toHaveLength(1);
  expect(restoreMissingMarkdownImages(
    "![Architecture](images/architecture.png)",
    "![架构](images/architecture.png)"
  )).toBe("![架构](images/architecture.png)");
});
