import { useEffect, useRef, useState } from "react";
import { Button, Field, Input, Textarea } from "@fluentui/react-components";
import { DisclosureSection, OptionPicker } from "../../shared/ui/productPrimitives";
import type { AccountSession } from "../account/account.types";
import { accountActorStorageKey } from "../account/accountSessionBinding";
import { contextFailure, createPersonalContextClient, type ContextEntry, type ContextEntryInput, type ContextKind, type ContextWrite } from "../context-cloud/contextClient";
import { ContentView } from "../markdown/ContentView";
import { legacyContent } from "../markdown/contentFragment";
import { groupBackgroundTemplate } from "./groupBackgroundTemplate";
import { ResourceLink } from "../resource-links/ResourceReferenceView";

function sourceLink(locator: string) {
  if (locator.startsWith("liteasy://")) return <ResourceLink locator={locator}>打开来源</ResourceLink>;
  try { const url = new URL(locator); if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password) return <a href={url.href} target="_blank" rel="noopener noreferrer">打开来源</a>; } catch { /* Preserve non-Web locators as readable source data. */ }
  return <span>{locator}</span>;
}

const kinds: Record<ContextKind, string> = { profile: "个人背景", understanding: "认识", progress: "进展", idea: "Idea", group_background: "研究组背景", reference: "来源快照" };
export function ResearchContextPanel({ session, createClient = createPersonalContextClient }: {
  session: AccountSession | null; createClient?: typeof createPersonalContextClient;
}) {
  const [entries, setEntries] = useState<ContextEntry[]>([]);
  const [selected, setSelected] = useState<ContextEntry>();
  const [history, setHistory] = useState<ContextEntry[]>([]);
  const [scope, setScope] = useState("personal");
  const [kind, setKind] = useState<ContextKind>("understanding");
  const [filter, setFilter] = useState("");
  const [status, setStatus] = useState("active");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [basis, setBasis] = useState<ContextEntryInput["basis"]>("user_authored");
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const epoch = useRef(0);
  const pending = useRef<ContextWrite>();
  const binding = accountActorStorageKey(session, session?.endpoint ?? "");
  useEffect(() => { epoch.current++; setEntries([]); setSelected(undefined); setTitle(""); setBody(""); setHistory([]); setCursor(null); setError(""); setNotice(""); pending.current = undefined; setBusy(false); return () => { epoch.current++; }; }, [binding, session?.sessionId]);
  async function run(operation: (client: ReturnType<typeof createClient>, current: () => boolean) => Promise<void>) {
    if (!session || !binding) return;
    const generation = epoch.current; setBusy(true); setError(""); setNotice("");
    try { await operation(createClient(session), () => generation === epoch.current); }
    catch (failure) { if (generation === epoch.current) setError(contextFailure(failure)); }
    finally { if (generation === epoch.current) setBusy(false); }
  }
  async function load(more = false) {
    await run(async (client, current) => {
      const page = await client.list({ scopes: [scope], ...(filter ? { kinds: [filter as ContextKind] } : {}), status, ...(more && cursor ? { cursor } : {}) });
      if (current()) { setEntries((items) => more ? [...items, ...page.entries] : page.entries); setCursor(page.nextCursor); }
    });
  }
  function choose(entry?: ContextEntry) {
    setSelected(entry); setTitle(entry?.title ?? ""); setBody(entry?.bodyMarkdown ?? "");
    setKind(entry?.kind ?? "understanding"); setBasis(entry?.basis ?? "user_authored"); setHistory([]); pending.current = undefined; setError("");
  }
  async function write(action: "save" | "archive" | "delete") {
    await run(async (client, current) => {
      const entry: ContextEntryInput = { scopeKey: selected?.scopeKey ?? scope, kind, title, bodyMarkdown: body, basis,
        status: action === "archive" ? "archived" : selected?.status ?? "active", tags: selected?.tags ?? [], sourceRefs: selected?.sourceRefs ?? [], attributes: selected?.attributes ?? {} };
      const candidate = action === "delete" && selected ? { schemaVersion: "liteasy.context-write/v1" as const, operationId: "", action: "delete" as const, entryId: selected.id, expectedRevision: selected.revision }
        : selected ? { schemaVersion: "liteasy.context-write/v1" as const, operationId: "", action: "update" as const, entryId: selected.id, expectedRevision: selected.revision, entry }
        : { schemaVersion: "liteasy.context-write/v1" as const, operationId: "", action: "create" as const, entry };
      if (!pending.current || JSON.stringify({ ...pending.current, operationId: "" }) !== JSON.stringify(candidate)) pending.current = { ...candidate, operationId: crypto.randomUUID() };
      const receipt = await client.write(pending.current);
      if (!current()) return;
      pending.current = undefined;
      setNotice(`云端已保存 · ${receipt.entryId} · 版本 ${receipt.revision}`);
      if (action === "delete") { setEntries((items) => items.filter((item) => item.id !== selected?.id)); choose(); }
      else {
        const result = await client.get(receipt.entryId);
        if (current()) { choose(result.entry); setEntries((items) => [result.entry, ...items.filter((item) => item.id !== result.entry.id)]); }
      }
    });
  }
  return <section aria-label="个人上下文">
    <h3>个人上下文</h3><p className="profile-muted">保存可在各设备使用的背景、认识与 Idea。所有条目仅本人可见。</p>
    {!binding ? <p>登录云账号后可读取和整理。</p> : <>
      <div className="profile-actions"><Field label="归组"><Input value={scope} disabled={busy} onChange={(_, data) => { setScope(data.value); setCursor(null); }} /></Field>
        <Field label="筛选类型"><OptionPicker aria-label="筛选类型" value={filter} onValueChange={(value) => { setFilter(value); setCursor(null); }} options={[{ value: "", label: "全部类型" }, ...Object.entries(kinds).map(([value, label]) => ({ value, label }))]} /></Field>
        <Field label="整理状态"><OptionPicker aria-label="整理状态" value={status} onValueChange={(value) => { setStatus(value); setCursor(null); }} options={[{ value: "active", label: "使用中" }, { value: "draft", label: "草稿" }, { value: "archived", label: "已归档" }]} /></Field>
        <Button disabled={busy} onClick={() => void load()}>载入条目</Button><Button disabled={busy} onClick={() => choose()}>新建条目</Button></div>
      <ul aria-label="上下文条目">{entries.map((entry) => <li key={entry.id}><Button appearance="subtle" onClick={() => choose(entry)}>{entry.title}</Button> · {kinds[entry.kind]} · 版本 {entry.revision}</li>)}</ul>
      {cursor ? <Button disabled={busy} onClick={() => void load(true)}>更多条目</Button> : null}
      <Field label="条目类型"><OptionPicker aria-label="条目类型" value={kind} onValueChange={(value) => setKind(value as ContextKind)} options={Object.entries(kinds).map(([value, label]) => ({ value, label }))} /></Field>
      {kind === "group_background" && !body ? <Button onClick={() => setBody(groupBackgroundTemplate)}>填入研究组背景模板</Button> : null}
      <Field label="标题"><Input value={title} maxLength={160} onChange={(_, data) => setTitle(data.value)} /></Field>
      <Field label="内容依据"><OptionPicker aria-label="内容依据" value={basis} onValueChange={(value) => setBasis(value as ContextEntryInput["basis"])} options={[{ value: "user_authored", label: "本人撰写" }, { value: "user_statement", label: "本人陈述" }, { value: "agent_summary", label: "AI 整理" }, { value: "source_excerpt", label: "来源摘录" }, { value: "imported", label: "导入资料" }]} /></Field>
      <Field label="正文 Markdown"><Textarea rows={10} value={body} onChange={(_, data) => setBody(data.value)} /></Field>
      {body ? <div aria-label="正文预览"><ContentView content={legacyContent(body)} mediaPolicy="blocked" /></div> : null}
      <Button appearance="primary" disabled={busy || !title.trim() || !body.trim()} onClick={() => void write("save")}>{selected ? "保存修正" : "保存条目"}</Button>
      {selected ? <><p>当前条目归组：{selected.scopeKey} · 版本 {selected.revision}</p><Button disabled={busy} onClick={() => void run(async (client, current) => { const value = await client.get(selected.id); if (current()) choose(value.entry); })}>重新载入当前条目</Button>
        <Button disabled={busy} onClick={() => void write("archive")}>归档</Button><Button disabled={busy} onClick={() => void write("delete")}>删除条目及历史</Button>
        <Button disabled={busy} onClick={() => void run(async (client, current) => { const value = await client.history(selected.id); if (current()) setHistory(value.revisions); })}>查看修订</Button>
        <ul aria-label="条目来源">{selected.sourceRefs.map((source, index) => <li key={index}>{source.title ?? source.sourceId ?? source.origin} · {source.availability === "local_only" ? "来源仅在原设备可用" : source.availability === "unavailable" ? "来源当前不可访问" : source.availability === "remote" ? "远端来源" : "来源可达性未知"} · 来源版本 {source.revision ?? "未知"}
          {source.locator ? <> · {sourceLink(source.locator)}</> : null}</li>)}</ul></> : null}
      {history.map((entry) => <DisclosureSection key={entry.revision} title={`版本 ${entry.revision} · ${entry.updatedAt}`}><ContentView content={legacyContent(entry.bodyMarkdown)} mediaPolicy="blocked" /></DisclosureSection>)}
    </>}
    {busy ? <p role="status">正在访问云端…</p> : null}{notice ? <p role="status">{notice}</p> : null}{error ? <p role="alert">{error}</p> : null}
  </section>;
}
