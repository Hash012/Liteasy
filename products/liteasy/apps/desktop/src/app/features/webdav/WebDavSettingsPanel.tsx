import { isTauri } from "@tauri-apps/api/core";
import { Button, Checkbox, Field, Input } from "@fluentui/react-components";
import { CloudSyncRegular } from "@fluentui/react-icons";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  disconnectWebDav, emptyWebDavSettings, loadWebDavSettings, saveWebDavSettings,
  syncWebDav, verifyWebDav, webdavStatus, type WebDavSettings
} from "./webdavClient";

export function WebDavSettingsPanel() {
  const desktop = isTauri();
  const [settings, setSettings] = useState<WebDavSettings>(emptyWebDavSettings);
  const [saved, setSaved] = useState<WebDavSettings | null>(null);
  const [password, setPassword] = useState("");
  const [loadError, setLoadError] = useState("");
  const status = useSyncExternalStore(webdavStatus.subscribe, webdavStatus.getSnapshot);
  useEffect(() => {
    if (!desktop) return;
    let active = true;
    void loadWebDavSettings().then((value) => {
      if (active) {
        const next = value.endpoint ? value : emptyWebDavSettings;
        setSettings(next); setSaved(next);
      }
    }).catch((error) => { if (active) setLoadError(String(error)); });
    return () => { active = false; };
  }, [desktop]);
  const dirty = JSON.stringify(settings) !== JSON.stringify(saved) || password.length > 0;
  const connected = Boolean(saved?.endpoint);
  const disabled = status.busy || !saved;
  async function save() {
    try { await saveWebDavSettings(settings, password); setSaved({ ...settings }); setPassword(""); }
    catch { /* The shared status presents the error. */ }
  }
  return <section className="sidebar-section" aria-label="WebDAV 同步">
    <div className="sidebar-section-header"><CloudSyncRegular aria-hidden="true" /><span>WebDAV 同步</span></div>
    <div className="sidebar-section-content">
      <p>同步当前文献库中的 PDF、文献信息、批注和阅读产物。其他设备填写相同服务器地址与同步库名称即可连接。</p>
      {desktop ? <div style={{ display: "grid", gap: 8 }}>
        <Field label="服务器地址"><Input aria-label="WebDAV 服务器地址" placeholder="https://dav.example.com/" value={settings.endpoint} disabled={disabled} onChange={(_, data) => setSettings({ ...settings, endpoint: data.value })} /></Field>
        <Field label="用户名"><Input aria-label="WebDAV 用户名" autoComplete="username" value={settings.username} disabled={disabled} onChange={(_, data) => setSettings({ ...settings, username: data.value })} /></Field>
        <Field label="密码或应用密码"><Input aria-label="WebDAV 密码" type="password" autoComplete="new-password" placeholder={connected ? "留空保留已保存密码" : "输入密码"} value={password} disabled={disabled} onChange={(_, data) => setPassword(data.value)} /></Field>
        <Field label="同步库名称"><Input aria-label="WebDAV 同步库名称" value={settings.collection} disabled={disabled} onChange={(_, data) => setSettings({ ...settings, collection: data.value })} /></Field>
        <Checkbox label="自动同步（启动后及每 5 分钟）" checked={settings.autoSync} disabled={disabled} onChange={(_, data) => setSettings({ ...settings, autoSync: data.checked === true })} />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <Button size="small" disabled={disabled || !dirty || !settings.endpoint || !settings.username || !settings.collection} onClick={() => void save()}>保存配置</Button>
          <Button size="small" disabled={disabled || dirty || !connected} onClick={() => void verifyWebDav().catch(() => {})}>验证服务器</Button>
          <Button size="small" appearance="primary" disabled={disabled || dirty || !connected} onClick={() => void syncWebDav().catch(() => {})}>立即同步</Button>
          <Button size="small" disabled={disabled || !connected} onClick={() => void disconnectWebDav().then(() => { setSettings(emptyWebDavSettings); setSaved(emptyWebDavSettings); setPassword(""); }).catch(() => {})}>断开连接</Button>
        </div>
        <p>文件存入服务器的 liteasy/{settings.collection || "personal"}/ 目录。密码保存在系统凭据存储中。删除会同步到其他设备；被替换或删除的本地内容保留在文献库的 .liteasy/webdav/recovery 目录。</p>
        {status.busy ? <p role="status">{status.progress?.phase === "sync" ? `正在同步 ${status.progress.completed}/${status.progress.total}` : "正在连接 WebDAV 服务器…"}</p> : null}
        {status.message ? <p role="status">{status.message}</p> : null}
        {status.result ? <p>上传 {status.result.uploaded} 项，下载 {status.result.downloaded} 项，删除 {status.result.deleted} 项，冲突 {status.result.conflicts.length} 项。</p> : null}
        {status.result?.deferred?.length ? <p role="status">{status.result.deferred.length} 项远端变更等待应用。请关闭相关文献后再次同步，以保留正在编辑的内容。</p> : null}
        {status.result?.conflicts.length ? <>
          <p>以下文件在两端都有变化。选择需要保留的版本后继续同步；解决前暂停自动同步。</p>
          {status.result.conflicts.map((conflict) => <div key={conflict.path} style={{ border: "1px solid var(--colorNeutralStroke2)", borderRadius: 4, padding: 8 }}>
            <p style={{ overflowWrap: "anywhere" }}>{conflict.path}</p>
            {conflict.remotePath && conflict.remotePath !== conflict.path ? <p style={{ overflowWrap: "anywhere" }}>远端路径：{conflict.remotePath}</p> : null}
            <p>本地：{conflict.local ? `${conflict.local.size} 字节` : "已删除"}；远端：{conflict.remote ? `${conflict.remote.size} 字节` : "已删除"}</p>
            <Button size="small" disabled={disabled || dirty} onClick={() => void syncWebDav([{ conflict, choice: "local" }]).catch(() => {})}>保留本地版本</Button>
            <Button size="small" disabled={disabled || dirty} onClick={() => void syncWebDav([{ conflict, choice: "remote" }]).catch(() => {})}>使用远端版本</Button>
          </div>)}
        </> : null}
      </div> : <p>请在桌面版中配置 WebDAV 同步。</p>}
      {loadError || status.error ? <p role="alert">{loadError || status.error}</p> : null}
    </div>
  </section>;
}
