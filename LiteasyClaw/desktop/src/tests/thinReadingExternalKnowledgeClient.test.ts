import { describe, expect, test, vi } from "vitest";
import { createThinReadingExternalKnowledgeClient } from "../app/features/thin-reading/thinReadingExternalKnowledgeClient";

describe("thinReadingExternalKnowledgeClient", () => {
  test("keeps source identity and traceability fields", async () => {
    const transport = vi.fn(async () => ({
      json: async () => ({
        provider: "openalex",
        query: "late interaction follow-up",
        retrieval: {
          attempts: 2,
          id: "artifact-thin-external:retrieval-key",
          reused: true,
          status: "completed"
        },
        sources: [{
          abstract: "A follow-up abstract.",
          authors: ["A. Author"],
          doi: "https://doi.org/10.1000/follow-up",
          fullTextUrl: "https://example.org/follow-up.pdf",
          id: "openalex:W42",
          provider: "openalex",
          relation: "cites_target",
          relevance: 0.82,
          retrievalQuery: "late interaction follow-up",
          sourceRecordUrl: "https://openalex.org/W42",
          sourceId: "W42",
          title: "A Follow-up Study",
          url: "https://openalex.org/W42",
          year: 2025
        }],
        status: "available"
      }),
      ok: true,
      status: 200
    }));
    const client = createThinReadingExternalKnowledgeClient({
      endpoint: "https://liteasy.example.com/",
      openAlexApiKey: "user-openalex-key",
      transport
    });

    await expect(client({
      artifactId: "artifact-thin-external",
      query: "late interaction follow-up",
      targetPaperIdentity: {
        kind: "doi",
        value: "10.1000/colbert"
      },
      targetPaperTitle: "ColBERT"
    })).resolves.toEqual({
      retrieval: {
        attempts: 2,
        id: "artifact-thin-external:retrieval-key",
        reused: true,
        status: "completed"
      },
      sources: [expect.objectContaining({
        doi: "https://doi.org/10.1000/follow-up",
        evidenceBasis: "abstract",
        fullTextUrl: "https://example.org/follow-up.pdf",
        id: "openalex:W42",
        retrievalIntents: ["support"],
        sourceRecordUrl: "https://openalex.org/W42",
        sourceId: "W42",
        url: "https://openalex.org/W42"
      })]
    });
    expect(transport).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.stringContaining('"artifactId":"artifact-thin-external"'),
      headers: expect.objectContaining({ "X-OpenAlex-Api-Key": "user-openalex-key" }),
      method: "POST",
      url: "https://liteasy.example.com/v1/research/external-knowledge"
    }));
    expect(String(transport.mock.calls[0][0].body)).toContain('"targetPaperIdentity":{"kind":"doi","value":"10.1000/colbert"}');
    expect(JSON.parse(String(transport.mock.calls[0][0].body)).limit).toBe(32);
    expect(String(transport.mock.calls[0][0].body)).not.toContain("user-openalex-key");
  });

  test("rejects malformed configured API keys before sending a retrieval request", async () => {
    const transport = vi.fn();
    const client = createThinReadingExternalKnowledgeClient({
      endpoint: "https://liteasy.example.com",
      openAlexApiKey: "not a valid key",
      transport
    });

    await expect(client({ artifactId: "artifact-invalid-key", query: "test" })).rejects.toThrow("API 密钥格式无效");
    expect(transport).not.toHaveBeenCalled();
  });

  test("surfaces the actionable OpenAlex key requirement instead of a generic 503", async () => {
    const client = createThinReadingExternalKnowledgeClient({
      endpoint: "https://liteasy.example.com",
      transport: async () => ({
        json: async () => ({
          error: "openalex_api_key_required",
          message: "OpenAlex 外部文献检索需要有效 API 密钥。请在 Liteasy 设置中配置 OpenAlex API 密钥后重试。"
        }),
        ok: false,
        status: 503
      })
    });

    await expect(client({ artifactId: "artifact-key-required", query: "test" }))
      .rejects.toThrow("请在 Liteasy 设置中配置 OpenAlex API 密钥");
  });

  test("rejects malformed source payloads", async () => {
    const client = createThinReadingExternalKnowledgeClient({
      endpoint: "https://liteasy.example.com",
      transport: async () => ({
        json: async () => ({ sources: [{ id: "invented" }] }),
        ok: true,
        status: 200
      })
    });

    await expect(client({ artifactId: "artifact-malformed", query: "test" })).rejects.toThrow("返回格式无效");
  });

  test("rejects sources whose OpenAlex identity and record URL do not agree", async () => {
    const client = createThinReadingExternalKnowledgeClient({
      endpoint: "https://liteasy.example.com",
      transport: async () => ({
        json: async () => ({
          sources: [{
            abstract: "A follow-up abstract.",
            authors: [],
            id: "openalex:W42",
            provider: "openalex",
            relation: "related",
            relevance: 0.8,
            retrievalQuery: "follow-up",
            sourceId: "W42",
            sourceRecordUrl: "https://untrusted.example.com/W42",
            title: "A Follow-up Study",
            url: "https://example.org/paper"
          }]
        }),
        ok: true,
        status: 200
      })
    });

    await expect(client({ artifactId: "artifact-mismatch", query: "test" })).rejects.toThrow("返回格式无效");
  });

  test("accepts a Crossref source only with canonical DOI provenance and topic relation", async () => {
    const client = createThinReadingExternalKnowledgeClient({
      endpoint: "https://liteasy.example.com",
      transport: async () => ({
        json: async () => ({
          sources: [{
            abstract: "A replication study.",
            authors: ["C. Author"],
            doi: "https://doi.org/10.1000/crossref-only",
            id: "crossref:10.1000/crossref-only",
            provider: "crossref",
            relation: "topic_search",
            relevance: 0.72,
            retrievalQuery: "replication",
            sourceId: "10.1000/crossref-only",
            sourceRecordUrl: "https://api.crossref.org/works/10.1000%2Fcrossref-only",
            title: "A Replication Study",
            url: "https://doi.org/10.1000/crossref-only"
          }]
        }),
        ok: true,
        status: 200
      })
    });

    await expect(client({ artifactId: "artifact-crossref", query: "replication" })).resolves.toMatchObject({
      sources: [expect.objectContaining({ id: "crossref:10.1000/crossref-only", relation: "topic_search" })]
    });
  });

  test("accepts a canonical arXiv preprint and preserves its explicit identity", async () => {
    const client = createThinReadingExternalKnowledgeClient({
      endpoint: "https://liteasy.example.com",
      transport: async () => ({
        json: async () => ({
          sources: [{
            abstract: "This preprint reports a reproducible method and enough detail for sentence-level review.",
            arxivId: "2101.01234",
            authors: ["A. Author"],
            id: "arxiv:2101.01234",
            provider: "arxiv",
            relation: "topic_search",
            relevance: 0.75,
            retrievalQuery: "reproducible method",
            sourceId: "2101.01234",
            sourceRecordUrl: "https://arxiv.org/abs/2101.01234",
            title: "A Reproducible Method",
            url: "https://arxiv.org/abs/2101.01234"
          }]
        }),
        ok: true,
        status: 200
      })
    });

    await expect(client({ artifactId: "artifact-arxiv", query: "reproducible method" }))
      .resolves.toMatchObject({ sources: [expect.objectContaining({ provider: "arxiv" })] });
  });

  test("filters retracted records and records without reviewable source content", async () => {
    const client = createThinReadingExternalKnowledgeClient({
      endpoint: "https://liteasy.example.com",
      transport: async () => ({
        json: async () => ({
          sources: [
            {
              abstract: "This abstract is long enough to inspect, but the bibliographic record is retracted.",
              authors: ["R. Author"],
              id: "openalex:W42",
              isRetracted: true,
              provider: "openalex",
              relation: "related",
              relevance: 0.8,
              retrievalQuery: "test",
              sourceId: "W42",
              sourceRecordUrl: "https://openalex.org/W42",
              title: "Retracted Work",
              url: "https://example.org/retracted"
            },
            {
              abstract: "Unavailable",
              authors: ["N. Author"],
              id: "openalex:W43",
              provider: "openalex",
              relation: "topic_search",
              relevance: 0.7,
              retrievalQuery: "test",
              sourceId: "W43",
              sourceRecordUrl: "https://openalex.org/W43",
              title: "No Reviewable Abstract",
              url: "https://example.org/no-abstract"
            }
          ]
        }),
        ok: true,
        status: 200
      })
    });

    await expect(client({ artifactId: "artifact-untrusted", query: "test" }))
      .resolves.toMatchObject({ sources: [] });
  });

  test("stops before transport when the artifact boundary is invalid", async () => {
    const transport = vi.fn();
    const client = createThinReadingExternalKnowledgeClient({
      endpoint: "https://liteasy.example.com",
      transport
    });

    await expect(client({ artifactId: "../unsafe", query: "test" })).rejects.toThrow("有效 artifactId");
    expect(transport).not.toHaveBeenCalled();
  });
});
