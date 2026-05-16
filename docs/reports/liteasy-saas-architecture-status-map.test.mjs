import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const targetFile = path.join(__dirname, "liteasy-saas-architecture-status-map-2026-05-16.html");

test("the SaaS architecture status map report exists", () => {
  assert.equal(fs.existsSync(targetFile), true);
});

test("the SaaS architecture status map report includes the required interactive views", () => {
  const html = fs.readFileSync(targetFile, "utf8");

  assert.match(html, /Liteasy SaaS 架构全景/);
  assert.match(html, /产品架构视角/);
  assert.match(html, /工程映射视角/);
  assert.match(html, /OpenClaw/);
  assert.match(html, /Liteasy 与 OpenClaw 的关系/);
  assert.match(html, /已实现/);
  assert.match(html, /部分实现/);
  assert.match(html, /未实现/);
  assert.match(html, /data-node-id=/);
  assert.match(html, /view-toggle/);
  assert.match(html, /status-filter/);
  assert.match(html, /page-tab/);
  assert.match(html, /overflow:\s*hidden/);
  assert.doesNotMatch(html, /这份单文件可视化/);
  assert.doesNotMatch(html, /既展示理想中的 Liteasy SaaS 应该由哪些层构成/);
  assert.doesNotMatch(html, /点击任一节点/);
  assert.doesNotMatch(html, /理想中的/);
  assert.doesNotMatch(html, /理想状态/);
  assert.doesNotMatch(html, /理想 SaaS/);
});
