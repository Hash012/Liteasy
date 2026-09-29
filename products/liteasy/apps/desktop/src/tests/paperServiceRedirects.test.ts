import { afterEach, expect, test, vi } from "vitest";
import { deletePaperServiceKey, paperServiceRequest, savePaperServiceKey } from "../app/features/paper-services/paperServiceTransport";

const native = vi.hoisted(() => ({ enabled: false, invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => native.enabled, invoke: native.invoke }));
const config = { provider: "crossref" as const, endpoint: "https://publisher.example" };
const options = { authenticate: false, followPublicRedirects: true, maxResponseBytes: 1024 };
afterEach(async () => {
  native.enabled = false;
  native.invoke.mockReset();
  await deletePaperServiceKey(config);
  vi.unstubAllGlobals();
});

test("follows inspectable HTTPS redirects with no provider credentials, cookies or referrer", async () => {
  await savePaperServiceKey(config, "private-provider-key");
  const fetch = vi.fn(async (url: URL, init?: RequestInit) => {
    expect(init).toMatchObject({ method: "GET", redirect: "manual", credentials: "omit", referrerPolicy: "no-referrer" });
    expect(init?.headers).toBeUndefined();
    expect(url.href).not.toContain("private-provider-key");
    return url.hostname === "publisher.example"
      ? new Response(null, { status: 302, headers: { Location: "https://cdn.example/paper.pdf" } })
      : new Response("%PDF-1.7\nbody");
  });
  vi.stubGlobal("fetch", fetch);
  const result = await paperServiceRequest(config, `${config.endpoint}/paper`, options);
  expect(await result.text()).toBe("%PDF-1.7\nbody");
  expect(result.url).toBe("https://cdn.example/paper.pdf");
  expect(fetch).toHaveBeenCalledTimes(2);
});

test.each(["http://cdn.example/paper.pdf", "http://127.0.0.1/paper.pdf", "https://user:password@cdn.example/paper.pdf"])("rejects unsafe redirects before sending a second request: %s", async (location) => {
  const fetch = vi.fn(async () => new Response(null, { status: 302, headers: { Location: location } }));
  vi.stubGlobal("fetch", fetch);
  await expect(paperServiceRequest(config, `${config.endpoint}/paper`, options)).rejects.toThrow("HTTPS");
  expect(fetch).toHaveBeenCalledOnce();
});

test("blocks redirect loops and browser redirects whose destination is hidden", async () => {
  const fetch = vi.fn(async () => new Response(null, { status: 302, headers: { Location: "/paper" } }));
  vi.stubGlobal("fetch", fetch);
  await expect(paperServiceRequest(config, `${config.endpoint}/paper`, options)).rejects.toThrow("次数过多");
  expect(fetch).toHaveBeenCalledTimes(6);
  fetch.mockClear();
  fetch.mockImplementation(async () => Object.defineProperty(new Response(null, { status: 302 }), "type", { value: "opaqueredirect" }));
  await expect(paperServiceRequest(config, `${config.endpoint}/paper`, options)).rejects.toThrow("桌面端");
  expect(fetch).toHaveBeenCalledOnce();
});

test("cannot enable public redirects for authenticated requests or uploads", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  for (const request of [{ followPublicRedirects: true }, { ...options, authenticate: true },
    { ...options, method: "POST" as const }, { ...options, body: new Uint8Array([1]) }, { ...options, json: { secret: "value" } }]) {
    await expect(paperServiceRequest(config, `${config.endpoint}/paper`, request)).rejects.toThrow(/凭据|GET/);
  }
  expect(fetch).not.toHaveBeenCalled();
  expect(native.invoke).not.toHaveBeenCalled();
});

test("passes the public-download policy to Rust and preserves its final response URL", async () => {
  native.enabled = true;
  native.invoke.mockResolvedValue({ status: 200, bodyBase64: btoa("%PDF-1.7"), finalUrl: "https://cdn.example/final.pdf" });
  const result = await paperServiceRequest(config, `${config.endpoint}/paper`, options);
  expect(native.invoke).toHaveBeenCalledWith("request_paper_service", expect.objectContaining({
    authenticate: false, followPublicRedirects: true, bodyBase64: null, method: "GET", maxResponseBytes: 1024
  }));
  expect(result.url).toBe("https://cdn.example/final.pdf");
  expect(await result.text()).toBe("%PDF-1.7");
  await expect(paperServiceRequest(config, `${config.endpoint}/paper`, { ...options, authenticate: true })).rejects.toThrow("凭据");
  expect(native.invoke).toHaveBeenCalledOnce();
});

test("enforces the response-byte budget after a safe redirect", async () => {
  const fetch = vi.fn(async (url: URL) => url.pathname === "/paper"
    ? new Response(null, { status: 302, headers: { Location: "/final.pdf" } })
    : new Response("%PDF-" + "x".repeat(1100)));
  vi.stubGlobal("fetch", fetch);
  await expect(paperServiceRequest(config, `${config.endpoint}/paper`, options)).rejects.toThrow("大小限制");
});
