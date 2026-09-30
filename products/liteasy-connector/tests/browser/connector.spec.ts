import { test, expect, chromium, type BrowserContext, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { unzipSync, strFromU8 } from "fflate";

let context: BrowserContext;
let extension: string;
let profile: string;
let server: Server;
let origin: string;
let panel: Page;
let article: Page;
const runtimeErrors: string[] = [];
const metadata = {
  translatorID: "cab97186-d3c6-4ac0-abe8-8263cefe388d", translatorType: 4,
  label: "Liteasy test publisher", creator: "Liteasy tests", target: "^http://127\\.0\\.0\\.1:[0-9]+/(paper|search)",
  minVersion: "3.0", priority: 100, inRepository: true, browserSupport: "gcsibv", lastUpdated: "2026-01-01 00:00:00"
};
const translator = JSON.stringify(metadata) + `
function detectWeb(doc, url) { return url.includes('/search') ? 'multiple' : 'journalArticle'; }
function doWeb(doc, url) {
  function save(title, suffix) {
    var item = new Zotero.Item('journalArticle');
    item.title = title;
    item.DOI = '10.1234/liteasy' + suffix;
    item.url = url;
    item.creators = [{firstName:'Ada',lastName:'Lovelace',creatorType:'author'}];
    item.date = '2026';
    item.publicationTitle = 'Fixture Journal';
    item.attachments = [{title:'Full Text PDF',url:new URL('/paper.pdf',url).href,mimeType:'application/pdf'}];
    item.complete();
  }
  if (url.includes('/search')) Zotero.selectItems({'one':'First result','two':'Second result'}, function(selected) {
    if (selected) for (var key in selected) save(selected[key], key);
  });
  else save('A paper about reading', '');
}
`;

test.beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/paper.pdf") { res.setHeader("Content-Type", "application/pdf"); res.end("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n" + "% fixture padding\n".repeat(25000) + "%%EOF"); return; }
    res.setHeader("Content-Type", "text/html;charset=utf-8");
    res.end(`<!doctype html><html><head><title>A paper about reading</title><meta name="citation_title" content="A paper about reading"><meta name="citation_doi" content="10.1234/liteasy"><meta name="citation_author" content="Ada Lovelace"><meta name="citation_pdf_url" content="${origin}/paper.pdf"><style>body{font-family:system-ui;margin:40px;background:#fafafa}h1{color:#123456}</style></head><body><h1>A paper about reading</h1><p>Snapshot text, equations and source metadata.</p><a href="/paper.pdf">Full text</a><script>window.fixtureScript=true</script></body></html>`);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  profile = await mkdtemp(join(tmpdir(), "liteasy-connector-test-"));
  const dist = resolve("dist/chromium");
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium", headless: true,
    ...(process.env.LITEASY_CHROMIUM ? { executablePath: process.env.LITEASY_CHROMIUM } : {}),
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`, "--no-sandbox"],
    viewport: { width: 1100, height: 850 }, acceptDownloads: true
  });
  context.on("page", p => p.on("pageerror", e => runtimeErrors.push(e.message)));
  // Only the publisher and translator repository are fixtures. Chrome APIs,
  // extension CSP, MV3 sandbox, workers and IndexedDB are all real.
  await context.route("https://repo.zotero.org/**", route => {
    const url = route.request().url();
    return route.fulfill({ contentType: "application/json", body: url.includes("/code/") ? translator : url.includes("/metadata") ? JSON.stringify([metadata]) : "{}" });
  });
  await context.route("https://chatgpt.com/**", route => route.fulfill({ contentType: "text/html;charset=utf-8", body: `<!doctype html><html><head><meta charset="utf-8"><title>阅读测试</title></head><body><main><article data-message-author-role="assistant" data-message-id="test-reply-1"><div class="markdown"><h2>事务与恢复</h2><p>读取进度与自己的理解。</p><h2>第二节</h2><p>白板卡片保留来源。</p></div></article></main></body></html>` }));
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  extension = worker.url().split("/")[2];
  await worker.evaluate(async () => { await (globalThis as any).Zotero.initDeferred.promise; await (globalThis as any).Zotero.Translators.init(); });
  // Prime fixture metadata/code in the real upstream cache. Repository access
  // is not a requirement of this deterministic native-extension test.
  await worker.evaluate(async ({ metadata, translator }) => {
    const z = (globalThis as any).Zotero;
    await z.Prefs.set("translatorMetadata", [metadata]);
    await z.Prefs.set("translatorCode_" + metadata.translatorID, translator);
    z.Translators._load([metadata]);
  }, { metadata, translator });
  article = await context.newPage();
  await article.goto(origin + "/paper");
  const tabId = await worker.evaluate(async (url) => (await chrome.tabs.query({ url }))[0].id!, origin + "/paper");
  panel = await context.newPage();
  await panel.goto(`chrome-extension://${extension}/panel.html?tabId=${tabId}`);
});

test.afterAll(async () => {
  await context?.close();
  await new Promise<void>(resolve => server?.close(() => resolve()));
  if (profile) await rm(profile, { recursive: true, force: true });
});

test("native capture preserves translated metadata, offline snapshot, PDF, deduplication and ZIP export", async () => {
  await expect(panel.getByRole("heading", { name: "A paper about reading", exact: true })).toBeVisible();
  await panel.getByLabel("保存到分类", { exact: true }).fill("阅读研究");
  await panel.getByLabel("文献标签", { exact: true }).fill("待读, 方法");
  await panel.getByRole("button", { name: "保存到 Liteasy", exact: true }).click();
  await expect(panel.getByText("已保存 1 条文献。", { exact: true })).toBeVisible({ timeout: 90000 });
  const detail = panel.getByRole("region", { name: "文献详情" });
  await expect(detail.getByText("DOI: 10.1234/liteasy")).toBeVisible();
  await expect(detail.getByRole("button", { name: /网页快照/ })).toBeVisible();
  await expect(detail.getByRole("button", { name: /Full Text PDF|全文 PDF/ })).toBeVisible();
  await panel.getByRole("button", { name: "保存到 Liteasy", exact: true }).click();
  await expect(panel.getByRole("button", { name: "保存到 Liteasy", exact: true })).toBeEnabled({ timeout: 90000 });
  await expect(panel.locator(".reference-row")).toHaveCount(1);
  const download = panel.waitForEvent("download");
  await panel.getByRole("button", { name: "完整归档", exact: true }).click();
  const archive = unzipSync(new Uint8Array(await readFile((await (await download).path())!)));
  const backup = JSON.parse(strFromU8(archive["library.json"]));
  expect(backup.items).toHaveLength(1);
  expect(backup.items[0].collection).toBe("阅读研究");
  expect(backup.items[0].tags).toEqual(["待读", "方法"]);
  expect(backup.items[0].translator).toBe("Liteasy test publisher");
  expect(backup.items[0].item.publicationTitle).toBe("Fixture Journal");
  const html = Object.entries(archive).find(([name]) => name.endsWith(".html"))![1];
  expect(strFromU8(html)).toContain("Snapshot text");
  expect(strFromU8(html)).not.toContain("window.fixtureScript=true");
  expect(Object.keys(archive).some(name => name.endsWith(".pdf"))).toBeTruthy();
  await panel.screenshot({ path: "test-results/library.png", fullPage: true });
});

test("real reading controls persist, annotation preview is safe, and edited Canvas exports round trip", async () => {
  const chat = await context.newPage();
  await chat.goto("https://chatgpt.com/c/liteasy-fixture");
  const read = chat.getByRole("checkbox", { name: "本节已读：事务与恢复" });
  await expect(read).toBeEnabled();
  await read.check();
  await chat.reload();
  await expect(chat.getByRole("checkbox", { name: "本节已读：事务与恢复" })).toBeChecked();
  const reader = await context.newPage();
  await reader.goto(`chrome-extension://${extension}/sidebar.html`);
  await reader.locator("#new-note").click();
  await reader.locator("#note-title").fill("自己的理解");
  await reader.locator("#note-body").fill("## 事务\n\n**保留来源**\n\n<script>window.unsafePreview = true</script>\n\n$E=mc^2$");
  await reader.locator("#save-note").click();
  await expect(reader.locator("#save-status")).toContainText("已保存");
  await reader.locator("#force-preview").click();
  await expect(reader.locator("#preview strong")).toHaveText("保留来源");
  expect(await reader.evaluate(() => (window as any).unsafePreview)).toBeUndefined();
  await reader.locator("#note-to-board").click();
  await expect(reader.getByRole("article", { name: "白板卡片", exact: true })).toHaveCount(1);
  await reader.locator("#wb-files-toggle").click();
  const download = reader.waitForEvent("download");
  await reader.locator("#wb-export").click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.canvas$/);
  const canvas = JSON.parse(await readFile((await file.path())!, "utf8"));
  expect(canvas.nodes[0].text).toContain("保留来源");
  expect(canvas.edges).toEqual([]);
  await reader.reload();
  await reader.getByRole("button", { name: "知识白板", exact: true }).click();
  await expect(reader.getByRole("article", { name: "白板卡片", exact: true })).toHaveCount(1);
  await reader.setViewportSize({ width: 420, height: 850 });
  await reader.locator("#wb-fit").click();
  await reader.screenshot({ path: "test-results/whiteboard-side-panel.png", fullPage: true });
  expect(await reader.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await reader.close(); await chat.close();
});

test("content-script sender cannot invoke library reads and browser surfaces fail clearly", async () => {
  const worker = context.serviceWorkers().find(w => w.url().includes("liteasy-worker"))!;
  const tabId = await worker.evaluate(async url => (await chrome.tabs.query({ url }))[0].id!, origin + "/paper");
  const denied = await worker.evaluate(async id => {
    const result = await chrome.scripting.executeScript({ target: { tabId: id }, func: async () => chrome.runtime.sendMessage({ type: "LITEASY_LIST" }) });
    return result[0].result;
  }, tabId);
  expect(denied.ok).toBe(false);
  const invalid = await panel.evaluate(async () => {
    const tab = await chrome.tabs.create({ url: "chrome://version/", active: false });
    const result = await chrome.runtime.sendMessage({ type: "LITEASY_PAGE_INFO", tabId: tab.id });
    await chrome.tabs.remove(tab.id!);
    return result;
  });
  expect(invalid.ok).toBe(false);
  expect(invalid.error).toContain("网页");
  const transport = await worker.evaluate(async () => {
    try { await (globalThis as any).Zotero.Connector.callMethod("saveItems", { items: [] }); return "unexpected"; }
    catch (e) { return (e as Error).message; }
  });
  expect(transport).toContain("仅保存到 Liteasy");
  expect(runtimeErrors.filter(e => !/Failed to retrieve translators|NetworkError|fetch|Translators|HTTP request|status 0/i.test(e))).toEqual([]);
});

test("multiple-item translator respects selection and cancellation without capturing the result list as a paper", async () => {
  const worker = context.serviceWorkers().find(w => w.url().includes("liteasy-worker"))!;
  const search = await context.newPage();
  await search.goto(origin + "/search");
  const tabId = await worker.evaluate(async url => (await chrome.tabs.query({ url }))[0].id!, origin + "/search");
  const ui = await context.newPage();
  await ui.goto(`chrome-extension://${extension}/panel.html?tabId=${tabId}`);
  const selectorOpened = context.waitForEvent("page", p => p.url().includes("itemSelector"));
  await ui.getByRole("button", { name: "保存到 Liteasy", exact: true }).click();
  const selector = await selectorOpened;
  await selector.getByRole("checkbox", { name: "Second result", exact: true }).check();
  await selector.locator("#ok").click();
  await expect(ui.getByText(/已保存 1 条文献/)).toBeVisible({ timeout: 30000 });
  const entries = await ui.evaluate(async () => (await chrome.runtime.sendMessage({ type: "LITEASY_LIST" })).data);
  const result = entries.find((item: any) => item.item.title === "Second result");
  expect(result).toBeTruthy();
  expect(entries.some((item: any) => item.item.title === "First result")).toBe(false);
  expect(result.attachments.some((item: any) => item.mimeType === "text/html")).toBe(false);
  const cancelOpened = context.waitForEvent("page", p => p.url().includes("itemSelector"));
  await ui.getByRole("button", { name: "保存到 Liteasy", exact: true }).click();
  await (await cancelOpened).locator("#cancel").click();
  await expect(ui.getByRole("button", { name: "保存到 Liteasy", exact: true })).toBeEnabled({ timeout: 30000 });
  await expect(ui.getByText("已取消采集，未保存条目。", { exact: true })).toBeVisible();
  const after = await ui.evaluate(async () => (await chrome.runtime.sendMessage({ type: "LITEASY_LIST" })).data);
  expect(after.length).toBe(entries.length);
  await ui.close(); await search.close();
});

test("the bundled official catalogue translates Highwire metadata without the Zotero rule service", async () => {
  const worker = context.serviceWorkers().find(w => w.url().includes("liteasy-worker"))!;
  const count = await worker.evaluate(async () => {
    const z = (globalThis as any).Zotero;
    const catalogue = await (await fetch(chrome.runtime.getURL("translators/catalogue.json"))).json();
    await z.Prefs.removeAllCachedTranslators();
    await z.Prefs.set("translatorMetadata", catalogue.translators);
    z.Translators._load(catalogue.translators);
    return catalogue.translators.length;
  });
  expect(count).toBeGreaterThan(500);
  await context.route("https://repo.zotero.org/**", route => route.abort());
  const source = await context.newPage();
  await source.goto(origin + "/paper-official");
  const tabId = await worker.evaluate(async url => (await chrome.tabs.query({ url }))[0].id!, origin + "/paper-official");
  const result = await panel.evaluate(async tabId => chrome.tabs.sendMessage(tabId, { type: "LITEASY_COLLECT_PAGE", snapshot: false }), tabId);
  expect(result.ok).toBe(true);
  expect(result.data.translator, JSON.stringify(result)).not.toBe("网页元数据");
  expect(result.data.items[0].DOI).toBe("10.1234/liteasy");
  expect(result.data.items[0].title).toBe("A paper about reading");
  await source.close();
});
