# Liteasy Evidence-Led Marketing Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update the existing Liteasy static marketing page so it presents evidence-led thin reading, multimodal understanding, exports, and Intuecho shared reading as direct user outcomes while preserving the current visual style and page framework.

**Architecture:** Keep the site as dependency-free static HTML, CSS, JavaScript, and local assets. Add a small Node built-in test suite that locks the public copy and semantic interaction contract, then update the existing sections and data-driven tab interactions in place. Verify the final page with both automated contract tests and a real Chromium session at desktop and mobile sizes.

**Tech Stack:** HTML5, CSS, browser JavaScript, SVG/PNG assets, Node.js 20 `node:test`, Playwright Chromium from the existing desktop development toolchain.

## Global Constraints

- Preserve the existing fixed navigation, full-width screenshot hero, three-value strip, five-step workflow, dark evidence band, tabbed result showcase, Intuecho band, waitlist form, and footer.
- Preserve the paper, deep green, terracotta, serif-heading, monospaced-eyebrow, fine-border, low-shadow, 4-8px-radius visual language.
- Use `Liteasy` as the public product name. Do not use `LiteasyClaw` in rendered marketing copy or accessibility text.
- Use this hero headline verbatim: `先读懂最想知道的，再像研究者一样探索深入。`
- Present only user-visible product results. Do not render development stages, plans, phases, service configuration, model/provider implementation, repository readiness, or production acceptance language.
- Make direct product promises for capabilities Liteasy can deliver: evidence classification, source return, layered exploration, multimodal understanding, exportable results, and Intuecho shared annotations and recommendations.
- Do not invent user counts, coverage rates, uptime, response-time guarantees, or absolute accuracy claims.
- Keep `加入体验计划` as the only primary conversion goal. An unconfigured waitlist endpoint must never report a successful submission.
- Do not add a runtime dependency, framework, bundler, analytics script, external form provider, or product/service implementation change.
- Preserve keyboard-operable tabs, responsive navigation, semantic labels, reduced motion, and non-overlapping text at desktop and mobile widths.

---

## File Map

- Create `products/marketing/package.json`: local `npm test` and `npm run preview` commands with no dependencies.
- Create `products/marketing/tests/marketingPage.test.mjs`: static public-copy, semantic HTML, interaction-data, asset, and waitlist fallback contracts.
- Create `products/marketing/tests/verifyMarketingBrowser.mjs`: real Chromium interaction, overflow, image-load, and screenshot verification.
- Modify `products/marketing/index.html`: public metadata, brand, headline, section copy, evidence categories, result tabs, Intuecho outcomes, trust copy, and footer.
- Modify `products/marketing/app.js`: five workflow states, five result-preview states, accessible tab state changes, navigation state, and truthful waitlist fallback.
- Modify `products/marketing/styles.css`: layout support for the longer headline, evidence-category labels, updated result previews, Intuecho visual, and responsive constraints.
- Create `products/marketing/assets/intuecho-reading-visual.svg`: current shared-reading outcome visual using the existing illustration language.
- Modify `products/marketing/assets/thin-reading-visual.svg`: user-question-led thin-reading wording if retained by a result preview.
- Modify `products/marketing/README.md`: repeatable test, preview, waitlist, and browser-verification commands.

---

### Task 1: Lock And Implement The Public Product Narrative

**Files:**
- Create: `products/marketing/package.json`
- Create: `products/marketing/tests/marketingPage.test.mjs`
- Modify: `products/marketing/index.html:1-264`
- Modify: `products/marketing/README.md:1-17`

**Interfaces:**
- Consumes: the approved public-message constraints in `docs/superpowers/specs/2026-08-12-liteasy-marketing-evidence-led-thin-reading-design.md`.
- Produces: stable `data-marketing-section` markers for `hero`, `workflow`, `evidence`, `results`, `intuecho`, and `waitlist`; tab IDs consumed by `app.js`; `npm test` as the marketing verification entry point.

- [ ] **Step 1: Add the dependency-free marketing scripts**

Create `products/marketing/package.json`:

```json
{
  "name": "liteasy-marketing",
  "private": true,
  "scripts": {
    "preview": "python3 -m http.server 8080 --bind 127.0.0.1",
    "test": "node --test tests/*.test.mjs",
    "verify:browser": "node tests/verifyMarketingBrowser.mjs"
  }
}
```

- [ ] **Step 2: Write the failing public-copy and semantic contract tests**

Create `products/marketing/tests/marketingPage.test.mjs` with Node built-ins only:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const html = await readFile(new URL("index.html", root), "utf8");
const script = await readFile(new URL("app.js", root), "utf8");

test("publishes the Liteasy evidence-led thin-reading promise", () => {
  assert.match(html, /<title>Liteasy \|/);
  assert.match(html, /先读懂最想知道的，再像研究者一样探索深入。/);
  assert.match(html, /来自论文/);
  assert.match(html, /来自外部来源/);
  assert.match(html, /AI 独立理解/);
});

test("keeps development language and the retired brand out of public copy", () => {
  const renderedCopy = `${html}\n${script}`;
  for (const forbidden of [
    "LiteasyClaw",
    "正在构建",
    "未来计划",
    "WHAT COMES NEXT",
    "可用模型能力",
    "生产环境已验收"
  ]) {
    assert.doesNotMatch(renderedCopy, new RegExp(forbidden));
  }
});

test("keeps one conversion goal and truthful fallback status", () => {
  assert.ok((html.match(/href="#waitlist"/g) ?? []).length >= 2);
  assert.match(html, /data-waitlist-form/);
  assert.match(script, /体验申请入口尚未开放/);
  assert.doesNotMatch(script, /提交成功|申请成功/);
});

test("declares the preserved semantic page framework", () => {
  for (const section of ["hero", "workflow", "evidence", "results", "intuecho", "waitlist"]) {
    assert.match(html, new RegExp(`data-marketing-section="${section}"`));
  }
  assert.match(html, /role="tablist"[^>]*aria-label="薄读工作流"/);
  assert.match(html, /role="tablist"[^>]*aria-label="理解方式预览"/);
  assert.match(html, /aria-live="polite"/);
});
```

- [ ] **Step 3: Run the tests and verify the expected failure**

Run from `products/marketing`:

```bash
npm test
```

Expected: FAIL because the old page still contains `LiteasyClaw`, the old headline, future-plan copy, and lacks the three evidence labels and new section markers.

- [ ] **Step 4: Rewrite the HTML around direct user outcomes**

Update `index.html` without changing section order. Use these exact public anchors and labels:

```html
<title>Liteasy | 先读懂最想知道的，再像研究者一样探索深入</title>
<section id="top" class="hero" data-marketing-section="hero" aria-labelledby="hero-title">
  <p class="eyebrow light">LITEASY / EVIDENCE-LED READING</p>
  <h1 id="hero-title">先读懂最想知道的，<br />再像研究者一样探索深入。</h1>
  <p class="hero-copy">
    Liteasy 从你最想知道的内容开始，带你沿着词句、证据与关联文献继续探索，
    并让每一步理解都能辨明依据。
  </p>
</section>
```

Use the three proof headings `抓住主线`, `辨明依据`, and `让理解生长`. Mark the preserved primary sections with `data-marketing-section`. Replace the evidence band with visible text labels `来自论文`, `来自外部来源`, and `AI 独立理解`. Replace the old frontier copy with an Intuecho section headed `阅读不是一个人的孤岛。` that directly promises position-linked shared annotations and relevant discussion recommendations. Keep the waitlist fields unchanged, change trust bullets to local-reading boundaries and user-controlled sharing, and change the footer promise to `让理解有依据，也能继续生长。`.

- [ ] **Step 5: Update README commands and boundaries**

Document:

```bash
cd products/marketing && npm test
cd products/marketing && npm run preview
```

State that the page has no runtime dependencies, the configured `window.LITEASY_WAITLIST_URL` is the real submission target, and the unconfigured state remains a truthful unavailable message.

- [ ] **Step 6: Run the contract test and verify green**

Run:

```bash
npm test
```

Expected: all public-copy, semantic-framework, and waitlist fallback tests pass.

- [ ] **Step 7: Commit the narrative update**

```bash
git add -- products/marketing/package.json products/marketing/tests/marketingPage.test.mjs products/marketing/index.html products/marketing/README.md
git commit -m "feat: update Liteasy marketing narrative"
```

---

### Task 2: Update The Workflow, Result Previews, And Shared-Reading Visual

**Files:**
- Modify: `products/marketing/tests/marketingPage.test.mjs`
- Modify: `products/marketing/app.js:1-170`
- Modify: `products/marketing/index.html:82-205`
- Modify: `products/marketing/styles.css:80-229`
- Create: `products/marketing/assets/intuecho-reading-visual.svg`
- Modify: `products/marketing/assets/thin-reading-visual.svg`

**Interfaces:**
- Consumes: tab buttons with `data-step` and `data-result`, shared tab panels, and `data-workflow-*` / `data-result-*` targets from Task 1.
- Produces: `workflowData` keys `open`, `core`, `explore`, `verify`, `keep`; `resultData` keys `thin`, `graph`, `visual`, `compare`, `document`; a self-contained shared-reading SVG with semantic title and description.

- [ ] **Step 1: Extend tests for the five-step and five-result contracts**

Append:

```js
test("offers the approved five-step researcher workflow", () => {
  for (const label of ["打开文献", "看见核心", "选择深入", "核对依据", "留下理解"]) {
    assert.match(`${html}\n${script}`, new RegExp(label));
  }
  for (const key of ["open", "core", "explore", "verify", "keep"]) {
    assert.match(script, new RegExp(`\\b${key}: \\{`));
  }
});

test("offers five user-facing understanding results", () => {
  for (const label of ["薄读", "关系图", "图表与示意", "对比表", "汇报与文档"]) {
    assert.match(`${html}\n${script}`, new RegExp(label));
  }
  for (const key of ["thin", "graph", "visual", "compare", "document"]) {
    assert.match(script, new RegExp(`\\b${key}: \\{`));
  }
});

test("ships an accessible Intuecho shared-reading visual", async () => {
  const svg = await readFile(new URL("assets/intuecho-reading-visual.svg", root), "utf8");
  assert.match(svg, /<title[^>]*>[^<]*共享批注/);
  assert.match(svg, /<desc[^>]*>[^<]*文献位置/);
});
```

- [ ] **Step 2: Run the focused test and verify red**

Run:

```bash
npm test -- --test-name-pattern="five-step|five user-facing|Intuecho"
```

Expected: FAIL because the old data keys, result types, and shared-reading asset remain.

- [ ] **Step 3: Replace workflow data and tab bindings**

Use this exact state shape in `app.js`:

```js
const workflowData = {
  open: { number: "01 / 05", title: "打开文献", copy: "把当前真正想理解的文献带进桌面阅读工作台。" },
  core: { number: "02 / 05", title: "看见核心", copy: "从你最想知道的内容开始，建立对论文主线的第一层理解。" },
  explore: { number: "03 / 05", title: "选择深入", copy: "选中词句或尚未展开的板块，沿着问题进入下一层。" },
  verify: { number: "04 / 05", title: "核对依据", copy: "辨认内容依据，并回到相关原文位置核对上下文。" },
  keep: { number: "05 / 05", title: "留下理解", copy: "批注、整理、导出或分享这一轮阅读形成的理解。" }
};
```

Rename artifact-facing selectors and labels to result-facing names where doing so improves clarity, but retain the generic tab update function and its Arrow key behavior. On activation, update `aria-selected`, `aria-labelledby`, title, copy, use case, preview class, markup, and preview `aria-label` together.

- [ ] **Step 4: Implement five result previews**

Define `resultData` with:

```js
const resultData = {
  thin: {
    kicker: "从问题开始",
    title: "薄读",
    copy: "先读懂你最想知道的，再沿词句、板块和关联线索逐层探索。",
    use: "适合：快速进入一篇复杂文献",
    className: "result-thin-preview",
    ariaLabel: "从用户问题逐层深入的薄读预览"
  },
  graph: {
    kicker: "看见联系",
    title: "关系图",
    copy: "把当前内容与概念、证据和相关文献之间的联系放在同一视野中。",
    use: "适合：追踪概念与研究脉络",
    className: "result-graph-preview",
    ariaLabel: "概念、证据和相关文献关系图预览"
  },
  visual: {
    kicker: "换一种方式理解",
    title: "图表与示意",
    copy: "用结构图、公式、图表或过程演示，把复杂内容变成可以观察和操作的解释。",
    use: "适合：理解结构、数量与过程",
    className: "result-visual-preview",
    ariaLabel: "图表、公式和过程示意预览"
  },
  compare: {
    kicker: "并列判断",
    title: "对比表",
    copy: "把多篇文献的研究对象、方法、证据和结论放在同一视野中比较。",
    use: "适合：综述与方案比较",
    className: "result-compare-preview",
    ariaLabel: "多篇文献对比表预览"
  },
  document: {
    kicker: "带走这一轮理解",
    title: "汇报与文档",
    copy: "把阅读结果整理为汇报结构或可继续编辑、保存的文档。",
    use: "适合：组会、课堂与研究记录",
    className: "result-document-preview",
    ariaLabel: "汇报结构与可编辑文档预览"
  }
};
```

Add these `markup` fields to the matching entries:

```js
thin: {
  markup: `
    <div class="thin-toolbar"><span>薄读</span><span>从你的问题开始</span></div>
    <p>为什么这项方法能在更少计算量下保留关键关系？</p>
    <div class="thin-tokens"><span>查看方法依据</span><span>理解实验结果</span><span>继续探索局限</span></div>`
},
graph: {
  markup: `<img class="result-visual" src="assets/map-visual.svg" alt="当前问题与概念、证据和相关文献组成的关系图" />`
},
visual: {
  markup: `
    <div class="visual-explanation" aria-hidden="true">
      <div class="visual-formula">输入 <span>→</span> 关系提取 <span>→</span> 证据核对</div>
      <div class="visual-bars"><span style="--value: 42%"></span><span style="--value: 68%"></span><span style="--value: 84%"></span></div>
    </div>
    <p class="preview-caption">结构、数量与过程在同一解释中相互对应</p>`
},
compare: {
  markup: `
    <table class="comparison-preview">
      <caption class="sr-only">三篇示例文献的方法与证据对比</caption>
      <thead><tr><th>文献</th><th>研究重点</th><th>证据</th></tr></thead>
      <tbody><tr><th>A</th><td>效率</td><td>消融实验</td></tr><tr><th>B</th><td>表达能力</td><td>基准测试</td></tr><tr><th>C</th><td>可解释性</td><td>案例分析</td></tr></tbody>
    </table>`
},
document: {
  markup: `
    <div class="document-preview">
      <p class="document-preview__eyebrow">LITEASY / READING NOTES</p>
      <h4>研究问题与当前判断</h4>
      <p>整理核心理解、依据、关联文献与下一步问题。</p>
      <div class="document-preview__lines"><span></span><span></span><span></span></div>
      <p class="document-preview__formats">DOCX · PDF · Markdown</p>
    </div>`
}
```

Merge each snippet into its full object rather than declaring duplicate keys. Avoid nested cards and keep all preview content explicitly illustrative.

- [ ] **Step 5: Create the Intuecho shared-reading SVG**

Create `assets/intuecho-reading-visual.svg` with:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 420" role="img" aria-labelledby="title desc">
  <title id="title">Intuecho 共享批注</title>
  <desc id="desc">共享批注与讨论关联到当前文献位置，并连接到其他读者的理解路径。</desc>
  <rect width="720" height="420" fill="#ecf0ea" />
  <rect x="54" y="44" width="270" height="332" rx="5" fill="#fffdf8" stroke="#b9c9c0" />
  <text x="82" y="78" fill="#2f6a58" font-family="IBM Plex Mono, monospace" font-size="11">CURRENT READING</text>
  <text x="82" y="116" fill="#18201d" font-family="Noto Serif SC, serif" font-size="22" font-weight="600">当前阅读位置</text>
  <path d="M82 148H288M82 174H274M82 200H288M82 226H248M82 278H288M82 304H266" stroke="#c8d2cb" stroke-width="4" />
  <rect x="78" y="239" width="218" height="28" rx="3" fill="#f4dcd6" />
  <circle cx="324" cy="253" r="7" fill="#c85b45" />
  <path d="M331 253C380 253 382 112 430 112M331 253H430M331 253C380 253 382 338 430 338" fill="none" stroke="#719080" stroke-width="2" />
  <g font-family="Noto Sans SC, sans-serif">
    <rect x="430" y="70" width="230" height="84" rx="5" fill="#fffdf8" stroke="#9eb0a7" />
    <text x="452" y="98" fill="#c85b45" font-size="11" font-weight="700">共享批注</text>
    <text x="452" y="126" fill="#18201d" font-size="15">另一位读者补充了适用前提</text>
    <rect x="430" y="211" width="230" height="84" rx="5" fill="#fffdf8" stroke="#9eb0a7" />
    <text x="452" y="239" fill="#2f6a58" font-size="11" font-weight="700">相关讨论</text>
    <text x="452" y="267" fill="#18201d" font-size="15">围绕同一证据继续核对与讨论</text>
    <rect x="430" y="316" width="230" height="48" rx="5" fill="#dce9e1" stroke="#9eb0a7" />
    <text x="452" y="346" fill="#18201d" font-size="15">另一条理解路径</text>
  </g>
</svg>
```

Do not add a status badge or roadmap wording to the asset.

- [ ] **Step 6: Update styles without replacing the design system**

Add focused selectors for `.evidence-types`, `.evidence-type`, `.result-*`, and `.intuecho-*` while preserving the current variables. Use a three-column `.evidence-types` grid above 760px and a one-column stack below it. Keep `.result-preview` at `min-height: 420px` on desktop and `min-height: 320px` below 760px. Give `.comparison-preview` `width: 100%` and collapsed borders; render `.visual-bars span` with `height: var(--value)` inside a fixed-height flex container. Let `.result-tab` wrap with `white-space: normal` and `min-width: max-content` only inside the existing horizontally scrollable mobile tablist. At the mobile breakpoint set the hero title to `font-size: clamp(38px, 12vw, 52px)` and keep `letter-spacing: 0`.

- [ ] **Step 7: Run the complete marketing tests**

Run:

```bash
npm test
```

Expected: all narrative, semantics, workflow, result, asset, and form tests pass.

- [ ] **Step 8: Commit interaction and visual updates**

```bash
git add -- products/marketing/index.html products/marketing/app.js products/marketing/styles.css products/marketing/assets/intuecho-reading-visual.svg products/marketing/assets/thin-reading-visual.svg products/marketing/tests/marketingPage.test.mjs
git commit -m "feat: present evidence-led Liteasy outcomes"
```

---

### Task 3: Verify Real Browser Behavior And Responsive Presentation

**Files:**
- Modify: `products/marketing/tests/marketingPage.test.mjs`
- Create: `products/marketing/tests/verifyMarketingBrowser.mjs`
- Modify: `products/marketing/styles.css`
- Modify: `products/marketing/app.js`
- Modify: `products/marketing/README.md`
- Evidence only, do not commit: `/tmp/liteasy-marketing-desktop.png`, `/tmp/liteasy-marketing-mobile.png`

**Interfaces:**
- Consumes: the static server started from `products/marketing`, DOM markers from Tasks 1-2, and Chromium available through `products/liteasy/apps/desktop` development dependencies.
- Produces: verified click/keyboard/mobile-navigation/form behavior and desktop/mobile screenshots with no overlap or blank media.

- [ ] **Step 1: Add final static accessibility invariants**

Append these static tests:

```js
test("connects every tab to an existing panel", () => {
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
  const tabs = [...html.matchAll(/<button\s+([^>]*\brole="tab"[^>]*)>/g)].map((match) => match[1]);
  assert.equal(tabs.length, 10);
  const tabIds = tabs.map((attributes) => attributes.match(/\bid="([^"]+)"/)?.[1]);
  assert.equal(new Set(tabIds).size, tabs.length);
  for (const attributes of tabs) {
    const controls = attributes.match(/\baria-controls="([^"]+)"/)?.[1];
    assert.ok(controls && ids.has(controls));
    assert.match(attributes, /\baria-selected="(?:true|false)"/);
  }
});

test("declares an accessible mobile navigation toggle", () => {
  assert.match(html, /<button[^>]*aria-expanded="false"[^>]*aria-controls="site-nav"[^>]*data-menu-toggle/);
});

test("gives every marketing SVG a title and description", async () => {
  for (const file of ["map-visual.svg", "tree-visual.svg", "thin-reading-visual.svg", "intuecho-reading-visual.svg"]) {
    const svg = await readFile(new URL(`assets/${file}`, root), "utf8");
    assert.match(svg, /<title\b[^>]*>[^<]+<\/title>/);
    assert.match(svg, /<desc\b[^>]*>[^<]+<\/desc>/);
  }
});
```

- [ ] **Step 2: Run tests before any final repair**

Run:

```bash
npm test
```

Expected: PASS unless the implementation omitted an accessibility relation. If it fails, confirm the failure names the missing relationship before changing production files.

- [ ] **Step 3: Start the marketing server**

Run from `products/marketing` and keep the process active:

```bash
npm run preview
```

Expected: the page is available at `http://127.0.0.1:8080`.

- [ ] **Step 4: Run a real Chromium interaction and layout check**

Create `products/marketing/tests/verifyMarketingBrowser.mjs` with this exact module import and flow:

```js
import assert from "node:assert/strict";
import { chromium } from "../../liteasy/apps/desktop/node_modules/playwright/index.mjs";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://127.0.0.1:8080", { waitUntil: "networkidle" });
await page.getByRole("tab", { name: "核对依据" }).click();
assert.equal(await page.locator("[data-workflow-title]").textContent(), "核对依据");
await page.getByRole("tab", { name: "关系图" }).focus();
await page.getByRole("tab", { name: "关系图" }).press("ArrowRight");
assert.equal(await page.locator("[data-result-title]").textContent(), "图表与示意");
await page.locator("[data-waitlist-form]").evaluate((form) => form.requestSubmit());
await page.getByText("体验申请入口尚未开放").waitFor();
assert.equal(await page.locator("img").evaluateAll((images) => images.every((image) => image.complete && image.naturalWidth > 0)), true);
await page.screenshot({ path: "/tmp/liteasy-marketing-desktop.png", fullPage: true });

await page.setViewportSize({ width: 390, height: 844 });
await page.reload({ waitUntil: "networkidle" });
await page.locator("[data-menu-toggle]").click();
await page.getByRole("link", { name: "加入体验计划" }).first().click();
assert.equal(await page.locator("[data-menu-toggle]").getAttribute("aria-expanded"), "false");
await page.screenshot({ path: "/tmp/liteasy-marketing-mobile.png", fullPage: true });

const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
if (overflow > 1) throw new Error(`horizontal overflow: ${overflow}px`);
await browser.close();
```

Expected: the script exits 0, keyboard navigation changes the active result, the fallback message is truthful, the mobile menu opens and closes, and horizontal overflow is at most 1px.

Run it from `products/marketing`:

```bash
npm run verify:browser
```

- [ ] **Step 5: Inspect screenshots and page pixels**

Open both screenshots and verify:

- the hero is nonblank and the product screenshot remains visible behind readable text;
- the next section is hinted in the first viewport at 1440x900 and 390x844;
- the three evidence labels are legible and not color-only;
- result previews and the Intuecho SVG are visible, framed, and not cropped;
- no headings, tabs, buttons, labels, or form fields overlap;
- mobile navigation does not cover or trap access to page content.

If any check fails, make the smallest CSS or interaction correction, rerun `npm test`, rerun the browser script, and replace the `/tmp` screenshots.

- [ ] **Step 6: Update README with the browser verification recipe**

Document that screenshots are verification output in `/tmp` and must not be committed. Keep the normal user preview URL as `http://127.0.0.1:8080`.

- [ ] **Step 7: Run final verification**

Run:

```bash
cd products/marketing && npm test
git diff --check -- products/marketing
```

Then rerun the real Chromium script from Step 4. Expected: all tests pass, `git diff --check` is clean, Chromium exits 0, and both screenshots reflect the final files.

- [ ] **Step 8: Commit the verified responsive page**

```bash
git add -- products/marketing
git commit -m "test: verify Liteasy marketing experience"
```

Do not stage `/tmp` screenshots or unrelated worktree changes.
