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
import { useTasksController } from "../controllers/useTasksController";
import { TasksView } from "../features/tasks/TasksView";
import { useBackNavigation } from "../controllers/useBackNavigation";
import { useBackHandler } from "../features/navigation/backNavigation";
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
  const tasks = useTasksController(account.scope);
  const capture = useCaptureController(library.scope, library.refresh);
  useBackNavigation();
  useBackHandler(Boolean(library.selected), () => { if (details && library.selected?.kind === "pdf") setDetails(false); else library.close(); }, 10);
  useBackHandler(tab !== "library", () => setTab("library"));
  const libraryTab = tab === "library" || tab === "inbox";
  const selected = library.selected;
  return <div className={`app-shell${selected ? " has-document" : ""}`}>
    <header className="app-header"><span className="brand">Liteasy</span><span>{destinations.find((item) => item.id === tab)?.label}</span></header>
    <main className="app-content">
      {!account.ready ? <section><Spinner label="正在打开资料库…" />{account.error ? <p role="alert">{account.error}<Button onClick={() => void account.refresh()}>重试</Button></p> : null}</section> : <>
      {!selected ? <ShareInboxView key={library.scope} destination={library.scope === "local" ? "本机资料库" : "当前登录账号的资料库"} captures={capture.captures} busy={capture.busy} error={capture.error} onSave={capture.save} onDiscard={capture.discard} /> : null}
      {selected && capture.captures.length ? <Button className="capture-alert" appearance="primary" onClick={() => { library.close(); setTab("inbox"); }}>收到 {capture.captures.length} 份分享，去归档</Button> : null}
      {library.error ? <p className="error-message" role="alert">{library.error}</p> : null}
      {library.busy ? <Spinner size="tiny" label="正在保存资料…" /> : null}
      {libraryTab ? <div className={`library-workspace${selected ? " has-selection" : ""}`}>
        <div className="library-master"><LibraryView items={library.items} inbox={tab === "inbox"} busy={library.busy}
          onImport={library.importFiles} onAdd={library.importResource} onOpen={(item) => { setDetails(false); library.open(item); }} onUpdate={library.update} /></div>
        {selected ? <div className="library-document">{selected.kind === "pdf" && !details ? <Suspense fallback={<Spinner label="正在打开阅读器…" />}>
          <ReadingWorkspace key={`${library.scope}:${selected.id}:${selected.contentHash}`} item={selected} scope={library.scope} repository={library.repository} onClose={library.close} onDetails={() => setDetails(true)} />
        </Suspense> : <ResourceDetails key={selected.id} item={selected} onSave={library.update} onClose={() => { if (selected.kind === "pdf") setDetails(false); else library.close(); }} />}</div> : null}
      </div> :
          tab === "tasks" ? <TasksView key={account.scope} controls={tasks} items={library.items} /> :
            <section className="settings-view"><h1>设置</h1><AccountSettingsView key={account.account.scope} controls={account} /><SyncSettingsView key={library.scope} scope={library.scope} onChanged={library.refresh} /><p>资料和附件保存在此设备。卸载应用前请先同步。</p></section>}
      </>}
    </main>
    <nav className="app-navigation" aria-label="主导航">{destinations.map((item) =>
      <Tooltip key={item.id} content={item.label} relationship="label"><Button appearance={tab === item.id ? "primary" : "subtle"} icon={item.icon}
        aria-current={tab === item.id ? "page" : undefined} onClick={() => { library.close(); setTab(item.id); }}>{item.label}</Button></Tooltip>
    )}</nav>
  </div>;
}
