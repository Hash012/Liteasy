import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Button, FluentProvider, webDarkTheme, webLightTheme } from "@fluentui/react-components";
import { WorkspaceCommandBar } from "../../../app/layout/WorkspaceCommandBar";
import { FileStatusBar } from "../../../app/layout/FileStatusBar";
import "../../../app/styles/app.css";

function Fixture() {
  const [dark, setDark] = useState(false);
  const [selected, setSelected] = useState("");
  return <FluentProvider theme={dark ? webDarkTheme : webLightTheme}>
    <div className="app-frame workspace-frame">
      <WorkspaceCommandBar state={{
        title: "Lairmar: Large Language Models with Episodic Memory Control — a long document title that must preserve the command area",
        actions: [
          { id: "search", label: "搜索", icon: "search", priority: 100, onSelect: () => setSelected("搜索") },
          { id: "layout", label: "布局", icon: "layout", priority: 50, children: [{ id: "outline", label: "大纲", checked: true, onSelect: () => setSelected("大纲") }] }
        ],
        overflowActions: [{ id: "settings", label: "设置", icon: "settings", onSelect: () => setSelected("设置") }]
      }} />
      <main style={{ padding: 20, background: "var(--colorNeutralBackground1)", color: "var(--colorNeutralForeground1)" }}>
        <Button onClick={() => setDark((value) => !value)}>切换测试主题</Button>
        <p>{selected}</p>
      </main>
      <FileStatusBar status={{ name: "Lairmar.pdf", path: "/library/Lairmar.pdf", type: "PDF", pageCount: 18, size: 1782579, source: "local", indexState: "indexed", syncState: "synced" }} />
    </div>
  </FluentProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
