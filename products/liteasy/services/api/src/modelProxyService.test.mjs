import assert from "node:assert/strict";
import test from "node:test";
import { ModelProxyError, ModelProxyService } from "./modelProxyService.mjs";
import { ModelUpstreamError } from "./modelUpstreamProviders.mjs";

const image = { mediaType: "image/png", base64: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]).toString("base64"), label: "Private research figure" };

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

test("validates and forwards images for generation and streaming without logging their content", async () => {
  const inputs = [];
  const { instance, events } = service({ providers: { openai: { model: "gpt-5-mini", supportsImages: true,
    async generate(input) { inputs.push(input); return "Image answer"; },
    async *stream(input) { inputs.push(input); yield "Image answer"; },
  } } });
  await instance.generate(body({ images: [image] }), context());
  for await (const _delta of instance.generateStream(body({ images: [image] }), context())) { /* consume */ }
  assert.equal(inputs.length, 2);
  assert.deepEqual(inputs.map((input) => input.images), [[image], [image]]);
  assert.equal(JSON.stringify(events).includes(image.base64), false);
  assert.equal(JSON.stringify(events).includes(image.label), false);
});

test("rejects malformed, external, mismatched and excessive image data before provider access", async () => {
  let accessed = false;
  const { instance } = service({ providers: { openai: { model: "gpt-5-mini", supportsImages: true,
    async generate() { accessed = true; return "unused"; },
  } } });
  for (const images of [null, {}, Array(13).fill(image), [{ ...image, url: "https://untrusted/image.png" }],
    [{ ...image, mediaType: "image/jpeg" }], [{ ...image, base64: "not base64" }], [{ ...image, label: "x".repeat(1001) }]]) {
    await assert.rejects(instance.generate(body({ images }), context()), { code: "model_images_invalid" });
  }
  const large = Buffer.alloc(3 * 1024 * 1024);
  Buffer.from(image.base64, "base64").copy(large);
  await assert.rejects(instance.generate(body({ images: [{ ...image, base64: large.toString("base64") }, { ...image, base64: large.toString("base64") }] }), context()),
    { code: "model_images_too_large", status: 413 });
  assert.equal(accessed, false);
});

test("does not silently strip images for a provider without image capability", async () => {
  const { instance } = service();
  await assert.rejects(instance.generate(body({ images: [image] }), context()), { code: "model_images_unsupported", status: 415 });
});
