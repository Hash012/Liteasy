import { afterEach, expect, test, vi } from "vitest";
import { generateAssistantAnswer } from "../app/features/assistant/generateAssistantAnswer";
import { createSettingsStore } from "../app/features/settings/settings.store";
import { getDirectModelConfig } from "../app/features/models/modelProviders";
import { deleteDirectModelKey, saveDirectModelKey } from "../app/features/models/directModelTransport";

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

test("an unsigned-in user can generate an assistant answer with a personal key without contacting cloud generation or audit", async () => {
  const store = createSettingsStore();
  store.apply({ intent: "update_setting", target: "models.connection_mode", value: "direct" });
  const settings = store.getState();
  const config = getDirectModelConfig(settings);
  await saveDirectModelKey(config, "fixture-key-for-transport-test");
  const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ choices: [{ message: { content: "这是一条测试传输返回的论文阅读回答。" }, finish_reason: "stop" }] }), { status: 200 }));
  vi.stubGlobal("fetch", fetchImpl);
  const accountTransport = vi.fn(() => { throw new Error("A Liteasy account was unexpectedly required"); });
  try {
    const result = await generateAssistantAnswer({
      importedChunksByPaperId: {}, mode: "qa", question: "怎样阅读论文？", selectedPapers: [], settings,
      modelTransport: accountTransport, auditTransport: accountTransport
    });
    expect(JSON.stringify(result)).toContain("这是一条测试传输返回的论文阅读回答。");
    expect(accountTransport).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe("https://api.openai.com/v1/chat/completions");
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ headers: { Authorization: "Bearer fixture-key-for-transport-test" } });
    expect(localStorage.getItem("liteasy.model-connection.v1")).not.toContain("fixture-key");
  } finally { await deleteDirectModelKey(config); }
});
