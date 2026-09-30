import { useState } from "react";
import { Button, Tooltip } from "@fluentui/react-components";
import { LibraryRegular, ArrowDownloadRegular, DesktopRegular, SettingsRegular } from "@fluentui/react-icons";

const destinations = [
  { id: "library", label: "资料库", icon: <LibraryRegular /> },
  { id: "inbox", label: "收件箱", icon: <ArrowDownloadRegular /> },
  { id: "tasks", label: "桌面任务", icon: <DesktopRegular /> },
  { id: "settings", label: "设置", icon: <SettingsRegular /> }
] as const;

export function AppShell() {
  const [tab, setTab] = useState<string>("library");
  return <div className="app-shell">
    <header className="app-header"><span className="brand">Liteasy</span><span>{destinations.find((item) => item.id === tab)?.label}</span></header>
    <main className="app-content">
      <div className="empty-state"><LibraryRegular /><h1>随身携带你的资料</h1><p>收集文献、记录想法，随时继续阅读。</p></div>
    </main>
    <nav className="app-navigation" aria-label="主导航">{destinations.map((item) =>
      <Tooltip key={item.id} content={item.label} relationship="label"><Button appearance={tab === item.id ? "primary" : "subtle"} icon={item.icon}
        aria-current={tab === item.id ? "page" : undefined} onClick={() => setTab(item.id)}>{item.label}</Button></Tooltip>
    )}</nav>
  </div>;
}
