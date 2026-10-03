import { Button } from "@fluentui/react-components";
import type { AcademicProfile, CreateAnnotationInput } from "./community.types";
import { ContributionSummary } from "./AnnotationContribution";

const audienceLabels = { private: "仅自己", public: "所有人", mutual_followers: "互相关注的人", organization: "指定组织" };
export function AnnotationSendPreview({ input, authorName, profile, organizationName, replyOnly = false, pending, onConfirm, onCancel }: {
  input: CreateAnnotationInput;
  authorName: string;
  profile: AcademicProfile;
  organizationName?: string;
  replyOnly?: boolean;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return <section className="annotation-send-preview" aria-label="发送预览">
    <h3>确认要发送的内容</h3>
    <p>保存到 Intuecho · 接收方：{organizationName ?? audienceLabels[input.visibility]}{replyOnly ? " · 原批注下的回复" : input.shareToPlaza ? " · 同时展示到广场" : " · 不加入广场"}</p>
    {replyOnly ? <p>回复显示在原批注的讨论中，可见范围与原批注一致。</p> : input.visibility === "public" && !input.shareToPlaza && <p>此内容仍然公开，所有人可见；不加入广场仅影响展示位置。</p>}
    <p>作者资料：{authorName}{profile.educationStage ? ` · ${profile.educationStage}` : ""}{profile.institutions.map((institution) => ` · ${institution.name}`).join("")}</p>
    <p>学段与机构由本人填写，不代表平台认证。可在个人中心修改或清空。</p>
    <div className="annotation-send-preview-body">{input.body}</div>
    {!replyOnly && <ContributionSummary value={input.contribution} />}
    <ul>{input.targets.map((target, index) => <li key={index}>
      <span>文献 {target.literature.literatureId}</span>
      {target.kind === "source_passage" && <blockquote>{target.excerpt}</blockquote>}
      {target.kind === "derived_passage" && <><blockquote>{target.derivedContent.excerpt}</blockquote><ul>{target.evidence.map((evidence, evidenceIndex) => <li key={evidenceIndex}>{evidence.excerpt}</li>)}</ul></>}
    </li>)}</ul>
    {input.tags.length > 0 && <p>标签：{input.tags.join("、")}</p>}
    <p className="annotation-send-preview-note">{replyOnly ? "仅发送上述回复正文。" : "仅发送上述正文、关联文献与摘录；不上传本机文件。"}内容或接收方改变后需要重新预览，发送时会再次核对权限与作者资料。</p>
    <div><Button type="button" onClick={onCancel} disabled={pending}>返回修改</Button><Button type="button" appearance="primary" onClick={onConfirm} disabled={pending}>{pending ? "正在发送" : "确认发送"}</Button></div>
  </section>;
}
