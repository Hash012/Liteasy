import { test } from "vitest";
import assert from "node:assert/strict";
import { checkCatalogs, generateMessageTypes, readFlatCatalog } from "../../scripts/check-i18n.mjs";

test("Chinese additions do not require updating other language catalogs", () => {
  const zh = { title: "标题", added: "已添加 {{count}} 项" };
  const en = { title: "Title" };
  assert.equal(checkCatalogs({ "en-US": en, "zh-CN": zh }).missingTranslations["en-US"], 1);
  assert.match(generateMessageTypes(zh), /"added": \{ "count": number \}/);
  assert.deepEqual(en, { title: "Title" });
});
test("optional translations still validate keys and interpolation parameters", () => {
  assert.throws(() => checkCatalogs({ "zh-CN": { title: "{{name}}" }, "en-US": { typo: "Title" } }), /unknown key/);
  assert.throws(() => checkCatalogs({ "zh-CN": { title: "{{name}}" }, "en-US": { title: "{{count}}" } }), /placeholder mismatch/);
});
test("plural translations may be absent, but cannot be partly translated", () => {
  const zh = { items: "{{count}} 项", items_one: "{{count}} 项", items_other: "{{count}} 项" };
  assert.equal(checkCatalogs({ "zh-CN": zh, "en-US": {} }).missingTranslations["en-US"], 3);
  assert.throws(() => checkCatalogs({ "zh-CN": zh, "en-US": { items_one: "{{count}} item" } }), /incomplete plural/);
  assert.throws(() => checkCatalogs({ "zh-CN": zh, "en-US": { items: "{{count}} items" } }), /incomplete plural/);
});
test("catalogs reject duplicates, empty strings and unsafe interpolation", () => {
  for (const invalid of ['{"title":"a","title":"b"}', '{"title":""}', '{"title":"<img>"}', '{"title":"{{- html}}"}']) {
    assert.throws(() => readFlatCatalog(invalid));
  }
});
