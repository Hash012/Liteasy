import { afterEach, expect, test, vi } from "vitest";
import { createSelectionLookupService } from "../app/features/selection-lookup/selectionLookupService";
import { parseDictionaryResult, safeLookupAudioUrl } from "../app/features/selection-lookup/dictionaryParsers";
import { isDictionarySelection, normalizeLookupText, selectionLookupContext } from "../app/features/selection-lookup/selectionLookupText";
import { createSettingsStore } from "../app/features/settings/settings.store";
import type { LookupTransportRequest } from "../app/features/selection-lookup/selectionLookup.types";

const bing = '<div class="qdef"><ul><li><span class="pos">n.</span><span class="def">正则化</span></li></ul></div>';
afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

test("queries a multi-word term as a dictionary entry before using a translation service", async () => {
  const transport = vi.fn(async (_input: LookupTransportRequest) => ({ status: 200, body: bing }));
  const translateAi = vi.fn();
  const service = createSelectionLookupService({ getSettings: () => ({}), transport, translateAi });
  const result = await service.query({ text: "  distribution\n shift  ", context: "A distribution shift occurs." });
  expect(transport).toHaveBeenCalledWith(expect.objectContaining({ config: { provider: "bing" }, text: "distribution shift", sourceLanguage: "en", targetLanguage: "zh" }));
  expect(result).toMatchObject({ kind: "dictionary", senses: [{ partOfSpeech: "n.", definition: "正则化" }] });
  expect(translateAi).not.toHaveBeenCalled();
});

test.each([{ status: 200, body: "<html>not found</html>" }, { status: 404, body: "" }, { status: 503, body: "unavailable" }])(
  "falls back on empty results and HTTP errors while preserving context", async (response) => {
    const translateAi = vi.fn(async () => "分布偏移");
    const service = createSelectionLookupService({ getSettings: () => ({}), transport: vi.fn(async () => response), translateAi });
    const result = await service.query({ text: "distribution shift", context: "We evaluate distribution shift.", paperTitle: "Paper" });
    expect(result).toMatchObject({ kind: "translation", translation: "分布偏移", fallback: true });
    expect(translateAi).toHaveBeenCalledWith(expect.objectContaining({ context: "We evaluate distribution shift.", paperTitle: "Paper" }));
  }
);

test("does not start AI translation when automatic querying has not been confirmed", async () => {
  const translateAi = vi.fn();
  const service = createSelectionLookupService({ getSettings: () => ({}), transport: vi.fn(async () => ({ status: 200, body: "" })), translateAi });
  expect(await service.query({ text: "unknownterm", allowTranslation: false })).toMatchObject({ kind: "missing" });
  expect(await service.query({ text: "A complete sentence with punctuation.", allowTranslation: false })).toMatchObject({ kind: "missing" });
  expect(translateAi).not.toHaveBeenCalled();
});

test("AI lookup sends only the normalized term and language, without dictionary or translation requests", async () => {
  const explainAi = vi.fn(async () => "正则化：限制模型过于复杂，减少过拟合。"), transport = vi.fn(), translateAi = vi.fn();
  const service = createSelectionLookupService({ getSettings: () => ({}), explainAi, transport, translateAi });
  const controller = new AbortController();
  expect(await service.query({ text: " regularization ", mode: "explain", context: "PRIVATE_SENTENCE", paperId: "PRIVATE_ID",
    paperTitle: "PRIVATE_PAPER", systemPrompt: "TRANSLATION_ONLY_PROMPT", signal: controller.signal })).toMatchObject({
      kind: "explanation", sourceLabel: "AI 查词", explanation: "正则化：限制模型过于复杂，减少过拟合。"
    });
  expect(explainAi).toHaveBeenCalledExactlyOnceWith({ text: "regularization", targetLanguage: "zh", signal: controller.signal });
  expect(transport).not.toHaveBeenCalled(); expect(translateAi).not.toHaveBeenCalled();
});

test("cancels without starting a fallback and validates selection size", async () => {
  const abort = new AbortController(), translateAi = vi.fn();
  const transport = vi.fn(async () => { abort.abort(); return { status: 200, body: "" }; });
  const service = createSelectionLookupService({ getSettings: () => ({}), transport, translateAi });
  await expect(service.query({ text: "unknown", signal: abort.signal })).rejects.toThrow();
  expect(translateAi).not.toHaveBeenCalled();
  await expect(service.query({ text: "x".repeat(1001) })).rejects.toThrow("1,000");
  expect(transport).toHaveBeenCalledTimes(1);
});

test("translates with LibreTranslate and uses the latest service settings", async () => {
  const settings = createSettingsStore();
  const transport = vi.fn(async (_input: LookupTransportRequest) => ({ status: 200, body: '{"translatedText":"正则化"}' }));
  settings.apply({ intent: "update_setting", target: "lookup.translation_service", value: "libretranslate" });
  settings.apply({ intent: "update_setting", target: "lookup.libretranslate_endpoint", value: "http://localhost:5000/api" });
  const service = createSelectionLookupService({ getSettings: () => settings.getState(), transport, translateAi: vi.fn() });
  await service.query({ text: "regularization", mode: "translate" });
  expect(transport).toHaveBeenLastCalledWith(expect.objectContaining({ config: { provider: "libretranslate", endpoint: "http://localhost:5000/api" } }));
  settings.apply({ intent: "update_setting", target: "lookup.target_language", value: "ja" });
  await service.query({ text: "regularization", mode: "translate" });
  expect(transport.mock.calls[1][0].targetLanguage).toBe("ja");
});

test("extracts pronunciation and structured definitions without rendering upstream HTML", () => {
  const body = '<div id="phrsListTab"><span class="pronounce">英 <span class="phonetic">[test]</span></span><span class="pronounce">美 <span class="phonetic">[test2]</span></span><div class="trans-container"><ul><li>n. 测试</li><li>v. 检验<script>secret()</script></li></ul></div></div>';
  const result = parseDictionaryResult("youdao", "test & query", body);
  expect(result.senses).toEqual([{ partOfSpeech: "n.", definition: "测试" }, { partOfSpeech: "v.", definition: "检验" }]);
  expect(result.pronunciations[0]).toMatchObject({ label: "英式", phonetic: "[test]", audioUrl: "https://dict.youdao.com/dictvoice?audio=test%20%26%20query&type=1" });
  expect(safeLookupAudioUrl("javascript:alert(1)")).toBeUndefined();
  expect(safeLookupAudioUrl("https://evil.example/test.mp3")).toBeUndefined();
});

test("parses English definitions and keeps examples separate from senses", () => {
  const result = parseDictionaryResult("free-dictionary", "field", JSON.stringify([{ phonetics: [{ text: "/fiːld/", audio: "https://api.dictionaryapi.dev/media/pronunciations/en/field-us.mp3" }],
    meanings: [{ partOfSpeech: "noun", definitions: [{ definition: "An area of study.", example: "A research field." }] }] }]));
  expect(result).toMatchObject({ kind: "dictionary", senses: [{ partOfSpeech: "noun", definition: "An area of study.", example: "A research field." }] });
  expect(result.pronunciations[0].audioUrl).toContain("/media/pronunciations");
});

test("retains definitions when a provider's pronunciation link is malformed", () => {
  const result = parseDictionaryResult("bing", "test", `${bing}<div class="hd_area"><span class="b_primtxt">美 [test]</span><span class="bigaud" data-mp3link="https://[invalid"></span></div>`);
  expect(result.kind).toBe("dictionary");
  expect(result.senses[0].definition).toBe("正则化");
  expect(result.pronunciations[0].audioUrl).toBeUndefined();
});

test("preserves meaningful hyphens and limits context to a surrounding sentence", () => {
  expect(normalizeLookupText("regu\u00ad\nlarization")).toBe("regularization");
  expect(normalizeLookupText("out-of-distribution")).toBe("out-of-distribution");
  expect(isDictionarySelection("out-of-distribution")).toBe(true);
  expect(selectionLookupContext("Earlier sentence. We use regularization here. Next sentence.", "regularization")).toBe("We use regularization here.");
  expect(selectionLookupContext("unknown page", "absent")).toBe("");
});

test("persists lookup preferences without credentials and rejects invalid values", () => {
  const store = createSettingsStore();
  store.apply({ intent: "update_setting", target: "lookup.dictionary_service", value: "youdao" });
  store.apply({ intent: "update_setting", target: "lookup.auto_query", value: true });
  expect(createSettingsStore().getState()).toMatchObject({ "lookup.dictionary_service": "youdao", "lookup.auto_query": true });
  expect(() => store.apply({ intent: "update_setting", target: "lookup.libretranslate_endpoint", value: "https://user:key@server.test" })).toThrow("设置无效");
  expect(() => store.apply({ intent: "update_setting", target: "lookup.target_language", value: "auto" })).toThrow("设置无效");
  expect(JSON.parse(localStorage.getItem("liteasy.selection-lookup.v1")!)).not.toHaveProperty("api_key");
});
