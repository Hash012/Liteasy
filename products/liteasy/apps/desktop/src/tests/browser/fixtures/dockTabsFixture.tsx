import { useState } from "react";
import { createRoot } from "react-dom/client";
import { FluentProvider, webDarkTheme, webLightTheme } from "@fluentui/react-components";
import { DocumentPdfRegular } from "@fluentui/react-icons";
import { DockRegion } from "../../../app/features/dock/DockRegion";
import type { DockItemId } from "../../../app/features/dock/dock.types";
import { WorkspaceCommandBar } from "../../../app/layout/WorkspaceCommandBar";
import { FileStatusBar } from "../../../app/layout/FileStatusBar";
import "../../../app/styles/app.css";
import "../../../app/features/theme/appearance.css";

const dark = location.search.includes("dark");
document.documentElement.dataset.colorScheme = dark ? "dark" : "light";
const initialTitles = ["Cicada: Dependably Fast Multi-Core In-Memory Transactions.pdf", "Larimar: Large Language Models with Episodic Memory Control.pdf", "研究笔记.md", "文献综述.md", "实验记录.md"];
function Fixture() {
  const [tools, setTools] = useState<DockItemId[]>(["library", "notes", "profile"]);
  const [tool, setTool] = useState<DockItemId>("profile");
  const [document, select] = useState("settings");
  const [titles, setTitles] = useState(initialTitles);
  return <FluentProvider theme={dark ? webDarkTheme : webLightTheme}>
    <div className="app-frame workspace-frame">
      <WorkspaceCommandBar state={{ title: "Liteasy · 研究工作区", actions: [], overflowActions: [] }} />
      <div className="app-shell" style={{ gridTemplateColumns: "0 minmax(0, 1fr)", gridTemplateRows: "minmax(0, 1fr)" }}>
        <div className="dock-workspace-columns" style={{ gridTemplateColumns: "minmax(0, 1fr) 4px minmax(0, 2fr)" }}>
          <DockRegion regionId="left" layout={{ activeItemId: tool, itemIds: tools }} onActivateItem={setTool}
            onCloseItem={(id) => { const next = tools.filter((item) => item !== id); setTools(next); if (id === tool) setTool(next[0]); }}
            onMoveItem={() => undefined} onSplitRegion={() => undefined}
            renderItem={() => <div style={{ padding: 24, color: "var(--colorNeutralForeground1)" }}><h2>个人中心</h2><p>研究档案 · 已记偏好 · 数据管理</p></div>} />
          <div className="pane-resizer" role="separator" />
          <DockRegion regionId="main" layout={{ activeItemId: "settings", itemIds: ["settings"] }} onActivateItem={() => select("settings")}
            onCloseItem={() => undefined} onMoveItem={() => undefined} onSplitRegion={() => undefined}
            renderItem={() => <div style={{ padding: 24, color: "var(--colorNeutralForeground1)" }}><h2>设置</h2><p>让 Liteasy 更适合你的研究习惯</p></div>}
            dynamicTabs={titles.map((title) => ({ id: title, title, icon: <DocumentPdfRegular />, kind: "document", selected: document === title,
              onActivate: () => select(title), onClose: () => { setTitles((current) => current.filter((item) => item !== title)); if (title === document) select("settings"); },
              render: () => <div style={{ padding: 24, color: "var(--colorNeutralForeground1)" }}><h2>{title}</h2></div> }))} />
        </div>
      </div>
      <FileStatusBar />
    </div>
  </FluentProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
