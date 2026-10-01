import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, vi } from "vitest";
import { DeviceControlService, emptyDeviceState } from "../../../../packages/device-control/src/service.mjs";
import { DeviceExecutor, type DeviceExecutorPort } from "../app/features/device-control/deviceExecutor";
import { emptyDeviceJournal, type DeviceJournal, type DeviceSnapshot, type DeviceTask } from "../app/features/device-control/deviceControl.types";

async function fixture() {
  let now = 1_000_000; const states = new Map();
  const service = new DeviceControlService({ async transaction(subject: string, work: (state: unknown) => unknown) {
    const state = structuredClone(states.get(subject) ?? emptyDeviceState()); const result = work(state); states.set(subject, state); return result;
  } }, { now: () => now });
  const device = (name: string, capabilities: string[] = []) => ({ deviceId: randomUUID(), secret: randomBytes(32).toString("base64url"), name, capabilities });
  const mobile = device("Phone"); const desktop = device("Desktop", ["open-document"]);
  await service.register("owner", "mobile", mobile); await service.register("owner", "desktop", desktop);
  await service.pair("owner", mobile, await service.pairCode("owner", desktop));
  const { task } = await service.enqueue("owner", mobile, { operationId: randomUUID(), desktopId: desktop.deviceId, kind: "open-document", document: { documentId: "paper", contentHash: "a".repeat(64), title: "Paper" } });
  let saved: DeviceJournal = { ...emptyDeviceJournal(), enabled: true };
  const effect = vi.fn(async () => {
    expect(saved.pending?.phase).toBe("executing");
    expect((await service.list("owner", "mobile", mobile)).tasks[0].status).toBe("running");
    return { message: "Opened" };
  });
  const port: DeviceExecutorPort = {
    request: async <T,>(route: string, body?: Record<string, unknown>) => {
      if (route === "devices") return await service.list("owner", "desktop", desktop) as T;
      if (route === "tasks/claim") return await service.claim("owner", desktop) as T;
      const [, id, action] = route.split("/");
      return await service.updateTask("owner", desktop, id, action, body) as T;
    },
    save: async (value) => { saved = structuredClone(value); }, heartbeat: async () => {}, changed: vi.fn(), prepare: vi.fn(async () => effect)
  };
  return { service, port, effect, mobile, desktop, task, saved: () => structuredClone(saved), advance: (ms: number) => { now += ms; },
    result: async () => (await service.list("owner", "mobile", mobile)).tasks[0] as DeviceTask };
}
test("lost receipt replies and process restarts never repeat a desktop effect", async () => {
  const f = await fixture(); const request = f.port.request; let drop = true;
  f.port.request = async (route, body) => { const result = await request(route, body); if (route.endsWith("/receipt") && drop) { drop = false; throw new Error("Lost response"); } return result as never; };
  await expect(new DeviceExecutor(f.saved(), f.port).tick()).rejects.toThrow("Lost response");
  expect(f.saved().pending?.receipt?.status).toBe("succeeded"); expect((await f.result()).status).toBe("succeeded");
  await new DeviceExecutor(f.saved(), f.port).tick();
  expect(f.saved().pending).toBeNull(); expect(f.effect).toHaveBeenCalledTimes(1);
});
test("unknown start acceptance is recovered as uncertain without executing", async () => {
  const f = await fixture(); const request = f.port.request;
  f.port.request = async (route, body) => { const result = await request(route, body); if (route.endsWith("/start")) throw new Error("Unknown start"); return result as never; };
  await expect(new DeviceExecutor(f.saved(), f.port).tick()).rejects.toThrow("Unknown start");
  await new DeviceExecutor(f.saved(), f.port).tick();
  expect((await f.result()).status).toBe("uncertain"); expect(f.effect).not.toHaveBeenCalled();
});
test("attachments defer until ready and concurrent polls cannot claim twice", async () => {
  const f = await fixture(); const runner = new DeviceExecutor(f.saved(), f.port);
  f.port.prepare = vi.fn(async () => null);
  await Promise.all([runner.tick(), runner.tick()]); expect((await f.result()).status).toBe("waiting-input");
  expect(f.port.prepare).toHaveBeenCalledTimes(1); expect(f.effect).not.toHaveBeenCalled();
  f.advance(61_000); f.port.prepare = async () => f.effect;
  await runner.tick(); expect((await f.result()).status).toBe("succeeded"); expect(f.effect).toHaveBeenCalledOnce();
});
test("a failed result write cannot acknowledge completion or cause effects on recovery", async () => {
  const f = await fixture(); const save = f.port.save;
  f.port.save = async (value) => { if (value.pending?.receipt) throw new Error("Disk full"); await save(value); };
  await expect(new DeviceExecutor(f.saved(), f.port).tick()).rejects.toThrow("Disk full");
  expect((await f.result()).status).toBe("running"); expect(f.saved().pending?.phase).toBe("executing");
  f.port.save = save;
  await new DeviceExecutor(f.saved(), f.port).tick();
  expect((await f.result()).status).toBe("uncertain"); expect(f.effect).toHaveBeenCalledOnce();
});
test("phone cancellation interrupts cooperative desktop work and returns a receipt", async () => {
  vi.useFakeTimers();
  try {
    const f = await fixture(); let executing = false;
    f.port.prepare = async () => async (signal) => new Promise((_, reject) => { executing = true; signal.addEventListener("abort", () => reject(new Error("Cancelled")), { once: true }); });
    const running = new DeviceExecutor(f.saved(), f.port).tick();
    await vi.waitFor(() => expect(executing).toBe(true));
    await f.service.cancel("owner", f.mobile, f.task.taskId);
    await vi.advanceTimersByTimeAsync(25_000); await running;
    expect((await f.result()).status).toBe("cancelled");
  } finally { vi.useRealTimers(); }
});
