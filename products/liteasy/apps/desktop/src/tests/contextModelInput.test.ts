import "fake-indexeddb/auto";
import { webcrypto } from "node:crypto";
import { beforeEach, expect, test, vi } from "vitest";
import { createDesktopAgentService } from "../app/controllers/agent/createDesktopAgentService";
import { createObjectRepository } from "../app/features/objects/objectRepository";
import { createObjectStorage } from "../app/features/objects/objectStorage";
import { refOf } from "../app/features/objects/object.types";
import { stageImage } from "../app/features/objects/objectAssets";
import { resolveContextSnapshot } from "../app/features/context/objectContext";
import { createSettingsStore } from "../app/features/settings/settings.store";

const { generateAnswer } = vi.hoisted(() => ({ generateAnswer: vi.fn(async () => ({ answer: "图中曲线需要结合实验条件解释。",
  trace: { backend: "test", mode: "live", provider: "openai", source: "direct_api" } })) }));
vi.mock("../app/features/models/modelRuntime", () => ({ createModelGatewayFromSettings: () => ({ generateAnswer }) }));

beforeEach(() => { vi.stubGlobal("crypto", webcrypto); generateAnswer.mockClear(); });

test("the actual object-context answer path supplies image bytes and exposes coverage without persisting binary", async () => {
  const scopeId = crypto.randomUUID();
  const repository = createObjectRepository(createObjectStorage(scopeId, () => scopeId), scopeId);
  const asset = await stageImage(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]), "image/png");
  const figure = await repository.createImage(asset, "实验图");
  const paper = await repository.create({ kind: "content.note", title: "长论文",
    content: { schema: "liteasy.note/v1", payload: { origin: "user", text: "实验背景与条件。".repeat(4000) } } });
  const api = createDesktopAgentService({
    resolveObjectContext: (request) => resolveContextSnapshot({ repository, refs: request.contextRefs ?? [], purpose: request.input.message,
      question: request.input.message, policy: "balanced", budget: 300 }),
    listCapabilities: () => [],
    getEnvironment: () => ({
      knowledge: { settings: createSettingsStore().getState(), selectedPapers: [], importedChunksByPaperId: {} },
      runtime: { contextView: { cloud: { connected: false }, workspace: { type: "local" },
        profile: { enabled: false, requiresConfirmation: false },
        selection: { selectedCount: 0, importedCount: 0, issues: [], locked: true, ready: true } } } as never,
    }),
  });
  const session = await api.createSession({ consumer: "frontend" });
  if (!session.ok) throw new Error(session.error.message);
  const response = await api.submitTurn({ sessionId: session.data.sessionId, idempotencyKey: "image-context",
    contextRefs: [refOf(figure), refOf(paper)], input: { mode: "qa", message: "解释图片和实验条件" } });
  expect(response).toMatchObject({ ok: true, data: { status: "completed" } });
  expect(generateAnswer).toHaveBeenCalledWith(expect.objectContaining({
    images: [{ label: "资料图片：实验图", mediaType: "image/png", base64: asset.base64 }],
    prompt: expect.stringContaining("这不是全文"),
  }));
  if (!response.ok) throw new Error(response.error.message);
  expect(response.data.events.find((event) => event.type === "assistant.message")).toMatchObject({ metadata: {
    contextCoverage: { total: 2, full: 1, partial: 1, omitted: 0, items: expect.arrayContaining([
      expect.objectContaining({ title: "长论文", status: "partial" }),
    ]) },
  } });
  expect(JSON.stringify(response)).not.toContain(asset.base64);
  api.dispose();
});
