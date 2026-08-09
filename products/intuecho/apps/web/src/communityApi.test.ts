import { afterEach, describe, expect, test, vi } from "vitest";
import type {
  LiteratureCandidate,
  LiteratureRecord
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

  test("resolves and confirms literature through authenticated endpoints", async () => {
    fetchMock
      .mockResolvedValueOnce(ok({ candidates: [candidate], status: "ambiguous" }))
      .mockResolvedValueOnce(ok({ literature: confirmed }));
    vi.stubGlobal("fetch", fetchMock);

    await communityApi.resolveLiterature({ purpose: "forum_compose", query: "A Paper" });
    await communityApi.confirmLiterature({ candidateKey: candidate.candidateKey, mode: "candidate" });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      expect.stringContaining("/v1/literature:resolve"),
      expect.stringContaining("/v1/literature:confirm")
    ]);
  });
});
