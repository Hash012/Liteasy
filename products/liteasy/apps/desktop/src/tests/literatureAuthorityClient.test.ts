import { describe, expect, test, vi } from "vitest";

import { createLiteratureAuthorityClient } from "../app/features/paper-identity/literatureAuthorityClient";

const literature = {
  authors: ["Ada Lovelace"],
  identifiers: [{ kind: "doi", source: "public_registry", value: "10.1000/private" }],
  literatureId: "literature-private",
  provenance: {
    confirmedAt: "2026-08-11T00:00:00.000Z",
    mode: "public_registry",
    provider: "crossref"
  },
  revision: 1,
  status: "confirmed",
  title: "Private paper"
};

describe("literatureAuthorityClient", () => {
  test("routes private identity operations through the Liteasy API", async () => {
    const fetchImpl = vi.fn(async (url: string) => new Response(JSON.stringify(
      url.endsWith(":resolve")
        ? { candidates: [], status: "not_found", unavailableProviders: [] }
        : url.endsWith(":confirm") || url.endsWith(":verify")
          ? { literature }
          : { claims: [], literatureId: literature.literatureId, versions: [] }
    ), { headers: { "content-type": "application/json" }, status: 200 }));
    const client = createLiteratureAuthorityClient({
      endpoint: "https://liteasy.example",
      fetchImpl: fetchImpl as typeof fetch,
      getSessionId: () => "desktop-token"
    });

    await client.resolveLiterature({ purpose: "liteasy_pdf_annotation", query: "Private paper" });
    await client.confirmLiterature({ candidateKey: "crossref:doi:10.1000/private", mode: "candidate" });
    await client.verifyLiterature({ literatureId: literature.literatureId, revision: 1 });
    await client.literatureRelations(literature.literatureId);

    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      "https://liteasy.example/v1/literature:resolve",
      "https://liteasy.example/v1/literature:confirm",
      "https://liteasy.example/v1/literature:verify",
      "https://liteasy.example/v1/literature/literature-private/relations"
    ]);
    expect(fetchImpl.mock.calls.every(([, init]) =>
      (init?.headers as Record<string, string>).Authorization === "Bearer desktop-token"
    )).toBe(true);
  });
});
