import { useEffect, useRef, useState } from "react";
import { Button, Input } from "@fluentui/react-components";
import { AddRegular, ArrowDownloadRegular, ArrowUploadRegular } from "@fluentui/react-icons";
import { useExtensionWorkbench } from "./extensionWorkbenchContext";
import { validateExtensionPackage, type ValidatedExtension } from "./extensionPackage";
import type { ExtensionInstallation } from "./extensionPackageStore";
import { paperLensPackage } from "./paperLensPackage";
import { ComponentTreeView } from "../visual-blocks/ComponentTreeView";
import { validateComponentTree } from "../visual-blocks/blockRegistry";
import { VisualBlockBase } from "../visual-blocks/VisualBlockBase";
import { type JsonObject } from "./extensionSchema";
import "./extensionWorkbench.css";

export function downloadExtensionJson(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ExtensionLibrary() {
  const host = useExtensionWorkbench();
  const [items, setItems] = useState<Array<{ state: ExtensionInstallation; pkg?: ValidatedExtension; error?: string }>>([]);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const load = async () => {
    if (!host) return;
    const current = ++generation.current;
    const states = await host.packages.store.list();
    const results = await Promise.all(states.map(async (state) => { try { return { state, pkg: await host.packages.store.get(state.id, state.version) }; } catch (e) { return { state, error: String(e) }; } }));
    if (current === generation.current) setItems(results);
  };
  useEffect(() => { void load(); return () => { generation.current++; }; }, [host?.packages.store, host?.packages.snapshot]);
  if (!host) return <p role="status">正在加载扩展…</p>;
  async function run(action: () => Promise<unknown>) { setBusy(true); setMessage(""); try { await action(); await load(); } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); } }
  return <section className="extension-page" aria-label="扩展">
    <header><div><h1>扩展</h1><p>用基础组件组合适合自己的阅读与研究方式。</p></div><div className="extension-toolbar"><Button icon={<AddRegular />} onClick={host.openStudio}>制作扩展</Button><Button onClick={host.openRuns}>运行记录</Button></div></header>
    <div className="extension-toolbar"><Input aria-label="搜索扩展" placeholder="搜索扩展、页面或命令" value={query} onChange={(_, data) => setQuery(data.value)} /><Button icon={<ArrowUploadRegular />} disabled={busy} onClick={() => file.current?.click()}>导入本地包</Button><Button disabled={busy} onClick={() => void run(async () => { const previous = items.find((item) => item.state.id === "plugin.paper-lens"); await host.packages.store.install(await paperLensPackage(), previous?.state.revision ?? null); })}>添加论文比较板</Button></div>
    <input hidden ref={file} type="file" accept=".json" onChange={(event) => { const selected = event.target.files?.[0]; event.target.value = ""; if (selected) void run(async () => {
      if (selected.size > 24 * 1024 * 1024) throw new Error("包文件超过 24 MB。");
      const pkg = await validateExtensionPackage(JSON.parse(await selected.text()));
      const previous = (await host.packages.store.list()).find((item) => item.id === pkg.manifest.id);
      await host.packages.store.install(pkg.bundle, previous?.revision ?? null);
      setMessage("已导入。检查能力说明后启用。");
    }); }} />
    {message || host.error ? <p role="status">{message || host.error}</p> : null}
    <div className="extension-library-grid">{items.filter((item) => [item.pkg?.manifest.name, item.state.id, ...item.pkg?.manifest.contributes.views.map((view) => view.title) ?? [], ...item.pkg?.manifest.contributes.commands.map((command) => command.title) ?? []].join(" ").toLowerCase().includes(query.toLowerCase())).map(({ state, pkg, error }) => <article className="extension-library-card" key={state.id}>
      <h2>{pkg?.manifest.name ?? "不可用扩展"}</h2><p>{state.version} · {state.enabled ? "已启用" : "已停用"}</p>
      {pkg?.manifest.permissions.length ? <details><summary>请求的能力</summary><ul>{pkg.manifest.permissions.map((permission, i) => <li key={i}>{permission.capability} · {permission.scopeRef}</li>)}</ul><p>实际执行时还需绑定本轮资料、保存位置和模型连接。</p></details> : <p>声明式组件与本地组合。</p>}
      {error ? <p role="alert">{error}</p> : null}
      <div className="extension-toolbar"><Button disabled={busy || !!error} onClick={() => void run(() => host.packages.store.enable(state.id, !state.enabled, state.revision))}>{state.enabled ? "停用" : "启用"}</Button><Button disabled={!pkg} icon={<ArrowDownloadRegular />} onClick={() => pkg && downloadExtensionJson(`${state.id}-${state.version}.liteasy-extension.json`, pkg.bundle)}>导出</Button><Button disabled={busy} onClick={() => void run(() => host.packages.store.uninstall(state.id, state.revision))}>卸载</Button></div>
      {state.enabled && pkg ? <div className="extension-entry-list">{pkg.manifest.contributes.views.map((view) => <Button key={view.id} appearance="subtle" onClick={() => void run(() => host.openView(state.id, view.id))}>{view.title}</Button>)}{pkg.manifest.contributes.commands.map((command) => <Button key={command.id} appearance="subtle" onClick={() => void run(() => host.invoke(state.id, command.id))}>{command.title}</Button>)}</div> : null}
    </article>)}</div>
    {!items.length ? <p>可以从论文比较板开始，也可以导入自己或 AI 制作的扩展包。</p> : null}
    <details><summary>恢复与数据</summary><p>停用或卸载保留已创建的笔记、白板、配置和版本记录。</p><Button disabled={busy} onClick={() => void run(() => host.packages.store.disableAll())}>停用所有第三方扩展</Button></details>
  </section>;
}

export function ExtensionViewHost({ dockId }: { dockId: string }) {
  const host = useExtensionWorkbench();
  const instance = host?.views.find((view) => view.dockId === dockId);
  const pkg = host?.packages.snapshot.packages.find((item) => item.manifest.id === instance?.extensionId);
  const definition = pkg?.manifest.contributes.views.find((view) => view.id === instance?.viewId);
  const [settings, setSettings] = useState<JsonObject>({});
  const [error, setError] = useState("");
  const scroll = useRef<HTMLElement>(null);
  useEffect(() => {
    let alive = true; setError(""); setSettings({});
    const load = () => { if (host && pkg) void Promise.all(pkg.manifest.contributes.settings.map(async (group) => [group.id, (await host.workspace.readConfiguration(pkg.manifest.id, group.id, pkg.settings[group.id])).effective] as const)).then((groups) => { if (alive) setSettings(Object.fromEntries(groups)); }).catch((e) => { if (alive) setError(String(e)); }); };
    load(); const dispose = host?.workspace.subscribeConfiguration(load);
    return () => { alive = false; dispose?.(); };
  }, [host?.workspace, pkg]);
  useEffect(() => { if (scroll.current) scroll.current.scrollTop = Number(instance?.hostState?.scrollTop) || 0; }, [instance?.dockId]);
  if (!host || !instance || !pkg || !definition) return <section className="extension-page"><h1>{instance?.title ?? "扩展页面"}</h1><p>此页面所属扩展尚未启用或已卸载，原记录仍保留。</p>{instance ? <Button onClick={() => downloadExtensionJson("page-state.json", instance)}>导出页面记录</Button> : null}</section>;
  let tree;
  try { tree = validateComponentTree(JSON.parse(pkg.bundle.files[definition.entry.path])); } catch (e) { return <p role="alert">{String(e)}</p>; }
  const saveState = async () => {
    try {
      const current = await host.workspace.getView(dockId);
      if (!current) return;
      const hostState = { scrollTop: Math.round(scroll.current?.scrollTop ?? 0) };
      if (current.hostState?.scrollTop === hostState.scrollTop) return;
      const { revision, updatedAt: _updatedAt, ...value } = current;
      await host.workspace.saveView({ ...value, hostState }, revision); await host.refreshViews();
    } catch (e) { setError(String(e)); }
  };
  return <section className="extension-page" ref={scroll} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) void saveState(); }}>
    <header><div><h1>{definition.title}</h1><small>来自 {pkg.manifest.name}</small></div><Button onClick={() => void navigator.clipboard.writeText(`liteasy://extensions/${instance.extensionId}/views/${instance.viewId}?instance=${instance.instanceId}`).catch((e) => setError(String(e)))}>复制页面链接</Button></header>
    {error ? <p role="alert">{error}</p> : null}
    <VisualBlockBase identity={dockId} fallback="页面内容暂不可用，可从扩展重新打开。"><ComponentTreeView tree={tree} data={{ ...instance.args, settings, state: instance.state }} openPath={host.openLink} /></VisualBlockBase>
    <div className="extension-toolbar">{pkg.manifest.contributes.commands.map((command) => <Button key={command.id} onClick={() => void host.invoke(pkg.manifest.id, command.id).catch((e) => setError(String(e)))}>{command.title}</Button>)}</div>
  </section>;
}
