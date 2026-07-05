import { describe, expect, test } from "vitest";
import type { SemanticActionPlan } from "../app/features/agent-runtime/agentRuntime.types";
import {
  createModelAssistedUIDslGenerator,
  generateUIDslWithModelFallback
} from "../app/features/generative-ui/uiDslGenerator";
import { createSettingsStore } from "../app/features/settings/settings.store";

function themePlan(): SemanticActionPlan {
  return {
    actions: [
      {
        actionId: "theme.apply_preset",
        input: {
          preset: "playful",
          tone: "cartoon"
        }
      }
    ],
    confidence: "high",
    intentId: "theme.apply",
    planId: "plan-model-ui",
    requiredContext: [],
    requiresConfirmation: false,
    riskLevel: "low",
    summary: "应用卡通风格"
  };
}

describe("generateUIDslWithModelFallback", () => {
  test("uses valid model JSON after schema and UX validation", async () => {
    const document = await generateUIDslWithModelFallback(themePlan(), {
      generateModelDsl: async () =>
        JSON.stringify({
          actions: [],
          audit: {
            createdAt: "2026-07-05T00:00:00.000Z",
            generatedBy: "model",
            model: "test-model",
            traceId: "trace-model-ui"
          },
          dataSources: [],
          id: "ui-model",
          intentPlanId: "plan-model-ui",
          root: {
            component: "StatusBanner",
            id: "model-status",
            props: {
              text: "模型生成 UI",
              tone: "info"
            }
          },
          surface: "assistant",
          version: "liteasy-ui-dsl/v1"
        })
    });

    expect(document.audit.generatedBy).toBe("model");
    expect(document.id).toBe("ui-model");
  });

  test("returns auditable fallback UI with rule actions when model DSL violates the schema", async () => {
    const document = await generateUIDslWithModelFallback(themePlan(), {
      generateModelDsl: async () =>
        JSON.stringify({
          actions: [],
          audit: {
            createdAt: "2026-07-05T00:00:00.000Z",
            generatedBy: "model",
            traceId: "trace-bad-model-ui"
          },
          dataSources: [],
          id: "ui-bad-model",
          intentPlanId: "plan-model-ui",
          root: {
            component: "MagicPanel",
            id: "bad",
            props: {}
          },
          surface: "assistant",
          version: "liteasy-ui-dsl/v1"
        })
    });

    expect(document.audit.generatedBy).toBe("rule");
    expect(document.id).toBe("fallback-plan-model-ui-dsl_error");
    expect(document.dataSources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          params: expect.objectContaining({
            reason: "dsl_error"
          }),
          sourceId: "runtime.context_view"
        })
      ])
    );
    expect(document.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionId: "theme.reset",
          id: "reset-theme"
        })
      ])
    );
  });

  test("returns auditable fallback UI when optional model UX review rejects the candidate", async () => {
    const document = await generateUIDslWithModelFallback(themePlan(), {
      generateModelDsl: async () =>
        JSON.stringify({
          actions: [],
          audit: {
            createdAt: "2026-07-05T00:00:00.000Z",
            generatedBy: "model",
            traceId: "trace-risky-model-ui"
          },
          dataSources: [],
          id: "ui-risky-model",
          intentPlanId: "plan-model-ui",
          root: {
            component: "StatusBanner",
            id: "model-status",
            props: {
              text: "模型生成 UI",
              tone: "info"
            }
          },
          surface: "assistant",
          version: "liteasy-ui-dsl/v1"
        }),
      generateModelUxReview: async () =>
        JSON.stringify({
          errors: ["Button unreachable: primary action is below the fold"],
          valid: false
        })
    });

    expect(document.audit.generatedBy).toBe("rule");
    expect(document.id).toBe("fallback-plan-model-ui-ux_risk");
    expect(document.dataSources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          params: expect.objectContaining({
            reason: "ux_risk"
          }),
          sourceId: "runtime.context_view"
        })
      ])
    );
    expect(document.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionId: "theme.reset",
          id: "reset-theme"
        })
      ])
    );
  });

  test("returns auditable fallback UI when model generation fails before producing DSL", async () => {
    const document = await generateUIDslWithModelFallback(themePlan(), {
      generateModelDsl: async () => {
        throw new Error("model gateway unavailable");
      }
    });

    expect(document).toEqual(
      expect.objectContaining({
        actions: expect.arrayContaining([
          expect.objectContaining({
            actionId: "theme.reset",
            id: "reset-theme"
          })
        ]),
        audit: expect.objectContaining({
          generatedBy: "rule"
        }),
        dataSources: expect.arrayContaining([
          expect.objectContaining({
            params: expect.objectContaining({
              reason: "model_failure"
            }),
            sourceId: "runtime.context_view"
          })
        ]),
        id: "fallback-plan-model-ui-model_failure"
      })
    );
  });
});

describe("createModelAssistedUIDslGenerator", () => {
  test("routes runtime UI DSL generation through the model gateway and validators", async () => {
    const settings = createSettingsStore().getState();
    const requestBodies: string[] = [];
    const generator = createModelAssistedUIDslGenerator({
      modelTransport: async (request) => {
        requestBodies.push(request.body);
        const prompt = JSON.parse(request.body).prompt as string;
        const answer = prompt.includes("UX Validator")
          ? JSON.stringify({
              errors: [],
              valid: true
            })
          : JSON.stringify({
              actions: [],
              audit: {
                createdAt: "2026-07-05T00:00:00.000Z",
                generatedBy: "model",
                model: "gpt-5-mini",
                traceId: "trace-model-ui"
              },
              dataSources: [],
              id: "ui-model-runtime",
              intentPlanId: "plan-model-ui",
              root: {
                component: "StatusBanner",
                id: "model-status",
                props: {
                  text: "模型生成运行时 UI",
                  tone: "info"
                }
              },
              surface: "assistant",
              version: "liteasy-ui-dsl/v1"
            });

        return {
          json: async () => ({
            answer,
            execution: {
              backend: "dev_cloud",
              mode: "live",
              provider: "openai"
            }
          }),
          ok: true,
          status: 200
        };
      },
      settings: {
        ...settings,
        "models.cloud_proxy_endpoint": "https://liteasy.example.com/model-proxy"
      }
    });

    const document = await generator({
      plan: themePlan(),
      statusText: "已应用卡通风格。"
    });

    expect(JSON.parse(requestBodies[0])).toEqual(
      expect.objectContaining({
        model: "gpt-5-mini",
        provider: "openai",
        source: "cloud_proxy"
      })
    );
    expect(JSON.parse(requestBodies[0]).prompt).toContain("只输出 UIDslDocument JSON");
    expect(JSON.parse(requestBodies[1]).prompt).toContain("UX Validator");
    expect(document).toEqual(
      expect.objectContaining({
        audit: expect.objectContaining({
          generatedBy: "model",
          model: "gpt-5-mini"
        }),
        id: "ui-model-runtime",
        surface: "assistant"
      })
    );
  });

  test("returns auditable fallback when the gateway UX review flags model UI risk", async () => {
    const settings = createSettingsStore().getState();
    const generator = createModelAssistedUIDslGenerator({
      modelTransport: async (request) => {
        const prompt = JSON.parse(request.body).prompt as string;
        const answer = prompt.includes("UX Validator")
          ? JSON.stringify({
              errors: ["Cognitive load is too high for an assistant status card"],
              valid: false
            })
          : JSON.stringify({
              actions: [],
              audit: {
                createdAt: "2026-07-05T00:00:00.000Z",
                generatedBy: "model",
                model: "gpt-5-mini",
                traceId: "trace-model-ui-risk"
              },
              dataSources: [],
              id: "ui-model-risk",
              intentPlanId: "plan-model-ui",
              root: {
                component: "StatusBanner",
                id: "model-status",
                props: {
                  text: "模型生成运行时 UI",
                  tone: "info"
                }
              },
              surface: "assistant",
              version: "liteasy-ui-dsl/v1"
            });

        return {
          json: async () => ({
            answer,
            execution: {
              backend: "dev_cloud",
              mode: "live",
              provider: "openai"
            }
          }),
          ok: true,
          status: 200
        };
      },
      settings: {
        ...settings,
        "models.cloud_proxy_endpoint": "https://liteasy.example.com/model-proxy"
      }
    });

    const document = await generator({
      plan: themePlan(),
      statusText: "已应用卡通风格。"
    });

    expect(document).toEqual(
      expect.objectContaining({
        audit: expect.objectContaining({
          generatedBy: "rule"
        }),
        dataSources: expect.arrayContaining([
          expect.objectContaining({
            params: expect.objectContaining({
              reason: "ux_risk"
            }),
            sourceId: "runtime.context_view"
          })
        ]),
        id: "fallback-plan-model-ui-ux_risk"
      })
    );
  });
});
