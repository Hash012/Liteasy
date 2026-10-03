import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createCommunityFixture, deferredFixtureRequest } from "./industrial-community-fixture.mjs";

// Run from any directory after installing Intuecho's dependencies and Chromium:
// node products/intuecho/scripts/industrial-community-browser.mjs
// Optional: LITEASY_PLAYWRIGHT_MODULE, LITEASY_CHROMIUM_EXECUTABLE,
// LITEASY_BROWSER_REPORT_DIR, LITEASY_BROWSER_SCENARIO (scenario-name regex).
// All storage belongs to new disposable browser contexts. Production endpoints
// cannot be selected: the runner always creates its own two loopback origins.
const root = fileURLToPath(new URL("../../..", import.meta.url));
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const sourceCommit = git("rev-parse", "HEAD");
const dirtyPathsBefore = git("status", "--porcelain").split("\n").filter(Boolean);
const webRoot = path.join(root, "products/intuecho/apps/web");
const output = process.env.LITEASY_BROWSER_REPORT_DIR ?? await mkdtemp(path.join(tmpdir(), "liteasy-industrial-browser-"));
await mkdir(output, { recursive: true });
const playwrightPath = process.env.LITEASY_PLAYWRIGHT_MODULE ?? path.join(root, "products/liteasy/apps/desktop/node_modules/playwright/index.mjs");
const { chromium } = await import(pathToFileURL(playwrightPath));
const { createServer } = await import(pathToFileURL(path.join(root, "products/intuecho/node_modules/vite/dist/node/index.js")));
const fixture = await createCommunityFixture();
process.env.VITE_INTUECHO_API_URL = fixture.origin;
process.env.VITE_LITEASY_IDENTITY_URL = fixture.origin;
const vite = await createServer({ root: webRoot, configFile: path.join(webRoot, "vite.config.ts"),
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: null }, logLevel: "error" });
await vite.listen();
const webOrigin = `http://127.0.0.1:${vite.httpServer.address().port}`;
const browser = await chromium.launch({ headless: true,
  ...(process.env.LITEASY_CHROMIUM_EXECUTABLE ? { executablePath: process.env.LITEASY_CHROMIUM_EXECUTABLE } : {}),
  args: ["--disable-background-networking", "--disable-component-update"] });
const results = [];
const blockedRequests = [];
const errors = [];
const activeContexts = [];
const storageKey = "intuecho.auth.development-session.v1";

async function context() {
  const value = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
  activeContexts.push(value);
  await value.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === webOrigin || url.origin === fixture.origin) return route.continue();
    blockedRequests.push(url.origin + url.pathname);
    return route.abort("blockedbyclient");
  });
  await value.addInitScript(({ storageKey, session, webOrigin }) => {
    if (location.origin !== webOrigin) return;
    // Each fresh isolated BrowserContext is seeded once. Reload must preserve
    // logout/revocation and drafts, rather than reintroduce the test session.
    if (!localStorage.getItem("industrial-fixture-seeded")) {
      localStorage.setItem(storageKey, JSON.stringify(session));
      localStorage.setItem("industrial-fixture-seeded", "1");
    }
  }, { storageKey, session: fixture.session, webOrigin });
  await value.tracing.start({ screenshots: true, snapshots: true, sources: true });
  value.on("page", (page) => page.on("pageerror", (error) => errors.push(error.message)));
  return value;
}
async function pageIn(value) {
  const page = await value.newPage();
  page.setDefaultTimeout(12_000);
  await page.goto(webOrigin);
  await page.getByRole("button", { name: "浏览器验收用户 的账户菜单" }).waitFor();
  return page;
}
async function source(page, fn, argument) {
  return page.evaluate(async ({ fn, argument }) => {
    const persistence = await import("/src/communityPersistence.ts");
    const commands = await import("/src/communityCommands.ts");
    const { communityApi } = await import("/src/communityApi.ts");
    const { resolveIdentitySession } = await import("/src/identityClient.ts");
    const owner = persistence.draftOwner(await resolveIdentitySession());
    const input = (body, extra = {}) => ({ body, visibility: "public", shareToPlaza: true,
      targets: [{ kind: "whole_document", literature: { literatureId: "fixture-literature" } }], tags: [], ...extra });
    return (0, eval)(`(${fn})`)({ persistence, commands, communityApi, owner, input }, argument);
  }, { fn: fn.toString(), argument });
}
async function expectCards(page, count) {
  await page.waitForFunction((count) => document.querySelectorAll(".annotation-list .annotation-body").length === count, count);
  const bodies = await page.locator(".annotation-list .annotation-body").allTextContents();
  assert.equal(new Set(bodies).size, count, "Pagination must not duplicate content");
  return bodies;
}
async function scenario(id, task) {
  if (process.env.LITEASY_BROWSER_SCENARIO && !new RegExp(process.env.LITEASY_BROWSER_SCENARIO).test(id)) return;
  const started = Date.now();
  const firstContext = activeContexts.length;
  let timeout;
  try {
    const details = await Promise.race([task(), new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(`Browser scenario ${id} exceeded 60 seconds`)), 60_000);
    })]);
    results.push({ id, status: "pass", durationMs: Date.now() - started, ...details });
    console.log(`PASS ${id}`);
  } catch (error) {
    results.push({ id, status: "fail", durationMs: Date.now() - started, error: error.stack });
    console.error(`FAIL ${id}: ${error.message}`);
    process.exitCode = 1;
  } finally {
    clearTimeout(timeout);
    for (const [index, value] of activeContexts.splice(firstContext).entries()) {
      for (const [pageIndex, page] of value.pages().entries()) {
        await page.screenshot({ path: path.join(output, `${id}-${index}-${pageIndex}.png`) }).catch(() => undefined);
      }
      await value.tracing.stop({ path: path.join(output, `${id}-${index}.zip`) });
      await value.close();
    }
    fixture.state.revoked = false;
    fixture.state.malformedLookup = false;
    fixture.state.missingLookups = false;
    fixture.state.failNextPage = false;
    fixture.state.delayNextPage?.release(); fixture.state.delayNextPage = null;
    fixture.state.holdNextLookup?.release(); fixture.state.holdNextLookup = null;
    fixture.state.holdNextCreate?.release(); fixture.state.holdNextCreate = null;
  }
}

try {
  await scenario("P01-independent-intents-and-cross-tab-locks", async () => {
    const value = await context();
    const first = await pageIn(value);
    const second = await pageIn(value);
    assert.equal(await first.evaluate(() => Boolean(navigator.locks)), true);
    const before = fixture.state.commits;
    fixture.state.loseNextCreate = true;
    const unknown = await source(first, async ({ communityApi, input }) => {
      try { await communityApi.createAnnotation(input("organization A independent intent", { visibility: "organization", shareToPlaza: false, organizationId: "organization-A" }), "11111111-1111-4111-8111-111111111111"); }
      catch (error) { return error.name + ":" + error.message; }
    });
    assert.match(unknown, /待核实/);
    const created = await source(second, async ({ communityApi, input }) => communityApi.createAnnotation(input("organization B independent intent", { visibility: "organization", shareToPlaza: false, organizationId: "organization-B" }), "22222222-2222-4222-8222-222222222222"));
    assert.ok(created.annotation.id);
    const duplicate = await Promise.allSettled([first, second].map((page) => source(page, async ({ communityApi, input }) => communityApi.createAnnotation(input("same cross-tab intent"), "33333333-3333-4333-8333-333333333333"))));
    assert.ok(duplicate.some((result) => result.status === "fulfilled"));
    assert.equal(fixture.state.commits - before, 3);
    assert.equal(fixture.state.events, fixture.state.commits);
    assert.equal(fixture.state.requests.filter((request) => request.method === "POST" && request.body?.command?.operationId === "33333333-3333-4333-8333-333333333333").length, 1,
      "Real cross-tab Web Locks must prevent a second dispatch, independently of fixture idempotency");
    const recovered = await source(first, async ({ persistence, commands, communityApi, owner }) => {
      const original = persistence.commandRecords(owner).find((item) => item.operationId.startsWith("1111"));
      await commands.recoverCommand(owner, original, communityApi.lookupCommand);
      return persistence.commandRecords(owner).find((item) => item.operationId === original.operationId);
    });
    assert.equal(recovered.state, "committed");
    return { realBrowserWebLocks: true, commits: 3, delayedResponseLossRecovered: true };
  });

  await scenario("P02-corruption-isolated-and-exportable", async () => {
    const page = await pageIn(await context());
    const result = await source(page, async ({ persistence, communityApi, owner, input }) => {
      persistence.saveCommand(owner, { operationId: "healthy-command", operationType: "create_annotation", targetId: null,
        bodyDigest: "a".repeat(64), state: "committed", resourceId: "healthy-resource", updatedAt: new Date().toISOString() });
      const key = `intuecho.community.local.v1:${encodeURIComponent(owner)}:command:broken`;
      localStorage.setItem(key, "{preserve this corrupt original");
      const records = persistence.commandRecords(owner);
      const created = await communityApi.createAnnotation(input("healthy send despite damaged neighbor"), "44444444-4444-4444-8444-444444444444");
      return { healthyPresent: records.some((item) => item.operationId === "healthy-command"), created: created.annotation.id,
        originalPreserved: [...Array(localStorage.length)].some((_, index) => localStorage.getItem(localStorage.key(index)).includes("preserve this corrupt original")) };
    });
    assert.equal(result.healthyPresent, true); assert.equal(result.originalPreserved, true); assert.ok(result.created);
    await page.getByRole("button", { name: "空间与操作", exact: true }).click();
    await page.getByRole("button", { name: /导出.*损坏|导出.*隔离|导出.*原始|导出.*记录/ }).first().waitFor();
    await page.getByRole("button", { name: /导出.*损坏|导出.*隔离|导出.*原始|导出.*记录/ }).first().click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "确认导出", exact: true }).click();
    const download = await downloadPromise;
    await download.saveAs(path.join(output, "P02-quarantined-record.json"));
    assert.match(await readFile(path.join(output, "P02-quarantined-record.json"), "utf8"), /preserve this corrupt original/);
    return result;
  });

  await scenario("P04-late-lookup-cannot-regress-committed", async () => {
    const value = await context(); const first = await pageIn(value); const second = await pageIn(value);
    const operation = { operationId: "55555555-5555-4555-8555-555555555555", operationType: "create_annotation", targetId: null,
      bodyDigest: "a".repeat(64), state: "outcome_unknown", updatedAt: new Date().toISOString(), payload: { body: "race" } };
    await source(first, ({ persistence, owner }, operation) => persistence.saveCommand(owner, operation), operation);
    fixture.state.missingLookups = true;
    const hold = deferredFixtureRequest(); fixture.state.holdNextLookup = hold;
    const recovering = source(first, ({ commands, communityApi, owner }, operation) => commands.recoverCommand(owner, operation, communityApi.lookupCommand), operation);
    await hold.started;
    await source(second, ({ persistence, owner }, operation) => persistence.saveCommand(owner, { ...operation, state: "committed", resourceId: "already-created", payload: undefined }), operation);
    hold.release();
    await recovering.catch((error) => assert.match(error.message, /迟到.*忽略|已提交/));
    const result = await source(first, ({ persistence, owner }) => persistence.commandRecords(owner));
    assert.equal(result[0].state, "committed"); assert.equal(result[0].resourceId, "already-created");
    return { conditionalTransitionPreservedCommit: true };
  });

  await scenario("P05-invalid-lookup-stays-unknown", async () => {
    const page = await pageIn(await context()); fixture.state.malformedLookup = true;
    const result = await source(page, async ({ persistence, commands, communityApi, owner }) => {
      const operation = { operationId: "66666666-6666-4666-8666-666666666666", operationType: "create_annotation", targetId: null,
        bodyDigest: "a".repeat(64), state: "outcome_unknown", updatedAt: new Date().toISOString(), payload: { body: "malformed" } };
      persistence.saveCommand(owner, operation);
      let rejected = false;
      try { await commands.recoverCommand(owner, operation, communityApi.lookupCommand); } catch { rejected = true; }
      return { rejected, state: persistence.commandRecords(owner)[0].state };
    });
    assert.equal(result.rejected, true); assert.equal(result.state, "outcome_unknown");
    return result;
  });

  await scenario("M00-delayed-commit-after-tab-close", async () => {
    const value = await context(); const first = await pageIn(value);
    const hold = deferredFixtureRequest(); fixture.state.holdNextCreate = hold;
    const before = fixture.state.commits;
    const sending = source(first, ({ communityApi, input }) => communityApi.createAnnotation(input("Commit after original tab closes"), "88888888-8888-4888-8888-888888888888")).catch(() => undefined);
    await hold.started;
    await first.close(); await sending;
    const second = await pageIn(value);
    await second.getByRole("button", { name: "空间与操作", exact: true }).click();
    await second.getByRole("button", { name: "核实原操作（只读）", exact: true }).click();
    await second.getByRole("status").filter({ hasText: "尚未查到回执" }).waitFor();
    const waiting = await source(second, ({ persistence, owner }) => persistence.commandRecords(owner));
    assert.equal(waiting[0].operationId, "88888888-8888-4888-8888-888888888888");
    assert.equal(waiting[0].state, "prepared"); assert.equal(fixture.state.commits, before);
    assert.equal(fixture.state.requests.filter((request) => request.method === "POST" && request.body?.command?.operationId === waiting[0].operationId).length, 1);
    hold.release();
    await second.getByRole("button", { name: "核实原操作（只读）", exact: true }).click();
    await second.getByRole("button", { name: "打开已创建内容", exact: true }).waitFor();
    const committed = await source(second, ({ persistence, owner }) => persistence.commandRecords(owner));
    assert.equal(committed[0].operationId, waiting[0].operationId); assert.equal(committed[0].state, "committed");
    assert.equal(fixture.state.commits - before, 1);
    return { tabClosedBeforeCommit: true, notFoundRetainedIntentWithoutResend: true, lateCommitRecovered: true };
  });

  await scenario("P03-real-editor-two-drafts-conflict-and-close", async () => {
    const value = await context(); const first = await pageIn(value); const second = await pageIn(value);
    for (const [page, body] of [[first, "Draft A first window"], [second, "Draft B second window"]]) {
      await page.getByRole("button", { name: "发布批注", exact: true }).click();
      await page.getByLabel("批注内容", { exact: true }).fill(body);
      await page.getByRole("status").filter({ hasText: "草稿已保存到此浏览器" }).waitFor();
    }
    const initial = await source(first, ({ persistence, owner }) => persistence.draftRecords(owner, "new-annotation"));
    assert.equal(initial.length, 2); assert.notEqual(initial[0].draftId, initial[1].draftId);
    const original = initial.find((draft) => draft.value.body === "Draft A first window");
    assert.ok(original);
    for (const page of [first, second]) {
      await page.getByRole("combobox", { name: "选择本机草稿", exact: true }).selectOption(original.draftId);
      await page.getByRole("button", { name: "恢复本机草稿", exact: true }).click();
      assert.equal(await page.getByLabel("批注内容", { exact: true }).inputValue(), "Draft A first window");
    }
    await first.getByLabel("批注内容", { exact: true }).fill("Draft A revised in first window");
    await first.getByRole("status").filter({ hasText: "草稿已保存到此浏览器" }).waitFor();
    await second.getByLabel("批注内容", { exact: true }).fill("Draft A competing second window version");
    await second.getByRole("status").filter({ hasText: "独立冲突草稿" }).waitFor();
    const after = await source(first, ({ persistence, owner }) => persistence.draftRecords(owner, "new-annotation"));
    assert.ok(after.some((draft) => draft.value.body === "Draft A revised in first window"));
    assert.ok(after.some((draft) => draft.value.body === "Draft A competing second window version" && draft.conflictOf === original.draftId));
    assert.ok(after.some((draft) => draft.value.body === "Draft B second window"));
    const removed = await source(first, ({ persistence, owner }, original) => persistence.removeDraftRevision(owner, "new-annotation", original), original);
    assert.equal(removed, false, "A completed old revision must not remove newer bytes");
    const third = await pageIn(value);
    await third.getByRole("button", { name: "发布批注", exact: true }).click();
    await third.getByLabel("批注内容", { exact: true }).fill("Recover after page close before debounce");
    await third.close({ runBeforeUnload: true });
    await first.waitForFunction(async () => {
      const persistence = await import("/src/communityPersistence.ts");
      const { resolveIdentitySession } = await import("/src/identityClient.ts");
      return persistence.draftRecords(persistence.draftOwner(await resolveIdentitySession())).some((draft) => draft.value.body === "Recover after page close before debounce");
    });
    return { independentDrafts: 2, conflictVersionsPreserved: true, staleCleanupRejected: true, closeRecovered: true };
  });

  await scenario("M00-real-storage-quota-keeps-editor-bytes", async () => {
    const page = await pageIn(await context());
    await page.getByRole("button", { name: "发布批注", exact: true }).click();
    await page.evaluate(() => {
      // Exhaust this disposable browser context's real origin quota. No Storage
      // method is mocked, and no developer/user profile is opened or cleared.
      for (const size of [1024 * 1024, 65536, 4096, 256]) {
        let index = 0;
        try { while (index < 2000) localStorage.setItem(`quota-fixture-${size}-${index++}`, "x".repeat(size)); }
        catch (error) { if (error.name !== "QuotaExceededError") throw error; }
      }
    });
    await page.getByLabel("批注内容", { exact: true }).fill("Unsaved bytes must remain editable when browser quota is exhausted");
    await page.getByRole("status").filter({ hasText: /草稿尚未保存.*空间不足/ }).waitFor();
    assert.equal(await page.getByLabel("批注内容", { exact: true }).inputValue(), "Unsaved bytes must remain editable when browser quota is exhausted");
    return { realQuotaExceeded: true, editorPreservedUnsavedText: true };
  });

  await scenario("M01-three-pages-retry-back-refresh", async () => {
    const page = await pageIn(await context());
    const offset = fixture.state.requests.length;
    await page.getByRole("button", { name: "最新", exact: true }).click();
    await expectCards(page, 30);
    fixture.state.failNextPage = true;
    await page.getByRole("button", { name: "加载更多批注", exact: true }).click();
    await page.getByRole("button", { name: "重试加载", exact: true }).waitFor();
    await expectCards(page, 30);
    await page.getByRole("button", { name: "重试加载", exact: true }).click();
    await expectCards(page, 60);
    await page.getByRole("button", { name: "加载更多批注", exact: true }).click();
    const all = await expectCards(page, 65);
    assert.equal(all[64], "授权合成批注 65");
    assert.equal(await page.getByRole("button", { name: "加载更多批注", exact: true }).count(), 0);
    await page.getByRole("link", { name: "打开批注详情", exact: true }).last().scrollIntoViewIfNeeded();
    const position = await page.evaluate(() => window.scrollY);
    await page.getByRole("link", { name: "打开批注详情", exact: true }).last().click();
    await page.locator(".annotation-detail .annotation-body").waitFor();
    const beforeBack = fixture.state.requests.length;
    await page.goBack();
    await expectCards(page, 65);
    assert.equal(fixture.state.requests.slice(beforeBack).filter((request) => request.path === "/v1/plaza/page" && request.authenticated).length, 3);
    await page.waitForFunction((position) => Math.abs(window.scrollY - position) < 100, position);
    const beforeReload = fixture.state.requests.length;
    await page.reload();
    await expectCards(page, 65);
    assert.equal(fixture.state.requests.slice(beforeReload).filter((request) => request.path === "/v1/plaza/page" && request.authenticated).length, 3);
    const pages = fixture.state.requests.slice(offset).filter((request) => request.path === "/v1/plaza/page");
    assert.ok(pages.some((request) => request.query.cursor === "fixture-cursor-30"));
    assert.ok(pages.some((request) => request.query.cursor === "fixture-cursor-60"));
    return { records: 65, pages: 3, retryPreservedExistingCards: true, backAndRefreshReauthorized: true };
  });

  await scenario("M01-filter-change-ignores-old-response", async () => {
    const page = await pageIn(await context());
    await page.getByRole("button", { name: "最新", exact: true }).click();
    await expectCards(page, 30);
    const hold = deferredFixtureRequest(); fixture.state.delayNextPage = hold;
    const cancelled = page.waitForEvent("requestfailed", (request) => request.url().includes("cursor=fixture-cursor-30"));
    await page.getByRole("button", { name: "加载更多批注", exact: true }).click();
    await hold.started;
    await page.getByRole("textbox", { name: "检索批注", exact: true }).fill("合成批注 65");
    await page.getByRole("textbox", { name: "检索批注", exact: true }).press("Enter");
    await expectCards(page, 1);
    hold.release();
    await cancelled;
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.deepEqual(await expectCards(page, 1), ["授权合成批注 65"]);
    await page.getByRole("button", { name: /^筛选/ }).click();
    await page.getByLabel("发布者机构", { exact: true }).fill("Synthetic Institute");
    await page.getByLabel("文献类型", { exact: true }).fill("journal");
    await page.getByLabel("发布者学段", { exact: true }).fill("博士");
    const filteredResponse = page.waitForResponse((response) => response.url().includes("institution=Synthetic"));
    await page.getByRole("button", { name: "应用筛选", exact: true }).click();
    await filteredResponse;
    const filtered = fixture.state.requests.filter((request) => request.path === "/v1/plaza").at(-1);
    assert.equal(filtered.query.institution, "Synthetic Institute");
    assert.equal(filtered.query.documentType, "journal"); assert.equal(filtered.query.educationStage, "博士");
    assert.equal(filtered.query.query, "合成批注 65");
    return { staleResponseIgnored: true, allLegacyFiltersPreserved: true };
  });

  await scenario("M01-revocation-clears-authorized-pages", async () => {
    const page = await pageIn(await context());
    await page.getByRole("button", { name: "最新", exact: true }).click();
    await expectCards(page, 30);
    fixture.state.revoked = true;
    await page.getByRole("button", { name: "加载更多批注", exact: true }).click();
    await page.getByRole("dialog").waitFor();
    await expectCards(page, 0);
    assert.equal(await page.locator("body").innerText().then((text) => text.includes("授权合成批注")), false);
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), storageKey), null);
    return { actorInvalidationClearedFeedAndSession: true };
  });

  await scenario("M01-operation-original-and-reauthorized-result", async () => {
    const page = await pageIn(await context()); fixture.state.loseNextCreate = true;
    const before = fixture.state.commits;
    await source(page, async ({ communityApi, input }) => {
      try { await communityApi.createAnnotation(input("Original frozen recovery draft"), "77777777-7777-4777-8777-777777777777"); }
      catch (error) { if (!error.message.includes("待核实")) throw error; }
    });
    await page.getByRole("button", { name: "空间与操作", exact: true }).click();
    await page.getByRole("button", { name: "打开原稿", exact: true }).click();
    await page.getByRole("dialog", { name: "恢复原稿", exact: true }).waitFor();
    assert.equal(await page.getByLabel("批注内容", { exact: true }).count(), 0, "Recovery requires explicit confirmation");
    await page.getByRole("button", { name: "确认恢复原稿", exact: true }).click();
    assert.equal(await page.getByLabel("批注内容", { exact: true }).inputValue(), "Original frozen recovery draft");
    assert.equal(fixture.state.commits - before, 1, "Opening a draft must not submit it");
    await page.getByRole("dialog", { name: "发布批注", exact: true }).getByRole("button", { name: "关闭", exact: true }).click();
    await page.getByRole("button", { name: "核实原操作（只读）", exact: true }).click();
    await page.getByRole("button", { name: "打开已创建内容", exact: true }).waitFor();
    const requestOffset = fixture.state.requests.length;
    await page.getByRole("button", { name: "打开已创建内容", exact: true }).click();
    await page.locator(".annotation-detail .annotation-body").waitFor();
    assert.equal(await page.locator(".annotation-detail .annotation-body").innerText(), "Original frozen recovery draft");
    const authorizedCalls = fixture.state.requests.slice(requestOffset);
    assert.ok(authorizedCalls.some((request) => request.path.includes("/v1/community-commands/") && request.authenticated));
    assert.ok(authorizedCalls.some((request) => request.path.includes("/v1/annotations/") && request.authenticated));
    const created = fixture.state.commands.get("77777777-7777-4777-8777-777777777777");
    fixture.state.hidden.add(created.annotation.id);
    await page.getByRole("button", { name: "空间与操作", exact: true }).click();
    await page.getByRole("button", { name: "打开已创建内容", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "当前内容不可访问" }).waitFor();
    assert.equal(await page.locator(".annotation-body").count(), 0);
    assert.equal((await page.locator("body").innerText()).includes("Original frozen recovery draft"), false);
    assert.equal(fixture.state.commits - before, 1);
    return { originalRequiresConfirmation: true, noImplicitResend: true, resultFreshlyAuthorized: true, withdrawnBodyNotShown: true };
  });
} finally {
  const sourceCommitAfter = git("rev-parse", "HEAD");
  const dirtyPaths = git("status", "--porcelain").split("\n").filter(Boolean);
  const report = { sourceCommit, sourceCommitAfter, dirtyPathsBefore, dirtyPaths,
    cleanUnchangedSource: sourceCommit === sourceCommitAfter && dirtyPathsBefore.length === 0 && dirtyPaths.length === 0,
    runtime: process.version, platform: process.platform, architecture: process.arch, browser: browser.version(),
    method: "Actual Vite React application and unchanged browser source modules in isolated Chromium contexts; actual localStorage and Web Locks, synthetic loopback HTTP API/identity only.",
    limitations: ["Synthetic HTTP server, not PostgreSQL or a real identity provider", "No real accounts or deployed services", "Not native Windows or installer acceptance"],
    blockedRequests, pageErrors: errors, results };
  if (blockedRequests.length || errors.length) process.exitCode = 1;
  await writeFile(path.join(output, "verification.json"), JSON.stringify(report, null, 2) + "\n");
  await writeFile(path.join(output, "requests.json"), JSON.stringify(fixture.state.requests, null, 2) + "\n");
  await browser.close(); await vite.close(); await fixture.close();
  console.log(`Browser evidence: ${output}`);
}
