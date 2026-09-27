import { useMemo, useState } from "react";
import { Button, Input, Select } from "@fluentui/react-components";
import { ArrowLeftRegular, LocationRegular, SearchRegular } from "@fluentui/react-icons";
import type { PdfAnnotation, PdfAnnotationV2 } from "./pdfAnnotationStorage";
import type { TeamAnnotation } from "../organization/teamAnnotationClient";
import { PdfAnnotationMarkdown } from "./PdfAnnotationMarkdown";
import { comparePdfAnnotationsByReadingOrder } from "./pdfAnnotationReadingOrder";

const labels = { highlight: "高亮", underline: "划线", note: "便笺", text: "文本框", ink: "手绘" };
export function PdfAnnotationsOverview({ annotations, teamAnnotations, paperIdentity, error, onNavigate, onClose }: {
  annotations: PdfAnnotationV2[]; teamAnnotations: TeamAnnotation[]; paperIdentity?: PdfAnnotation["paperIdentity"]; error?: string;
  onNavigate(annotation: PdfAnnotation): void; onClose(): void;
}) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const [limit, setLimit] = useState(80);
  const entries = useMemo(() => {
    const items: { id: string; annotation: PdfAnnotation; author?: string }[] = annotations.map((annotation) => ({ id: annotation.id, annotation }));
    const localIds = new Set(annotations.map((annotation) => annotation.id));
    for (const team of teamAnnotations) {
      if (!paperIdentity || localIds.has(team.body.clientAnnotationId)) continue;
      items.push({ id: `team:${team.annotationId}`, author: team.uploadedBy,
        annotation: { ...team.body, paperIdentity, id: team.annotationId, createdAt: team.createdAt } });
    }
    return items.sort((a, b) => comparePdfAnnotationsByReadingOrder(a.annotation, b.annotation));
  }, [annotations, teamAnnotations, paperIdentity]);
  const filtered = useMemo(() => entries.filter(({ annotation, author }) => (kind === "all" || annotation.kind === kind)
    && [annotation.excerpt, annotation.note, annotation.text, author, String(annotation.page)].join(" ").toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [entries, query, kind]);
  return <section className="pdf-overview" aria-label="全部批注">
    <header className="pdf-overview-header">
      <Button appearance="subtle" icon={<ArrowLeftRegular />} onClick={onClose}>返回 PDF</Button>
      <strong>全部批注 · {entries.length}</strong>
      <Input aria-label="搜索全部批注" placeholder="搜索摘录、批注或页码" contentBefore={<SearchRegular />} value={query} onChange={(_, data) => { setQuery(data.value); setLimit(80); }} />
      <Select aria-label="筛选批注类型" value={kind} onChange={(_, data) => { setKind(data.value); setLimit(80); }}>
        <option value="all">全部类型</option>{Object.entries(labels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
      </Select>
    </header>
    <div className="pdf-annotations-overview-scroll">
      {error ? <p role="alert">{error}</p> : null}
      <p role="status">{filtered.length ? `${filtered.length} 条批注，按原文顺序排列。` : entries.length ? "没有匹配的批注。" : "此文档还没有批注。"}</p>
      <ol className="pdf-annotations-grid">{filtered.slice(0, limit).map(({ id, annotation, author }) => <li key={id} className="pdf-annotation-card">
        <header><strong>{labels[annotation.kind]} · 第 {annotation.page} 页</strong>{author ? <span>团队 · {author}</span> : null}
          <Button appearance="subtle" icon={<LocationRegular />} aria-label={`定位第 ${annotation.page} 页${labels[annotation.kind]}：${annotation.excerpt}`}
            onClick={() => onNavigate(annotation)}>定位原文</Button></header>
        {annotation.kind !== "text" && annotation.kind !== "ink" && annotation.excerpt ? <blockquote>{annotation.excerpt}</blockquote> : null}
        {annotation.note ? <PdfAnnotationMarkdown value={annotation.note} images={annotation.images} /> : <p className="pdf-overview-muted">{annotation.kind === "ink" ? "手绘批注，点击定位原文查看笔迹。" : annotation.kind === "text" ? "空白文本框" : "未添加备注"}</p>}
      </li>)}</ol>
      {filtered.length > limit ? <Button onClick={() => setLimit((value) => value + 80)}>显示更多批注（剩余 {filtered.length - limit} 条）</Button> : null}
    </div>
  </section>;
}
