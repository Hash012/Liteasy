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
import { ContributionFields, defaultContribution } from "./AnnotationContribution";

export type ComposerState = { draft?: CreateAnnotationInput; edit?: CommunityAnnotation; replyTo?: CommunityAnnotation };

type Props = {
  context: ComposerState;
  authorName?: string;
  onClose: () => void;
  onSaved: () => void;
};

export function AnnotationComposer({ context, authorName = "当前登录账号", onClose, onSaved }: Props) {
  const original = context.edit;
  const parent = context.replyTo;
  const draft = context.draft;
  const sourceReplyId = original?.originalReply?.replyId;
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
  const [preview, setPreview] = useState<{ key: string; input: CreateAnnotationInput; profile: AcademicProfile }>();
  const sending = useRef(false);
  const draftKey = JSON.stringify([body, tags, targets, visibility, organizationId, shareToPlaza, organization, contribution]);
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
    setPending(true);
    setStatus("");
    if (parent && publicationCanonicalizing) {
      setStatus("正在确认继承的关联文献，请稍候");
      setPending(false);
      return;
    }
    if (parent && publishAsAnnotation && (!replyTargetsReady || !inheritedTargetsAreCanonical(targets))) {
      setStatus("请重新确认关联文献后再发布独立批注");
      setPending(false);
      return;
    }
    if (!visibility) {
      setStatus("请选择可见范围；选择前草稿只保留在本机。");
      setPending(false);
      return;
    }
    const input: CreateAnnotationInput = {
      body,
      contribution,
      ...(visibility === "organization" ? { organizationId } : {}),
      shareToPlaza,
      tags,
      targets,
      visibility
    };
    if (!parent && !sourceReplyId && visibility === "organization" && (!organization || organization.organizationId !== organizationId)) {
      setStatus("请先确认接收组织的当前权限。");
      setPending(false);
      return;
    }
    if (!original && !parent) {
      const parsed = createAnnotationSchema.safeParse(input);
      if (!parsed.success) setStatus("请检查批注内容与已确认的关联文献后重试。");
      else {
        try {
          const { profile } = await communityApi.academicProfile();
          setPreview({ key: draftKey, input: { ...parsed.data, expectedAuthorProfileRevision: profile.revision }, profile });
        } catch (error) { setStatus(error instanceof Error ? error.message : "无法核对将公开的作者资料，草稿仍保留。"); }
      }
      setPending(false);
      return;
    }
    try {
      if (sourceReplyId) await communityApi.updateReply(sourceReplyId, { body });
      else if (original) await communityApi.updateAnnotation(original.id, input);
      else if (parent) await communityApi.createReply(parent.id, { body, publishAsAnnotation,
        expectedParent: { revision: parent.revision, visibility: parent.visibility, organizationId: parent.organizationId },
        tags: publishAsAnnotation ? tags : [], targets: publishAsAnnotation ? targets : [] });
      else await communityApi.createAnnotation(input);
      onSaved();
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "批注保存失败");
      setPending(false);
    }
  }

  async function confirmSend() {
    if (!preview || preview.key !== draftKey || sending.current) return;
    sending.current = true;
    setPending(true);
    setStatus("");
    try {
      await communityApi.createAnnotation(preview.input);
      onSaved();
    } catch (reason) {
      if (reason instanceof Error && reason.message.includes("AUTHOR_PROFILE_CHANGED")) { setPreview(undefined); setStatus("作者资料已变化，请重新预览后发送。"); }
      else setStatus(reason instanceof Error ? reason.message : "发送失败，草稿已保留。");
      setPending(false);
    } finally {
      sending.current = false;
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
        {status && <p className="form-error" role="alert">{status}</p>}
        {preview && preview.key === draftKey && <AnnotationSendPreview authorName={authorName} profile={preview.profile} input={preview.input} organizationName={visibility === "organization" ? organization?.name : undefined} pending={pending} onConfirm={() => void confirmSend()} onCancel={() => setPreview(undefined)} />}
        <div className="drawer-actions"><Button type="button" appearance="secondary" onClick={onClose}>取消</Button><Button type="submit" appearance="primary" icon={<Send20Regular />} disabled={pending || publicationCanonicalizing || !visibility || !body.trim() || (!parent && !isReplyEdit && visibility === "organization" && (!organization || organization.organizationId !== organizationId)) || (Boolean(parent) && publishAsAnnotation && !replyTargetsReady) || (!parent && !isReplyEdit && targets.length === 0)}>{pending ? "正在保存" : original ? "保存修改" : "发布"}</Button></div>
      </form>
    </aside>
  </div>;
}
