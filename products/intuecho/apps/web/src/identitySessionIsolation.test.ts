import { afterEach, beforeEach, expect, test, vi } from "vitest";

const sessionFor = (id: string) => ({ audience: "intuecho-web", email: `${id}@example.test`, expiresAt: "2099-01-01T00:00:00Z", name: id, sessionId: `token-${id}`, userId: id });
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

function identityFetch() {
  return vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url).endsWith("/v1/identity/web-config")) return response({}, 404);
    const email = JSON.parse(String(init?.body ?? "{}")).email;
    return response({ session: sessionFor(email === "b@example.test" ? "b" : "a") });
  });
}

test("an old rejection cannot erase a newer development identity but a current 401 does", async () => {
  vi.stubGlobal("fetch", identityFetch());
  const { developmentIdentity } = await import("./developmentIdentity");
  const identity = await import("./identityClient");
  await developmentIdentity.login("a@example.test", "synthetic password");
  const a = await identity.resolveIdentitySession();
  const generation = identity.getIdentitySessionGeneration();
  await developmentIdentity.login("b@example.test", "synthetic password");
  const notify = vi.fn();
  identity.setAuthRequiredHandler(notify);
  await identity.clearRejectedIdentitySession(a!, generation);
  expect(developmentIdentity.read()?.userId).toBe("b");
  expect(notify).not.toHaveBeenCalled();
  const b = await identity.resolveIdentitySession();
  await identity.clearRejectedIdentitySession(b!);
  expect(developmentIdentity.read()).toBeNull();
  expect(notify).toHaveBeenCalledOnce();
});

test.each([200, 401])("a real client isolates the old account's late %s response", async (status) => {
  const fetchMock = identityFetch();
  vi.stubGlobal("fetch", fetchMock);
  const { developmentIdentity } = await import("./developmentIdentity");
  const identity = await import("./identityClient");
  const { communityApi } = await import("./communityApi");
  await developmentIdentity.login("a@example.test", "synthetic password");
  await identity.resolveIdentitySession();
  let finish!: (response: Response) => void;
  fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }));
  const request = communityApi.myAnnotations();
  await vi.waitFor(() => expect(finish).toBeDefined());
  await developmentIdentity.login("b@example.test", "synthetic password");
  finish(response({ annotations: [{ body: "A private content" }] }, status));
  await expect(request).rejects.toThrow("账号会话已变化");
  expect(developmentIdentity.read()?.userId).toBe("b");
});


test("an offline development validation preserves the stored identity", async () => {
  const fetchMock = identityFetch();
  vi.stubGlobal("fetch", fetchMock);
  const { developmentIdentity } = await import("./developmentIdentity");
  await developmentIdentity.login("a@example.test", "synthetic password");
  fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  await expect(developmentIdentity.restore()).rejects.toThrow("Failed to fetch");
  expect(developmentIdentity.read()?.userId).toBe("a");
});
