import { Button, Checkbox, Input, Textarea, Tooltip } from "@fluentui/react-components";
import { Add20Regular, Dismiss20Regular, Send20Regular } from "@fluentui/react-icons";
import { useRef, useState, type FormEvent } from "react";
import { canonicalizeInheritedTargets, inheritedTargetsAreCanonical } from "./canonicalizeInheritedTargets";
import { communityApi } from "./communityApi";
import type {
  AnnotationTarget,
  AnnotationVisibility,
  CommunityAnnotation,
  CreateAnnotationInput
} from "./community.types";
import { LiteratureTargetEditor } from "./LiteratureTargetEditor";
import { ReplyPublicationFields } from "./ReplyPublicationFields";

export type ComposerState = { draft?: CreateAnnotationInput; edit?: CommunityAnnotation; replyTo?: CommunityAnnotation };

type Props = {
  context: ComposerState;
  onClose: () => void;
  onSaved: () => void;
};

export function AnnotationComposer({ context, onClose, onSaved }: Props) {
  const original = context.edit;
  const parent = context.replyTo;
  const draft = context.draft;
  const sourceReplyId = original?.originalReply?.replyId;
  const [body, setBody] = useState(original?.body ?? draft?.body ?? "");
  const [tags, setTags] = useState(original?.tags.filter((tag) => tag.origin === "user").map((tag) => tag.name) ?? draft?.tags ?? []);
  const [tagInput, setTagInput] = useState("");
  const [publishAsAnnotation, setPublishAsAnnotation] = useState(false);
  const [replyTargetsReady, setReplyTargetsReady] = useState(false);
  const [targets, setTargets] = useState<AnnotationTarget[]>(original?.targets ?? draft?.targets ?? []);
  const [visibility, setVisibility] = useState<AnnotationVisibility>(original?.visibility ?? draft?.visibility ?? parent?.visibility ?? "public");
  const [organizationId, setOrganizationId] = useState(original?.organizationId ?? draft?.organizationId ?? parent?.organizationId ?? "");
  const [shareToPlaza, setShareToPlaza] = useState(original?.shareToPlaza ?? draft?.shareToPlaza ?? true);
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const publicationAttempt = useRef(0);

  async function setReplyPublication(enabled: boolean) {
    const attempt = ++publicationAttempt.current;
    const inheritedTargets = enabled ? structuredClone(parent?.targets ?? []) : [];
    const hasTargets = inheritedTargets.length > 0;
    setPublishAsAnnotation(enabled && hasTargets);
    setTargets(inheritedTargets);
    setReplyTargetsReady(hasTargets && inheritedTargetsAreCanonical(inheritedTargets));
    setStatus("");
    if (!enabled || !hasTargets || inheritedTargetsAreCanonical(inheritedTargets)) return;
    try {
      const canonicalTargets = await canonicalizeInheritedTargets(inheritedTargets);
      if (publicationAttempt.current !== attempt) return;
      setTargets(canonicalTargets);
      setReplyTargetsReady(true);
    } catch {
      if (publicationAttempt.current !== attempt) return;
      setReplyTargetsReady(false);
      setStatus("请重新确认关联文献后再发布独立批注");
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
    if (parent && publishAsAnnotation && (!replyTargetsReady || !inheritedTargetsAreCanonical(targets))) {
      setStatus("请重新确认关联文献后再发布独立批注");
      setPending(false);
      return;
    }
    const input: CreateAnnotationInput = {
      body,
      ...(visibility === "organization" ? { organizationId } : {}),
      shareToPlaza,
      tags,
      targets,
      visibility
    };
    try {
      if (sourceReplyId) await communityApi.updateReply(sourceReplyId, { body });
      else if (original) await communityApi.updateAnnotation(original.id, input);
      else if (parent) await communityApi.createReply(parent.id, { body, publishAsAnnotation, tags: publishAsAnnotation ? tags : [], targets: publishAsAnnotation ? targets : [] });
      else await communityApi.createAnnotation(input);
      onSaved();
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "批注保存失败");
      setPending(false);
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
        <label className="field-label">批注内容<Textarea value={body} onChange={(_, data) => setBody(data.value)} resize="vertical" rows={7} required /></label>
        {!isReplyEdit && parent && <ReplyPublicationFields publishAsAnnotation={publishAsAnnotation} targets={targets} visibility={parent.visibility} onEnabledChange={setReplyPublication} onTargetsChange={updateReplyTargets} />}
        {!isReplyEdit && !parent && <>
          <div className="visibility-row">
            <label>可见范围<select value={visibility} onChange={(event) => { const next = event.target.value as AnnotationVisibility; setVisibility(next); if (next !== "public") setShareToPlaza(false); }}><option value="public">公开</option><option value="private">仅自己</option><option value="organization">指定组织</option><option value="mutual_followers">仅互相关注</option></select></label>
            {visibility === "organization" && <label>组织 ID<Input value={organizationId} onChange={(_, data) => setOrganizationId(data.value)} required /></label>}
          </div>
          {visibility === "public" && <Checkbox checked={shareToPlaza} label="发布到广场" onChange={(_, data) => setShareToPlaza(Boolean(data.checked))} />}
          <LiteratureTargetEditor targets={targets} onChange={setTargets} required />
        </>}
        {!isReplyEdit && (!parent || publishAsAnnotation) && <div className="tag-editor-v2"><label>标签</label><div className="tag-row">{tags.map((tag) => <button type="button" key={tag} onClick={() => setTags(tags.filter((item) => item !== tag))}>#{tag}<Dismiss20Regular /></button>)}</div><div className="tag-input"><Input value={tagInput} onChange={(_, data) => setTagInput(data.value)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === ",") { event.preventDefault(); addTag(); } }} /><Button type="button" icon={<Add20Regular />} onClick={addTag}>添加</Button></div></div>}
        {status && <p className="form-error" role="alert">{status}</p>}
        <div className="drawer-actions"><Button type="button" appearance="secondary" onClick={onClose}>取消</Button><Button type="submit" appearance="primary" icon={<Send20Regular />} disabled={pending || !body.trim() || (Boolean(parent) && publishAsAnnotation && !replyTargetsReady) || (!parent && !isReplyEdit && targets.length === 0)}>{pending ? "正在保存" : original ? "保存修改" : "发布"}</Button></div>
      </form>
    </aside>
  </div>;
}
