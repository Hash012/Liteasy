import { useState } from "react";
import { Button, Tooltip, Spinner } from "@fluentui/react-components";
import { LibraryRegular, ArrowDownloadRegular, DesktopRegular, SettingsRegular } from "@fluentui/react-icons";
import { useLibraryController } from "../controllers/useLibraryController";
import { LibraryView } from "../features/library/LibraryView";
import { ResourceDetails } from "../features/library/ResourceDetails";

const destinations = [
  { id: "library", label: "资料库", icon: <LibraryRegular /> },
  { id: "inbox", label: "收件箱", icon: <ArrowDownloadRegular /> },
  { id: "tasks", label: "桌面任务", icon: <DesktopRegular /> },
  { id: "settings", label: "设置", icon: <SettingsRegular /> }
] as const;

export function AppShell() {
  const [tab, setTab] = useState<string>("library");
  const library = useLibraryController();
  return <div className="app-shell">
    <header className="app-header"><span className="brand">Liteasy</span><span>{destinations.find((item) => item.id === tab)?.label}</span></header>
    <main className="app-content">
      {library.error ? <p className="error-message" role="alert">{library.error}</p> : null}
      {library.busy ? <Spinner size="tiny" label="正在保存资料…" /> : null}
      {library.selected ? <ResourceDetails item={library.selected} onSave={library.update} onClose={library.close} /> :
        tab === "library" || tab === "inbox" ? <LibraryView items={library.items} inbox={tab === "inbox"} busy={library.busy}
          onImport={library.importFiles} onAdd={library.importResource} onOpen={library.open} onUpdate={library.update} /> :
          tab === "tasks" ? <section><h1>桌面任务</h1><p>在这里查看发送给桌面设备的任务。</p></section> :
            <section><h1>设置</h1><p>资料和附件保存在此设备。卸载应用前请先备份。</p></section>}
    </main>
    <nav className="app-navigation" aria-label="主导航">{destinations.map((item) =>
      <Tooltip key={item.id} content={item.label} relationship="label"><Button appearance={tab === item.id ? "primary" : "subtle"} icon={item.icon}
        aria-current={tab === item.id ? "page" : undefined} onClick={() => { library.close(); setTab(item.id); }}>{item.label}</Button></Tooltip>
    )}</nav>
  </div>;
}
