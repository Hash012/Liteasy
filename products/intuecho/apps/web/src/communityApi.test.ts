import { afterEach, describe, expect, test, vi } from "vitest";
import type {
  LiteratureCandidate,
  LiteratureRecord,
  LiteratureResolveResult
} from "@intuecho/contracts";
import { communityApi } from "./communityApi";

vi.mock("./identityClient", () => ({
  clearRejectedIdentitySession: vi.fn(),
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
  identifiers: candidate.record.identifiers,
  literatureId: "literature-1",
  provenance: {
    confirmedAt: "2026-08-09T00:00:00.000Z",
    mode: "public_registry",
    provider: candidate.provider
  },
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
});
