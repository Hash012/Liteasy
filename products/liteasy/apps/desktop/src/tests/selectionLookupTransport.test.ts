import { afterEach, expect, test, vi } from "vitest";
import { deleteLookupKey, hasLookupKey, lookupHttpRequest, lookupResponseLimit, saveLookupKey, selectionLookupTransport } from "../app/features/selection-lookup/selectionLookupTransport";

const native = vi.hoisted(() => ({ enabled: false, invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => native.enabled, invoke: native.invoke }));
afterEach(async () => { native.enabled = false; native.invoke.mockReset(); vi.unstubAllGlobals(); await deleteLookupKey("http://localhost:5000/api"); });

test("encodes selected text into fixed dictionary URLs", () => {
  const text = "word/?key=x#fragment";
  const bing = lookupHttpRequest({ config: { provider: "bing", endpoint: "https://evil.test" }, text, sourceLanguage: "en", targetLanguage: "zh" });
  expect(new URL(bing.url).searchParams.get("q")).toBe(text);
  expect(new URL(bing.url).hostname).toBe("cn.bing.com");
  const youdao = lookupHttpRequest({ config: { provider: "youdao" }, text, sourceLanguage: "en", targetLanguage: "zh" });
  expect(new URL(youdao.url).search).toBe(""); expect(youdao.url).toContain("%2F");
});

test("keeps optional browser credentials in session memory and scopes them to the saved endpoint", async () => {
  await saveLookupKey("http://localhost:5000/api/", "session-test-key");
  const fetch = vi.fn(async () => new Response('{"translatedText":"测试"}'));
  vi.stubGlobal("fetch", fetch);
  await selectionLookupTransport({ config: { provider: "libretranslate", endpoint: "http://localhost:5000/api" }, text: "test", sourceLanguage: "en", targetLanguage: "zh" });
  expect(fetch.mock.calls[0][0]).toBe("http://localhost:5000/api/translate");
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ q: "test", source: "en", target: "zh", format: "text", api_key: "session-test-key" });
  await selectionLookupTransport({ config: { provider: "libretranslate", endpoint: "https://other.test" }, text: "test", sourceLanguage: "en", targetLanguage: "zh" });
  expect(JSON.parse(fetch.mock.calls[1][1].body)).not.toHaveProperty("api_key");
  expect(localStorage.getItem("liteasy.selection-lookup.v1") ?? "").not.toContain("session-test-key");
  await deleteLookupKey("http://localhost:5000/api"); expect(await hasLookupKey("http://localhost:5000/api")).toBe(false);
});

test("native requests cancel through IPC and never pass saved secrets back to the renderer", async () => {
  native.enabled = true;
  let resolve!: (result: unknown) => void;
  native.invoke.mockImplementation((command) => command === "request_selection_lookup" ? new Promise((done) => { resolve = done; }) : Promise.resolve());
  const controller = new AbortController();
  const pending = selectionLookupTransport({ config: { provider: "bing" }, text: "test", sourceLanguage: "en", targetLanguage: "zh", signal: controller.signal });
  const id = native.invoke.mock.calls[0][1].requestId;
  controller.abort(); resolve({ status: 200, body: "late" });
  await expect(pending).rejects.toThrow();
  expect(native.invoke).toHaveBeenCalledWith("cancel_selection_lookup_request", { requestId: id });
  expect(native.invoke.mock.calls[0][1]).not.toHaveProperty("apiKey");
});

test("rejects unsafe endpoints and oversized upstream responses", async () => {
  const fetch = vi.fn(async () => new Response("large", { headers: { "Content-Length": String(lookupResponseLimit + 1) } }));
  vi.stubGlobal("fetch", fetch);
  await expect(selectionLookupTransport({ config: { provider: "libretranslate", endpoint: "https://user:key@server.test" }, text: "test", sourceLanguage: "en", targetLanguage: "zh" })).rejects.toThrow("密钥");
  expect(fetch).not.toHaveBeenCalled();
  await expect(selectionLookupTransport({ config: { provider: "bing" }, text: "test", sourceLanguage: "en", targetLanguage: "zh" })).rejects.toThrow("结果过大");
});
