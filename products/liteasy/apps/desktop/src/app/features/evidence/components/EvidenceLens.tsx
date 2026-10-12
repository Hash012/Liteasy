import { ContentView } from "../../markdown/ContentView";
import { legacyContent } from "../../markdown/contentFragment";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button, Select, Tooltip } from "@fluentui/react-components";
import { ArrowLeft20Regular, ChevronDown16Regular, ChevronRight16Regular, Dismiss20Regular, DocumentSearch20Regular, Open20Regular, Info16Regular, CheckmarkCircle16Regular, Warning16Regular, SubtractCircle16Regular, DocumentText16Regular } from "@fluentui/react-icons";
import { useUiTranslation } from "../../../shared/i18n/useUiTranslation";
import { evidenceCounts, type ClaimAssessment, type EvidenceClaim, type EvidencePassage, type EvidenceReportV1 } from "../evidenceReport";
import "./evidenceLens.css";

type LensProps = {
  report: EvidenceReportV1;
  onOpenPassage?: (passage: EvidencePassage) => void | Promise<void>;
  canOpenPassage?: (passage: EvidencePassage) => boolean;
  streaming?: boolean;
};
const assessments: Record<ClaimAssessment, string> = {
  supported: "有支持", conditional: "有条件", contested: "有分歧", contradicted: "有反证", insufficient: "依据不足", unverified: "未核验"
};
const coverages = { full_text: "全文材料", partial_text: "部分正文", abstract_only: "仅摘要", metadata_only: "仅元信息", unknown: "阅读范围未知" };
const locators = { exact_text: "已核对文本位置", page_only: "页级定位", unknown: "位置未核对", unavailable: "缺少原文位置", stale: "来源版本已变化" };
const relations = { direct_support: "直接支持", conditional_support: "条件支持", contradicts: "反驳", context: "背景", mentions: "提及", unassessed: "关系未核验" };
function AssessmentBadge({ status }: { status: ClaimAssessment }) {
  const { tChinese: t } = useUiTranslation();
  const Icon = status === "supported" ? CheckmarkCircle16Regular : status === "unverified" ? SubtractCircle16Regular : Warning16Regular;
  return <span className={`evidence-lens__status evidence-lens__status--${status}`}><Icon aria-hidden="true" />{t(`evidence.assessment.${status}`, assessments[status])}</span>;
}
function uniquePassages(passages: readonly EvidencePassage[]) {
  const seen = new Set<string>();
  return passages.filter(passage => {
    const key = JSON.stringify([passage.sourceId, passage.locator, passage.quote]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function EvidenceSummaryStrip({ report, expanded, onToggle, streaming }: Pick<LensProps, "report" | "streaming"> & { expanded: boolean; onToggle: () => void }) {
  const { tChinese: t } = useUiTranslation();
  const counts = evidenceCounts(report);
  return <Button className="evidence-lens__summary" appearance="subtle" size="small" aria-expanded={expanded} onClick={onToggle}
    icon={expanded ? <ChevronDown16Regular /> : <ChevronRight16Regular />}>
    <DocumentText16Regular className="evidence-lens__summary-icon" aria-hidden="true" /><span className="evidence-lens__summary-text">
      <span>{t("evidence.sources", "{{count}} 篇来源", { count: counts.sources })}</span>
      <span>{t("evidence.passages", "{{count}} 处引用", { count: counts.passages })}</span>
      {streaming ? <span>{t("evidence.streaming", "生成中 · 未核验")}</span> : report.claims.length === 0
        ? <span>{t("evidence.notReviewed", "未逐条核验")}</span>
        : <span className="evidence-lens__counts">{Object.entries(counts.claims).filter(([, count]) => count > 0).map(([status, count]) =>
          <span key={status}>{count} {t(`evidence.assessment.${status}`, assessments[status as ClaimAssessment])}</span>)}</span>}
    </span>
  </Button>;
}

export function ClaimEvidenceMark({ claim, number, onClick, selected, streaming }: { claim: EvidenceClaim; number: number; onClick: (target: HTMLElement) => void; selected: boolean; streaming?: boolean }) {
  const { tChinese: t } = useUiTranslation();
  const status = streaming ? "unverified" : claim.assessment;
  return <Button appearance="subtle" className="evidence-lens__claim" onClick={event => onClick(event.currentTarget)}
    aria-expanded={selected} aria-label={t("evidence.inspectClaim", "查看论断 {{number}}：{{text}}", { number, text: claim.text })}>
    <span className="evidence-lens__claim-number">{number}</span><span className="evidence-lens__claim-text">{claim.text}</span>
    <AssessmentBadge status={status} />
  </Button>;
}

function VerificationDetails({ report, claim }: { report: EvidenceReportV1; claim?: EvidenceClaim }) {
  const { tChinese: t } = useUiTranslation();
  const records = claim?.assessmentId ? report.verifications.filter(record => record.id === claim.assessmentId) : report.verifications;
  const failed = records.some(record => record.status === "failed");
  const timedOut = records.some(record => record.status === "timed_out");
  const independentlyReviewed = records.some(record => record.origin === "independent_verifier" && record.status === "completed");
  const briefKey = timedOut ? "timeout" : failed ? "failed" : independentlyReviewed ? "reviewed" : "unverified";
  const brief = timedOut ? "检查超时 · 未核验" : failed ? "检查失败 · 未核验" : independentlyReviewed ? "查看核验记录" : "未进行独立语义核验";
  return <details className="evidence-lens__checks">
    <summary><Info16Regular aria-hidden="true" /><span>{t("evidence.verificationDetails", "核验说明")}</span><span>{t(`evidence.checkBrief.${briefKey}`, brief)}</span></summary>
    <div className="evidence-lens__check-records">{records.length === 0 ? <p>{t("evidence.noVerifier", "尚无独立核验记录。引用存在不代表结论成立。")}</p> : records.map(record => <div key={record.id}>
      <span>{record.origin !== "independent_verifier" ? t("evidence.noSemanticReview", "未进行独立语义核验")
        : t(`evidence.checker.${record.checkerKind}`, record.checkerKind === "human" ? "人工核验" : record.checkerKind === "model" ? "独立模型核验" : "结构检查")}</span>
      <span> · {t(`evidence.execution.${record.status}`, { completed: "检查已返回", failed: "检查失败", skipped: "检查未执行", timed_out: "检查超时" }[record.status])}</span>
      {record.checkerIdentity ? <p>{record.checkerIdentity}</p> : null}
      {record.finding ? <p>{record.finding}</p> : null}
    </div>)}</div>
  </details>;
}

function PassageCard({ report, passage, claim, onOpenPassage, canOpenPassage, streaming }: LensProps & { passage: EvidencePassage; claim?: EvidenceClaim }) {
  const { tChinese: t } = useUiTranslation();
  const source = report.sources.find(item => item.id === passage.sourceId);
  const [error, setError] = useState(false);
  const [opening, setOpening] = useState(false);
  const edge = claim?.edges.find(item => item.passageId === passage.id);
  const available = Boolean(onOpenPassage && passage.locatorIntegrity !== "stale" && (canOpenPassage ? canOpenPassage(passage) : passage.locator.precision !== "unavailable"));
  const reason = passage.locatorIntegrity === "stale" ? t("evidence.changedSource", "来源版本已变化，请重新获取证据。")
    : t("evidence.unavailableSource", "当前无法定位原文，仍可阅读保存的摘录。");
  const open = async () => {
    if (!available || opening) return;
    setOpening(true); setError(false);
    try { await onOpenPassage?.(passage); } catch { setError(true); }
    finally { setOpening(false); }
  };
  return <article className="evidence-lens__passage">
    <strong className="evidence-lens__source-title" title={source?.title}>{source?.title ?? t("evidence.unknownSource", "来源不可用")}</strong>
    <div className="evidence-lens__metadata">
      {passage.locator.page ? <span>{t("evidence.page", "第 {{page}} 页", { page: passage.locator.page })}</span> : <span>{t("evidence.fileSnapshot", "文件快照，未记录页码")}</span>}
      <span>{t(`evidence.coverage.${source?.coverage ?? "unknown"}`, coverages[source?.coverage ?? "unknown"])}</span>
      <span>{t(`evidence.locator.${passage.locatorIntegrity}`, locators[passage.locatorIntegrity])}</span>
    </div>
    {edge ? <p className="evidence-lens__relationship">{t(`evidence.relation.${streaming || claim?.assessment === "unverified" ? "unassessed" : edge.relation}`,
      streaming || claim?.assessment === "unverified" ? relations.unassessed : relations[edge.relation])}</p> : null}
    {passage.quote ? <ContentView content={legacyContent(passage.quote)} purpose="evidence" allowSource /> : <p>{t("evidence.noQuote", "未保存原文摘录。")}</p>}
    {edge?.condition ? <p>{t("evidence.condition", "条件：")}{edge.condition}</p> : null}
    {edge?.explanation ? <p>{t("evidence.relationNote", "关系说明（待结合核验记录阅读）：")}{edge.explanation}</p> : null}
    <div className="evidence-lens__passage-footer"><Button size="small" appearance="subtle" icon={<Open20Regular />} disabled={!available || opening} onClick={() => { void open(); }}>
      {opening ? t("evidence.opening", "正在打开") : t("evidence.openOriginal", "打开原文")}
    </Button>{source?.revision ? <span className="evidence-lens__version" title={source.revision}>{t("evidence.version", "版本：")}{source.revision}</span> : null}</div>
    {!available ? <small>{reason}</small> : null}
    {error ? <p role="status">{t("evidence.openFailed", "原文打开失败，请确认文件仍然存在或稍后重试。")}</p> : null}
  </article>;
}

export function EvidencePeek({ claim, onClose, onInspect, ...props }: LensProps & { claim: EvidenceClaim; onClose: () => void; onInspect: () => void }) {
  const { tChinese: t } = useUiTranslation();
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const passages = uniquePassages(props.report.passages.filter(passage => claim.edges.some(edge => edge.passageId === passage.id)));
  useEffect(() => { closeRef.current?.focus(); }, [claim.id]);
  return <section role="dialog" aria-modal="false" aria-labelledby={titleId} className="evidence-lens__peek" onKeyDown={event => {
    if (event.key === "Escape") { event.stopPropagation(); onClose(); }
  }}>
    <header><strong id={titleId}>{t("evidence.peekTitle", "论断与证据")}</strong>
      <Tooltip content={t("evidence.closePeek", "关闭证据预览")} relationship="label"><Button ref={closeRef} appearance="subtle" size="small" icon={<Dismiss20Regular />} aria-label={t("evidence.closePeek", "关闭证据预览")} onClick={onClose} /></Tooltip>
    </header>
    <p className="evidence-lens__peek-claim" title={claim.text}>{claim.text}</p><AssessmentBadge status={props.streaming ? "unverified" : claim.assessment} />
    {claim.caveat ? <p>{claim.caveat}</p> : null}
    {passages.slice(0, 2).map(passage => <PassageCard key={passage.id} {...props} passage={passage} claim={claim} />)}
    {!passages.length ? <p>{t("evidence.noBoundQuote", "尚无可用的关联摘录。")}</p> : null}
    <VerificationDetails report={props.report} claim={claim} />
    <Button appearance="subtle" size="small" onClick={onInspect}>{t("evidence.inspectAll", "查看全部证据")}</Button>
  </section>;
}

export function EvidenceInspector({ onBack, ...props }: LensProps & { onBack: () => void }) {
  const { tChinese: t } = useUiTranslation();
  const [filter, setFilter] = useState<ClaimAssessment | "all">("all");
  const [limit, setLimit] = useState(12);
  const backRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { backRef.current?.focus(); }, []);
  const claims = props.report.claims.filter(claim => filter === "all" || (props.streaming ? "unverified" : claim.assessment) === filter);
  const passages = uniquePassages(props.report.passages);
  const metadataSources = props.report.sources.filter(source => !passages.some(passage => passage.sourceId === source.id));
  return <section className="evidence-lens__inspector" aria-label={t("evidence.inspectorTitle", "证据详情")} onKeyDown={event => {
    if (event.key === "Escape") { event.stopPropagation(); onBack(); }
  }}>
    <header><Button ref={backRef} appearance="subtle" size="small" icon={<ArrowLeft20Regular />} onClick={onBack}>{t("evidence.back", "返回证据摘要")}</Button>
      <strong>{t("evidence.inspectorTitle", "证据详情")}</strong></header>
    {props.report.claims.length > 0 ? <label className="evidence-lens__filter">{t("evidence.filter", "筛选论断")}
      <Select size="small" aria-label={t("evidence.filter", "筛选论断")} value={filter} onChange={(_, data) => { setFilter(data.value as ClaimAssessment | "all"); setLimit(12); }}>
        <option value="all">{t("evidence.all", "全部")}</option>{Object.entries(assessments).map(([status, label]) => <option key={status} value={status}>{t(`evidence.assessment.${status}`, label)}</option>)}
      </Select></label> : null}
    <div className="evidence-lens__inspector-body">
      {claims.slice(0, limit).map(claim => <section className="evidence-lens__claim-detail" key={claim.id}>
        <h4>{claim.text}</h4><AssessmentBadge status={props.streaming ? "unverified" : claim.assessment} />
        {claim.caveat ? <p>{claim.caveat}</p> : null}
        {uniquePassages(props.report.passages.filter(passage => claim.edges.some(edge => edge.passageId === passage.id))).map(passage => <PassageCard key={passage.id} {...props} passage={passage} claim={claim} />)}
        {!props.report.passages.some(passage => claim.edges.some(edge => edge.passageId === passage.id)) ? <p>{t("evidence.noBoundQuote", "尚无可用的关联摘录。")}</p> : null}
        <VerificationDetails report={props.report} claim={claim} />
      </section>)}
      {props.report.claims.length === 0 ? <>
        <p>{t("evidence.legacyNotice", "这些引用尚未关联到逐条论断，不能据此认定回答已获支持。")}</p>
        {passages.slice(0, limit).map(passage => <PassageCard key={passage.id} {...props} passage={passage} />)}
        {metadataSources.slice(0, Math.max(0, limit - passages.length)).map(source => <p key={source.id}>{source.title} · {t(`evidence.coverage.${source.coverage}`, coverages[source.coverage])}</p>)}
        <VerificationDetails report={props.report} />
      </> : claims.length === 0 ? <p>{t("evidence.emptyFilter", "没有符合此条件的论断。")}</p> : null}
      {(props.report.claims.length ? claims.length : passages.length + metadataSources.length) > limit ? <Button appearance="subtle" size="small" onClick={() => setLimit(value => value + 12)}>{t("evidence.more", "显示更多")}</Button> : null}
    </div>
  </section>;
}

export function EvidenceLens(props: LensProps) {
  const { tChinese: t } = useUiTranslation();
  const [expanded, setExpanded] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const [selectedId, setSelectedId] = useState<string>();
  const [limit, setLimit] = useState(4);
  const triggerRef = useRef<HTMLElement>();
  const inspectTriggerRef = useRef<HTMLButtonElement>(null);
  const selected = useMemo(() => props.report.claims.find(claim => claim.id === selectedId), [props.report.claims, selectedId]);
  useEffect(() => { setSelectedId(undefined); setInspecting(false); setExpanded(false); setLimit(4); }, [props.report.id]);
  const closePeek = () => { setSelectedId(undefined); triggerRef.current?.focus(); };
  const closeInspector = () => { setInspecting(false); requestAnimationFrame(() => inspectTriggerRef.current?.focus()); };
  return <div className="evidence-lens" aria-label={t("evidence.lens", "回答证据")}>
    <EvidenceSummaryStrip {...props} expanded={expanded} onToggle={() => { setExpanded(value => !value); setSelectedId(undefined); setInspecting(false); }} />
    {expanded ? inspecting ? <EvidenceInspector {...props} onBack={closeInspector} /> : <div className="evidence-lens__expanded">
      <Button ref={inspectTriggerRef} className="evidence-lens__inspect-action" appearance="subtle" size="small" icon={<DocumentSearch20Regular />} onClick={() => { setSelectedId(undefined); setInspecting(true); }}>{t("evidence.inspectAll", "查看全部证据")}</Button>
      {props.report.claims.length ? <ol className="evidence-lens__claims">{props.report.claims.slice(0, limit).map((claim, index) => <li key={claim.id}>
        <ClaimEvidenceMark claim={claim} number={index + 1} selected={selectedId === claim.id} streaming={props.streaming} onClick={target => { triggerRef.current = target; setSelectedId(claim.id); }} />
        {selected?.id === claim.id ? <EvidencePeek {...props} claim={selected} onClose={closePeek} onInspect={() => { setSelectedId(undefined); setInspecting(true); }} /> : null}
      </li>)}</ol> : <div className="evidence-lens__source-preview">
        <p className="evidence-lens__empty">{props.report.sources.length ? t("evidence.noStructuredClaims", "已保留来源，尚未逐条核验回答。") : t("evidence.noSources", "本轮没有可核对的来源。")}</p>
        {uniquePassages(props.report.passages).slice(0, 2).map(passage => <PassageCard key={passage.id} {...props} passage={passage} />)}
        {props.report.sources.filter(source => !props.report.passages.some(passage => passage.sourceId === source.id)).slice(0, 2).map(source =>
          <p className="evidence-lens__metadata" key={source.id}><span>{source.title}</span><span>{t(`evidence.coverage.${source.coverage}`, coverages[source.coverage])}</span></p>)}
        <VerificationDetails report={props.report} />
      </div>}
      {props.report.claims.length > limit ? <Button appearance="subtle" size="small" onClick={() => setLimit(value => value + 4)}>{t("evidence.more", "显示更多")}</Button> : null}
    </div> : null}
  </div>;
}
