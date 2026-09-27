import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { AssistantModelPicker } from "../app/features/models/AssistantModelPicker";
import { getModelProvider } from "../app/features/models/modelProviders";
import { deleteDirectModelKey, saveDirectModelKey } from "../app/features/models/directModelTransport";
import { loadVerifiedModelProfiles, rememberVerifiedModel, verifiedModelProfilesKey } from "../app/features/models/verifiedModelProfiles";
import { createSettingsStore } from "../app/features/settings/settings.store";
import { getActiveModelProvider, getModelForSettings } from "../app/features/models/modelPolicy";
import { createModelGatewayFromSettings } from "../app/features/models/modelRuntime";

const fast = { ...getModelProvider("custom"), endpoint: "https://fast.example.test/v1", model: "reader-fast" };
const careful = { ...getModelProvider("anthropic"), endpoint: "https://careful.example.test/v1", model: "reader-careful" };
beforeEach(() => { localStorage.clear(); });

test("retains multiple normalized profiles and never stores credentials or arbitrary fields", () => {
  rememberVerifiedModel({ ...fast, apiKey: "must-not-persist" } as typeof fast);
  rememberVerifiedModel({ ...fast, endpoint: `${fast.endpoint}/` });
  rememberVerifiedModel(careful);
  expect(loadVerifiedModelProfiles()).toHaveLength(2);
  expect(localStorage.getItem(verifiedModelProfilesKey)).not.toContain("must-not-persist");
  const stored = JSON.parse(localStorage.getItem(verifiedModelProfilesKey)!);
  localStorage.setItem(verifiedModelProfilesKey, JSON.stringify([null, { config: {} }, ...stored]));
  expect(loadVerifiedModelProfiles()).toHaveLength(2);
});

test("changing or deleting a key invalidates every model sharing that credential scope", async () => {
  await saveDirectModelKey(fast, "first-test-key");
  rememberVerifiedModel(fast);
  rememberVerifiedModel({ ...fast, model: "other-fast" });
  rememberVerifiedModel(careful);
  await saveDirectModelKey(fast, "replacement-test-key");
  expect(loadVerifiedModelProfiles().map((profile) => profile.config.model)).toEqual(["reader-careful"]);
  await deleteDirectModelKey(careful);
  expect(loadVerifiedModelProfiles()).toEqual([]);
});

test("offers only verified credential-backed models and switches the actual generation endpoint and protocol", async () => {
  await saveDirectModelKey(fast, "test-fast-key");
  await saveDirectModelKey(careful, "test-careful-key");
  rememberVerifiedModel(fast); rememberVerifiedModel(careful);
  rememberVerifiedModel({ ...fast, endpoint: "https://missing.example.test/v1", model: "no-key" });
  const store = createSettingsStore();
  const onSettingsChanged = vi.fn();
  render(<AssistantModelPicker settingsStore={store} onSettingsChanged={onSettingsChanged} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /^切换模型：/ }));
  const choices = await screen.findByRole("group", { name: "已验证模型" });
  expect(within(choices).getAllByRole("button")).toHaveLength(2);
  expect(within(choices).queryByText("no-key")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("搜索可用模型"), { target: { value: "reader-careful" } });
  await user.click(within(choices).getByRole("button", { name: /reader-careful/ }));
  await waitFor(() => expect(onSettingsChanged).toHaveBeenCalledOnce());
  expect(store.getState()["models.direct_protocol"]).toBe("anthropic");
  expect(store.getState()["models.direct_endpoint"]).toBe(careful.endpoint);
  const transport = vi.fn(async () => JSON.stringify({ content: [{ type: "text", text: "selected model answered" }], stop_reason: "end_turn" }));
  const result = await createModelGatewayFromSettings(store.getState(), { directTransport: transport }).generateAnswer({
    provider: getActiveModelProvider(store.getState()), model: getModelForSettings(store.getState()), prompt: "test request"
  });
  expect(result.answer).toBe("selected model answered");
  expect(transport).toHaveBeenCalledWith(expect.objectContaining({ config: expect.objectContaining({ model: "reader-careful", endpoint: careful.endpoint, protocol: "anthropic" }) }));
  expect(createSettingsStore().getState()["models.direct_model"]).toBe("reader-careful");
});

test("removes a model when its credential is deleted and disables switching while a task is running", async () => {
  await saveDirectModelKey(fast, "test-fast-key"); rememberVerifiedModel(fast);
  const store = createSettingsStore();
  const { rerender } = render(<AssistantModelPicker settingsStore={store} disabled />);
  expect(screen.getByRole("button", { name: /^切换模型：/ })).toBeDisabled();
  rerender(<AssistantModelPicker settingsStore={store} />);
  await userEvent.setup().click(screen.getByRole("button", { name: /^切换模型：/ }));
  await screen.findByRole("button", { name: /reader-fast/ });
  await act(async () => { await deleteDirectModelKey(fast); });
  await screen.findByText(/暂无已验证模型/);
  expect(screen.queryByRole("button", { name: /reader-fast/ })).not.toBeInTheDocument();
});
