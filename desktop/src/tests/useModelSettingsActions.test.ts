import { act, renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { createSettingsStore } from "../app/features/settings/settings.store";
import type { SettingsState } from "../app/features/settings/settings.types";
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
  test("updates model access mode and applies policy snapshots", () => {
    const { onSettingsChanged, result, settingsStore } = renderActions();

    act(() => result.current.setModelAccessMode("local_direct"));
    expect(settingsStore.getState()["models.access_mode"]).toBe("local_direct");
    expect(onSettingsChanged).toHaveBeenLastCalledWith(settingsStore.getState());

    act(() =>
      result.current.applyModelPolicySnapshot({
        "models.local_direct_enabled": true,
        "models.local_direct_endpoint": "http://127.0.0.1:9000"
      })
    );
    expect(settingsStore.getState()["models.local_direct_enabled"]).toBe(true);
    expect(settingsStore.getState()["models.local_direct_endpoint"]).toBe("http://127.0.0.1:9000");
  });

  test("applies local dev cloud defaults for account login", () => {
    const { result, settingsStore } = renderActions();

    act(() => result.current.applyLocalDevCloudDefaults());

    expect(settingsStore.getState()["models.cloud_proxy_endpoint"]).toBe("http://127.0.0.1:8787");
    expect(settingsStore.getState()["models.control_plane_endpoint"]).toBe("http://127.0.0.1:8787");
  });

  test("disabling local direct falls back from local direct access mode to cloud proxy", () => {
    const { result, settingsStore } = renderActions();

    act(() =>
      result.current.applyModelPolicySnapshot({
        "models.access_mode": "local_direct" as SettingsState["models.access_mode"],
        "models.local_direct_enabled": true
      })
    );
    expect(settingsStore.getState()["models.access_mode"]).toBe("local_direct");

    act(() => result.current.setLocalDirectEnabled(false));

    expect(settingsStore.getState()["models.local_direct_enabled"]).toBe(false);
    expect(settingsStore.getState()["models.access_mode"]).toBe("cloud_proxy");
  });
});
