import "fake-indexeddb/auto";
import { cpus, totalmem } from "node:os";
import { writeFileSync } from "node:fs";
import { createObjectStorage, type StorageChange } from "../src/app/features/objects/objectStorage";
import { createScopedAssistantHistoryPersistence } from "../src/app/features/assistant/assistantHistoryPersistence";
import { createAssistantSession } from "../src/app/features/assistant/assistantSessionHistory";

// Synthetic data only. This measures repository work with fake-IDB, not WebView/native paint time.
const scope = `benchmark-${crypto.randomUUID()}`;
const storage = createObjectStorage(scope, () => scope);
Object.defineProperty(globalThis, "sessionStorage", { value: { getItem: () => "benchmark", setItem: () => {} }, configurable: true });
let changes: StorageChange[] = [];
const put = async (key: string, value: unknown) => {
  changes.push({ key, expected: null, row: { key, version: crypto.randomUUID(), value } });
  if (changes.length === 500) { await storage.commit(changes); changes = []; }
};
await put("assistant/v2/migration", { version: 2, completed: true });
await put("assistant/v2/view/benchmark", { activeSessionId: "session-0" });
for (let index = 0; index < 1000; index++) {
  const session = createAssistantSession({ id: `session-${index}`, title: `Synthetic topic ${index}` });
  const { messages: _messages, ...metadata } = session;
  const ids: string[] = [];
  for (let message = 0; message < 30; message++) {
    const id = `message-${message}`; ids.push(id);
    await put(`assistant/v2/message/${session.id}/${id}`, { id, role: message % 2 ? "assistant" : "user", content: `Synthetic message ${message}: ${"reference material ".repeat(10)}` });
  }
  await put(`assistant/v2/session/${session.id}`, { ...metadata, messageCount: 30, messageIds: ids });
}
if (changes.length) await storage.commit(changes);
let reads = 0;
const tracked = { ...storage, get: (key: string) => { reads++; return storage.get(key); } };
const repo = createScopedAssistantHistoryPersistence(scope, () => scope, { storage: tracked, viewId: "benchmark" });
const start = performance.now();
const snapshot = (await repo.load())!;
const coldLoad = performance.now() - start;
const initialReads = reads;
const switchTimes: number[] = [], searchTimes: number[] = [];
for (let index = 1; index <= 100; index++) {
  const before = performance.now(); await repo.loadSession!(`session-${index}`); switchTimes.push(performance.now() - before);
  const searching = performance.now(); snapshot.sessions.filter((session) => session.title.toLowerCase().includes(String(index))); searchTimes.push(performance.now() - searching);
}
const percentiles = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return { p50: sorted[Math.floor(sorted.length * .5)], p95: sorted[Math.floor(sorted.length * .95)] }; };
const report = { layer: "Node + fake-indexeddb (repository only)", mode: "development", node: process.version, cpu: cpus()[0]?.model, logicalCpus: cpus().length, memoryBytes: totalmem(), sessions: 1000, messages: 30000, coldLoadMs: coldLoad, initialRecordGets: initialReads,
  initiallyLoadedMessages: snapshot.sessions.reduce((total, session) => total + session.messages.length, 0), switchMs: percentiles(switchTimes), titleSearchMs: percentiles(searchTimes), nativeWebViewPaint: "unverified" };
const output = process.argv[2] ?? "/tmp/liteasy-assistant-session-benchmark.json";
writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
