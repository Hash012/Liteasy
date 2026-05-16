import { act, renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { createSettingsStore } from "../app/features/settings/settings.store";
import { useModelSettingsActions } from "../app/features/models/useModelSettingsActions";

function renderActions() {
  const settingsStore = createSettingsStore();
  const onSettingsChanged = vi.fn();
  const hook = renderHook(() =>
    useModelSettingsActions({
      onSettingsChanged,
      settingsStore
    })
  );

  return {
    onSettingsChanged,
    result: hook.result,
    settingsStore
  };
}

describe("useModelSettingsActions", () => {
  test("applies cloud model policy snapshots", () => {
    const { onSettingsChanged, result, settingsStore } = renderActions();

    act(() =>
      result.current.applyModelPolicySnapshot({
        "models.cloud_proxy_endpoint": "https://liteasy.example.com/model-proxy",
        "models.default_provider": "deepseek"
      })
    );
    expect(settingsStore.getState()["models.cloud_proxy_endpoint"]).toBe("https://liteasy.example.com/model-proxy");
    expect(settingsStore.getState()["models.default_provider"]).toBe("deepseek");
    expect(onSettingsChanged).toHaveBeenLastCalledWith(settingsStore.getState());
  });

  test("applies local dev cloud defaults for account login", () => {
    const { result, settingsStore } = renderActions();

    act(() => result.current.applyLocalDevCloudDefaults());

    expect(settingsStore.getState()["models.cloud_proxy_endpoint"]).toBe("http://127.0.0.1:8787");
    expect(settingsStore.getState()["models.control_plane_endpoint"]).toBe("http://127.0.0.1:8787");
  });
});
