import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { useDeviceControlController } from "../app/controllers/useDeviceControlController";
import { emptyDeviceJournal } from "../app/features/device-control/deviceControl.types";
import type { SettingsState } from "../app/features/settings/settings.types";

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke, isTauri: () => true }));
test("late account journals stay hidden and desktop registration waits for explicit opt-in", async () => {
  let loadA!: (value: unknown) => void;
  native.invoke.mockImplementation(async (command, input) => {
    if (command === "device_control_journal" && !input.snapshot) {
      if (input.subject === "a") return new Promise((resolve) => { loadA = resolve; });
      return emptyDeviceJournal();
    }
    return {};
  });
  const properties = (userId: string) => ({ endpoint: "https://api.example", libraryRoot: "/library", session: { userId, sessionId: `token-${userId}`, email: "user@example.com", name: "User", expiresAt: "later" },
    getSettings: () => ({} as SettingsState), getPapers: () => [], getTransport: () => undefined, openPaper: vi.fn(), refreshLibrary: async () => {} });
  const hook = renderHook((props) => useDeviceControlController(props), { initialProps: properties("a") });
  await waitFor(() => expect(loadA).toBeTypeOf("function"));
  hook.rerender(properties("b")); await waitFor(() => expect(hook.result.current.available).toBe(true));
  await act(async () => loadA({ ...emptyDeviceJournal(), enabled: true, name: "Other account" }));
  expect(hook.result.current.journal.enabled).toBe(false); expect(hook.result.current.journal.name).toBeUndefined();
  expect(native.invoke.mock.calls.filter(([command]) => command === "device_control_request")).toHaveLength(0);
  await act(async () => hook.result.current.configure(true, false, "办公室"));
  const requests = native.invoke.mock.calls.filter(([command]) => command === "device_control_request");
  expect(requests).toHaveLength(1);
  expect(requests[0][1]).toMatchObject({ subject: "b", sessionId: "token-b", route: "devices/heartbeat", body: { capabilities: ["open-document", "extract-text", "sync-library"] } });
  hook.unmount();
});
