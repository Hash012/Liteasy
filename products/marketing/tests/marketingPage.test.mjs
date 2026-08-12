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
