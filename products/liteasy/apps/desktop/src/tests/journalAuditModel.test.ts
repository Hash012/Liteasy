import { describe, expect, test } from "vitest";
import { createExecutionJournal } from "../app/features/generative-ui/executionJournal";
import {
  auditExecutionJournalTrace,
  createModelAssistedJournalAuditModel,
  generateJournalAuditWithModelFallback
} from "../app/features/generative-ui/journalAuditModel";
import { createSettingsStore } from "../app/features/settings/settings.store";

describe("auditExecutionJournalTrace", () => {
  test("projects journal facts into assistant audit UI without rewriting facts", () => {
    const journal = createExecutionJournal();
    journal.record({
      input: "让 UI 变成卡通风格",
      mode: "command",
      traceId: "trace-audit",
      type: "input"
    });
    journal.record({
      planId: "plan-audit",
      traceId: "trace-audit",
      type: "plan"
    });
    journal.record({
      actionId: "theme.apply_preset",
      result: "allow",
      traceId: "trace-audit",
      type: "policy"
    });
    journal.record({
      actionId: "theme.apply_preset",
      message: "已应用卡通风格。",
      traceId: "trace-audit",
      type: "action_result"
    });

    const before = journal.getTrace("trace-audit");
    const document = auditExecutionJournalTrace(before, {
      traceId: "trace-audit"
    });

    expect(document).toEqual(
      expect.objectContaining({
        audit: expect.objectContaining({
          generatedBy: "rule",
          traceId: "trace-audit"
        }),
        surface: "assistant"
      })
    );
    expect(document.root).toEqual(
      expect.objectContaining({
        children: expect.arrayContaining([
          expect.objectContaining({
            component: "StatusBanner",
            props: expect.objectContaining({
              text: "执行审计：已回放 4 条 journal 事实。"
            })
          }),
          expect.objectContaining({
            component: "Panel",
            props: expect.objectContaining({
              text: "输入 1 条 · 计划 1 条 · 策略 1 条 · 执行 1 条 · UI 0 条"
            })
          })
        ])
      })
    );
    expect(journal.getTrace("trace-audit")).toEqual(before);
  });

  test("appends model audit commentary without rewriting journal facts", async () => {
    const journal = createExecutionJournal();
    journal.record({
      input: "打开组织",
      mode: "command",
      traceId: "trace-model-audit",
      type: "input"
    });
    journal.record({
      planId: "plan-open-organization",
      traceId: "trace-model-audit",
      type: "plan"
    });
    journal.record({
      actionId: "panel.open",
      result: "allow",
      traceId: "trace-model-audit",
      type: "policy"
    });
    journal.record({
      actionId: "panel.open",
      message: "已打开组织面板。",
      traceId: "trace-model-audit",
      type: "action_result"
    });

    const before = journal.getTrace("trace-model-audit");
    const document = await generateJournalAuditWithModelFallback(before, {
      generateModelAudit: async () =>
        JSON.stringify({
          summary: "模型审计：低风险面板动作已按策略执行。",
          verdict: "pass"
        }),
      model: "gpt-5-mini-auditor",
      traceId: "trace-model-audit"
    });

    expect(document.audit).toEqual(
      expect.objectContaining({
        generatedBy: "model",
        model: "gpt-5-mini-auditor",
        traceId: "trace-model-audit"
      })
    );
    expect(document.dataSources[0]).toEqual(
      expect.objectContaining({
        params: expect.objectContaining({
          factCount: 4,
          traceId: "trace-model-audit"
        })
      })
    );
    expect(document.root.children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "journal-audit-facts",
          props: expect.objectContaining({
            text: "输入 1 条 · 计划 1 条 · 策略 1 条 · 执行 1 条 · UI 0 条"
          })
        }),
        expect.objectContaining({
          id: "journal-audit-model-commentary",
          props: expect.objectContaining({
            text: "模型审计：低风险面板动作已按策略执行。"
          })
        })
      ])
    );
    expect(journal.getTrace("trace-model-audit")).toEqual(before);
  });

  test("falls back to rule audit when model commentary is invalid or unsafe", async () => {
    const journal = createExecutionJournal();
    journal.record({
      actionId: "theme.apply_preset",
      message: "已应用卡通风格。",
      traceId: "trace-bad-model-audit",
      type: "action_result"
    });

    const document = await generateJournalAuditWithModelFallback(
      journal.getTrace("trace-bad-model-audit"),
      {
        generateModelAudit: async () =>
          JSON.stringify({
            summary: "function () { document.querySelector('.app').remove() }",
            verdict: "pass"
          }),
        model: "gpt-5-mini-auditor",
        traceId: "trace-bad-model-audit"
      }
    );

    expect(document.audit.generatedBy).toBe("rule");
    expect(document.root.children ?? []).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "journal-audit-model-commentary"
        })
      ])
    );
  });

  test("routes optional journal audit through the model gateway", async () => {
    const settings = createSettingsStore().getState();
    let requestBody = "";
    const auditModel = createModelAssistedJournalAuditModel({
      modelTransport: async (request) => {
        requestBody = request.body;
        return {
          json: async () => ({
            answer: JSON.stringify({
              summary: "模型审计：journal 与 UI 投影一致。",
              verdict: "pass"
            }),
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

    const document = await auditModel({
      trace: [
        {
          actionId: "theme.apply_preset",
          message: "已应用卡通风格。",
          traceId: "trace-gateway-audit",
          type: "action_result"
        }
      ],
      traceId: "trace-gateway-audit"
    });

    expect(JSON.parse(requestBody)).toEqual(
      expect.objectContaining({
        model: "gpt-5-mini",
        provider: "openai",
        source: "cloud_proxy"
      })
    );
    expect(JSON.parse(requestBody).prompt).toContain("不改写 journal 事实");
    expect(document.audit).toEqual(
      expect.objectContaining({
        generatedBy: "model",
        model: "gpt-5-mini"
      })
    );
  });
});
