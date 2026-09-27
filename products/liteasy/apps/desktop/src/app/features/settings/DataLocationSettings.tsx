import { displayPath } from "../resource-filesystem/displayPath";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { Button, Input } from "@fluentui/react-components";
import { FolderOpenRegular } from "@fluentui/react-icons";

type DataLocation = { currentPath: string; pendingPath?: string | null; migrationError?: string | null };

export function DataLocationSettings() {
  const [location, setLocation] = useState<DataLocation>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const desktop = isTauri();
  useEffect(() => {
    if (!desktop) return;
    let active = true;
    void invoke<DataLocation>("get_data_location").then((value) => { if (active) setLocation(value); })
      .catch((e) => { if (active) setError(String(e)); });
    return () => { active = false; };
  }, [desktop]);
  async function run(command: string) {
    setBusy(true); setError("");
    try {
      const value = await invoke<DataLocation | null>(command);
      if (value?.currentPath) setLocation(value);
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }
  return <section className="sidebar-section" aria-label="本地数据保存位置">
    <div className="sidebar-section-header"><FolderOpenRegular /><span>数据保存位置</span></div>
    <div className="sidebar-section-content">
      {desktop ? <>
        <p>Windows 新安装默认将数据保存在安装目录下的 LiteasyData；已有数据和自定义目录保持原位置，可在此迁移。文献库、笔记对象、聊天历史和生成内容保存在此目录。外接文件夹和单独设置的文献库保持原位置。</p>
        <label>当前目录<Input aria-label="当前数据保存路径" readOnly value={displayPath(location?.currentPath ?? "")} style={{ width: "100%" }} /></label>
        <Button size="small" disabled={busy} onClick={() => void run("choose_data_location")}>选择数据保存位置</Button>
        <Button size="small" disabled={busy || !location} onClick={() => void run("reveal_data_location")}>打开数据文件夹</Button>
        <p>选择后将在目标位置创建 LiteasyData。重启时复制并校验现有数据，成功后启用新目录，旧目录保留。</p>
        {location?.pendingPath ? <>
          <p>重启后保存至：<span style={{ overflowWrap: "anywhere" }}>{displayPath(location.pendingPath)}</span></p>
          <p>请先保存正在编辑的内容并等待生成任务结束。</p>
          <Button size="small" disabled={busy} onClick={() => void run("restart_for_data_location")}>重启并迁移数据</Button>
          <Button size="small" disabled={busy} onClick={() => void run("cancel_data_location_change")}>取消目录更改</Button>
        </> : null}
        {location?.migrationError ? <p role="alert">{location.migrationError}</p> : null}
      </> : <p>浏览器版数据保存在当前浏览器；可在 Notes 中连接文件夹。桌面版支持自定义本地数据目录。</p>}
      {error ? <p role="alert">{error}</p> : null}
    </div>
  </section>;
}
