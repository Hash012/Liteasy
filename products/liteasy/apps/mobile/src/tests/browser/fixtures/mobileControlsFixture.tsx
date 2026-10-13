import { createRoot } from "react-dom/client";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { TasksView, type TaskControls } from "../../../app/features/tasks/TasksView";
import { LibraryView } from "../../../app/features/library/LibraryView";
import type { LibraryItem } from "../../../app/features/library/library.types";
import "../../../app/styles/mobile.css";

const item: LibraryItem = { id: "paper", kind: "pdf", contentHash: "a".repeat(64), title: "合成测试文献", filename: "paper.pdf", mimeType: "application/pdf", size: 1,
  collection: "跨团队论文阅读的超长分类名称", tags: [], note: "", createdAt: "now", updatedAt: "now", page: 1, pinned: false, downloaded: true, revision: 1 };
const controls: TaskControls = { available: true, busy: false, error: "", loadResult: async (task) => task,
  pair: async () => {}, unpair: async () => {}, cancel: async () => {}, retry: async () => {}, enqueue: async () => {},
  snapshot: { devices: [{ deviceId: "desktop", name: "办公室设备 · 跨学科阅读的超长设备名称", online: false, lastSeen: 0, capabilities: ["open-document"] }], pairs: [], outbox: [], tasks: [] } };
createRoot(document.getElementById("root")!).render(<FluentProvider theme={webLightTheme}>
  <main style={{ padding: 12 }}><LibraryView items={[item]} inbox={false} busy={false} onImport={async () => true} onAdd={async () => true} onOpen={() => {}} onUpdate={async () => true} />
    <TasksView controls={controls} items={[item]} /></main>
</FluentProvider>);
