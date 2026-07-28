import { describe, expect, test, vi } from "vitest";
import { createThinReadingExternalKnowledgeClient } from "../app/features/thin-reading/thinReadingExternalKnowledgeClient";

describe("thinReadingExternalKnowledgeClient", () => {
  test("keeps source identity and traceability fields", async () => {
    const transport = vi.fn(async () => ({
      json: async () => ({
        provider: "openalex",
        query: "late interaction follow-up",
        sources: [{
          abstract: "A follow-up abstract.",
          authors: ["A. Author"],
          doi: "https://doi.org/10.1000/follow-up",
          id: "openalex:W42",
          provider: "openalex",
          relevance: 0.82,
          retrievalQuery: "late interaction follow-up",
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
      transport
    });

    await expect(client({
      query: "late interaction follow-up",
      targetPaperTitle: "ColBERT"
    })).resolves.toEqual([
      expect.objectContaining({
        doi: "https://doi.org/10.1000/follow-up",
        id: "openalex:W42",
        sourceId: "W42",
        url: "https://openalex.org/W42"
      })
    ]);
    expect(transport).toHaveBeenCalledWith(expect.objectContaining({
      method: "POST",
      url: "https://liteasy.example.com/v1/research/external-knowledge"
    }));
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

    await expect(client({ query: "test" })).rejects.toThrow("返回格式无效");
  });
});
