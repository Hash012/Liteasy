import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";

const paperCss = readFileSync(resolve(process.cwd(), "src/app/features/import/paperResource.css"), "utf8");
const thinReadingCss = readFileSync(resolve(process.cwd(), "src/app/features/thin-reading/thinReading.css"), "utf8");

test("uses full-width max-content paper resource rows without the old 1040px nested cards", () => {
  expect(paperCss).toContain("align-content: start;");
  expect(paperCss).toContain("grid-auto-rows: max-content;");
  expect(paperCss).not.toContain("max-width: 1040px");
  expect(paperCss).toContain("border-radius: 0;");
});

test("bounds MinerU and ACORN images without forcing them to fill their columns", () => {
  expect(paperCss).toMatch(/\.mineru-markdown__image\s*\{[^}]*max-width: min\(100%, 720px\);[^}]*width: auto;/);
  expect(paperCss).toMatch(/\.paper-resource-tab__multimodal-page figure img\s*\{[^}]*max-width: min\(100%, 720px\);[^}]*width: auto;/);
  expect(thinReadingCss).toMatch(/\.thin-reading__figure-media img\s*\{[^}]*max-width: min\(100%, 720px\);[^}]*width: auto;/);
});

test("keeps Markdown prose on a readable measure inside the full-width resource", () => {
  expect(paperCss).toMatch(/\.mineru-markdown\s*\{[^}]*max-width: 780px;[^}]*min-width: 0;[^}]*width: 100%;/);
  expect(paperCss).toMatch(/\.paper-resource-tab__multimodal-page\s*\{[^}]*max-width: 100%;[^}]*min-width: 0;[^}]*width: 100%;/);
  expect(paperCss).toMatch(/\.paper-resource-tab__multimodal-page > \*\s*\{[^}]*max-width: 100%;[^}]*min-width: 0;/);
});
