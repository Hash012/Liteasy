import { agentContextLimit, withModelContextBudget } from "../app/features/context/modelContextBudget";
import { createSettingsStore } from "../app/features/settings/settings.store";

afterEach(() => localStorage.clear());

test("rejects oversized requests before a provider call and accounts for schemas and images", async () => {
  const generateAnswer = vi.fn();
  const report = vi.fn();
  const gateway = withModelContextBudget({ generateAnswer }, 4096, report);
  await expect(gateway.generateAnswer({ model: "test", provider: "test", prompt: "x".repeat(10000) }))
    .rejects.toThrow("上下文预算");
  await expect(gateway.generateAnswer({ model: "test", provider: "test", prompt: "brief",
    outputFormat: { name: "large", strict: true, schema: { description: "x".repeat(10000) } } })).rejects.toThrow("上下文预算");
  await expect(gateway.generateAnswer({ model: "test", provider: "test", prompt: "brief",
    images: Array.from({ length: 3 }, () => ({ label: "figure", mediaType: "image/png", base64: "AAAAAAAAAAAAAAAA" })) })).rejects.toThrow("上下文预算");
  expect(generateAnswer).not.toHaveBeenCalled();
  expect(report).toHaveBeenLastCalledWith(expect.objectContaining({ maxTokens: 4096, estimated: true }));
});

test("persists an explicitly chosen budget and normalizes malformed older preferences", () => {
  localStorage.setItem("liteasy.model-connection.v1", JSON.stringify({ "assistant.context_window": "-1" }));
  const store = createSettingsStore();
  expect(store.getState()["assistant.context_window"]).toBe("32768");
  expect(() => store.apply({ intent: "update_setting", target: "assistant.context_window", value: "1024" })).toThrow();
  store.apply({ intent: "update_setting", target: "assistant.context_window", value: "65536" });
  expect(createSettingsStore().getState()["assistant.context_window"]).toBe("65536");
  expect(agentContextLimit("NaN")).toBe(32768);
});
