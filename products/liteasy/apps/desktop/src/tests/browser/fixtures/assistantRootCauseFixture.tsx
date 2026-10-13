import { createRoot } from "react-dom/client";
import { AssistantSessionController } from "../../../app/controllers/assistant/AssistantSessionController";
import { ApplicationThemeProvider } from "../../../app/features/theme/ApplicationThemeProvider";
import { notifyAppearancePreference } from "../../../app/features/theme/appearancePreference";
import { createAssistantHistoryPersistence } from "../../../app/features/assistant/assistantHistoryPersistence";
import { createAssistantSession } from "../../../app/features/assistant/assistantSessionHistory";
import "../../../app/styles/app.css";
import "../../../app/features/theme/appearance.css";

const persistence = createAssistantHistoryPersistence({
  load: async () => JSON.parse(localStorage.getItem("assistant-isolated-fixture") ?? "null") ?? {
    version: "liteasy.assistant-history/v1", activeSessionId: "fixture-conversation",
    sessions: [{ ...createAssistantSession({ id: "fixture-conversation" }), messages: [
      { id: "question", role: "user", content: "离线测试问题" },
      { id: "answer", role: "assistant", content: "旧对话中的回答", turnOutcome: "completed" }
    ] }], draft: { input: "待保存草稿", tokens: [], readerContexts: [] }
  },
  save: async (snapshot) => localStorage.setItem("assistant-isolated-fixture", JSON.stringify(snapshot))
});
const tasks = [
  { id: "failed", agentRunId: "run-2", artifactId: "saved-reading", type: "thin_reading" as const, status: "failed" as const, stage: "failed" as const, progress: 20, message: "离线新运行失败" },
  { id: "complete", agentRunId: "run-1", artifactId: "saved-reading", type: "thin_reading" as const, status: "completed" as const, stage: "completed" as const, progress: 100, message: "离线结果已保存" }
];
createRoot(document.getElementById("root")!).render(<ApplicationThemeProvider>
  <ButtonBar />
  <div style={{ width: 360, height: 780, maxHeight: "90vh", border: "1px solid var(--colorNeutralStroke1)", display: "flex" }}>
    <AssistantSessionController historyPersistence={persistence} artifactTasks={tasks} onGenerateArtifact={() => { throw new Error("Offline fixture must not generate"); }} selectedSetStatus={{ importedCount: 0, selectedCount: 0, selectionLocked: false }} />
  </div>
</ApplicationThemeProvider>);
function ButtonBar() {
  return <><button onClick={() => notifyAppearancePreference("dark")}>深色</button><button onClick={() => notifyAppearancePreference("light")}>浅色</button></>;
}
