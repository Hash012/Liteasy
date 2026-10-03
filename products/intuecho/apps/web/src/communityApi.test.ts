import { afterEach, describe, expect, test, vi } from "vitest";
import type {
  LiteratureCandidate,
  LiteratureRecord,
  LiteratureResolveResult
} from "@intuecho/contracts";
import { clearRejectedIdentitySession, isIdentitySessionCurrent, getIdentitySessionGeneration } from "./identityClient";
import { communityApi } from "./communityApi";

vi.mock("./identityClient", () => ({
  clearRejectedIdentitySession: vi.fn(),
  isIdentitySessionCurrent: vi.fn(async () => true),
  getIdentitySessionGeneration: vi.fn(() => 0),
  notifyAuthenticationRequired: vi.fn(),
  resolveIdentitySession: vi.fn(async () => ({
    audience: "intuecho-web",
    email: "reader@example.test",
    expiresAt: "2099-01-01T00:00:00.000Z",
    name: "Reader",
    sessionId: "session-token",
    userId: "reader-1"
  }))
}));

const fetchMock = vi.fn<typeof fetch>();

function ok(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status: 200
  });
}

const candidate: LiteratureCandidate = {
  candidateKey: "crossref:doi:10.1000/a-paper",
  provider: "crossref",
  record: {
    authors: ["A. Author"],
    identifiers: [{ kind: "doi", source: "public_registry", value: "10.1000/a-paper" }],
    title: "A Paper"
  }
};

const confirmed: LiteratureRecord = {
  authors: candidate.record.authors,
  identifiers: [{ kind: "doi", role: "confirmable", source: "public_registry", value: "10.1000/a-paper" }],
  literatureId: "literature-1",
  provenance: {
    confirmedAt: "2026-08-09T00:00:00.000Z",
    mode: "public_registry",
    provider: candidate.provider
  },
  revision: 1,
  status: "confirmed",
  title: candidate.record.title
};

describe("communityApi literature clients", () => {
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    sessionStorage.clear();
    localStorage.clear();
  });

  test("uses canonical resolver result and authenticated literature requests", async () => {
    fetchMock
      .mockResolvedValueOnce(ok({ candidates: [candidate], status: "ambiguous" }))
      .mockResolvedValueOnce(ok({ literature: confirmed }));
    vi.stubGlobal("fetch", fetchMock);

    const result: LiteratureResolveResult = {
      candidates: [candidate],
      status: "ambiguous",
      unavailableProviders: ["crossref"]
    };
    expect(result.unavailableProviders).toEqual(["crossref"]);
    const unavailable: LiteratureResolveResult = {
      retryable: true,
      status: "unavailable",
      unavailableProviders: ["openalex", "semantic_scholar"]
    };
    expect(unavailable.status).toBe("unavailable");

    await communityApi.resolveLiterature({ purpose: "forum_compose", query: "A Paper" });
    await communityApi.confirmLiterature({ candidateKey: candidate.candidateKey, mode: "candidate" });

    expect(fetchMock).toHaveBeenNthCalledWith(1, expect.stringContaining("/v1/literature:resolve"), expect.objectContaining({
      method: "POST",
      headers: { Authorization: "Bearer session-token", "Content-Type": "application/json" },
      body: JSON.stringify({ purpose: "forum_compose", query: "A Paper" })
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, expect.stringContaining("/v1/literature:confirm"), expect.objectContaining({
      method: "POST",
      headers: { Authorization: "Bearer session-token", "Content-Type": "application/json" },
      body: JSON.stringify({ candidateKey: candidate.candidateKey, mode: "candidate" })
    }));
  });

  test("uses authenticated encoded reply publication and deletion requests", async () => {
    fetchMock
      .mockResolvedValueOnce(ok({ reply: {} }))
      .mockResolvedValueOnce(ok({ ok: true, replyId: "reply/id" }));
    vi.stubGlobal("fetch", fetchMock);
    const replyId = "reply/id with spaces";
    const publication = { published: true as const, tags: ["method"], targets: [] };

    const publicationResult = await communityApi.updateReplyPublication(replyId, publication);
    expect(publicationResult.reply).toBeDefined();
    const deletionResult = await communityApi.deleteReply(replyId);
    expect(deletionResult.replyId).toBe("reply/id");

    const encoded = encodeURIComponent(replyId);
    expect(fetchMock).toHaveBeenNthCalledWith(1, expect.stringContaining(`/v1/replies/${encoded}/publication`), expect.objectContaining({
      method: "PUT",
      headers: { Authorization: "Bearer session-token", "Content-Type": "application/json" },
      body: JSON.stringify(publication)
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, expect.stringContaining(`/v1/replies/${encoded}`), expect.objectContaining({
      method: "DELETE",
      headers: { Authorization: "Bearer session-token" }
    }));
  });

  test("strips hydrated literature projections from annotation write requests", async () => {
    fetchMock.mockResolvedValue(ok({ annotation: { id: "annotation-1" } }));
    vi.stubGlobal("fetch", fetchMock);
    const hydratedTarget = {
      kind: "whole_document" as const,
      literature: { literatureId: "literature-1", literatureRecord: confirmed }
    };

    await communityApi.createAnnotation({
      body: "Canonical write boundary",
      shareToPlaza: true,
      tags: [],
      targets: [hydratedTarget],
      visibility: "public"
    }, "synthetic-explicit-intent");

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      command: { protocolVersion: 1, operationId: expect.any(String), bodyDigest: expect.stringMatching(/^[a-f0-9]{64}$/) },
      body: "Canonical write boundary",
      shareToPlaza: true,
      tags: [],
      targets: [{ kind: "whole_document", literature: { literatureId: "literature-1" } }],
      visibility: "public"
    });
  });
});


test.each([200, 401])("isolates a late %s response after the caller changes account", async (status) => {
  let finish!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; })));
  const result = communityApi.myAnnotations();
  await vi.waitFor(() => expect(finish).toBeDefined());
  vi.mocked(isIdentitySessionCurrent).mockResolvedValueOnce(false);
  finish(new Response(JSON.stringify({ annotations: [{ body: "private A" }] }), { status }));
  await expect(result).rejects.toThrow("账号会话已变化");
  expect(clearRejectedIdentitySession).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

test("rejects a request whose session resolution crosses logout", async () => {
  vi.mocked(getIdentitySessionGeneration).mockReturnValueOnce(0).mockReturnValueOnce(1);
  const send = vi.fn();
  vi.stubGlobal("fetch", send);
  await expect(communityApi.myAnnotations()).rejects.toThrow("账号会话已变化");
  expect(send).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});


test("uses the existing latest cursor endpoint with encoded literature and cancellation", async () => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValueOnce(ok({ annotations: [], nextCursor: "next" }));
  const abort = new AbortController();
  const result = await communityApi.plazaPage({ literatureId: "literature/a", limit: 30, cursor: "opaque+cursor" }, abort.signal);
  expect(result.nextCursor).toBe("next");
  const [path, options] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  const url = new URL(String(path));
  expect(url.pathname).toBe("/v1/plaza/page");
  expect(url.searchParams.get("literatureId")).toBe("literature/a");
  expect(url.searchParams.get("cursor")).toBe("opaque+cursor");
  expect(options?.signal).toBe(abort.signal);
  vi.unstubAllGlobals();
});
