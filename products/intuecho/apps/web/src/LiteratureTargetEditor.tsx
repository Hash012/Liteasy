import {
  Button,
  Input,
  Spinner,
  Textarea,
  Tooltip
} from "@fluentui/react-components";
import {
  Add20Regular,
  Dismiss20Regular,
  Search20Regular
} from "@fluentui/react-icons";
import { useEffect, useRef, useState } from "react";
import type { LiteratureCandidate, LiteratureRecord, LiteratureResolveResult } from "@intuecho/contracts";
import { communityApi } from "./communityApi";
import type { AnnotationReadTarget, AnnotationTarget } from "./community.types";

type Props = { onChange: (targets: AnnotationTarget[]) => void; required: boolean; targets: Array<AnnotationTarget | AnnotationReadTarget> };
type TargetKind = "whole_document" | "source_passage";
function recordTitle(record: LiteratureRecord | LiteratureCandidate["record"] | undefined) {
  return record?.title || "已确认文献";
}

async function confirmedTarget(kind: TargetKind, literatureId: string, excerpt: string, page: string): Promise<AnnotationTarget> {
  if (kind === "whole_document") return { kind, literature: { literatureId } };
  return {
    anchorHash: await hashExcerpt(excerpt),
    excerpt: excerpt.trim(),
    kind,
    literature: { literatureId },
    ...(page.trim() ? { page: Number(page) } : {}),
    rects: []
  };
}

async function hashExcerpt(excerpt: string) {
  const normalized = excerpt.trim().normalize("NFKC");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  return `sha256:${[...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

export function LiteratureTargetEditor({ onChange, required, targets }: Props) {
  const attemptRef = useRef(0);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<TargetKind>("whole_document");
  const [result, setResult] = useState<LiteratureResolveResult | null>(null);
  const [confirmed, setConfirmed] = useState<LiteratureRecord | null>(null);
  const [literatureRecords, setLiteratureRecords] = useState<Record<string, LiteratureRecord>>({});
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [page, setPage] = useState("");

  useEffect(() => {
    if (query.trim().length < 3 || /^(10\.\d|https?:\/\/|arxiv[:/]|S2:|W\d+)/iu.test(query.trim())) return;
    const timer = window.setTimeout(() => void search(), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  async function search() {
    if (!query.trim()) { setStatus("请输入文献标题、DOI 或其他标识"); return; }
    const attempt = ++attemptRef.current;
    setLoading(true); setStatus(""); setConfirmed(null);
    try {
      const next = await communityApi.resolveLiterature({ purpose: "forum_compose", query: query.trim() });
      if (attempt !== attemptRef.current) return;
      setResult(next);
      if (next.status === "exact") await confirm(next.candidate, attempt);
      if (next.status === "unavailable") setStatus("文献检索服务暂时不可用，请重试。");
      if (next.status === "not_found") setStatus("没有找到可由公开来源确认的文献。");
      if (next.status === "conflict") setStatus("来源返回的稳定标识与题录存在冲突，无法确认。");
    } catch (reason) {
      if (attempt === attemptRef.current) setStatus(reason instanceof Error ? reason.message : "文献检索失败");
    } finally {
      if (attempt === attemptRef.current) setLoading(false);
    }
  }

  async function confirm(candidate: LiteratureCandidate, originatingAttempt?: number) {
    const attempt = originatingAttempt ?? ++attemptRef.current;
    setLoading(true); setStatus("");
    try {
      const response = await communityApi.confirmLiterature({ candidateKey: candidate.candidateKey, mode: "candidate" });
      if (attempt !== attemptRef.current) return;
      setConfirmed(response.literature);
      setLiteratureRecords((records) => ({ ...records, [response.literature.literatureId]: response.literature }));
      if (kind === "whole_document") void addConfirmed(response.literature, "", "", attempt);
    } catch (reason) {
      if (attempt === attemptRef.current) setStatus(reason instanceof Error ? reason.message : "文献确认失败");
    } finally {
      if (attempt === attemptRef.current) setLoading(false);
    }
  }

  async function addConfirmed(record: LiteratureRecord, selectedExcerpt = excerpt, selectedPage = page, attempt = attemptRef.current) {
    if (kind === "source_passage" && !selectedExcerpt.trim()) { setStatus("请填写原文摘录"); return; }
    const target = await confirmedTarget(kind, record.literatureId, selectedExcerpt, selectedPage);
    if (attempt !== attemptRef.current) return;
    onChange([...targets, target]);
    setExcerpt(""); setPage(""); setQuery(""); setResult(null); setStatus("");
  }

  const candidates = result?.status === "ambiguous" ? result.candidates : [];
  return <section className="target-editor literature-target-editor">
    <div className="section-row"><div><strong>关联文献</strong>{required && <span>必填</span>}</div><small>{targets.length} 处</small></div>
    <label className="field-label">目标范围<select aria-label="目标范围" value={kind} onChange={(event) => setKind(event.target.value as TargetKind)}><option value="whole_document">整篇文献</option><option value="source_passage">原文字句</option></select></label>
    {targets.length > 0 && <div className="selected-targets">{targets.map((target, index) => { const reference = target.literature; const title = "literatureRecord" in reference && reference.literatureRecord ? reference.literatureRecord.title : literatureRecords[reference.literatureId]?.title ?? `文献 ${reference.literatureId}`; return <div key={`${target.kind}-${index}`}><div className="target-chip"><span><strong>{title}</strong><small>{target.kind === "whole_document" ? "整篇文献" : `${"page" in target && target.page ? `第 ${target.page} 页 · ` : ""}${"excerpt" in target ? target.excerpt : "原文摘录"}`}</small></span></div><Tooltip content="移除关联文献" relationship="label"><Button appearance="subtle" icon={<Dismiss20Regular />} aria-label="移除关联文献" onClick={() => onChange(targets.filter((_, position) => position !== index))} /></Tooltip></div>; })}</div>}
    <div className="literature-search-row"><Input role="combobox" aria-label="检索关联文献" contentBefore={<Search20Regular />} value={query} onChange={(_, data) => { attemptRef.current += 1; setQuery(data.value); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void search(); } }} /><Button type="button" appearance="primary" onClick={() => void search()} disabled={loading}>检索</Button></div>
    {loading && <div className="literature-loading" role="status"><Spinner size="tiny" /> 正在检索文献</div>}
    {result?.status === "unavailable" && <Button type="button" appearance="subtle" aria-label="重试检索" onClick={() => void search()} disabled={loading}>重试检索</Button>}
    {result?.status === "ambiguous" && <div className="literature-candidates" role="list">{candidates.map((candidate) => <div key={candidate.candidateKey} role="listitem"><span><strong>{candidate.record.title}</strong><small>{candidate.record.authors.join("、")}{candidate.record.year ? ` · ${candidate.record.year}` : ""}</small></span><Button type="button" aria-label={`选择 ${candidate.record.title}`} onClick={() => void confirm(candidate)}>选择</Button></div>)}</div>}
    {confirmed && <div className="literature-confirmed-record" role="status"><strong>{recordTitle(confirmed)}</strong>{kind === "whole_document" ? <small>已确认，可继续添加为关联文献</small> : <div className="target-form literature-passage-form"><label>页码<Input aria-label="页码" type="number" min={1} value={page} onChange={(_, data) => setPage(data.value)} /></label><label className="wide">原文摘录<Textarea aria-label="原文摘录" value={excerpt} onChange={(_, data) => setExcerpt(data.value)} /></label><Button type="button" icon={<Add20Regular />} onClick={() => void addConfirmed(confirmed)}>添加已确认文献</Button></div>}</div>}
    {status && <p className="form-error" role="alert">{status}</p>}
  </section>;
}
