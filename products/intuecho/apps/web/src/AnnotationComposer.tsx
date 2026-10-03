import { Button, Checkbox, Input, Textarea, Tooltip } from "@fluentui/react-components";
import { Add20Regular, Dismiss20Regular, Send20Regular } from "@fluentui/react-icons";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { createAnnotationSchema, type OrganizationChoice } from "@intuecho/contracts";
import { canonicalizeInheritedTargets, inheritedTargetsAreCanonical } from "./canonicalizeInheritedTargets";
import { communityApi } from "./communityApi";
import type {
  AcademicProfile,
  AnnotationTarget,
  AnnotationVisibility,
  CommunityAnnotation,
  CreateAnnotationInput
} from "./community.types";
import { LiteratureTargetEditor } from "./LiteratureTargetEditor";
import { ReplyPublicationFields } from "./ReplyPublicationFields";
import { OrganizationAudienceSelector } from "./OrganizationAudienceSelector";
import { AnnotationSendPreview } from "./AnnotationSendPreview";
import { getIdentitySessionGeneration } from "./identityClient";
import { RevisionConflict } from "./RevisionConflict";
import { LocalDraftControls } from "./LocalDraftControls";
import { removeDraft, saveDraft } from "./communityPersistence";
import { ContributionFields, defaultContribution } from "./AnnotationContribution";

export type ComposerState = { draft?: CreateAnnotationInput; edit?: CommunityAnnotation; replyTo?: CommunityAnnotation };

type Props = {
  context: ComposerState;
  authorName?: string;
  owner?: string;
  actorBinding?: string;
  onClose: () => void;
  onSaved: () => void;
};

export function AnnotationComposer(props: Props) {
  return <ComposerWorkspace key={props.actorBinding ?? "current"} {...props} />;
}

function ComposerWorkspace({ context, authorName = "当前登录账号", owner = "", actorBinding, onClose, onSaved }: Props) {
  const original = context.edit;
  const parent = context.replyTo;
  const draft = context.draft;
  const sourceReplyId = original?.originalReply?.replyId;
  const [intentId, setIntentId] = useState(() => crypto.randomUUID());
  const [body, setBody] = useState(original?.body ?? draft?.body ?? "");
  const [tags, setTags] = useState(original?.tags.filter((tag) => tag.origin === "user").map((tag) => tag.name) ?? draft?.tags ?? []);
  const [tagInput, setTagInput] = useState("");
  const [publishAsAnnotation, setPublishAsAnnotation] = useState(false);
  const [publicationCanonicalizing, setPublicationCanonicalizing] = useState(false);
  const [replyTargetsReady, setReplyTargetsReady] = useState(false);
  const [targets, setTargets] = useState<AnnotationTarget[]>(original?.targets ?? draft?.targets ?? []);
  const [visibility, setVisibility] = useState<AnnotationVisibility | "">(original?.visibility ?? draft?.visibility ?? parent?.visibility ?? "");
  const [organizationId, setOrganizationId] = useState(original?.organizationId ?? draft?.organizationId ?? parent?.organizationId ?? "");
  const [shareToPlaza, setShareToPlaza] = useState(original?.shareToPlaza ?? draft?.shareToPlaza ?? false);
  const [contribution, setContribution] = useState(original?.contribution ?? draft?.contribution ?? defaultContribution);
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const [organization, setOrganization] = useState<OrganizationChoice>();
  const [preview, setPreview] = useState<{ key: string; input: CreateAnnotationInput; profile: AcademicProfile; generation: number }>();
  const [revisionConflict, setRevisionConflict] = useState(false);
  const [baseRevision, setBaseRevision] = useState(original?.revision);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const sending = useRef(false);
  const draftKey = JSON.stringify([body, tags, targets, visibility, organizationId, shareToPlaza, organization, contribution, publishAsAnnotation, baseRevision, parent?.revision, actorBinding]);
  const currentDraftKey = useRef(draftKey);
  currentDraftKey.current = draftKey;
  const draftScope = original ? `edit:${original.id}` : parent ? `reply:${parent.id}` : "new-annotation";
  const draftValue = { intentId, body, tags, targets, visibility, organizationId, shareToPlaza, contribution, publishAsAnnotation, baseRevision };
  function restoreDraft(value: typeof draftValue) {
    setIntentId(value.intentId); setBody(value.body); setTags(value.tags); setTargets(value.targets); setVisibility(value.visibility);
    setOrganizationId(value.organizationId); setShareToPlaza(value.shareToPlaza); setContribution(value.contribution);
    setPublishAsAnnotation(value.publishAsAnnotation); setReplyTargetsReady(inheritedTargetsAreCanonical(value.targets));
    setBaseRevision(value.baseRevision); setPreview(undefined);
  }
  function persistDraft() { if (owner) saveDraft(owner, draftScope, draftValue); }
  function saved() {
    if (owner) { try { removeDraft(owner, draftScope); } catch { /* A successful write is not retried for a local cleanup failure. */ } }
    onSaved();
  }
  useEffect(() => { setPreview(undefined); }, [draftKey]);
  const publicationAttempt = useRef(0);
  const publicationCanonicalizingRef = useRef(false);

  async function setReplyPublication(enabled: boolean) {
    if (publicationCanonicalizingRef.current) return;
    const attempt = ++publicationAttempt.current;
    const inheritedTargets = enabled ? structuredClone(parent?.targets ?? []) : [];
    const hasTargets = inheritedTargets.length > 0;
    setPublishAsAnnotation(enabled && hasTargets);
    setTargets(inheritedTargets);
    setReplyTargetsReady(hasTargets && inheritedTargetsAreCanonical(inheritedTargets));
    setStatus("");
    if (!enabled || !hasTargets || inheritedTargetsAreCanonical(inheritedTargets)) return;
    publicationCanonicalizingRef.current = true;
    setPublicationCanonicalizing(true);
    try {
      const canonicalTargets = await canonicalizeInheritedTargets(inheritedTargets);
      if (publicationAttempt.current !== attempt) return;
      setTargets(canonicalTargets);
      setReplyTargetsReady(true);
    } catch {
      if (publicationAttempt.current !== attempt) return;
      setReplyTargetsReady(false);
      setStatus("请重新确认关联文献后再发布独立批注");
    } finally {
      publicationCanonicalizingRef.current = false;
      setPublicationCanonicalizing(false);
    }
  }

  function updateReplyTargets(nextTargets: AnnotationTarget[]) {
    publicationAttempt.current += 1;
    setTargets(nextTargets);
    const ready = nextTargets.length > 0 && inheritedTargetsAreCanonical(nextTargets);
    setReplyTargetsReady(ready);
    if (ready) setStatus("");
    if (nextTargets.length === 0) {
      setPublishAsAnnotation(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending || sending.current) return;
    const generation = getIdentitySessionGeneration();
    const submittedKey = draftKey;
    const stillCurrent = () => mounted.current && generation === getIdentitySessionGeneration() && currentDraftKey.current === submittedKey;
    setPending(true);
    setStatus("");
    try {
      persistDraft();
      if (parent && publicationCanonicalizing) throw new Error("正在确认继承的关联文献，请稍候");
      if (parent && publishAsAnnotation && (!replyTargetsReady || !inheritedTargetsAreCanonical(targets))) throw new Error("请重新确认关联文献后再发布独立批注");
      if (!visibility) throw new Error("请选择可见范围；选择前草稿只保留在本机。");
      const input: CreateAnnotationInput = {
        body, contribution, ...(visibility === "organization" ? { organizationId } : {}),
        ...(draft?.collaboration ? { collaboration: draft.collaboration } : {}),
        ...(draft?.notificationIntent ? { notificationIntent: draft.notificationIntent } : {}),
        shareToPlaza: parent ? false : shareToPlaza, tags, targets, visibility
      };
      if (!parent && !sourceReplyId && visibility === "organization" && (!organization || organization.organizationId !== organizationId)) throw new Error("请先确认接收组织的当前权限。");
      // Same-scope replies have an inline audience notice; independent copies and all annotation edits freeze a full preview.
      if (parent && !publishAsAnnotation) {
        await communityApi.createReply(parent.id, { body, publishAsAnnotation: false,
          expectedParent: { revision: parent.revision, visibility: parent.visibility, organizationId: parent.organizationId }, tags: [], targets: [] }, intentId);
        if (stillCurrent()) saved();
        return;
      }
      if (sourceReplyId) {
        if (!original?.originalReply?.revision) throw new Error("请从原回复打开编辑，以核对回复的当前修订。");
        await communityApi.updateReply(sourceReplyId, { body, expectedRevision: original.originalReply.revision });
        if (stillCurrent()) saved();
        return;
      }
      const parsed = createAnnotationSchema.safeParse(input);
      if (!parsed.success) throw new Error("请检查批注内容与已确认的关联文献后重试。");
      const { profile } = await communityApi.academicProfile();
      if (stillCurrent()) setPreview({ key: submittedKey, input: structuredClone({ ...parsed.data, expectedAuthorProfileRevision: profile.revision }), profile, generation });
    } catch (error) {
      if (stillCurrent()) setStatus(error instanceof Error ? error.message : "操作未完成，当前内容仍保留。");
    } finally { if (mounted.current && generation === getIdentitySessionGeneration()) setPending(false); }
  }

  async function confirmSend() {
    if (!preview || preview.key !== draftKey || preview.generation !== getIdentitySessionGeneration() || sending.current) return;
    const approved = preview;
    const stillCurrent = () => mounted.current && approved.generation === getIdentitySessionGeneration() && currentDraftKey.current === approved.key;
    sending.current = true;
    setPending(true);
    setStatus("");
    try {
      persistDraft();
      const { profile } = await communityApi.academicProfile();
      if (!stillCurrent()) return;
      if (JSON.stringify(profile) !== JSON.stringify(approved.profile)) throw new Error("AUTHOR_PROFILE_CHANGED：作者资料已变化，请重新预览后发送。");
      if (original) await communityApi.updateAnnotation(original.id, { ...approved.input, expectedRevision: baseRevision! });
      else if (parent) await communityApi.createReply(parent.id, { body: approved.input.body, publishAsAnnotation: true,
        expectedAuthorProfileRevision: profile.revision,
        expectedParent: { revision: parent.revision, visibility: parent.visibility, organizationId: parent.organizationId },
        tags: approved.input.tags, targets: approved.input.targets }, intentId);
      else await communityApi.createAnnotation(approved.input, intentId);
      if (stillCurrent()) saved();
    } catch (reason) {
      if (!stillCurrent()) return;
      if (reason instanceof Error && /AUTHOR_PROFILE_CHANGED|REVISION_CONFLICT/.test(reason.message)) setPreview(undefined);
      if (reason instanceof Error && reason.message.includes("ANNOTATION_REVISION_CONFLICT")) setRevisionConflict(true);
      setStatus(reason instanceof Error ? reason.message : "发送结果待核实，请保留当前内容并核实原操作。");
    } finally {
      sending.current = false;
      if (mounted.current && approved.generation === getIdentitySessionGeneration()) setPending(false);
    }
  }

  function addTag() {
    const value = tagInput.trim().replace(/^#/, "");
    if (value && !tags.some((tag) => tag.toLocaleLowerCase("zh-CN") === value.toLocaleLowerCase("zh-CN")) && tags.length < 20) setTags([...tags, value]);
    setTagInput("");
  }

  const isReplyEdit = Boolean(sourceReplyId);
  return <div className="drawer-backdrop" role="presentation">
    <aside className="annotation-drawer" role="dialog" aria-modal="true" aria-labelledby="composer-title">
      <header><div><span>{original ? "编辑" : parent ? "回复" : "新批注"}</span><h2 id="composer-title">{parent ? `回复 ${parent.author.name}` : isReplyEdit ? "编辑回复" : "发布批注"}</h2></div><Tooltip content="关闭" relationship="label"><Button appearance="subtle" icon={<Dismiss20Regular />} aria-label="关闭" onClick={onClose} /></Tooltip></header>
      <form onSubmit={submit}>
        <LocalDraftControls owner={owner} scope={draftScope} value={draftValue} onRestore={restoreDraft} />
        {baseRevision !== undefined && <p>编辑基于修订 {baseRevision}；冲突时保留你的草稿，请核对最新内容。</p>}
        {parent && !publishAsAnnotation && <p>回复沿用原批注的可见范围，不产生独立批注。</p>}
        <label className="field-label">批注内容<Textarea value={body} onChange={(_, data) => { setBody(data.value); setContribution((current) => ({ ...current, review: "unreviewed" })); }} resize="vertical" rows={7} required /></label>
        {!isReplyEdit && parent && <ReplyPublicationFields disabled={publicationCanonicalizing} publishAsAnnotation={publishAsAnnotation} targets={targets} visibility={parent.visibility} onEnabledChange={setReplyPublication} onTargetsChange={updateReplyTargets} />}
        {!isReplyEdit && !parent && <>
          <div className="visibility-row">
            <label>可见范围<select value={visibility} onChange={(event) => { const next = event.target.value as AnnotationVisibility | ""; setVisibility(next); if (next !== "public") setShareToPlaza(false); }}><option value="" disabled>请选择接收范围</option><option value="public">公开</option><option value="private">仅自己</option><option value="organization">指定组织</option><option value="mutual_followers">仅互相关注</option></select></label>
            {visibility === "organization" && <OrganizationAudienceSelector value={organizationId} onChange={setOrganizationId} onResolvedSelection={setOrganization} />}
          </div>
          {visibility === "public" && <Checkbox checked={shareToPlaza} label="发布到广场" onChange={(_, data) => setShareToPlaza(Boolean(data.checked))} />}
          <LiteratureTargetEditor targets={targets} onChange={(value) => { setTargets(value); setContribution((current) => ({ ...current, review: "unreviewed" })); }} required />
          <ContributionFields value={contribution} onChange={setContribution} />
        </>}
        {!isReplyEdit && (!parent || publishAsAnnotation) && <div className="tag-editor-v2"><label>标签</label><div className="tag-row">{tags.map((tag) => <button type="button" key={tag} onClick={() => setTags(tags.filter((item) => item !== tag))}>#{tag}<Dismiss20Regular /></button>)}</div><div className="tag-input"><Input value={tagInput} onChange={(_, data) => setTagInput(data.value)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === ",") { event.preventDefault(); addTag(); } }} /><Button type="button" icon={<Add20Regular />} onClick={addTag}>添加</Button></div></div>}
        {revisionConflict && original && baseRevision !== undefined && <RevisionConflict baseRevision={baseRevision} loadCurrent={async () => (await communityApi.annotation(original.id)).annotation} onUseRevision={(revision) => { setBaseRevision(revision); setRevisionConflict(false); setPreview(undefined); }} />}
        {status && <p className="form-error" role="alert">{status}</p>}
        {preview && preview.key === draftKey && <AnnotationSendPreview authorName={authorName} profile={preview.profile} input={preview.input} organizationName={visibility === "organization" ? organization?.name : undefined} pending={pending} onConfirm={() => void confirmSend()} onCancel={() => setPreview(undefined)} />}
        <div className="drawer-actions"><Button type="button" appearance="secondary" onClick={onClose}>取消</Button><Button type="submit" appearance="primary" icon={<Send20Regular />} disabled={pending || publicationCanonicalizing || !visibility || !body.trim() || (!parent && !isReplyEdit && visibility === "organization" && (!organization || organization.organizationId !== organizationId)) || (Boolean(parent) && publishAsAnnotation && !replyTargetsReady) || (!parent && !isReplyEdit && targets.length === 0)}>{pending ? "正在保存" : original ? "保存修改" : "发布"}</Button></div>
      </form>
    </aside>
  </div>;
}
