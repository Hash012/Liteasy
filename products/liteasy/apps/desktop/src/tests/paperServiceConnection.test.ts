import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { testPaperServiceConnection } from "../app/features/paper-services/paperServiceConnection";
import { deletePaperServiceKey, savePaperServiceKey } from "../app/features/paper-services/paperServiceTransport";

const native = vi.hoisted(() => ({ enabled: false, invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => native.enabled, invoke: native.invoke }));
const doi = "10.1038/nature14539";
const providers = [
  { provider: "crossref", endpoint: "https://api.crossref.org", path: `/works/${encodeURIComponent(doi)}` },
  { provider: "openalex", endpoint: "https://api.openalex.org", path: `/works/${encodeURIComponent(`https://doi.org/${doi}`)}` },
  { provider: "semantic-scholar", endpoint: "https://api.semanticscholar.org/graph/v1", path: `/paper/${encodeURIComponent(`DOI:${doi}`)}` }
] as const;
function payload(provider: string, otherDoi = doi) {
  return provider === "crossref" ? { message: { title: ["Deep learning"], DOI: otherDoi } }
    : provider === "openalex" ? { display_name: "Deep learning", doi: `https://doi.org/${otherDoi}` }
    : { title: "Deep learning", externalIds: { DOI: otherDoi } };
}
beforeEach(() => { native.enabled = false; native.invoke.mockReset(); });
afterEach(async () => {
  native.enabled = false;
  for (const config of providers) await deletePaperServiceKey(config);
  vi.unstubAllGlobals(); vi.restoreAllMocks();
});

for (const config of providers) {
  test.each([false, true])(`${config.provider} tests the fixed public DOI using stored credentials when configured: %s`, async (saved) => {
    if (saved) await savePaperServiceKey(config, "service-private-key");
    const fetch = vi.fn(async (url: URL, init?: RequestInit) => {
      expect(url.origin + url.pathname).toBe(config.endpoint + config.path);
      expect(init).toMatchObject({ method: "GET", credentials: "omit", referrerPolicy: "no-referrer", redirect: "error", body: undefined });
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      const headers = new Headers(init?.headers);
      expect(headers.get("Authorization")).toBeNull();
      expect(headers.get("Crossref-Plus-API-Token")).toBe(saved && config.provider === "crossref" ? "Bearer service-private-key" : null);
      expect(headers.get("x-api-key")).toBe(saved && config.provider === "semantic-scholar" ? "service-private-key" : null);
      expect(url.searchParams.get("api_key")).toBe(saved && config.provider === "openalex" ? "service-private-key" : null);
      expect(url.searchParams.get("fields")).toBe(config.provider === "semantic-scholar" ? "title,externalIds" : null);
      return Response.json(payload(config.provider));
    });
    vi.stubGlobal("fetch", fetch);
    await expect(testPaperServiceConnection(config, new AbortController().signal)).resolves.toEqual({ title: "Deep learning" });
    expect(fetch).toHaveBeenCalledOnce();
    expect(JSON.stringify(localStorage)).not.toContain("service-private-key");
  });
}

test.each([
  [401, "服务未接受当前密钥"], [403, "服务拒绝了本次访问"], [429, "服务请求额度已用尽"],
  [404, "请检查服务类型"], [500, "暂时不可用"]
])("explains HTTP %s without exposing a raw response or credential", async (status, message) => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("upstream secret-key: private-stack", { status })));
  await expect(testPaperServiceConnection(providers[0])).rejects.toThrow(String(message));
});

test.each([new TypeError("Failed to fetch https://service?api_key=secret"), "native failure at secret endpoint"])("replaces transport failures with a useful network explanation", async (error) => {
  vi.stubGlobal("fetch", vi.fn(async () => { throw error; }));
  await expect(testPaperServiceConnection(providers[0])).rejects.toThrow("无法连接文献服务。请检查网络、代理和 API 地址后重试。");
});

test("explains native and browser timeouts", async () => {
  for (const error of [new DOMException("expired", "TimeoutError"), "request timed out"]) {
    vi.stubGlobal("fetch", vi.fn(async () => { throw error; }));
    await expect(testPaperServiceConnection(providers[0])).rejects.toThrow("连接测试超时");
  }
});

test("rejects HTML success pages, unrelated papers and invalid addresses", async () => {
  for (const response of [new Response("<html>Login</html>"), Response.json(payload("crossref", "10.1234/unrelated")), Response.json({})]) {
    vi.stubGlobal("fetch", vi.fn(async () => response));
    await expect(testPaperServiceConnection(providers[0])).rejects.toThrow(/服务返回的内容不是文献题录|未返回预期的测试论文/);
  }
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  for (const endpoint of ["invalid", "https://api.crossref.org?api_key=secret", "http://api.crossref.org"]) {
    await expect(testPaperServiceConnection({ ...providers[0], endpoint })).rejects.toThrow("服务地址无效");
  }
  expect(fetch).not.toHaveBeenCalled();
});

test("native tests use the existing authenticated task and cancel it when configuration changes", async () => {
  native.enabled = true;
  let complete!: (value: unknown) => void;
  native.invoke.mockImplementation((command) => command === "request_paper_service_task"
    ? new Promise((resolve) => { complete = resolve; }) : Promise.resolve());
  const abort = new AbortController();
  const task = testPaperServiceConnection({ provider: providers[2].provider, endpoint: providers[2].endpoint }, abort.signal);
  expect(native.invoke).toHaveBeenCalledWith("request_paper_service_task", {
    requestId: expect.any(String), input: {
      config: { provider: "semantic-scholar", endpoint: providers[2].endpoint },
      url: `${providers[2].endpoint}${providers[2].path}?fields=title%2CexternalIds`, method: "GET",
      authenticate: true, bodyBase64: null, contentType: null, timeoutMs: 15_000, maxResponseBytes: 256 * 1024
    }
  });
  abort.abort();
  expect(native.invoke).toHaveBeenCalledWith("cancel_public_document", { requestId: native.invoke.mock.calls[0][1].requestId });
  complete({ status: 200, bodyBase64: btoa(JSON.stringify(payload("semantic-scholar"))) });
  await expect(task).rejects.toMatchObject({ name: "AbortError" });
});
