import { SearchOptions, SearchHighlight } from "../search/SearchOptions";
import { type SearchMetadata } from "../search/searchQuery";
import { noteLabels } from "../notes/noteLabels";
import { useMemo, useState } from "react";
import { Button, Input } from "@fluentui/react-components";
import { ArrowLeftRegular, LocationRegular, SearchRegular } from "@fluentui/react-icons";
import type { PdfAnnotation, PdfAnnotationV2 } from "./pdfAnnotationStorage";
import type { TeamAnnotation } from "../organization/teamAnnotationClient";
import { PdfAnnotationMarkdown } from "./PdfAnnotationMarkdown";
import { compilePdfAnnotationQuery, teamPdfAnnotation } from "./pdfAnnotationQuery";
import { comparePdfAnnotations, pdfAnnotationSortLabels, type PdfAnnotationSort } from "./pdfAnnotationSort";
import { PdfAnnotationSortPicker } from "./PdfAnnotationSortPicker";

import { PdfAnnotationFilters, emptyPdfAnnotationFacets, matchesPdfAnnotationFacets, pdfAnnotationKindLabels as labels } from "./PdfAnnotationFilters";
export function PdfAnnotationsOverview({ annotations, teamAnnotations, paperIdentity, searchMetadata, error, onNavigate, onClose }: {
  searchMetadata?: SearchMetadata;
  annotations: PdfAnnotationV2[]; teamAnnotations: TeamAnnotation[]; paperIdentity?: PdfAnnotation["paperIdentity"]; error?: string;
  onNavigate(annotation: PdfAnnotation): void; onClose(): void;
}) {
  const [query, setQuery] = useState("");
  const [facets, setFacets] = useState(emptyPdfAnnotationFacets);
  const [order, setOrder] = useState<PdfAnnotationSort>("reading");
  const [limit, setLimit] = useState(80);
  const entries = useMemo(() => {
    const items: { id: string; annotation: PdfAnnotation; author?: string }[] = annotations.map((annotation) => ({ id: annotation.id, annotation }));
    const localIds = new Set(annotations.map((annotation) => annotation.id));
    for (const team of teamAnnotations) {
      if (!paperIdentity || localIds.has(team.body.clientAnnotationId)) continue;
      items.push({ id: `team:${team.annotationId}`, author: team.uploadedBy,
        annotation: teamPdfAnnotation(team, paperIdentity) });
    }
    return items.sort((a, b) => comparePdfAnnotations(a.annotation, b.annotation, order));
  }, [annotations, teamAnnotations, paperIdentity, order]);
  const compiled = useMemo(() => compilePdfAnnotationQuery(query, searchMetadata), [query, searchMetadata]);
  const filtered = useMemo(() => entries.filter(({ annotation, author }) => matchesPdfAnnotationFacets(annotation, facets)
    && compiled.matches(annotation, author)), [entries, compiled, facets]);
  return <section className="pdf-overview" aria-label="全部批注">
    <header className="pdf-overview-header">
      <Button appearance="subtle" icon={<ArrowLeftRegular />} onClick={onClose}>返回 PDF</Button>
      <strong>全部批注 · {entries.length}</strong>
      <Input aria-label="搜索全部批注" placeholder="搜索摘录、批注或页码" contentBefore={<SearchRegular />} value={query} onChange={(_, data) => { setQuery(data.value); setLimit(80); }} />
      <SearchOptions query={query} onChange={setQuery} tags={Object.values(noteLabels)} />
      <PdfAnnotationFilters annotations={entries.map(({ annotation }) => annotation)} value={facets} onChange={(value) => { setFacets(value); setLimit(80); }} />
      <PdfAnnotationSortPicker value={order} onChange={(value) => { setOrder(value); setLimit(80); }} />
    </header>
    <div className="pdf-annotations-overview-scroll">
      {error ? <p role="alert">{error}</p> : null}
      <p role="status">{filtered.length ? `${filtered.length} 条批注，按${pdfAnnotationSortLabels[order]}排列。` : entries.length ? "没有匹配的批注。" : "此文档还没有批注。"}</p>
      <ol className="pdf-annotations-grid">{filtered.slice(0, limit).map(({ id, annotation, author }) => <li key={id} className="pdf-annotation-card">
        <header><strong>{labels[annotation.kind]} · 第 {annotation.page} 页</strong>{author ? <span>团队成员</span> : null}
          <Button appearance="subtle" icon={<LocationRegular />} aria-label={`定位第 ${annotation.page} 页${labels[annotation.kind]}：${annotation.excerpt}`}
            onClick={() => onNavigate(annotation)}>定位原文</Button></header>
        {annotation.kind !== "text" && annotation.kind !== "ink" && annotation.excerpt ? <blockquote><SearchHighlight text={annotation.excerpt} query={query} /></blockquote> : null}
        {annotation.quickAsk ? <><strong><SearchHighlight text={annotation.quickAsk.question} query={query} /></strong><PdfAnnotationMarkdown value={annotation.quickAsk.answer} /></> : null}
        {annotation.review ? <PdfAnnotationMarkdown value={annotation.review.text} /> : null}
        {annotation.note ? <PdfAnnotationMarkdown value={annotation.note} images={annotation.images} /> : <p className="pdf-overview-muted">{annotation.kind === "ink" ? "手绘批注，点击定位原文查看笔迹。" : annotation.kind === "text" ? "空白文本框" : "未添加备注"}</p>}
      </li>)}</ol>
      {filtered.length > limit ? <Button onClick={() => setLimit((value) => value + 80)}>显示更多批注（剩余 {filtered.length - limit} 条）</Button> : null}
    </div>
  </section>;
}
