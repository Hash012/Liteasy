import { createHttpModelAuditClient } from "../app/features/models/modelAuditClient";

test("posts generated answers and citations to the model audit endpoint", async () => {
  const requests: Array<{ body: string; url: string }> = [];
  const client = createHttpModelAuditClient({
    endpoint: "https://liteasy.example.com/model-proxy",
    source: "cloud_proxy",
    transport: async (request) => {
      requests.push({ body: request.body, url: request.url });

      return {
        json: async () => ({
          audit: {
            model: "gpt-5-mini-auditor",
            rationale: "云端审计确认回答有引用支撑。",
            score: 0.91,
            verdict: "pass"
          }
        }),
        ok: true,
        status: 200
      };
    }
  });

  const result = await client({
    answer: "生成回答",
    citations: [
      {
        page: 8,
        paperId: "demo-2",
        snippet: "masked language model"
      }
    ],
    model: "gpt-5-mini-auditor",
    provider: "openai",
    question: "预训练目标是什么？",
    retrievalConfidence: 0.86
  });

  expect(result).toEqual({
    model: "gpt-5-mini-auditor",
    rationale: "云端审计确认回答有引用支撑。",
    score: 0.91,
    verdict: "pass"
  });
  expect(requests).toEqual([
    {
      body: JSON.stringify({
        answer: "生成回答",
        citations: [
          {
            page: 8,
            paperId: "demo-2",
            snippet: "masked language model"
          }
        ],
        model: "gpt-5-mini-auditor",
        provider: "openai",
        question: "预训练目标是什么？",
        retrievalConfidence: 0.86,
        source: "cloud_proxy"
      }),
      url: "https://liteasy.example.com/model-proxy/v1/model/audit"
    }
  ]);
});
