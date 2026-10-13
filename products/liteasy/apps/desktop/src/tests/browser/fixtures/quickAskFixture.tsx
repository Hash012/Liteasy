import { createRoot } from "react-dom/client";
import { useState } from "react";
import { Button } from "@fluentui/react-components";
import { ApplicationThemeProvider } from "../../../app/features/theme/ApplicationThemeProvider";
import { notifyAppearancePreference } from "../../../app/features/theme/appearancePreference";
import { PdfReader } from "../../../app/features/pdf/PdfReader";
import { usePdfQuickAskController } from "../../../app/controllers/usePdfQuickAskController";
import { createSettingsStore } from "../../../app/features/settings/settings.store";
import { resolveLocalAccountKey } from "../../../app/features/library/localAccountKey";
import type { ModelTransport } from "../../../app/features/models/modelHttpClient";
import "../../../app/styles/app.css";
import "../../../app/features/theme/appearance.css";
const metrics = { requests: [] as unknown[], aborted: 0 };
Object.assign(window, { quickAskFixture: metrics });
const answer = "## 合成解释\n\n这是用于界面验收的 **固定回答**。\n\n公式：$x^2 + y^2 = 1$。\n\n| 条件 | 结果 |\n| --- | --- |\n| 保留来源 | 不夸大核验 |\n\n```ts\nconst literal = '<script>neverRun()</script>';\n```\n\n" + Array.from({ length: 12 }, (_, i) => `第 ${i + 1} 段：保留选区与来源信息，长答案应只在内容区滚动。`).join("\n\n");
const transport: ModelTransport = async input => {
  metrics.requests.push(JSON.parse(input.body));
  return { ok: true, status: 200, json: async () => ({}), body: new ReadableStream({ start(controller) {
    const emit = (event: unknown) => controller.enqueue(new TextEncoder().encode(JSON.stringify(event) + "\n"));
    emit({ type: "delta", delta: answer.slice(0, 25) });
    const timer = setTimeout(() => { emit({ type: "delta", delta: answer.slice(25) }); emit({ type: "completed", answer, execution: { mode: "live", provider: "openai" } }); controller.close(); }, 1200);
    input.signal?.addEventListener("abort", () => { clearTimeout(timer); metrics.aborted++; controller.error(new DOMException("Stopped", "AbortError")); }, { once: true });
  } }) };
};
function Fixture() {
  const [paperId, setPaperId] = useState("quick-ask-synthetic");
  const ask = usePdfQuickAskController({ getSettings: () => createSettingsStore().getState(), getScopeId: resolveLocalAccountKey, modelTransport: transport });
  return <ApplicationThemeProvider><main style={{ height: "100vh", display: "flex", flexDirection: "column", minWidth: 0 }}>
    <div><Button onClick={() => notifyAppearancePreference("light")}>浅色主题</Button><Button onClick={() => notifyAppearancePreference("dark")}>深色主题</Button><Button onClick={() => setPaperId(paperId === "quick-ask-synthetic" ? "second-paper" : "quick-ask-synthetic")}>切换文献</Button></div>
    <PdfReader selectedPapers={[{ id: paperId, title: "合成速问验收资料", sourcePath: `${window.location.origin}/manual-preview/das24a.pdf`, contentHash: "a".repeat(64) }]} zoom={100} onQuickAsk={ask} />
  </main></ApplicationThemeProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
