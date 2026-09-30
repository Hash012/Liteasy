import { isTauri } from "@tauri-apps/api/core";
import { Button, Checkbox, Field, Input } from "@fluentui/react-components";
import { CloudSyncRegular } from "@fluentui/react-icons";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  defaultSyncOptions, disconnectWebDav, emptyWebDavSettings, loadWebDavSettings, saveWebDavSettings,
  syncWebDav, verifyWebDav, webDavPathLabel, webdavStatus, type WebDavSettings
} from "./webdavClient";

export function WebDavSettingsPanel({ embedded = false }: { embedded?: boolean }) {
  const desktop = isTauri();
  const [settings, setSettings] = useState<WebDavSettings>(emptyWebDavSettings);
  const [saved, setSaved] = useState<WebDavSettings | null>(null);
  const [password, setPassword] = useState("");
  const [encryptionPassword, setEncryptionPassword] = useState("");
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
  const dirty = JSON.stringify(settings) !== JSON.stringify(saved) || password.length > 0 || encryptionPassword.length > 0;
  const connected = Boolean(saved?.endpoint);
  const disabled = status.busy || !saved;
  async function save() {
    try { await saveWebDavSettings(settings, password, encryptionPassword); setEncryptionPassword(""); setSaved({ ...settings }); setPassword(""); }
    catch { /* The shared status presents the error. */ }
  }
  return <section className={embedded ? "settings-embedded-panel" : "sidebar-section"} aria-label="WebDAV 同步">
    {!embedded ? <div className="sidebar-section-header"><CloudSyncRegular aria-hidden="true" /><span>WebDAV 同步</span></div> : null}
    <div className="sidebar-section-content">
      <p>选择要在设备间同步的内容。文献文件、批注、笔记与白板分别同步；其他设备使用相同服务器和同步库名称，并登录同一账号（离线设备均使用访客身份）。</p>
      {desktop ? <div style={{ display: "grid", gap: 8 }}>
        <Field label="服务器地址"><Input aria-label="WebDAV 服务器地址" placeholder="https://dav.example.com/" value={settings.endpoint} disabled={disabled} onChange={(_, data) => setSettings({ ...settings, endpoint: data.value })} /></Field>
        <Field label="用户名"><Input aria-label="WebDAV 用户名" autoComplete="username" value={settings.username} disabled={disabled} onChange={(_, data) => setSettings({ ...settings, username: data.value })} /></Field>
        <Field label="密码或应用密码"><Input aria-label="WebDAV 密码" type="password" autoComplete="new-password" placeholder={connected ? "留空保留已保存密码" : "输入密码"} value={password} disabled={disabled} onChange={(_, data) => setPassword(data.value)} /></Field>
        <Field label="同步库名称"><Input aria-label="WebDAV 同步库名称" value={settings.collection} disabled={disabled} onChange={(_, data) => setSettings({ ...settings, collection: data.value })} /></Field>
        <fieldset style={{ border: "1px solid var(--colorNeutralStroke2)", borderRadius: 8, padding: 12, display: "grid", gap: 4 }}>
          <legend>同步内容</legend>
          {([
            ["library", "文献与本地文件", "PDF、电子书、Markdown、图片及文献信息"],
            ["annotations", "论文批注与阅读产物", "高亮、评注及论文附属阅读数据"],
            ["workspace", "Liteasy 笔记、白板与产物", "包括笔记版本、附件、Canvas 和产物目录"],
            ["history", "AI 对话历史", "会话和消息，不包含正在执行的任务"],
            ["preferences", "偏好设置与用户画像", "阅读外观、模型配置、研究画像与记忆"],
            ["externalFolders", "外部链接目录", "包含已连接的 Obsidian / Markdown 目录及文件；保留层次，不同步 .obsidian 等隐藏配置"],
            ["extensionPackages", "扩展包", "同步声明式扩展；新设备收到后默认停用，需在本机启用"],
            ["extensionConfiguration", "扩展设置与页面", "同步配置和页面状态；不复制执行授权或模型密钥"],
            ["extensionWorkflows", "工作流与制作草稿", "包括源文件、版本记录和样例报告"],
            ["extensionRuns", "工作流运行记录", "执行状态和版本；新设备继续执行前需要重新授权"],
            ["extensionSnapshots", "运行正文快照", "包括实际读取片段、模型输出及写入回执；可能包含私人资料"],
            ["apiKeys", "API key", "加密同步模型与论文服务密钥，不同步登录凭证或 WebDAV 密码"]
          ] as const).map(([key, label, hint]) => <div key={key}>
            <Checkbox label={label} checked={(settings.sync ?? defaultSyncOptions)[key]} disabled={disabled} onChange={(_, data) => setSettings({ ...settings, sync: { ...defaultSyncOptions, ...settings.sync, [key]: data.checked === true } })} />
            <div style={{ color: "var(--colorNeutralForeground3)", fontSize: 12, paddingLeft: 32 }}>{hint}</div>
          </div>)}
          <p>关闭选项仅暂停该类同步，不删除远端副本。外部目录默认关闭；另一台设备的目录会恢复到 Liteasy 数据目录内，不会套用原电脑的绝对路径。</p>
          {settings.sync?.apiKeys ? <Field label="密钥同步口令" hint="至少 12 个字符；所有设备使用同一口令。留空保留已保存口令，口令只存本机系统凭据库。">
            <Input aria-label="密钥同步口令" type="password" autoComplete="new-password" value={encryptionPassword} disabled={disabled} onChange={(_, data) => setEncryptionPassword(data.value)} />
          </Field> : null}
        </fieldset>
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
        {status.result?.restartRequired ? <p role="status">笔记、白板、历史或设置已下载，请重启 Liteasy 载入。重启前继续编辑的内容会保留，不会被远端版本覆盖。</p> : null}
        {sessionStorage.getItem("liteasy.webdav-restore-notice") ? <p role="status">{sessionStorage.getItem("liteasy.webdav-restore-notice")}</p> : null}
        {status.result?.deferred?.length ? <p role="status">{status.result.deferred.length} 项远端变更等待应用。请关闭相关文献后再次同步，以保留正在编辑的内容。</p> : null}
        {status.result?.conflicts.length ? <>
          <p>以下内容在两端都有变化。选择保留的版本后继续同步；笔记、目录或历史按整组选择，未选版本保留恢复副本。解决前暂停自动同步。</p>
          {status.result.conflicts.map((conflict) => <div key={conflict.path} style={{ border: "1px solid var(--colorNeutralStroke2)", borderRadius: 4, padding: 8 }}>
            <p title={conflict.path} style={{ overflowWrap: "anywhere" }}>{webDavPathLabel(conflict.path)}</p>
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
