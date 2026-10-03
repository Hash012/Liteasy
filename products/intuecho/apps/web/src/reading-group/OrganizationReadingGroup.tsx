import { Badge, Button, Checkbox, Input, Textarea } from "@fluentui/react-components";
import { Add20Regular, BookOpen20Regular, Save20Regular } from "@fluentui/react-icons";
import { useEffect, useRef, useState } from "react";
import type { AcademicProfile } from "../community.types";
import { LocalDraftControls } from "../LocalDraftControls";
import { useLocalDraft } from "../useLocalDraft";
import { LiteratureTargetEditor } from "../LiteratureTargetEditor";
import { SourceRevision } from "../SourceRevision";
import type { LiteratureRecord, OrganizationAccessSnapshot } from "@intuecho/contracts";
import { communityApi } from "../communityApi";
import type { CommunityAnnotation, CommunityReply, CreateAnnotationInput, CreateReplyInput, OrganizationAnnotationGroup } from "../community.types";
import { buildPersonalReadingNote, buildReadingPack, buildReadingReply, isHostSummary, readingMaterials, readingPacks, readingPackTitle } from "./readingGroup";
import type { PersonalReadingNote, ReadingContributionKind } from "./readingGroup";
import { ReadingRoundReview, matchesDiscussionFilter, type DiscussionFilter } from "./ReadingRoundReview";
import "./reading-group.css";

export type OrganizationReadingGroupProps = {
  organization: OrganizationAnnotationGroup;
  viewerId: string;
  actorBinding: string;
  owner?: string;
  access?: OrganizationAccessSnapshot;
  onChanged?: () => void;
  onExportNote?: (note: PersonalReadingNote) => void | Promise<void>;
};

type Preview = { context: string; draftKey: string; profile?: AcademicProfile } & (
  | { kind: "pack"; payload: CreateAnnotationInput }
  | { kind: "reply"; payload: CreateReplyInput; references: CommunityReply[] }
  | { kind: "edit"; reply: CommunityReply; payload: { body: string; expectedRevision: number } }
);

function savePersonalNote(note: PersonalReadingNote) {
  const url = URL.createObjectURL(new Blob([note.content], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = note.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "操作未完成，请刷新后核对。";
  if (/PARENT_ANNOTATION_REVISION_CONFLICT/.test(message)) return "读书包的内容或可见范围已变化，请重新加载并确认。";
  if (/ORGANIZATION_ACCESS_DENIED|ANNOTATION_NOT_FOUND|PARENT_ANNOTATION_NOT_FOUND/.test(message)) return "当前无法访问此读书包，请刷新组织权限。";
  return message;
}

export function OrganizationReadingGroup(props: OrganizationReadingGroupProps) {
  return <ReadingGroupWorkspace key={`${props.actorBinding}:${props.organization.organizationId}`} {...props} />;
}

function ReadingGroupWorkspace({ organization, viewerId, actorBinding, owner = "", access, onChanged, onExportNote = savePersonalNote }: OrganizationReadingGroupProps) {
  const [packIntentId, setPackIntentId] = useState(() => crypto.randomUUID());
  const [replyIntentId, setReplyIntentId] = useState(() => crypto.randomUUID());
  const [createdPacks, setCreatedPacks] = useState<CommunityAnnotation[]>([]);
  const packs = readingPacks([...new Map([...createdPacks, ...organization.annotations].map((annotation) => [annotation.id, annotation])).values()], organization.organizationId);
  const [selectedId, setSelectedId] = useState("");
  const [discussionFilter, setDiscussionFilter] = useState<DiscussionFilter>("all");
  const [discussionQuery, setDiscussionQuery] = useState("");
  const pack = packs.find((item) => item.id === selectedId) ?? packs[0];
  const [sourceRecords, setSourceRecords] = useState<LiteratureRecord[]>([]);
  const [sourceError, setSourceError] = useState("");
  const [sourceQuery, setSourceQuery] = useState("");
  const materials = [...new Map([...readingMaterials(organization.annotations, organization.organizationId),
    ...sourceRecords.filter((record) => record.status === "confirmed").map((record) => ({ literatureId: record.literatureId, title: record.title, revision: record.revision }))].map((material) => [material.literatureId, material])).values()];
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [guide, setGuide] = useState("");
  const [deadline, setDeadline] = useState("");
  const [notifyReadingTask, setNotifyReadingTask] = useState(false);
  const [mentionedUserIds, setMentionedUserIds] = useState<string[]>([]);
  const [selectedMaterials, setSelectedMaterials] = useState<string[]>([]);
  const [kind, setKind] = useState<ReadingContributionKind>("question");
  const [contribution, setContribution] = useState("");
  const [evidence, setEvidence] = useState("");
  const [summary, setSummary] = useState("");
  const [unresolved, setUnresolved] = useState("");
  const [referenceIds, setReferenceIds] = useState<string[]>([]);
  const [reflection, setReflection] = useState("");
  const [reflectionRevision, setReflectionRevision] = useState<number | null>(null);
  const [exportConfirmed, setExportConfirmed] = useState(false);
  const [editing, setEditing] = useState<CommunityReply | null>(null);
  const [editBody, setEditBody] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const [thread, setThread] = useState<{ context: string; replies: CommunityReply[] } | null>(null);
  const [threadError, setThreadError] = useState("");
  const [unavailableContext, setUnavailableContext] = useState("");
  const context = JSON.stringify([actorBinding, organization.organizationId, pack?.id, pack?.revision, access]);
  const canRead = access?.allowedActions.includes("read_body") === true && unavailableContext !== context;
  const canComment = canRead && access?.allowedActions.includes("comment") === true;
  const currentContext = useRef(context);
  currentContext.current = context;
  const mounted = useRef(true);
  const replies = thread?.context === context ? thread.replies : [];
  const isHost = pack?.author.id === viewerId;
  const draftScope = `reading-group:${organization.organizationId}:${pack?.id ?? "first-pack"}`;
  const draftValue = { packIntentId, replyIntentId, title, guide, deadline, notifyReadingTask, selectedMaterials, kind, contribution, evidence, summary, unresolved, referenceIds, reflection, reflectionRevision, editing, editBody };
  const draftKey = JSON.stringify(draftValue);
  const currentDraftKey = useRef(draftKey);
  currentDraftKey.current = draftKey;
  const activePreview = preview?.context === context && preview.draftKey === draftKey ? preview : null;
  function restoreDraft(value: typeof draftValue) {
    if (!value || [value.packIntentId, value.replyIntentId, value.title, value.guide, value.deadline, value.contribution, value.evidence, value.summary, value.unresolved, value.reflection, value.editBody].some((item) => typeof item !== "string") ||
      !Array.isArray(value.selectedMaterials) || value.selectedMaterials.some((item) => typeof item !== "string") ||
      !Array.isArray(value.referenceIds) || value.referenceIds.some((item) => typeof item !== "string") ||
      (value.editing !== null && (!value.editing || typeof value.editing.id !== "string" || typeof value.editing.body !== "string" || !Number.isSafeInteger(value.editing.revision) || value.editing.parentAnnotationId !== pack?.id)) ||
      (value.reflectionRevision != null && (!Number.isSafeInteger(value.reflectionRevision) || value.reflectionRevision < 1)) ||
      !["question", "evidence", "summary"].includes(value.kind)) throw new Error("草稿内容格式无法识别，原件已保留，请从操作中心导出。");
    setPackIntentId(value.packIntentId); setReplyIntentId(value.replyIntentId); setTitle(value.title); setGuide(value.guide); setDeadline(value.deadline); setNotifyReadingTask(value.notifyReadingTask);
    setSelectedMaterials(value.selectedMaterials); setKind(value.kind); setContribution(value.contribution); setEvidence(value.evidence);
    setSummary(value.summary); setUnresolved(value.unresolved); setReferenceIds(value.referenceIds); setReflection(value.reflection); setReflectionRevision(value.reflectionRevision ?? null);
    setEditing(value.editing); setEditBody(value.editBody); setPreview(null); setExportConfirmed(false); setCreateOpen(true);
  }
  const localDraft = useLocalDraft({ owner, scope: draftScope, value: draftValue, onRestore: restoreDraft, enabled: canRead });
  useEffect(() => {
    if (!canRead || !createOpen) return;
    let active = true;
    setSourceError("");
    void communityApi.readingSources(organization.organizationId).then(({ sources }) => {
      if (active && mounted.current) setSourceRecords(sources.filter((record) => record.status === "confirmed"));
    }).catch(() => { if (active && mounted.current) setSourceError("暂时无法读取可用资料，请重试或检索并确认文献。"); });
    return () => { active = false; };
  }, [actorBinding, organization.organizationId, canRead, createOpen]);
  const participants = [...new Map([...(pack ? [pack.author] : []), ...replies.map((reply) => reply.author)].filter((author) => author.id !== viewerId).map((author) => [author.id, author])).values()];

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setCreatedPacks([]); }, [organization.annotations]);
  useEffect(() => {
    setPreview(null);
    setPending(false);
    setThread(null);
    setThreadError("");
    setReferenceIds([]);
    setMentionedUserIds([]);
    if (!canRead || !pack) return;
    let active = true;
    void communityApi.replies(pack.id).then((result) => {
      if (active && mounted.current && currentContext.current === context) {
        setThread({ context, replies: result.replies.filter((reply) => reply.parentAnnotationId === pack.id) });
      }
    }).catch((error) => {
      if (active && mounted.current && currentContext.current === context) {
        rejectUnavailableAccess(error);
        setThreadError(errorMessage(error));
      }
    });
    return () => { active = false; };
  }, [context, canRead, pack?.id]);

  async function searchSources() {
    if (!canRead || !sourceQuery.trim()) return;
    const requestedContext = context;
    setSourceError("");
    try {
      const { sources } = await communityApi.readingSources(organization.organizationId, sourceQuery.trim());
      if (mounted.current && currentContext.current === requestedContext) {
        setSourceRecords((current) => [...new Map([...current, ...sources.filter((record) => record.status === "confirmed")].map((record) => [record.literatureId, record])).values()]);
        setPreview(null);
        if (!sources.length) setSourceError("未找到可用的已确认资料，可继续检索并确认文献。");
      }
    } catch (error) { if (mounted.current && currentContext.current === requestedContext) { rejectUnavailableAccess(error); setSourceError(errorMessage(error)); } }
  }

  function rejectUnavailableAccess(error: unknown) {
    if (error instanceof Error && /ORGANIZATION_ACCESS_DENIED|ANNOTATION_NOT_FOUND/.test(error.message)) {
      setUnavailableContext(context);
      setThread(null);
    }
  }
  function editInput(update: () => void) { update(); setPreview(null); setStatus(""); }
  function prepare(build: () => Preview) {
    if (!canComment || pending) return;
    try { setPreview(build()); setStatus(""); } catch (error) { setStatus(errorMessage(error)); }
  }
  async function previewPack() {
    if (!canComment || pending) return;
    const approvedContext = context;
    setPending(true); setStatus("");
    try {
      const payload = buildReadingPack({ organizationId: organization.organizationId, title, guide, deadline, notifyReadingTask,
        materials: materials.filter((material) => selectedMaterials.includes(material.literatureId)) });
      const { profile } = await communityApi.academicProfile();
      if (mounted.current && currentContext.current === approvedContext && currentDraftKey.current === draftKey) setPreview({ context, draftKey, kind: "pack", profile, payload: { ...payload, expectedAuthorProfileRevision: profile.revision } });
    } catch (error) { if (mounted.current && currentContext.current === approvedContext) setStatus(errorMessage(error)); }
    finally { if (mounted.current && currentContext.current === approvedContext) setPending(false); }
  }
  function previewContribution(contributionKind: ReadingContributionKind) {
    if (!pack) return;
    prepare(() => {
      if (mentionedUserIds.some((id) => !participants.some((participant) => participant.id === id))) throw new Error("讨论参与者已变化，请重新选择提及对象。");
      const references = contributionKind === "summary" ? replies.filter((reply) => referenceIds.includes(reply.id)) : [];
      return { context, draftKey, kind: "reply", references, payload: buildReadingReply({
        pack, kind: contributionKind, body: contributionKind === "summary" ? summary : contribution,
        evidence: contributionKind === "summary" ? undefined : evidence, unresolved, references, viewerId, mentionedUserIds
      }) };
    });
  }

  async function submitPreview() {
    if (!activePreview || !canComment || pending) return;
    const approved = activePreview;
    const stillCurrent = () => mounted.current && currentContext.current === approved.context && currentDraftKey.current === approved.draftKey;
    setPending(true);
    setStatus("");
    try {
      const savedSnapshot = owner ? await localDraft.save() : undefined;
      if (approved.kind === "pack") {
        const { profile } = await communityApi.academicProfile();
        if (!stillCurrent()) return;
        if (JSON.stringify(profile) !== JSON.stringify(approved.profile)) throw new Error("作者资料已变化，请重新预览。");
        const result = await communityApi.createAnnotation(approved.payload, packIntentId);
        if (!stillCurrent()) return;
        if (result.annotation.organizationId !== organization.organizationId || result.annotation.visibility !== "organization" || result.annotation.shareToPlaza || result.annotation.author.id !== viewerId) {
          throw new Error("读书包回执与批准的作者或组织范围不一致，请刷新核对。");
        }
        setCreatedPacks((current) => [...current, result.annotation]);
        setSelectedId(result.annotation.id);
        setCreateOpen(false);
        setTitle(""); setGuide(""); setDeadline(""); setSelectedMaterials([]); setNotifyReadingTask(false);
      } else if (approved.kind === "reply" && pack) {
        if (approved.references.length) {
          const current = await communityApi.replies(pack.id);
          if (!stillCurrent()) return;
          if (approved.references.some((reference) => !current.replies.some((reply) => reply.id === reference.id && reply.revision === reference.revision && reply.parentAnnotationId === pack.id))) {
            setThread({ context, replies: current.replies.filter((reply) => reply.parentAnnotationId === pack.id) });
            throw new Error("引用的回复已更新，请重新查看后整理摘要。");
          }
        }
        const result = await communityApi.createReply(pack.id, approved.payload, replyIntentId);
        if (!stillCurrent()) return;
        if (result.reply.parentAnnotationId !== pack.id || result.reply.author.id !== viewerId || result.annotation !== null) {
          throw new Error("回复回执与批准的讨论不一致，请刷新核对。");
        }
        setThread({ context, replies: [...replies.filter((reply) => reply.id !== result.reply.id), result.reply] });
        setContribution(""); setEvidence(""); setSummary(""); setUnresolved(""); setReferenceIds([]); setMentionedUserIds([]);
      } else if (approved.kind === "edit" && pack) {
        if (approved.reply.author.id !== viewerId || approved.reply.parentAnnotationId !== pack.id) return;
        const result = await communityApi.updateReply(approved.reply.id, approved.payload);
        if (!stillCurrent()) return;
        if (result.reply.id !== approved.reply.id || result.reply.author.id !== viewerId || result.reply.parentAnnotationId !== pack.id || result.reply.revision <= approved.reply.revision) {
          throw new Error("修改回执无法核实，请刷新讨论。");
        }
        setThread({ context, replies: replies.map((reply) => reply.id === result.reply.id ? result.reply : reply) });
        setEditing(null);
      }
      if (approved.kind === "pack") setPackIntentId(crypto.randomUUID());
      if (approved.kind === "reply") setReplyIntentId(crypto.randomUUID());
      // Private reflection is not part of the submitted contribution. Keep it locally.
      if (savedSnapshot && !reflection.trim()) { try { await localDraft.clear(savedSnapshot); } catch { /* Do not repeat successful writes. */ } }
      setPreview(null);
      setStatus("已保存到组织讨论。");
      onChanged?.();
    } catch (error) {
      if (stillCurrent()) { rejectUnavailableAccess(error); setStatus(errorMessage(error)); setPreview(null); }
    } finally {
      if (mounted.current && currentContext.current === approved.context) setPending(false);
    }
  }

  async function checkCurrentPack() {
    if (!pack) throw new Error("ANNOTATION_NOT_FOUND");
    const { annotation } = await communityApi.annotation(pack.id);
    if (annotation.id !== pack.id || annotation.organizationId !== organization.organizationId || annotation.visibility !== "organization" || annotation.withdrawnAt || annotation.shareToPlaza) {
      throw new Error("ORGANIZATION_ACCESS_DENIED");
    }
    return annotation;
  }
  async function bindReflectionRevision() {
    const approvedContext = context;
    try {
      const current = await checkCurrentPack();
      if (mounted.current && currentContext.current === approvedContext) { setReflectionRevision(current.revision); setExportConfirmed(false); }
    } catch (error) {
      if (mounted.current && currentContext.current === approvedContext) { rejectUnavailableAccess(error); setStatus(errorMessage(error)); }
    }
  }
  async function exportNote() {
    if (!pack || !exportConfirmed || !canRead || !reflectionRevision) return;
    const approvedContext = context;
    const approvedDraft = draftKey;
    try {
      await checkCurrentPack();
      if (!mounted.current || currentContext.current !== approvedContext || currentDraftKey.current !== approvedDraft) return;
      // Source changes never rewrite the version on which the private reflection began.
      await onExportNote(buildPersonalReadingNote({ ...pack, revision: reflectionRevision }, reflection));
      if (mounted.current && currentContext.current === approvedContext) setStatus("已导出个人复盘与来源引用。");
    } catch (error) {
      if (mounted.current && currentContext.current === approvedContext) { rejectUnavailableAccess(error); setStatus(errorMessage(error)); }
    }
  }

  return <section className="reading-group" aria-label={`${organization.name} 读书组`}>
    <header><div><h2><BookOpen20Regular />读书组</h2><p>精选资料、提出问题、对照原文，并由主持人手动整理。</p></div>
      <Button icon={<Add20Regular />} disabled={!canComment || pending} onClick={() => editInput(() => setCreateOpen(!createOpen))}>创建读书包</Button></header>
    {!canRead ? <p role="status">组织权限尚未确认或已变化，请刷新后重试。</p> : <>
      <LocalDraftControls controller={localDraft} owner={owner} scope={draftScope} value={draftValue} onRestore={restoreDraft} />
      {createOpen && <section className="reading-group-form" aria-label="创建组织读书包">
        <label>读书主题<Input value={title} maxLength={160} onChange={(_, data) => editInput(() => setTitle(data.value))} /></label>
        <label>导读与讨论目标<Textarea value={guide} maxLength={6000} onChange={(_, data) => editInput(() => setGuide(data.value))} /></label>
        <label>查找已确认资料<Input value={sourceQuery} onChange={(_, data) => editInput(() => setSourceQuery(data.value))} /></label>
        <Button onClick={() => void searchSources()} disabled={!sourceQuery.trim() || pending}>查找可用资料</Button>
        <fieldset><legend>精选资料</legend>{materials.map((material) => <Checkbox key={material.literatureId} label={material.title} checked={selectedMaterials.includes(material.literatureId)} onChange={(_, data) => editInput(() => setSelectedMaterials((current) => data.checked ? [...current, material.literatureId] : current.filter((id) => id !== material.literatureId)))} />)}
          {!materials.length && <p>可直接检索并确认第一份文献，无需先发布批注。无法由来源确认的材料暂不能加入。</p>}</fieldset>
        <LiteratureTargetEditor required={false} targets={[]} onChange={() => {}} onConfirmed={(record) => editInput(() => {
          setSourceRecords((current) => [...current.filter((item) => item.literatureId !== record.literatureId), record]);
          setSelectedMaterials((current) => [...new Set([...current, record.literatureId])]);
        })} />
        {sourceError && <p role="status">{sourceError}</p>}
        <label>讨论截止日期（可选，UTC）<Input type="date" value={deadline} onChange={(_, data) => editInput(() => setDeadline(data.value))} /></label>
        <Checkbox label="作为阅读任务提醒已订阅成员" checked={notifyReadingTask} onChange={(_, data) => editInput(() => setNotifyReadingTask(data.checked === true))} />
        <Button disabled={!canComment || pending} onClick={() => void previewPack()}>预览读书包</Button>
      </section>}
      {!!packs.length && <label className="reading-group-select">选择读书包<select value={pack?.id ?? ""} onChange={(event) => {
        setSelectedId(event.target.value); setPreview(null); setEditing(null); setContribution(""); setEvidence("");
        setSummary(""); setUnresolved(""); setReflection(""); setReflectionRevision(null); setExportConfirmed(false); setStatus(""); setDiscussionFilter("all"); setDiscussionQuery("");
      }}>{packs.map((item) => <option key={item.id} value={item.id}>{readingPackTitle(item)}</option>)}</select></label>}
      {!pack ? <p>该组织尚无读书包。可直接选择或确认资料，创建第一个读书包。</p> : <>
        <article className="reading-group-pack"><div className="reading-group-row"><strong>主持人：{pack.author.name}</strong>
          <Badge appearance="tint">{replies.some((reply) => isHostSummary(pack, reply)) ? "已有主持人整理" : "讨论中"}</Badge></div>
          <p className="reading-group-body">{pack.body}</p><a href={`/annotations/${encodeURIComponent(pack.id)}`}>查看原批注与文献 · 修订 {pack.revision}</a></article>
        {thread?.context === context && <ReadingRoundReview pack={pack} replies={replies} onFilter={(filter) => { setDiscussionFilter(filter); setDiscussionQuery(""); }} />}
        <section aria-label="读书组讨论" className="reading-group-thread"><h3>问题与原文对照</h3>
          <div className="reading-round-filters" role="group" aria-label="讨论筛选">{(["all", "question", "evidence", "summary"] as const).map((filter) => <Button key={filter} size="small" appearance={discussionFilter === filter ? "primary" : "subtle"} aria-pressed={discussionFilter === filter} onClick={() => setDiscussionFilter(filter)}>
            {{ all: "全部", question: "问题", evidence: "原文对照", summary: "主持人整理" }[filter]} ({replies.filter((reply) => matchesDiscussionFilter(pack, reply, filter)).length})
          </Button>)}</div>
          <Input aria-label="检索本组讨论" placeholder="检索问题、作者或原文位置" value={discussionQuery} onChange={(_, data) => setDiscussionQuery(data.value)} />
          {threadError ? <p role="alert">{threadError}</p> : thread?.context !== context ? <p role="status">正在加载讨论…</p> : !replies.length ? <p>尚无贡献，可从一个问题开始。</p> : null}
          {replies.filter((reply) => matchesDiscussionFilter(pack, reply, discussionFilter) && `${reply.body} ${reply.author.name}`.toLocaleLowerCase().includes(discussionQuery.trim().toLocaleLowerCase())).map((reply) => <article key={reply.id} id={`reply-${reply.id}`}><div className="reading-group-row"><strong>{reply.author.name}</strong><small>修订 {reply.revision}</small>{isHostSummary(pack, reply) && <Badge appearance="tint">主持人手动摘要</Badge>}</div>
            <p className="reading-group-body">{reply.body}</p>
            {reply.collaboration?.sourceRefs.map((reference) => <SourceRevision key={`${reference.sourceNamespace}:${reference.sourceId}:${reference.revision}`} reference={reference} />)}
            {reply.author.id === viewerId && reply.viewerIsAuthor && <Button size="small" disabled={!canComment || pending} onClick={() => editInput(() => { setEditing(reply); setEditBody(reply.body); })}>更正我的贡献</Button>}
          </article>)}
        </section>
        {editing && <section className="reading-group-form" aria-label="更正自己的贡献"><label>更正内容<Textarea value={editBody} maxLength={8000} onChange={(_, data) => editInput(() => setEditBody(data.value))} /></label>
          <Button disabled={!canComment || pending || !editBody.trim()} onClick={() => prepare(() => ({ context, draftKey, kind: "edit", reply: editing, payload: { body: editBody.trim(), expectedRevision: editing.revision } }))}>预览更正</Button>
          <Button appearance="subtle" onClick={() => editInput(() => setEditing(null))}>取消更正</Button></section>}
        {!!participants.length && <fieldset><legend>提及讨论参与者（可选，最多 5 人）</legend><p>仅提醒已订阅且未静音的参与者；输入姓名不会自动提及。</p>
          {participants.map((participant) => <Checkbox key={participant.id} label={`提及 ${participant.name}`} checked={mentionedUserIds.includes(participant.id)} disabled={!canComment || pending || (mentionedUserIds.length >= 5 && !mentionedUserIds.includes(participant.id))} onChange={(_, data) => editInput(() => setMentionedUserIds((current) => data.checked ? [...current, participant.id] : current.filter((id) => id !== participant.id)))} />)}
        </fieldset>}
        <section className="reading-group-form" aria-label="贡献问题或原文对照"><label>贡献用途<select value={kind} onChange={(event) => editInput(() => setKind(event.target.value as ReadingContributionKind))}><option value="question">问题</option><option value="evidence">原文对照与回应</option></select></label>
          <label>问题或原文对照<Textarea value={contribution} maxLength={6000} onChange={(_, data) => editInput(() => setContribution(data.value))} /></label>
          <label>原文位置（自行核对）<Input value={evidence} maxLength={500} onChange={(_, data) => editInput(() => setEvidence(data.value))} /></label>
          <Button disabled={!canComment || pending} onClick={() => previewContribution(kind)}>预览贡献</Button>
        </section>
        {isHost && <section className="reading-group-form" aria-label="主持人整理"><h3>主持人整理</h3><p>手动保留讨论依据与异议；每次整理保留为新的回复，不代表全员共识。</p>
          <label>主持人手动摘要<Textarea value={summary} maxLength={6000} onChange={(_, data) => editInput(() => setSummary(data.value))} /></label>
          <label>未解决项与异议<Textarea value={unresolved} maxLength={1000} onChange={(_, data) => editInput(() => setUnresolved(data.value))} /></label>
          {replies.map((reply) => <Checkbox key={reply.id} label={`引用 ${reply.author.name} 的回复（修订 ${reply.revision}）`} checked={referenceIds.includes(reply.id)} onChange={(_, data) => editInput(() => setReferenceIds((current) => data.checked ? [...current, reply.id] : current.filter((id) => id !== reply.id)))} />)}
          <Button disabled={!canComment || pending} onClick={() => previewContribution("summary")}>预览主持人摘要</Button>
        </section>}
        <section className="reading-group-form" aria-label="返回个人笔记"><h3>个人复盘</h3><p>导出仅包含你在此填写的复盘与来源引用，不会复制组织讨论、资料摘录或原文件。</p>
          <label>个人复盘<Textarea value={reflection} maxLength={8000} onChange={(_, data) => {
            if (!data.value.trim()) setReflectionRevision(null);
            else if (!reflection.trim()) setReflectionRevision(pack.revision);
            setReflection(data.value); setExportConfirmed(false);
          }} /></label>
          {reflectionRevision && <p>此复盘引用修订 {reflectionRevision}{pack.revision !== reflectionRevision ? `；当前读书包为修订 ${pack.revision}` : ""}。来源更新不会改写你的复盘或引用。</p>}
          {reflection.trim() && !reflectionRevision && <><p>旧草稿未保存来源版本。请先核对当前来源；你的复盘内容保持不变。</p><Button onClick={() => void bindReflectionRevision()}>核对当前来源并绑定版本</Button></>}
          <Checkbox label="确认仅导出我在此填写的个人复盘与来源引用" checked={exportConfirmed} onChange={(_, data) => setExportConfirmed(Boolean(data.checked))} />
          <Button icon={<Save20Regular />} disabled={!exportConfirmed || !reflection.trim() || !reflectionRevision} onClick={() => void exportNote()}>导出个人笔记</Button>
        </section>
      </>}
      {activePreview && <section className="reading-group-preview" aria-label="提交预览"><h3>提交预览</h3><p>仅组织内：{organization.name}</p>
        {activePreview.profile && <p>作者资料：{activePreview.profile.educationStage ?? "未填写学段"} · {activePreview.profile.institutions.map((institution) => institution.name).join("、") || "未填写机构"}</p>}
        <p className="reading-group-body">{activePreview.payload.body}</p>
        {activePreview.kind === "pack" && <p>关联 {activePreview.payload.targets.length} 篇文献，仅发送文献引用，不发送原文件。</p>}
        {activePreview.kind === "pack" && activePreview.payload.notificationIntent === "reading_task" && <p>阅读任务提醒仅发给已订阅且未静音的成员。</p>}
        {activePreview.kind === "reply" && !!activePreview.payload.mentionedUserIds?.length && <p>将提及：{participants.filter((participant) => activePreview.payload.mentionedUserIds?.includes(participant.id)).map((participant) => participant.name).join("、")}。仅提醒已订阅且未静音的参与者。</p>}
        <Button appearance="primary" disabled={!canComment || pending} onClick={() => void submitPreview()}>{pending ? "正在提交" : "确认提交"}</Button>
        <Button disabled={pending} appearance="subtle" onClick={() => setPreview(null)}>返回修改</Button>
      </section>}
    </>}
    {status && <p role="status">{status}</p>}
  </section>;
}
