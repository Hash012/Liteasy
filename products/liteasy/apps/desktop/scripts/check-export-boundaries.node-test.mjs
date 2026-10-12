import { test } from "node:test";
import assert from "node:assert/strict";
import { exportBoundaryViolations } from "./check-export-boundaries.mjs";
const path = "src/app/features/document-export/documentHtml.ts";
test("gate rejects unsafe export imports, scripts, network and live DOM", () => {
  for (const source of ['import parser from "remark-parse";', 'import playwright from "playwright";', 'fetch("https://remote");', 'document.querySelector(".body").textContent;', 'eval(body);', 'import {createCompatibilityImagePdf} from "../artifacts/artifactDocumentExport";']) assert.ok(exportBoundaryViolations(path, source).length, source);
});
test("gate permits registered IR rendering, authorized asset ports and semantic local scientific bitmaps", () => {
  assert.deepEqual(exportBoundaryViolations(path, 'import {parseResearchDocument} from "../markdown/researchParser"; const x = node.type; assets.resolveImages(path); canvas.getContext("2d");'), []);
});
test("format serializers cannot branch on asset types", () => {
  assert.ok(exportBoundaryViolations(path, 'if(tab.type === "thin_reading"){}').length);
});
