import test from "node:test";
import assert from "node:assert/strict";
import { createDeepSeekChatCompletionsProvider } from "./deepseekChatCompletions.mjs";

test("posts to the DeepSeek chat completions API and extracts assistant content", async () => {
  let capturedRequest;
  const provider = createDeepSeekChatCompletionsProvider({
    apiKey: "sk-deepseek-test",
    fetchImpl: async (url, init) => {
      capturedRequest = { init, url };

      return {
        json: async () => ({
          choices: [
            {
              message: {
                content: "这是来自 DeepSeek 的回答",
                role: "assistant"
              }
            }
          ],
          id: "deepseek-response-1",
          model: "deepseek-v4-flash",
          object: "chat.completion"
        }),
        ok: true,
        status: 200
      };
    }
  });

  const answer = await provider({
    model: "deepseek-v4-flash",
    prompt: "问题：LiteasyClaw 的命令模式应该做什么？",
    provider: "deepseek",
    source: "cloud_proxy"
  });

  assert.equal(answer, "这是来自 DeepSeek 的回答");
  assert.deepEqual(capturedRequest, {
    init: {
      body: JSON.stringify({
        messages: [
          {
            content: "问题：LiteasyClaw 的命令模式应该做什么？",
            role: "user"
          }
        ],
        model: "deepseek-v4-flash",
        stream: false
      }),
      headers: {
        Authorization: "Bearer sk-deepseek-test",
        "Content-Type": "application/json"
      },
      method: "POST"
    },
    url: "https://api.deepseek.com/chat/completions"
  });
});

test("throws a readable error when the DeepSeek provider returns a non-ok status", async () => {
  const provider = createDeepSeekChatCompletionsProvider({
    apiKey: "sk-deepseek-test",
    fetchImpl: async () => ({
      json: async () => ({
        error: {
          message: "insufficient balance"
        }
      }),
      ok: false,
      status: 402
    })
  });

  await assert.rejects(
    provider({
      model: "deepseek-v4-flash",
      prompt: "问题：LiteasyClaw 的命令模式应该做什么？",
      provider: "deepseek",
      source: "cloud_proxy"
    }),
    /DeepSeek Chat Completions API 请求失败.*402.*insufficient balance/
  );
});
