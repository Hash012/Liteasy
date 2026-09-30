import { useState } from "react";
import { Button, Field, Input } from "@fluentui/react-components";
import type { AccountStatus } from "./accountClient";

export type AccountControls = { account: AccountStatus; available: boolean; busy: boolean; error: string; notice: string; guest: boolean;
  setGuest: (value: boolean) => void; begin: (url: string) => Promise<void>; cancel: () => Promise<void>; logout: () => Promise<void>; copyGuest: () => Promise<void> };
export function AccountSettingsView({ controls }: { controls: AccountControls }) {
  const [url, setUrl] = useState(controls.account.apiBaseUrl || import.meta.env.VITE_LITEASY_CLOUD_URL || "");
  const [confirmCopy, setConfirmCopy] = useState(false);
  return <section className="sync-settings" aria-label="账号"><h2>账号与资料库</h2>
    {controls.account.subject ? <>
      <p>已登录 · {controls.account.subject}</p><p>{controls.guest ? "正在使用本机资料库" : "正在使用账号资料库"}</p>
      <div className="resource-actions"><Button disabled={controls.busy} onClick={() => controls.setGuest(!controls.guest)}>{controls.guest ? "切换到账号资料库" : "查看本机资料库"}</Button>
        <Button disabled={controls.busy} onClick={() => void controls.logout()}>退出登录</Button></div>
      <p>本机资料不会随登录自动复制。文件同步设置按资料库分别保存。</p>
      {confirmCopy ? <div><p>将未删除的本机资料和批注复制到当前账号。重复附件会跳过，本机原件保留。</p>
        <Button disabled={controls.busy} onClick={() => { setConfirmCopy(false); void controls.copyGuest(); }}>确认复制</Button>
        <Button disabled={controls.busy} onClick={() => setConfirmCopy(false)}>取消</Button></div> :
        <Button disabled={controls.busy} onClick={() => setConfirmCopy(true)}>复制本机资料到此账号</Button>}
    </> : <>
      <p>未登录时也可收集资料、阅读和批注。</p>
      <Field label="账号服务地址"><Input type="url" placeholder="https://…" value={url} disabled={controls.busy || controls.account.pending}
        onChange={(_, data) => setUrl(data.value)} /></Field>
      {controls.account.pending ? <><p role="status">请在系统浏览器中完成登录，随后返回 Liteasy。</p><Button disabled={controls.busy} onClick={() => void controls.cancel()}>取消登录</Button></> :
        <Button appearance="primary" disabled={!controls.available || controls.busy || !url.trim()} onClick={() => void controls.begin(url)}>使用浏览器登录</Button>}
    </>}
    {controls.error ? <p role="alert">{controls.error}</p> : null}{controls.notice ? <p role="status">{controls.notice}</p> : null}
  </section>;
}
