import type { DeviceJournal, DeviceSnapshot, DeviceTask, TaskReceipt, TaskResult } from "./deviceControl.types";

export type PreparedDeviceTask = (signal: AbortSignal) => Promise<TaskResult>;
export type DeviceExecutorPort = {
  request: <T>(route: string, body?: Record<string, unknown>, method?: "GET" | "POST" | "DELETE") => Promise<T>;
  save: (journal: DeviceJournal) => Promise<void>;
  prepare: (task: DeviceTask) => Promise<PreparedDeviceTask | null>;
  changed: (snapshot: DeviceSnapshot) => void;
  heartbeat: () => Promise<void>;
};

/** One executor owns one account journal. Network receipts may replay; effects never do. */
export class DeviceExecutor {
  private busy = false;
  private stopped = false;
  private abort?: AbortController;
  private writes = Promise.resolve();
  constructor(readonly journal: DeviceJournal, private readonly port: DeviceExecutorPort) {}
  stop() { this.stopped = true; this.abort?.abort(); }
  private save() {
    const snapshot = structuredClone(this.journal);
    const operation = this.writes.catch(() => {}).then(() => this.port.save(snapshot));
    this.writes = operation; return operation;
  }
  async configure(enabled: boolean, allowSummary: boolean, name: string) {
    this.journal.enabled = enabled; this.journal.allowSummary = allowSummary; this.journal.name = name.trim().slice(0, 100) || "Liteasy 桌面";
    if (!enabled) this.abort?.abort();
    await this.save(); await this.port.heartbeat();
  }
  private async sendReceipt() {
    const pending = this.journal.pending;
    if (!pending?.receipt) return;
    await this.save(); // Also retries a failed durable write from the preceding tick.
    await this.port.request(`tasks/${pending.task.taskId}/receipt`, { leaseToken: pending.task.leaseToken, ...pending.receipt });
    this.journal.pending = null; await this.save();
  }
  private async recover(snapshot: DeviceSnapshot) {
    const pending = this.journal.pending;
    if (!pending) return;
    const remote = snapshot.tasks.find((task) => task.taskId === pending.task.taskId);
    if (!remote || ["succeeded", "failed", "cancelled", "queued", "waiting-input"].includes(remote.status)) {
      this.journal.pending = null; await this.save(); return;
    }
    if (remote.status === "leased") return; // No accepted start: wait for the server lease to expire.
    if (!pending.receipt) {
      pending.phase = "receipt";
      pending.receipt = { status: "uncertain", result: { message: "桌面在执行期间退出，未自动重跑。请核查文献、同步记录或模型用量后再决定是否重新发送。" } };
      await this.save();
    }
    await this.sendReceipt();
  }
  async tick() {
    if (this.busy || this.stopped) return;
    this.busy = true;
    try {
      await this.port.heartbeat();
      const snapshot = await this.port.request<DeviceSnapshot>("devices");
      if (this.stopped) return;
      this.port.changed(snapshot);
      await this.recover(snapshot);
      if (this.journal.pending || !this.journal.enabled || this.stopped) return;
      const { task } = await this.port.request<{ task: DeviceTask | null }>("tasks/claim", {});
      if (!task || this.stopped) return;
      const work = await this.port.prepare(task);
      if (!work) { await this.port.request(`tasks/${task.taskId}/defer`, { leaseToken: task.leaseToken }); return; }
      if (!this.journal.enabled || this.stopped) return;
      // The durable marker precedes both start and effects. On uncertainty recovery never invokes work.
      this.journal.pending = { task, phase: "executing" }; await this.save();
      await this.port.request(`tasks/${task.taskId}/start`, { leaseToken: task.leaseToken });
      if (this.stopped || !this.journal.enabled) return;
      const abort = new AbortController(); this.abort = abort;
      let cancelled = false; let disconnected = false; let updating = false;
      const progress = async () => {
        if (updating || this.stopped) return;
        updating = true;
        try {
          const result = await this.port.request<{ cancelRequested?: boolean }>(`tasks/${task.taskId}/progress`, { leaseToken: task.leaseToken, progress: 10 });
          if (result.cancelRequested) { cancelled = true; abort.abort(); }
        } catch { disconnected = true; abort.abort(); }
        finally { updating = false; }
      };
      const timer = setInterval(() => { void progress(); }, 25_000);
      let receipt: TaskReceipt;
      try {
        await progress(); abort.signal.throwIfAborted();
        receipt = { status: "succeeded", result: await work(abort.signal) };
      } catch (error) {
        receipt = { status: cancelled ? "cancelled" : disconnected || this.stopped || !this.journal.enabled ? "uncertain" : "failed",
          result: { message: cancelled ? "任务已停止；停止前已经完成的操作仍保留。" : abort.signal.aborted ? "任务已中断，请检查桌面的实际结果。" : "桌面未能完成此任务。" },
          error: error instanceof Error && !abort.signal.aborted ? error.message.slice(0, 2000) : undefined };
      } finally { clearInterval(timer); this.abort = undefined; }
      this.journal.pending = { task, phase: "receipt", receipt }; await this.save();
      await this.sendReceipt();
      if (!this.stopped) this.port.changed(await this.port.request<DeviceSnapshot>("devices"));
    } finally { this.busy = false; }
  }
}
