import { afterEach, expect, test, vi } from "vitest";
import { createDesktopAgentService } from "../app/controllers/agent/createDesktopAgentService";
import { createAgentApplicationService } from "../app/controllers/agent/agentApplicationService";
import { createGuideGenerator } from "../app/features/paper-reading/literatureGuide";
import { createSettingsStore } from "../app/features/settings/settings.store";
import { presetGenerationPrompt } from "../app/features/ai-prompts/generationPrompts";
import { runAgentArtifactAnalysis } from "../app/controllers/agent/runAgentArtifactAnalysis";
import type { FrontendAgentClient } from "../app/features/agent-api/frontendAgentClient";
import type { ModelTransportRequest } from "../app/features/models/modelHttpClient";

afterEach(() => localStorage.clear());

test("sends an isolated system prompt to the model with resource references and keeps the global preference", async () => {
  const settings = createSettingsStore();
  settings.apply({ intent: "update_setting", target: "ai.prompts.assistant", value: "长期对话偏好" });
  const transport = vi.fn(async (_request: ModelTransportRequest) => ({ ok: true, status: 200, json: async () => ({
    answer: "解释", execution: { mode: "live", provider: "openai" }
  }) }));
  const api = createDesktopAgentService({
    resolveObjectContext: async () => ({ snapshotId: "selected", scopeId: "local", purpose: "解释", createdAt: new Date().toISOString(), entries: [], tokens: 0 }),
    getEnvironment: () => ({ knowledge: { importedChunksByPaperId: {}, selectedPapers: [], settings: settings.getState(), modelTransport: transport }, runtime: {} as never })
  });
  const session = await api.createSession({ consumer: "frontend" });
  if (!session.ok) throw new Error(session.error.message);
  const prompt = `${presetGenerationPrompt("selection_explanation", "intuitive")}\n用二维向量举例`;
  const request = { sessionId: session.data.sessionId, idempotencyKey: "custom", contextRefs: [{ objectId: "selection", revision: "1" }], input: { mode: "qa" as const, message: "解释选段", systemPrompt: prompt } };
  const run = await api.submitTurn(request);
  expect(run).toMatchObject({ ok: true, data: { status: "completed", input: { systemPrompt: prompt } } });
  expect(JSON.parse(transport.mock.calls[0][0].body).prompt).toContain(prompt);
  expect(JSON.parse(transport.mock.calls[0][0].body).prompt).not.toContain("长期对话偏好");
  const conflict = await api.submitTurn({ ...request, input: { ...request.input, systemPrompt: "另一个偏好" } });
  expect(conflict).toMatchObject({ ok: false, error: { code: "idempotency_conflict" } });
  const next = await api.submitTurn({ ...request, idempotencyKey: "global", input: { mode: "qa", message: "解释另一段" } });
  expect(next).toMatchObject({ ok: true, data: { status: "completed" } });
  expect(JSON.parse(transport.mock.calls[1][0].body).prompt).toContain("长期对话偏好");
  expect(settings.getState()["ai.prompts.assistant"]).toBe("长期对话偏好");
});

test("uses centralized annotation prompts and lets the current run override them", async () => {
  const settings = createSettingsStore();
  settings.apply({ intent: "update_setting", target: "ai.prompts.literature_annotation", value: "全局标注重点" });
  const transport = vi.fn(async (_request: ModelTransportRequest) => ({ ok: true, status: 200, json: async () => ({
    answer: JSON.stringify({ level: "balanced", items: [] }), execution: { mode: "live", provider: "openai" }
  }) }));
  const generate = createGuideGenerator(() => settings.getState(), () => ({ level: "auto", context: "" }), transport);
  const input = { title: "Paper", abstract: "Abstract", mode: "balanced" as const, pages: [{ page: 1, text: "Source text" }], signal: new AbortController().signal };
  await generate(input);
  expect(JSON.parse(transport.mock.calls[0][0].body).prompt).toContain("全局标注重点");
  await generate({ ...input, systemPrompt: "本次公式直觉" });
  const body = JSON.parse(transport.mock.calls[1][0].body);
  expect(body.prompt).toContain("本次公式直觉");
  expect(body.prompt).not.toContain("全局标注重点");
  expect(body.outputFormat.schema.required).toEqual(["level", "items"]);
});

test("artifact launches carry prompt configuration independently of resource references", async () => {
  const send = vi.fn(async () => ({ ok: true as const, data: { status: "completed", events: [] } }));
  const client = { send, subscribe: () => () => {} } as unknown as FrontendAgentClient;
  const refs = [{ objectId: "note", revision: "1" }];
  await runAgentArtifactAnalysis(client, "ppt", undefined, { contextRefs: refs, systemPrompt: "围绕三个关键问题组织演示" });
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ artifactType: "ppt", systemPrompt: "围绕三个关键问题组织演示" }), expect.objectContaining({ contextRefs: refs }));
  expect(send.mock.calls[0][1]).not.toHaveProperty("attachments");
});

test("validates prompt lengths before executing a request", async () => {
  const execute = vi.fn(async () => ({ message: "answer" }));
  const api = createAgentApplicationService({ executeKnowledge: execute, executeCommand: () => ({ events: [], settingsChanged: false }) });
  const session = await api.createSession({ consumer: "frontend" });
  if (!session.ok) throw new Error(session.error.message);
  const result = await api.submitTurn({ sessionId: session.data.sessionId, idempotencyKey: "too-long", input: { mode: "qa", message: "解释", systemPrompt: "x".repeat(4001) } });
  expect(result).toMatchObject({ ok: false, error: { code: "invalid_request" } });
  expect(execute).not.toHaveBeenCalled();
});
