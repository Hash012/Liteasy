import { lazy, Suspense, useState } from "react";
import { Button, Tooltip, Spinner } from "@fluentui/react-components";
import { LibraryRegular, ArrowDownloadRegular, DesktopRegular, SettingsRegular } from "@fluentui/react-icons";
import { useLibraryController } from "../controllers/useLibraryController";
import { LibraryView } from "../features/library/LibraryView";
import { ResourceDetails } from "../features/library/ResourceDetails";
import { useCaptureController } from "../controllers/useCaptureController";
import { ShareInboxView } from "../features/capture/ShareInboxView";
import { SyncSettingsView } from "../features/sync/SyncSettingsView";
import { AccountSettingsView } from "../features/account/AccountSettingsView";
import { useAccountController } from "../controllers/useAccountController";
const ReadingWorkspace = lazy(() => import("../controllers/ReadingWorkspace"));

const destinations = [
  { id: "library", label: "资料库", icon: <LibraryRegular /> },
  { id: "inbox", label: "收件箱", icon: <ArrowDownloadRegular /> },
  { id: "tasks", label: "桌面任务", icon: <DesktopRegular /> },
  { id: "settings", label: "设置", icon: <SettingsRegular /> }
] as const;

export function AppShell() {
  const [tab, setTab] = useState<string>("library");
  const [details, setDetails] = useState(false);
  const account = useAccountController();
  const library = useLibraryController(account.scope);
  const capture = useCaptureController(library.scope, library.refresh);
  return <div className="app-shell">
    <header className="app-header"><span className="brand">Liteasy</span><span>{destinations.find((item) => item.id === tab)?.label}</span></header>
    <main className="app-content">
      <ShareInboxView captures={capture.captures} busy={capture.busy} error={capture.error} onSave={capture.save} onDiscard={capture.discard} />
      {library.error ? <p className="error-message" role="alert">{library.error}</p> : null}
      {library.busy ? <Spinner size="tiny" label="正在保存资料…" /> : null}
      {library.selected ? library.selected.kind === "pdf" && !details ? <Suspense fallback={<Spinner label="正在打开阅读器…" />}>
        <ReadingWorkspace key={library.selected.id} item={library.selected} scope={library.scope} repository={library.repository} onClose={library.close} onDetails={() => setDetails(true)} />
      </Suspense> : <ResourceDetails item={library.selected} onSave={library.update} onClose={() => { if (library.selected?.kind === "pdf") setDetails(false); else library.close(); }} /> :
        tab === "library" || tab === "inbox" ? <LibraryView items={library.items} inbox={tab === "inbox"} busy={library.busy}
          onImport={library.importFiles} onAdd={library.importResource} onOpen={(item) => { setDetails(false); library.open(item); }} onUpdate={library.update} /> :
          tab === "tasks" ? <section><h1>桌面任务</h1><p>在这里查看发送给桌面设备的任务。</p></section> :
            <section><h1>设置</h1><AccountSettingsView key={account.account.scope} controls={account} /><SyncSettingsView key={library.scope} scope={library.scope} onChanged={library.refresh} /><p>资料和附件保存在此设备。卸载应用前请先同步。</p></section>}
    </main>
    <nav className="app-navigation" aria-label="主导航">{destinations.map((item) =>
      <Tooltip key={item.id} content={item.label} relationship="label"><Button appearance={tab === item.id ? "primary" : "subtle"} icon={item.icon}
        aria-current={tab === item.id ? "page" : undefined} onClick={() => { library.close(); setTab(item.id); }}>{item.label}</Button></Tooltip>
    )}</nav>
  </div>;
}
