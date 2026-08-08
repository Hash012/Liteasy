import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";

const endpoint = process.env.LITEASY_TAURI_CDP_ENDPOINT ?? "http://127.0.0.1:9223";
const evidenceDirectory = path.resolve(
  process.env.LITEASY_ACCEPTANCE_EVIDENCE_DIR ??
    path.join(os.tmpdir(), `liteasy-windows-library-ui-${Date.now()}`)
);
const fixturePath = path.resolve(
  process.env.LITEASY_ACCEPTANCE_PDF ??
    "src/tests/assets/papers/attention-is-all-you-need.pdf"
);
fs.mkdirSync(evidenceDirectory, { recursive: true });

const browser = await chromium.connectOverCDP(endpoint);
const page = browser.contexts().flatMap((context) => context.pages())[0];
if (!page) throw new Error("No WebView2 page is attached to the Tauri process.");

const runId = Date.now().toString(36);
const rootName = `Windows验收-${runId}`;
const childName = `子目录-${runId}`;
const pdfName = `windows-import-${runId}.pdf`;

await page.getByRole("button", { name: "新建本地目录" }).click();
const rootDialog = page.getByRole("dialog", { name: "新建目录" });
await rootDialog.getByLabel("目录名称").fill(rootName);
await rootDialog.getByRole("button", { name: "创建" }).click();
await rootDialog.waitFor({ state: "hidden" });
await page.getByText(`已新建目录“${rootName}”。`).waitFor();

await page.getByRole("button", { name: rootName, exact: true }).click({ button: "right" });
await page.getByRole("menuitem", { name: "新建子目录" }).click();
const childDialog = page.getByRole("dialog", { name: "新建目录" });
await childDialog.getByLabel("目录名称").fill(childName);
await childDialog.getByRole("button", { name: "创建" }).click();
await childDialog.waitFor({ state: "hidden" });
await page.getByText(`已在“${rootName}”中新建目录“${childName}”。`).waitFor();

const pdfInput = page.locator('section[aria-label="本地文献库"] input[type="file"]').first();
await pdfInput.setInputFiles({
  buffer: fs.readFileSync(fixturePath),
  mimeType: "application/pdf",
  name: pdfName
});
await page.getByText("已导入 1 个 PDF。").waitFor({ timeout: 20_000 });

const snapshot = await page.evaluate(() =>
  window.__TAURI_INTERNALS__.invoke("load_local_library_snapshot")
);
const root = snapshot.folders.find((folder) => folder.name === rootName);
const child = snapshot.folders.find((folder) => folder.name === childName);
const imported = snapshot.entries.find((entry) => entry.relativePath === pdfName);
assert.ok(root, "The root folder was not persisted in the native library snapshot.");
assert.equal(child?.parentPath, root.path, "The child folder was not persisted below the root folder.");
assert.ok(imported, "The imported PDF was not persisted in the native library snapshot.");

await page.screenshot({
  fullPage: true,
  path: path.join(evidenceDirectory, "library-ui.png")
});
const evidence = {
  childFolder: child,
  collectionState: await page.locator('section[aria-label="收藏"]').innerText(),
  importedDocument: imported,
  rootFolder: root,
  testedAt: new Date().toISOString(),
  url: page.url()
};
fs.writeFileSync(
  path.join(evidenceDirectory, "library-ui.json"),
  `${JSON.stringify(evidence, null, 2)}\n`
);
process.stdout.write(`${JSON.stringify({ evidenceDirectory, ...evidence }, null, 2)}\n`);
await browser.close();
