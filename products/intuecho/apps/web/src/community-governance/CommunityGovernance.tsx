import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Checkbox, Field, Select, Textarea } from "@fluentui/react-components";
import type { CommunityAnnotation } from "../community.types";
import type { CommunityGovernanceApi, CommunityNotification, CommunityPreference, CommunityReport, CommunityReportInput, CommunityReportResolution } from "./governance.types";
import { contentFoldReason, preferenceFor, reportReasonLabels, reportStatusLabels, resolutionLabels } from "./governance";
import "./community-governance.css";

function useActive() {
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  return active;
}
const errorText = (error: unknown) => error instanceof Error ? error.message : "操作未完成，请重试。";

export function AnnotationVisibilityGate({ annotation, preferences, children, actorBinding }: {
  annotation: CommunityAnnotation; preferences: CommunityPreference[]; children: ReactNode; actorBinding: string;
}) {
  const reason = contentFoldReason(annotation, preferences);
  return <VisibilityGate key={`${actorBinding}:${annotation.id}:${annotation.revision}:${reason}`} reason={reason}>{children}</VisibilityGate>;
}
function VisibilityGate({ reason, children }: { reason: ReturnType<typeof contentFoldReason>; children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  if (!reason || expanded) return <>{children}</>;
  return <section className="community-governance" aria-label="折叠内容">
    <p>{reason === "hidden_author" ? "已按你的设置隐藏此作者的内容。" : "这条内容已折叠：至少 3 人评分，平均分不高于 2 星。评分不代表研究结论真伪。"}</p>
    <Button onClick={() => setExpanded(true)}>本次展开</Button>
  </section>;
}

type ControlsProps = { annotation: CommunityAnnotation; actorBinding: string; api: CommunityGovernanceApi; preferences: CommunityPreference[]; onPreferencesChanged?: () => void };
export function AnnotationGovernanceControls(props: ControlsProps) {
  return <AnnotationControls key={`${props.actorBinding}:${props.annotation.id}:${props.annotation.revision}`} {...props} />;
}
function AnnotationControls({ annotation, api, preferences, onPreferencesChanged }: ControlsProps) {
  const active = useActive();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<CommunityReportInput["reason"]>("other");
  const [detail, setDetail] = useState("");
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const author = preferenceFor(preferences, "author", annotation.author.id);
  async function submit() {
    setBusy(true); setStatus("");
    try {
      const result = await api.reportAnnotation(annotation.id, { revision: annotation.revision, reason, detail: detail.trim() });
      if (!active.current) return;
      setStatus(`举报已提交，状态：${reportStatusLabels[result.report.status]}。可在处理记录中查看。`);
      setOpen(false); setPreview(false); setDetail("");
    } catch (error) { if (active.current) setStatus(errorText(error)); }
    finally { if (active.current) setBusy(false); }
  }
  async function hideAuthor() {
    setBusy(true); setStatus("");
    try {
      await api.setPreference({ ...author, blocked: !author.blocked });
      if (active.current) { setStatus(author.blocked ? "已恢复显示此作者内容。" : "已隐藏此作者内容及其新回复提醒。此设置仅影响你的社区视图。"); onPreferencesChanged?.(); }
    } catch (error) { if (active.current) setStatus(errorText(error)); }
    finally { if (active.current) setBusy(false); }
  }
  return <section className="community-governance" aria-label="内容治理">
    <div className="community-actions"><Button disabled={busy} onClick={() => { setOpen(!open); setPreview(false); }}>举报</Button><Button disabled={busy} onClick={() => void hideAuthor()}>{author.blocked ? "恢复此作者内容" : "隐藏此作者内容"}</Button></div>
    {open && <form onSubmit={(event) => { event.preventDefault(); setPreview(true); }}>
      <p>仅向有权查看原内容的处理人员提交。请描述具体问题，避免添加无关私人信息；举报不会自动判定结论真伪或删除正文。</p>
      <Field label="举报类型"><Select value={reason} disabled={busy} onChange={(_, data) => { setReason(data.value as CommunityReportInput["reason"]); setPreview(false); }}>{Object.entries(reportReasonLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></Field>
      <Field label="具体说明"><Textarea value={detail} minLength={8} maxLength={1000} required disabled={busy} onChange={(_, data) => { setDetail(data.value); setPreview(false); }} /></Field>
      {preview ? <section aria-label="举报确认"><p>{reportReasonLabels[reason]} · 原内容修订 {annotation.revision}</p><p className="community-multiline">{detail.trim()}</p><Button disabled={busy} onClick={() => void submit()}>确认提交举报</Button></section> : <Button type="submit" disabled={busy || detail.trim().length < 8}>预览举报</Button>}
    </form>}
    {status && <p role="status">{status}</p>}
  </section>;
}

export function SubscriptionControls({ api, preference, label, actorBinding, onChanged }: {
  api: CommunityGovernanceApi; preference: CommunityPreference; label: string; actorBinding: string; onChanged?: () => void;
}) {
  return <SubscriptionControl key={`${actorBinding}:${preference.targetKind}:${preference.targetId}:${preference.subscribed}:${preference.muted}`} api={api} preference={preference} label={label} onChanged={onChanged} />;
}
function SubscriptionControl({ api, preference, label, onChanged }: {
  api: CommunityGovernanceApi; preference: CommunityPreference; label: string; onChanged?: () => void;
}) {
  const active = useActive();
  const [value, setValue] = useState(preference);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  async function save(next: CommunityPreference) {
    setBusy(true); setStatus("");
    try {
      const result = await api.setPreference(next);
      if (active.current) { setValue(result.preference); setStatus(next.muted ? "已静音，不再生成此范围的新提醒。" : next.subscribed ? "已订阅新回复。" : "已取消订阅，不再生成此范围的新提醒。"); onChanged?.(); }
    } catch (error) { if (active.current) setStatus(errorText(error)); }
    finally { if (active.current) setBusy(false); }
  }
  return <section className="community-governance" aria-label={`${label}提醒设置`}>
    <Checkbox label={`订阅${label}`} checked={value.subscribed} disabled={busy} onChange={(_, data) => void save({ ...value, subscribed: data.checked === true })} />
    <Checkbox label={`静音${label}`} checked={value.muted} disabled={busy} onChange={(_, data) => void save({ ...value, muted: data.checked === true })} />
    <p>取消订阅或静音此范围，也会停止来自重叠订阅的新提醒。</p>
    {status && <p role="status">{status}</p>}
  </section>;
}

type InboxProps = { api: CommunityGovernanceApi; actorBinding: string; onOpenAnnotation: (id: string) => void };
export function QuietInbox(props: InboxProps) { return <Inbox key={props.actorBinding} {...props} />; }
function Inbox({ api, onOpenAnnotation }: InboxProps) {
  const active = useActive();
  const [notifications, setNotifications] = useState<CommunityNotification[] | null>(null);
  const [read, setRead] = useState(new Set<string>());
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  async function load() {
    setBusy("refresh"); setNotifications(null); setStatus("");
    try { const result = await api.notifications(); if (active.current) setNotifications(result.notifications); }
    catch (error) { if (active.current) setStatus(errorText(error)); }
    finally { if (active.current) setBusy(null); }
  }
  useEffect(() => { void load(); }, []);
  async function markRead(id: string) {
    setBusy(id); setStatus("");
    try { await api.markNotificationRead(id); if (active.current) setRead((current) => new Set([...current, id])); }
    catch (error) { if (active.current) setStatus(errorText(error)); }
    finally { if (active.current) setBusy(null); }
  }
  return <section className="community-governance" aria-label="工作通知">
    <h2>工作通知</h2><p>仅显示你订阅的讨论提醒。组织邀请和私聊继续在消息中查看。</p>
    <Button disabled={busy !== null} onClick={() => void load()}>刷新通知</Button>
    {notifications?.length === 0 && <p>暂无通知。可在讨论中主动订阅。</p>}
    {notifications?.map((item) => <article key={item.id} className="community-notification">
      <p>{item.available ? "订阅的讨论有新回复" : "相关内容当前不可访问。"}</p>
      {item.available && <Button onClick={() => onOpenAnnotation(item.target.annotationId)}>查看讨论</Button>}
      {read.has(item.id) || (item.available && item.readAt) ? <span>已读</span> : <Button disabled={busy !== null} onClick={() => void markRead(item.id)}>标为已读</Button>}
    </article>)}
    {status && <p role="status">{status}</p>}
  </section>;
}

type ReportsProps = { api: CommunityGovernanceApi; actorBinding: string; review?: boolean };
export function CommunityReportHistory(props: ReportsProps) { return <Reports key={`${props.actorBinding}:${props.review}`} {...props} />; }
function Reports({ api, review = false }: ReportsProps) {
  const active = useActive();
  const [reports, setReports] = useState<CommunityReport[] | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    setBusy(true); setReports(null); setStatus("");
    try { const result = await (review ? api.reviewReports() : api.myReports()); if (active.current) setReports(result.reports); }
    catch (error) { if (active.current) setStatus(errorText(error)); }
    finally { if (active.current) setBusy(false); }
  }
  useEffect(() => { void load(); }, []);
  async function resolve(id: string, resolution: CommunityReportResolution) {
    setBusy(true); setStatus("");
    try { await api.resolveReport(id, resolution); if (active.current) await load(); }
    catch (error) { if (active.current) { setReports(null); setStatus(errorText(error)); } }
    finally { if (active.current) setBusy(false); }
  }
  return <section className="community-governance" aria-label={review ? "组织举报处理" : "我的举报记录"}>
    <h2>{review ? "组织举报处理" : "我的举报记录"}</h2><Button disabled={busy} onClick={() => void load()}>刷新处理记录</Button>
    {reports?.length === 0 && <p>暂无可查看的记录。</p>}
    {reports?.map((item) => <article className="community-notification" key={item.id}>
      <strong>{reportReasonLabels[item.reason]} · {reportStatusLabels[item.status]}</strong><p className="community-multiline">{item.detail}</p>
      {item.resolutionReason && <p>处理说明：{resolutionLabels[item.resolutionReason]}</p>}
      {review && item.status === "pending" && <ReviewDecision disabled={busy} onResolve={(resolution) => void resolve(item.id, resolution)} />}
    </article>)}
    {status && <p role="status">{status}</p>}
  </section>;
}
function ReviewDecision({ disabled, onResolve }: { disabled: boolean; onResolve: (resolution: CommunityReportResolution) => void }) {
  const [reason, setReason] = useState<CommunityReportResolution["reason"]>("reviewed");
  return <div><Field label="处理说明"><Select value={reason} disabled={disabled} onChange={(_, data) => setReason(data.value as CommunityReportResolution["reason"])}>{Object.entries(resolutionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></Field>
    <Button disabled={disabled} onClick={() => onResolve({ status: "resolved", reason })}>记录处理完成</Button><Button disabled={disabled} onClick={() => onResolve({ status: "dismissed", reason })}>记录不予采纳</Button>
    <p>此操作仅记录处理结果；原内容治理继续使用已有撤回与恢复操作。</p></div>;
}
