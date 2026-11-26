import { useEffect, useRef, useState } from "react";
import { Button, Checkbox, Field, Input, Textarea } from "@fluentui/react-components";
import type { AccountSession } from "../account/account.types";
import { accountActorStorageKey } from "../account/accountSessionBinding";
import { contextFailure, createPersonalContextClient, type ContextGrant } from "../context-cloud/contextClient";

export function ContextGrantPanel({ session, createClient = createPersonalContextClient }: {
  session: AccountSession | null; createClient?: typeof createPersonalContextClient;
}) {
  const [grants, setGrants] = useState<ContextGrant[]>([]);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState("personal");
  const [write, setWrite] = useState(false);
  const [all, setAll] = useState(false);
  const [days, setDays] = useState("30");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const epoch = useRef(0);
  const binding = accountActorStorageKey(session, session?.endpoint ?? "");
  useEffect(() => { epoch.current++; setSecret(""); setGrants([]); setError(""); setBusy(false); return () => { epoch.current++; }; }, [binding, session?.sessionId]);
  async function run(action: (client: ReturnType<typeof createClient>, current: () => boolean) => Promise<void>) {
    if (!session || !binding) return;
    const generation = epoch.current;
    setBusy(true); setError("");
    try { await action(createClient(session), () => epoch.current === generation); }
    catch (failure) { if (epoch.current === generation) setError(contextFailure(failure)); }
    finally { if (epoch.current === generation) setBusy(false); }
  }
  async function refresh() { await run(async (client, current) => { const result = await client.grants(); if (current()) setGrants(result.grants); }); }
  async function create() {
    const selected = all ? ["*"] : scopes.split(/[\s,，]+/).filter(Boolean);
    const duration = Number(days);
    if (!name.trim() || !selected.length || !Number.isInteger(duration) || duration < 1 || duration > 365 ||
      (!all && selected.some((scope) => !/^(personal|project\/[a-z0-9][a-z0-9-]{0,63})$/.test(scope)))) {
      setError("请填写名称、有效归组和 1–365 天的期限。"); return;
    }
    await run(async (client, current) => {
      const result = await client.createGrant({ name, readScopes: selected, writeScopes: write ? selected : [], expiresAt: new Date(Date.now() + duration * 86400_000).toISOString() });
      if (current()) { setSecret(result.secret); setGrants((list) => [result.grant, ...list]); }
    });
  }
  return <section aria-label="外部设备访问凭据">
    <h3>外部设备访问</h3><p className="profile-muted">为指定设备或 Agent 生成个人上下文凭据，可随时撤销。</p>
    {!binding ? <p>登录云账号后可管理访问凭据。</p> : <>
      <Field label="设备或 Agent 名称"><Input maxLength={80} value={name} onChange={(_, data) => setName(data.value)} /></Field>
      <Field label="允许读取的归组"><Textarea disabled={all} value={scopes} onChange={(_, data) => setScopes(data.value)} placeholder="personal 或 project/vector-db，以空格分隔" /></Field>
      <Checkbox label="允许访问全部个人上下文" checked={all} onChange={(_, data) => setAll(data.checked === true)} />
      <Checkbox label="同时允许保存、修改和删除" checked={write} onChange={(_, data) => setWrite(data.checked === true)} />
      <Field label="有效天数"><Input type="number" min={1} max={365} value={days} onChange={(_, data) => setDays(data.value)} /></Field>
      <Button disabled={busy} onClick={() => void create()}>生成凭据</Button><Button disabled={busy} onClick={() => void refresh()}>查看已有凭据</Button>
      {secret ? <div role="status"><p>凭据仅显示这一次。复制到目标设备后请关闭。</p><Field label="新凭据"><Textarea readOnly value={secret} /></Field><Button onClick={() => setSecret("")}>关闭凭据显示</Button></div> : null}
      <ul>{grants.map((grant) => <li key={grant.id}><strong>{grant.name}</strong> · 读取：{grant.readScopes.join("、") || "无"} · 写入：{grant.writeScopes.join("、") || "无"} · 到期 {new Date(grant.expiresAt).toLocaleDateString()}
        {grant.revokedAt ? " · 已撤销" : <Button size="small" disabled={busy} onClick={() => void run(async (client, current) => { await client.revokeGrant(grant.id); if (current()) setGrants((items) => items.map((item) => item.id === grant.id ? { ...item, revokedAt: new Date().toISOString() } : item)); })}>撤销 {grant.name}</Button>}</li>)}</ul>
    </>}
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}
