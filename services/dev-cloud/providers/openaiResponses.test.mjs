import test from "node:test";
import assert from "node:assert/strict";
import { createOpenAIResponsesProvider } from "./openaiResponses.mjs";

test("posts to the OpenAI Responses API and extracts text output", async () => {
  let capturedRequest;
  const provider = createOpenAIResponsesProvider({
    apiKey: "sk-test",
    fetchImpl: async (url, init) => {
      capturedRequest = { init, url };

      return {
        json: async () => ({
          output: [
            {
              content: [
                {
                  text: "这是来自真实 provider 的回答",
                  type: "output_text"
                }
              ],
              type: "message"
            }
          ]
        }),
        ok: true,
        status: 200
      };
    }
  });

  const answer = await provider({
    model: "gpt-5-mini",
    prompt: "问题：BERT 的核心方法是什么？",
    provider: "openai",
    source: "cloud_proxy"
  });

  assert.equal(answer, "这是来自真实 provider 的回答");
  assert.deepEqual(capturedRequest, {
    init: {
      body: JSON.stringify({
        input: "问题：BERT 的核心方法是什么？",
        model: "gpt-5-mini"
      }),
      headers: {
        Authorization: "Bearer sk-test",
        "Content-Type": "application/json"
      },
      method: "POST"
    },
    url: "https://api.openai.com/v1/responses"
  });
});

test("throws a readable error when the OpenAI provider returns a non-ok status", async () => {
  const provider = createOpenAIResponsesProvider({
    apiKey: "sk-test",
    fetchImpl: async () => ({
      json: async () => ({
        error: {
          message: "quota exceeded"
        }
      }),
      ok: false,
      status: 429
    })
  });

  await assert.rejects(
    provider({
      model: "gpt-5-mini",
      prompt: "问题：BERT 的核心方法是什么？",
      provider: "openai",
      source: "cloud_proxy"
    }),
    /OpenAI Responses API 请求失败.*429.*quota exceeded/
  );
});
