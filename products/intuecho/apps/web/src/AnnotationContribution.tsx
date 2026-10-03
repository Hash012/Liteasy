import { Checkbox, Select } from "@fluentui/react-components";
import type { AnnotationContribution } from "@intuecho/contracts";

export const contributionPurposes = { explanation: "研究解释", question: "疑问", replication: "复现观察", curation: "资料整理" };
export const contributionOrigins = { unspecified: "未说明", human: "本人撰写", ai_assisted: "AI 辅助", ai_generated: "AI 生成" };
export const defaultContribution: AnnotationContribution = { purpose: "explanation", origin: "unspecified", review: "unreviewed" };

export function ContributionFields({ value, onChange }: { value: AnnotationContribution; onChange(value: AnnotationContribution): void }) {
  return <fieldset className="contribution-fields"><legend>内容说明</legend>
    <label>用途<Select value={value.purpose} onChange={(_, data) => onChange({ ...value, purpose: data.value as AnnotationContribution["purpose"] })}>{Object.entries(contributionPurposes).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></label>
    <label>撰写方式<Select value={value.origin} onChange={(_, data) => onChange({ ...value, origin: data.value as AnnotationContribution["origin"] })}>{Object.entries(contributionOrigins).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></label>
    <Checkbox label="我已对照原文核查引用" checked={value.review === "source_checked"} onChange={(_, data) => onChange({ ...value, review: data.checked ? "source_checked" : "unreviewed" })} />
    <small>核查标记是贡献者的说明，不表示结论已获验证。修改正文或引用后需重新核查。</small>
  </fieldset>;
}

export function ContributionSummary({ value = defaultContribution }: { value?: AnnotationContribution }) {
  return <p className="contribution-summary">
    <span>{contributionPurposes[value.purpose]}</span><span>{contributionOrigins[value.origin]}{value.editedByUser ? " · 已人工修改" : ""}</span>
    <span title="贡献者自行说明；证据对应与星级不证明结论正确。">{value.review === "source_checked" ? "贡献者已核查引用" : "引用尚未核查"}</span>
  </p>;
}
