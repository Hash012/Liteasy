import { expect, test } from "vitest";
import { builtinHelpProviders } from "../app/features/help/builtinHelpProvider";
const provider = builtinHelpProviders[0];
const request = () => ({ locale: "zh-CN", signal: new AbortController().signal });

test("manual preserves legacy routes and fills previously empty topics", async () => {
  const all = await provider.search({ ...request(), query: "" });
  expect(all).toHaveLength(49);
  expect(new Set(all.map((article) => article.id)).size).toBe(all.length);
  expect((await provider.read("getting-started.basics", request()))?.body).toContain("双击");
  expect((await provider.read("reading.chatgpt-review", request()))?.body).toContain("CONTROL_PLANE_API_KEY");
  expect((await provider.search({ ...request(), query: "", topicId: "boards" })).map((article) => article.id))
    .toEqual(["boards.basics", "boards.research"]);
});

test("manual preserves conjunctive search and normalizes full-width queries", async () => {
  const legacy = await provider.search({ ...request(), query: "chatgpt 隧道", topicId: "reading" });
  expect(legacy.map((article) => article.id)).toEqual(["reading.chatgpt-review"]);
  expect(await provider.search({ ...request(), query: "ＭＣＰ" })).not.toHaveLength(0);
  expect(await provider.search({ ...request(), query: "no-such-manual-topic-123" })).toEqual([]);
});

test("all provider methods honor cancellation; missing reads remain null", async () => {
  const abort = new AbortController(); abort.abort();
  const cancelled = { locale: "zh-CN", signal: abort.signal };
  await expect(provider.listTopics(cancelled)).rejects.toThrow();
  await expect(provider.search({ ...cancelled, query: "" })).rejects.toThrow();
  await expect(provider.read("getting-started.basics", cancelled)).rejects.toThrow();
  expect(await provider.read("missing", request())).toBeNull();
});

test("untranslated requests explicitly disclose Simplified Chinese fallback", async () => {
  expect((await provider.read("getting-started.basics", { ...request(), locale: "en-US" }))?.body).toContain("已回退到 zh-CN");
});


test("every manifest article is readable offline and catalog generation stays reproducible", async () => {
  const { execFileSync } = await import("node:child_process");
  const { default: manifest } = await import("../app/features/help/manual/manifest.json");
  execFileSync(process.execPath, ["scripts/generate-manual-catalog.mjs", "--check"], { cwd: process.cwd() });
  const all = await provider.search({ ...request(), query: "" });
  expect(all.map((article) => article.id).sort()).toEqual(manifest.articles.map((article) => article.id).sort());
  for (const entry of all) {
    const article = await provider.read(entry.id, request());
    expect(article?.body.length, entry.id).toBeGreaterThan(100);
    expect(article?.format).toBe("markdown");
  }
  expect((await provider.search({ ...request(), query: "双括号" }))[0].id).toBe("reading.references");
  expect((await provider.read("reading.references", request()))?.body).toContain("[[CicN#L1:3]]");
});
