import { describe, expect, test, vi } from "vitest";
import {
  createThinReadingCommunityRecommendationClient,
  hasThinReadingCommunityIdentity
} from "../app/features/thin-reading/thinReadingCommunityRecommendationClient";
import type { ThinReadingRecommendationScope } from "../app/features/thin-reading/thinReading.types";

const communityIdentity = {
  id: "doi:10.48550/arxiv.1706.03762",
  kind: "doi" as const,
  source: "metadata" as const,
  value: "10.48550/arxiv.1706.03762"
};

const communityScope: ThinReadingRecommendationScope = {
  evidenceIds: ["evidence-attention"],
  kind: "selected_passage",
  paperId: "paper-attention",
  paperIdentity: {
    candidates: [communityIdentity],
    paperId: "paper-attention",
    primary: communityIdentity,
    title: "Attention Is All You Need"
  },
  excerpt: "self-attention"
};

describe("thinReadingCommunityRecommendationClient", () => {
  test("maps the whole-paper discovery scope to the Intuecho document contract", async () => {
    const transport = vi.fn(async () => ({
      json: async () => ({ recommendations: [] }),
      ok: true,
      status: 200
    }));
    const client = createThinReadingCommunityRecommendationClient({
      endpoint: "https://intuecho.example.com",
      sessionId: "desktop-token",
      transport
    });

    await expect(client({
      kind: "whole_paper",
      paperId: "paper-attention",
      paperIdentity: communityScope.paperIdentity
    })).resolves.toEqual([]);
    expect(JSON.parse(transport.mock.calls[0][0].body)).toEqual({
      scope: {
        kind: "document",
        paperIdentity: {
          id: "doi:10.48550/arxiv.1706.03762",
          kind: "doi",
          source: "metadata",
          value: "10.48550/arxiv.1706.03762"
        }
      }
    });
  });

  test("queries the scoped community endpoint and accepts only matching community results", async () => {
    const transport = vi.fn(async () => ({
      json: async () => ({
        recommendations: [{
          compatibility: 0.82,
          id: "community-recommendation-1",
          note: "社区批注讨论 self-attention 的并行化影响。",
          paperIdentity: communityIdentity,
          relationship: "方法与问题设定",
          source: "intuecho_community"
        }]
      }),
      ok: true,
      status: 200
    }));
    const client = createThinReadingCommunityRecommendationClient({
      endpoint: "https://intuecho.example.com/base/",
      sessionId: "desktop-token",
      transport
    });

    await expect(client(communityScope)).resolves.toEqual([
      expect.objectContaining({
        id: "community-recommendation-1",
        source: "intuecho_community"
      })
    ]);
    expect(transport).toHaveBeenCalledWith(expect.objectContaining({
      method: "POST",
      url: "https://intuecho.example.com/base/v1/thin-reading/recommendations:query"
    }));
    expect(JSON.parse(transport.mock.calls[0][0].body)).toEqual({
      scope: {
        evidenceIds: ["evidence-attention"],
        externalSourceIds: [],
        kind: "selected_passage",
        paperIdentity: {
          id: "doi:10.48550/arxiv.1706.03762",
          kind: "doi",
          source: "metadata",
          value: "10.48550/arxiv.1706.03762"
        }
      }
    });
  });

  test("rejects unverified identities and response items from another source or paper", async () => {
    const localScope: ThinReadingRecommendationScope = {
      kind: "whole_paper",
      paperId: "local-paper",
      paperIdentity: {
        candidates: [{ id: "local_paper_id:local-paper", kind: "local_paper_id", source: "local", value: "local-paper" }],
        paperId: "local-paper",
        primary: { id: "local_paper_id:local-paper", kind: "local_paper_id", source: "local", value: "local-paper" },
        title: "Local paper"
      }
    };
    const client = createThinReadingCommunityRecommendationClient({
      endpoint: "https://intuecho.example.com",
      sessionId: "desktop-token",
      transport: vi.fn(async () => ({
        json: async () => ({
          recommendations: [{
            compatibility: 0.82,
            id: "wrong-source",
            note: "不应显示。",
            paperIdentity: communityIdentity,
            relationship: "关联",
            source: "local_agent_lead"
          }]
        }),
        ok: true,
        status: 200
      }))
    });

    expect(hasThinReadingCommunityIdentity(localScope)).toBe(false);
    await expect(client(localScope)).rejects.toThrow("当前文献只有本地身份");
    await expect(client(communityScope)).rejects.toThrow("响应无效或不属于当前文献");
  });
});
