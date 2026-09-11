import { afterEach, expect, test, vi } from "vitest";
import { directModelTransport } from "../app/features/models/directModelTransport";
import { getModelProvider } from "../app/features/models/modelProviders";

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: native.invoke,
  Channel: class { onmessage = (_bytes: number[]) => {}; }
}));

afterEach(() => vi.clearAllMocks());

test("waits for the ordered stream completion marker even when the IPC command finishes first", async () => {
  const onChunk = vi.fn();
  native.invoke.mockImplementation(async (_command, args) => {
    setTimeout(() => {
      args.chunks.onmessage([65]);
      args.chunks.onmessage([]);
    }, 10);
    return "";
  });
  await directModelTransport({ config: getModelProvider("openai"), body: { stream: true }, onChunk });
  expect(onChunk).toHaveBeenCalledWith(new Uint8Array([65]));
});

test("cancels the native request and rejects instead of returning partial success", async () => {
  let rejectRequest: (error: Error) => void = () => {};
  native.invoke.mockImplementation((command) => {
    if (command === "cancel_direct_model_request") { rejectRequest(new Error("cancelled")); return Promise.resolve(); }
    return new Promise((_resolve, reject) => { rejectRequest = reject; });
  });
  const controller = new AbortController();
  const promise = directModelTransport({ config: getModelProvider("openai"), body: { stream: true }, onChunk: vi.fn(), signal: controller.signal });
  controller.abort();
  await expect(promise).rejects.toThrow();
  expect(native.invoke).toHaveBeenCalledWith("cancel_direct_model_request", expect.objectContaining({ requestId: expect.any(String) }));
});
