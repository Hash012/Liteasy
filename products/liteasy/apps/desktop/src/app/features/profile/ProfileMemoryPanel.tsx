import { useState } from "react";
import { Button, Field, Input, Select, Switch, Textarea, Tooltip } from "@fluentui/react-components";
import { AddRegular, DeleteRegular, EditRegular, SearchRegular } from "@fluentui/react-icons";
import { memoryFields, type MemoryField, type ProfileMemoryEntry } from "./profileMemory";
import type { ProfileMemoryController } from "./useProfileMemory";

export function ProfileMemoryPanel({ memory, enabled }: { memory: ProfileMemoryController; enabled: boolean }) {
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<{ id?: string; field: MemoryField; value: string }>();
  const entries = memory.data.entries.filter((entry) => `${memoryFields[entry.field]} ${entry.value}`.toLowerCase().includes(query.toLowerCase()));
  function renderEntry(entry: ProfileMemoryEntry) {
    return <article className="profile-memory-card" key={entry.id}>
      <div className="profile-memory-card-heading"><span className="profile-memory-kind">{memoryFields[entry.field]}</span>
        <span className="profile-muted">{entry.source === "manual" ? "手动维护" : "来自对话"}</span>
        <Tooltip content="编辑偏好" relationship="label"><Button appearance="subtle" size="small" icon={<EditRegular />} aria-label={`编辑偏好：${entry.value}`} onClick={() => setDraft(entry)} /></Tooltip>
        <Tooltip content="删除偏好" relationship="label"><Button appearance="subtle" size="small" icon={<DeleteRegular />} aria-label={`删除偏好：${entry.value}`} onClick={() => memory.removeEntry(entry.id)} /></Tooltip>
      </div>
      <p>{entry.value}</p>
      {entry.evidence ? <details className="profile-memory-source"><summary>来源与更新时间</summary><blockquote>{entry.evidence}</blockquote><time dateTime={entry.updatedAt}>{new Date(entry.updatedAt).toLocaleString()}</time></details> : null}
    </article>;
  }
  return <div className="profile-memory-panel">
    <Switch label="从对话自动整理偏好" checked={memory.data.automatic} disabled={!enabled || !!memory.error} onChange={(_, data) => memory.setAutomatic(data.checked)} />
    <p className="profile-muted">只记住明确的长期偏好。手动条目受保护，有歧义的变更由你确认。</p>
    <details className="profile-memory-source"><summary>自动整理如何工作</summary>
      <p>明确纠正之前对话中的偏好时可自动更新；手动条目不会被覆盖。</p>
      <p>每次最多 4 项，后续检查至少间隔 10 分钟及 5 轮对话；每个会话每天最多 3 次，总计最多 6 次。</p>
      <p>条目保存在本机；仅把候选声明和已有偏好发送给当前所用模型。未配置可用模型时，仍可手动管理。</p>
      {memory.data.cadence.lastCheck ? <p>上次检查：{new Date(memory.data.cadence.lastCheck).toLocaleString()}</p> : null}
    </details>
    <div className="profile-memory-toolbar"><Input contentBefore={<SearchRegular />} aria-label="搜索已记偏好" placeholder="搜索偏好" value={query} onChange={(_, data) => setQuery(data.value)} />
      <Button size="small" icon={<AddRegular />} disabled={!!memory.error} onClick={() => setDraft({ field: "research_topic", value: "" })}>添加偏好</Button></div>
    {draft ? <form className="profile-memory-editor" onSubmit={(event) => { event.preventDefault(); if (!draft.value.trim()) return; if (memory.saveEntry(draft.field, draft.value, draft.id)) setDraft(undefined); }}>
      <Field label="偏好类别"><Select value={draft.field} onChange={(_, data) => setDraft({ ...draft, field: data.value as MemoryField })}>
        {Object.entries(memoryFields).map(([field, name]) => <option key={field} value={field}>{name}</option>)}
      </Select></Field>
      <Field label="偏好内容"><Textarea autoFocus resize="vertical" maxLength={240} value={draft.value} onChange={(_, data) => setDraft({ ...draft, value: data.value })} placeholder="例如：事务处理与分布式数据库；回答先给结论，再解释依据" /></Field>
      <div className="profile-actions"><Button appearance="primary" type="submit" disabled={!draft.value.trim()}>保存偏好</Button><Button onClick={() => setDraft(undefined)}>取消</Button></div>
    </form> : null}
    {memory.data.pending.length ? <section className="profile-memory-pending" aria-label="待确认的偏好变更"><h3>待确认 · {memory.data.pending.length}</h3>
      {memory.data.pending.map((entry) => <article key={entry.id} className="profile-memory-card">
        <span className="profile-memory-kind">{memoryFields[entry.field]}</span>
        <p className="profile-muted">当前：{memory.data.entries.find((item) => item.id === entry.replacesId)?.value ?? "未设置"}</p>
        <p>建议：{entry.value}</p><blockquote>{entry.evidence}</blockquote>
        <div className="profile-actions"><Button size="small" onClick={() => memory.review(entry.id, true)}>采用变更</Button><Button appearance="subtle" size="small" onClick={() => memory.review(entry.id, false)}>忽略</Button></div>
      </article>)}
    </section> : null}
    <div className="profile-memory-list" aria-label="已记住的偏好">{entries.map(renderEntry)}</div>
    {!entries.length ? <p className="profile-empty">{query ? "没有匹配的偏好。" : "还没有保存偏好。你可以手动添加，也可以在对话中告诉助手你的研究方向或回答习惯。"}</p> : null}
  </div>;
}
