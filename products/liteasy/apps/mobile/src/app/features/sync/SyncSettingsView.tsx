import { useEffect, useState } from "react";
import { Button, Checkbox, Field, Input } from "@fluentui/react-components";
import { syncClient, type SyncSettings, type SyncStatus } from "./syncClient";

export function SyncSettingsView({ scope, onChanged }: { scope: string; onChanged: () => Promise<void> }) {
  const [settings, setSettings] = useState<SyncSettings>({ endpoint: "", username: "", collection: "library", autoSync: false, wifiOnly: true });
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const available = syncClient.available();
  useEffect(() => {
    if (!available) return;
    let active = true, previous = "";
    void syncClient.settings(scope).then((value) => { if (active && value) { setSettings(value); setSaved(true); } }).catch((reason) => { if (active) setError(String(reason)); });
    const refresh = async () => {
      try {
        const value = await syncClient.status(scope); if (!active) return;
        setStatus(value);
        if (value?.finishedAt && value.finishedAt !== previous) { previous = value.finishedAt; await onChanged(); }
      } catch (reason) { if (active) setError(String(reason)); }
    };
    void refresh(); const timer = setInterval(() => { if (document.visibilityState !== "hidden") void refresh(); }, 2500);
    return () => { active = false; clearInterval(timer); };
  }, [scope, available, onChanged]);
  const run = async (operation: () => Promise<unknown>) => {
    setError(""); setBusy(true);
    try { await operation(); setStatus(await syncClient.status(scope)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  return <section className="sync-settings" aria-label="文件同步"><h2>文件同步</h2>
    <p>使用与桌面端相同的 WebDAV 地址和同步库名称。资料保留在本机，可离线阅读。</p>
    {!available ? <p>请在安装的 Android 应用中配置同步。</p> : <>
      <div className="form-stack">
        <Field label="WebDAV 地址"><Input type="url" value={settings.endpoint} placeholder="https://…" onChange={(_, data) => { setSettings({ ...settings, endpoint: data.value }); setSaved(false); }} /></Field>
        <Field label="用户名"><Input value={settings.username} autoComplete="username" onChange={(_, data) => { setSettings({ ...settings, username: data.value }); setSaved(false); }} /></Field>
        <Field label={settings.hasPassword ? "密码（留空保留已保存的密码）" : "密码"}><Input type="password" value={password} autoComplete="new-password" onChange={(_, data) => { setPassword(data.value); setSaved(false); }} /></Field>
        <Field label="同步库名称"><Input value={settings.collection} onChange={(_, data) => { setSettings({ ...settings, collection: data.value }); setSaved(false); }} /></Field>
        <Checkbox label="自动同步" checked={settings.autoSync} onChange={(_, data) => { setSettings({ ...settings, autoSync: data.checked === true }); setSaved(false); }} />
        <Checkbox label="仅使用不限流量的网络" checked={settings.wifiOnly} onChange={(_, data) => { setSettings({ ...settings, wifiOnly: data.checked === true }); setSaved(false); }} />
      </div>
      <div className="sync-actions"><Button disabled={busy} onClick={() => void run(async () => {
        await syncClient.configure(scope, { ...settings, password }); setPassword(""); setSettings((value) => ({ ...value, hasPassword: true })); setSaved(true);
      })}>保存同步设置</Button>
        <Button appearance="primary" disabled={busy || !saved || status?.state === "running"} onClick={() => void run(() => syncClient.start(scope))}>立即同步</Button>
        {status?.state === "running" || status?.state === "queued" ? <Button onClick={() => void run(() => syncClient.cancel(scope))}>停止本次同步</Button> : null}
      </div>
      {error || status?.error ? <p role="alert" className="error-message">{error || status?.error}</p> : null}
      <p role="status">{status?.state === "running" ? `${status.phase} · ${status.completed ?? 0}/${status.total ?? 0}` : status?.state === "queued" ? "等待网络条件满足后同步。" : status?.state === "complete" ? `同步完成：上传 ${status.uploaded ?? 0} 项，下载 ${status.downloaded ?? 0} 项。` : status?.state === "conflict" ? "以下资料在两端都有变更，请选择要保留的版本。" : saved ? "同步设置已保存。" : ""}</p>
      {status?.conflicts?.map((conflict) => <div className="sync-conflict" key={conflict.path}><strong>{conflict.path}</strong>
        <p>本机：{conflict.local ? `${Math.ceil(conflict.local.size / 1024)} KiB` : "已删除"} · 远端：{conflict.remote ? `${Math.ceil(conflict.remote.size / 1024)} KiB` : "已删除"}</p>
        <Button disabled={busy} onClick={() => void run(() => syncClient.resolve(scope, conflict.path, true))}>保留本机版本</Button>
        <Button disabled={busy} onClick={() => void run(() => syncClient.resolve(scope, conflict.path, false))}>使用远端版本</Button>
      </div>)}
      {status?.deferredOpenDocument ? <p>正在阅读的文献会在关闭后参与下次同步。</p> : null}
    </>}
  </section>;
}
