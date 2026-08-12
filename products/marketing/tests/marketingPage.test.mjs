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
  for (const section of ["hero", "workflow", "evidence", "results", "associations", "intuecho", "waitlist"]) {
    assert.match(html, new RegExp(`data-marketing-section="${section}"`));
  }
  assert.match(html, /role="tablist"[^>]*aria-label="薄读工作流"/);
  assert.match(html, /role="tablist"[^>]*aria-label="薄读多模态呈现"/);
  assert.match(html, /role="tablist"[^>]*aria-label="关联推荐交互"/);
  assert.match(html, /aria-live="polite"/);
});

test("offers the approved five-step researcher workflow", () => {
  for (const label of ["打开文献", "看见核心", "选择深入", "核对依据", "留下理解"]) {
    assert.match(`${html}\n${script}`, new RegExp(label));
  }
  for (const key of ["open", "core", "explore", "verify", "keep"]) {
    assert.match(script, new RegExp(`\\b${key}: \\{`));
  }
});

test("offers Thin Reading's parallel multimodal understanding modes", () => {
  for (const label of ["论文原图", "结构表达", "科学图解", "数学与几何", "过程演示", "视觉重绘"]) {
    assert.match(`${html}\n${script}`, new RegExp(label));
  }
  for (const key of ["sourceFigure", "structure", "science", "math", "process", "illustration"]) {
    assert.match(script, new RegExp(`\\b${key}: \\{`));
  }
  for (const retired of ["关系图", "对比表", "汇报与文档"]) {
    assert.doesNotMatch(`${html}\n${script}`, new RegExp(retired));
  }
});

test("presents association recommendations as a reversible reading interaction", () => {
  for (const label of ["标出概念", "聚焦关联", "打开文献", "逐层返回"]) {
    assert.match(`${html}\n${script}`, new RegExp(label));
  }
  for (const key of ["anchors", "focus", "paper", "return"]) {
    assert.match(script, new RegExp(`\\b${key}: \\{`));
  }
  assert.match(html, /从一个概念，<br \/>走进一片研究/);
  assert.match(html, /相关推荐/);
});

test("ships an accessible Intuecho shared-reading visual", async () => {
  const svg = await readFile(new URL("assets/intuecho-reading-visual.svg", root), "utf8");
  assert.match(svg, /<title[^>]*>[^<]*共享批注/);
  assert.match(svg, /<desc[^>]*>[^<]*文献位置/);
});

test("connects every tab to an existing panel", () => {
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
  const tabs = [...html.matchAll(/<button\s+([^>]*\brole="tab"[^>]*)>/g)].map((match) => match[1]);
  assert.equal(tabs.length, 15);
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
