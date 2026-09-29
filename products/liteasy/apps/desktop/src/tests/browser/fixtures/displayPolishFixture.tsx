import { useState } from "react";
import { createRoot } from "react-dom/client";
import { FluentProvider, webDarkTheme, webLightTheme } from "@fluentui/react-components";
import { AssistantSessionToolbar } from "../../../app/features/assistant/AssistantSessionToolbar";
import { LibraryTagChips } from "../../../app/features/library/LibraryTagChips";
import { FileStatusBar } from "../../../app/layout/FileStatusBar";
import "../../../app/styles/app.css";
import "../../../app/features/theme/appearance.css";
import "../../../app/features/library/library.css";

const paper = { id: "larimar", title: "Larimar: Large Language Models with Episodic Memory Control — Research Notes and Evaluation Results.pdf",
  format: "pdf" as const, year: 2024, authors: ["Payel Das", "Bernhard Schölkopf"] };
function Fixture() {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [title, setTitle] = useState("排查 Windows 登录兼容性");
  const [action, setAction] = useState("");
  const dark = location.search.includes("dark");
  document.documentElement.dataset.colorScheme = dark ? "dark" : "light";
  return <FluentProvider theme={dark ? webDarkTheme : webLightTheme}>
    <div className="app-frame workspace-frame">
      <div style={{ background: "var(--colorNeutralBackground3)", padding: "8px 16px" }}>Liteasy</div>
      <main style={{ display: "flex", flexDirection: "column", gap: 24, padding: 12, minWidth: 0, background: "var(--colorNeutralBackground1)" }}>
        <section aria-label="文献库条目" style={{ maxWidth: 480 }}>
          <strong>Larimar: Large Language Models with Episodic Memory Control</strong>
          <LibraryTagChips entry={paper} onSelect={(tag) => setAction(tag.value)} />
        </section>
        <section aria-label="对话面板" style={{ border: "1px solid var(--colorNeutralStroke2)", borderRadius: 8, padding: "6px 8px", maxWidth: 760 }}>
          <AssistantSessionToolbar title={title} kind="conversation" historyOpen={historyOpen} running={false} cancelling={false} newSessionDisabled={false}
            onToggleHistory={() => setHistoryOpen((open) => !open)} onNewSession={() => setTitle("新对话")}
            onCancel={() => undefined} onOpenSettings={() => setAction("设置")} onDragStart={() => undefined} />
          {historyOpen ? <div aria-label="历史会话面板">历史会话</div> : null}
          <div style={{ minHeight: 110 }} />
        </section>
        <output aria-label="最近操作">{action}</output>
      </main>
      <FileStatusBar status={{ name: paper.title, entry: paper, type: "PDF", pageCount: 18, source: "local", indexState: "indexed" }} />
    </div>
  </FluentProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
