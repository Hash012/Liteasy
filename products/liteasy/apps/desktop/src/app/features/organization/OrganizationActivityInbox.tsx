import { useEffect, useRef, useState } from "react";
import { Button, Checkbox } from "@fluentui/react-components";
import { AlertRegular } from "@fluentui/react-icons";
import type { AccountSession } from "../account/account.types";
import { getAccountSessionGeneration } from "../account/accountSessionStorage";

type Activity = { id: string; available: false } | { id: string; available: true; organizationName: string; kind: "invitation_accepted" | "permissions_changed"; occurredAt: string };
type Preference = { enabled: boolean; read: string[] };
function load(key: string): Preference {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null");
    return { enabled: value?.enabled === true, read: Array.isArray(value?.read) ? value.read.filter((id: unknown) => typeof id === "string").slice(-100) : [] };
  } catch { return { enabled: false, read: [] }; }
}
export function OrganizationActivityInbox({ session, endpoint }: { session: AccountSession; endpoint: string }) {
  const binding = JSON.stringify([endpoint, session.issuer, session.userId]);
  const generation = getAccountSessionGeneration();
  return <BoundInbox key={`${binding}:${generation}`} session={session} endpoint={endpoint} generation={generation} storageKey={`liteasy.organization-activity.v1:${binding}`} />;
}
function BoundInbox({ session, endpoint, generation, storageKey }: { session: AccountSession; endpoint: string; generation: string; storageKey: string }) {
  const [preference, setPreference] = useState(() => load(storageKey));
  const [items, setItems] = useState<Activity[]>([]);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const epoch = useRef(0);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; epoch.current += 1; }; }, []);
  function save(next: Preference) { setPreference(next); try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { setStatus("偏好暂未写入本机；本次设置仍有效。"); } }
  async function refresh() {
    if (generation !== getAccountSessionGeneration() || (session.endpoint && session.endpoint.replace(/\/+$/, "") !== endpoint.replace(/\/+$/, ""))) {
      setStatus("账号或服务地址已变化，请重新登录后刷新。"); return;
    }
    const request = ++epoch.current;
    const current = () => active.current && request === epoch.current && generation === getAccountSessionGeneration();
    setBusy(true); setItems([]); setStatus("");
    try {
      const response = await fetch(`${endpoint.replace(/\/+$/, "")}/v1/org/activity/list`, { method: "POST", headers: { Authorization: `Bearer ${session.sessionId}` } });
      if (!response.ok) throw new Error("组织动态暂不可用，请稍后重试。");
      const result = await response.json();
      if (!Array.isArray(result.activities) || result.activities.length > 50 || result.activities.some((item: Activity) => !item || typeof item.id !== "string" || typeof item.available !== "boolean" || (item.available && (typeof item.organizationName !== "string" || !["invitation_accepted", "permissions_changed"].includes(item.kind))))) throw new Error("组织动态返回格式无效。");
      if (current()) setItems(result.activities);
    } catch (error) { if (current()) setStatus(error instanceof Error ? error.message : "组织动态暂不可用。"); }
    finally { if (current()) setBusy(false); }
  }
  return <details className="organization-surface organization-disclosure">
    <summary><AlertRegular /><span>我的组织动态</span></summary>
    <Checkbox label="查看我的权限与加入结果" checked={preference.enabled} onChange={(_, data) => { epoch.current += 1; setItems([]); setBusy(false); save({ ...preference, enabled: data.checked === true }); }} />
    <p>仅在你刷新时读取，已读记录保存在本机；不收集阅读活动。</p>
    {preference.enabled && <><Button disabled={busy} onClick={() => void refresh()}>刷新我的动态</Button>{items.map((item) => <div key={item.id}>
      <p>{item.available ? `${item.organizationName} · ${item.kind === "invitation_accepted" ? "加入结果已更新" : "成员权限已变化"}` : "相关组织当前不可访问。"}</p>
      {preference.read.includes(item.id) ? <span>已读</span> : <Button onClick={() => save({ ...preference, read: [...new Set([...preference.read, item.id])].slice(-100) })}>标为已读</Button>}
    </div>)}</>}
    {status && <p role="status">{status}</p>}
  </details>;
}
