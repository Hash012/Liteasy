import assert from "node:assert/strict";
import test from "node:test";
import { ModelProxyError, ModelProxyService } from "./modelProxyService.mjs";
import { ModelUpstreamError } from "./modelUpstreamProviders.mjs";

function context() {
  return { subjectId: "user_1", traceId: "trace_model_1" };
}

function body(overrides = {}) {
  return {
    model: "gpt-5-mini",
    prompt: "private prompt body",
    provider: "openai",
    source: "cloud_proxy",
    ...overrides
  };
}

function service(overrides = {}) {
  const events = [];
  const provider = {
    async generate() { return "Real answer"; },
    model: "gpt-5-mini",
    async *stream() { yield "Real "; yield "answer"; }
  };
  return {
    events,
    instance: new ModelProxyService({
      loadPolicy: async () => ({ defaultProvider: "openai" }),
      logger: {
        error(_label, event) { events.push(event); },
        info(_label, event) { events.push(event); }
      },
      providers: { openai: provider },
      ...overrides
    })
  };
}

test("returns a live execution result and logs metadata without prompt content", async () => {
  const { events, instance } = service();
  const result = await instance.generate(body(), context());

  assert.deepEqual(result, {
    answer: "Real answer",
    execution: { backend: "cloud", mode: "live", provider: "openai" }
  });
  assert.equal(events[0].promptChars, "private prompt body".length);
  assert.equal(JSON.stringify(events).includes("private prompt body"), false);
});

test("rejects provider and model choices outside server policy before upstream access", async () => {
  const { instance } = service();
  await assert.rejects(
    () => instance.generate(body({ provider: "deepseek" }), context()),
    (error) => error instanceof ModelProxyError && error.code === "model_provider_not_allowed"
  );
  await assert.rejects(
    () => instance.generate(body({ model: "gpt-5-expensive" }), context()),
    (error) => error instanceof ModelProxyError && error.code === "model_not_allowed"
  );
});

test("accepts released desktop OpenAI model aliases while the deployment selects the upstream model", async () => {
  const observedModels = [];
  const instance = service({
    providers: {
      openai: {
        async generate(input) { observedModels.push(input.model); return "Real answer"; },
        model: "gpt-5.6-sol",
        async *stream() { yield "Real answer"; }
      }
    }
  }).instance;

  for (const model of ["gpt-5-mini", "gpt-5-mini-auditor"]) {
    const result = await instance.generate(body({ model }), context());
    assert.equal(result.answer, "Real answer");
  }
  assert.deepEqual(observedModels, ["gpt-5-mini", "gpt-5-mini-auditor"]);
});

test("accepts released DeepSeek client labels while the deployment selects the upstream model", async () => {
  let calls = 0;
  let observedModel;
  const instance = service({
    loadPolicy: async () => ({ defaultProvider: "deepseek" }),
    providers: {
      deepseek: {
        async generate(input) { calls += 1; observedModel = input.model; return "Real answer"; },
        model: "deepseek-v4-pro",
        async *stream() { calls += 1; yield "Real answer"; }
      }
    }
  }).instance;

  const result = await instance.generate(body({
    model: "deepseek-v4-flash",
    provider: "deepseek"
  }), context());
  assert.equal(result.answer, "Real answer");
  assert.equal(calls, 1);
  assert.equal(observedModel, "deepseek-v4-pro");
});

test("rejects unknown fields, oversized prompts, and loose structured-output contracts", async () => {
  const { instance } = service();
  await assert.rejects(
    () => instance.generate(body({ apiKey: "client-secret" }), context()),
    (error) => error instanceof ModelProxyError && error.code === "model_request_invalid"
  );
  await assert.rejects(
    () => instance.generate(body({ prompt: "x".repeat(240_001) }), context()),
    (error) => error instanceof ModelProxyError && error.code === "model_prompt_too_large"
  );
  await assert.rejects(
    () => instance.generate(body({
      outputFormat: { name: "answer", schema: { type: "object" }, strict: false }
    }), context()),
    (error) => error instanceof ModelProxyError && error.code === "model_output_format_invalid"
  );
});

test("maps upstream details to stable errors while retaining minimal diagnostics", async () => {
  const events = [];
  const instance = service({
    logger: {
      error(_label, event) { events.push(event); },
      info() {}
    },
    providers: {
      openai: {
        async generate() {
          throw new ModelUpstreamError(
            "model_provider_unavailable",
            503,
            "upstream said secret diagnostic"
          );
        },
        model: "gpt-5-mini",
        async *stream() { yield "unused"; }
      }
    }
  }).instance;

  await assert.rejects(
    () => instance.generate(body(), context()),
    (error) => {
      assert.equal(error.code, "model_provider_unavailable");
      assert.equal(error.message.includes("secret diagnostic"), false);
      return true;
    }
  );
  assert.equal(events[0].detail, "upstream said secret diagnostic");
  assert.equal(JSON.stringify(events).includes("private prompt body"), false);
});

test("streams only text deltas and records completion after the iterator finishes", async () => {
  const { events, instance } = service();
  const deltas = [];
  for await (const delta of instance.generateStream(body(), context())) deltas.push(delta);

  assert.deepEqual(deltas, ["Real ", "answer"]);
  assert.equal(events[0].outputChars, 11);
  assert.equal(events[0].status, "completed");
});
