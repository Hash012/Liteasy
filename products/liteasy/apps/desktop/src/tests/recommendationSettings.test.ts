import { afterEach, describe, expect, test, vi } from "vitest";
import { createSettingsStore } from "../app/features/settings/settings.store";
import { executeAction } from "../app/features/skills/actionRegistry";

const storageKey = "liteasy.recommendation-settings.v1";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.removeItem(storageKey);
});

describe("recommendation style preferences", () => {
  test("defaults existing installations to balanced and retains a chosen style after restart", () => {
    const store = createSettingsStore();
    expect(store.getState()["network.recommendation.style"]).toBe("balanced");
    store.apply({ intent: "update_setting", target: "network.recommendation.style", value: "classic" });
    expect(createSettingsStore().getState()["network.recommendation.style"]).toBe("classic");
  });

  test.each(["{", "null", '{"network.recommendation.style":"unknown"}', '{"network.recommendation.style":"toString"}'])(
    "ignores invalid persisted preferences: %s",
    (value) => {
      localStorage.setItem(storageKey, value);
      expect(createSettingsStore().getState()["network.recommendation.style"]).toBe("balanced");
    }
  );

  test("rejects invalid settings updates without replacing the current preference", () => {
    const store = createSettingsStore();
    store.apply({ intent: "update_setting", target: "network.recommendation.style", value: "frontier" });
    expect(() => store.apply({
      intent: "update_setting", target: "network.recommendation.style", value: "unknown"
    })).toThrow("invalid_recommendation_style");
    expect(createSettingsStore().getState()["network.recommendation.style"]).toBe("frontier");
  });

  test("keeps preference changes usable when local storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    const store = createSettingsStore();
    store.apply({ intent: "update_setting", target: "network.recommendation.style", value: "exploratory" });
    expect(store.getState()["network.recommendation.style"]).toBe("exploratory");
  });

  test("lets Agent actions set the same persistent style with a readable confirmation", async () => {
    const result = await executeAction({
      actionId: "settings.update",
      input: { target: "network.recommendation.style", value: "frontier" }
    }, { settingsStore: createSettingsStore() });
    expect(result.message).toBe("已更新 推荐风格：追踪前沿");
    expect(createSettingsStore().getState()["network.recommendation.style"]).toBe("frontier");
  });
});
