import { describe, expect, test, vi } from "vitest";
import {
  classifyPaperTranslationError,
  createPaperTranslationController,
  PaperTranslationError,
  preflightTranslationService,
  type TranslationProgress
} from "../app/controllers/paperTranslationController";

const source = [
  "<!-- liteasy-anchor:segment-001 -->\nsource one",
  "<!-- liteasy-anchor:segment-002 -->\nsource two",
  "<!-- liteasy-anchor:segment-003 -->\nsource three"
].join("\n\n");

function healthyOldService() {
  return vi.fn(async () => ({
    json: async () => ({ ok: true }),
    ok: true,
    status: 200
  }));
}

describe("paper translation controller", () => {
  test("translates bounded batches sequentially, repairs once, reports progress and reuses caller cache", async () => {
    const cache = new Map<string, string>();
    const progress: TranslationProgress[] = [];
    const attempts: string[] = [];
    let activeCalls = 0;
    let maximumActiveCalls = 0;
    const generate = vi.fn(async (input) => {
      attempts.push(`${input.batchIndex}:${input.attempt}`);
      activeCalls += 1;
      maximumActiveCalls = Math.max(maximumActiveCalls, activeCalls);
      await Promise.resolve();
      activeCalls -= 1;
      if (input.batchIndex === 0 && input.attempt === "translate") {
        return "anchor was accidentally removed";
      }
      return input.batch.anchorIds.map((id: string) => (
        `<!-- liteasy-anchor:${id} -->\ntranslated ${id}`
      )).join("\n\n");
    });
    const controller = createPaperTranslationController({
      batchCharacterLimit: 94,
      cache,
      endpoint: "http://127.0.0.1:8791",
      generate,
      healthTransport: healthyOldService(),
      paperTitle: "Paper"
    });
    const options = {
      onProgress: (value: TranslationProgress) => progress.push(value),
      signal: new AbortController().signal
    };

    const first = await controller.translate("英文", "中文", source, options);
    const callsAfterFirstRun = generate.mock.calls.length;
    const second = await controller.translate("英文", "中文", source, options);

    expect(first).toBe(second);
    expect(attempts).toEqual(["0:translate", "0:repair", "1:translate"]);
    expect(callsAfterFirstRun).toBe(3);
    expect(generate).toHaveBeenCalledTimes(callsAfterFirstRun);
    expect(maximumActiveCalls).toBe(1);
    expect(progress.some(({ phase }) => phase === "repairing")).toBe(true);
    expect(progress.at(-1)).toMatchObject({
      cachedBatches: 2,
      completedBatches: 2,
      phase: "completed",
      totalBatches: 2
    });
  });

  test("performs one repair only and exposes an actionable anchor error", async () => {
    const generate = vi.fn(async () => "translation without anchors");
    const controller = createPaperTranslationController({
      cache: new Map(),
      endpoint: "http://localhost:8791",
      generate,
      healthTransport: healthyOldService(),
      paperTitle: "Paper"
    });

    await expect(controller.translate("英文", "中文", source, {
      signal: new AbortController().signal
    })).rejects.toMatchObject({
      action: expect.any(String),
      code: "anchor_integrity",
      detail: expect.stringContaining("自动修复后仍未通过"),
      title: "译文同步锚点无法修复"
    });
    expect(generate).toHaveBeenCalledTimes(2);
  });

  test("propagates abort to the active model request", async () => {
    const abortController = new AbortController();
    const generate = vi.fn(({ signal }) => new Promise<string>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }));
    const controller = createPaperTranslationController({
      cache: new Map(),
      endpoint: "http://127.0.0.1:8791",
      generate,
      healthTransport: healthyOldService(),
      paperTitle: "Paper"
    });
    const translation = controller.translate("英文", "中文", source, {
      signal: abortController.signal
    });
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    abortController.abort(new DOMException("cancelled", "AbortError"));

    await expect(translation).rejects.toMatchObject({ name: "AbortError" });
    expect(generate.mock.calls[0][0].signal).toBe(abortController.signal);
  });

  test("restores an omitted source image without putting image data in the model prompt", async () => {
    const markedSource = "<!-- liteasy-anchor:segment-001 -->\nSource\n\n![Diagram](images/diagram.png)";
    const generate = vi.fn(async () => "<!-- liteasy-anchor:segment-001 -->\n译文");
    const controller = createPaperTranslationController({
      cache: new Map(),
      endpoint: "http://127.0.0.1:8791",
      generate,
      healthTransport: healthyOldService(),
      paperTitle: "Paper"
    });

    await expect(controller.translate("英文", "中文", markedSource, {
      signal: new AbortController().signal
    })).resolves.toContain("![Diagram](images/diagram.png)");
    expect(generate.mock.calls[0][0].prompt).toContain("images/diagram.png");
    expect(generate.mock.calls[0][0].prompt).not.toContain("data:image");
  });
});

describe("translation service preflight", () => {
  test("accepts legacy health payloads that only expose ok", async () => {
    await expect(preflightTranslationService({
      endpoint: "http://127.0.0.1:8791/",
      healthTransport: healthyOldService(),
      signal: new AbortController().signal
    })).resolves.toMatchObject({ origin: "http://127.0.0.1:8791" });
  });

  test("detects a running process that still reports the Mosshub upstream", async () => {
    await expect(preflightTranslationService({
      endpoint: "http://127.0.0.1:8791",
      healthTransport: async () => ({
        json: async () => ({
          ok: true,
          runtime: { upstreamBaseUrl: "https://api.mosshubs.com/v1?token=secret" }
        }),
        ok: true,
        status: 200
      }),
      signal: new AbortController().signal
    })).rejects.toMatchObject({
      code: "legacy_mosshub",
      title: "本地翻译服务仍在使用旧的 Mosshub 配置"
    });
  });

  test("reports a missing OpenAI key before starting model work", async () => {
    await expect(preflightTranslationService({
      endpoint: "http://127.0.0.1:8791",
      healthTransport: async () => ({
        json: async () => ({
          ok: true,
          runtime: { hasApiKey: false, provider: "openai", upstreamBaseUrl: "https://nowcoding.ai/v1" }
        }),
        ok: true,
        status: 200
      }),
      signal: new AbortController().signal
    })).rejects.toMatchObject({
      code: "model_authentication",
      title: "本地模型服务缺少密钥"
    });
  });

  test("rejects legacy and direct upstream browser endpoints before fetching", async () => {
    const healthTransport = healthyOldService();
    await expect(preflightTranslationService({
      endpoint: "https://api.mosshubs.com/v1",
      healthTransport,
      signal: new AbortController().signal
    })).rejects.toMatchObject({ code: "legacy_mosshub" });
    await expect(preflightTranslationService({
      endpoint: "https://nowcoding.ai/v1?api_key=secret",
      healthTransport,
      signal: new AbortController().signal
    })).rejects.toMatchObject({ code: "direct_upstream_endpoint" });
    expect(healthTransport).not.toHaveBeenCalled();
  });
});

test("classifies upstream failures without exposing URL credentials", () => {
  const classified = classifyPaperTranslationError(new Error(
    "OpenAI request failed 524 endpoint=https://nowcoding.ai/v1?api_key=super-secret"
  ));

  expect(classified).toBeInstanceOf(PaperTranslationError);
  expect(classified).toMatchObject({
    action: expect.any(String),
    code: "model_timeout",
    title: "翻译请求超时"
  });
  expect(classified.detail).not.toContain("super-secret");
});
