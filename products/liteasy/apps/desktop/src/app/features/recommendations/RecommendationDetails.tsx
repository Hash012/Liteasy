import { Button } from "@fluentui/react-components";
import { ArrowClockwiseRegular, ArrowUpRightRegular } from "@fluentui/react-icons";
import { MarkdownContent } from "../markdown/MarkdownContent";
import type { RecommendationItem } from "./recommendation.types";
import { recommendationDateLabel, recommendationSourceUrl } from "./recommendationPresentation";
import { RecommendationDownload, type DownloadRecommendation, type RecommendationLocations } from "./RecommendationDownload";
import "./recommendationList.css";

export function RecommendationDetails({ item, onDownload, locations, page = false, loading = false, message, onRefresh }: {
  item: RecommendationItem; onDownload?: DownloadRecommendation; locations?: RecommendationLocations | null;
  page?: boolean; loading?: boolean; message?: string; onRefresh?: () => void;
}) {
  const url = recommendationSourceUrl(item);
  const topics = [...new Set([...(item.subjects ?? []), ...(item.keywords ?? [])])].slice(0, 12);
  return <section aria-label={page ? "推荐论文详情" : "推荐文献元信息"} className={page ? "recommendation-page" : "recommendation-detail"}>
    <div className="recommendation-detail-body">
      {page ? <p className="recommendation-page-eyebrow">论文详情 · {item.source}</p> : null}
      {page ? <h1>{item.title}</h1> : <h3>{item.title}</h3>}
      <p className="recommendation-detail-authors">{item.authors?.join(" · ") || "来源暂未提供作者信息"}</p>
      <div className="recommendation-detail-toolbar">
        {url ? <a className="recommendation-source-link" href={url} rel="noopener noreferrer" target="_blank"><ArrowUpRightRegular aria-hidden="true" />{page ? "打开论文网站" : item.source}</a> : <span className="recommendation-muted">暂无来源链接</span>}
        {onRefresh ? <Button appearance="subtle" size="small" icon={<ArrowClockwiseRegular />} disabled={loading} onClick={onRefresh}>刷新题录</Button> : null}
      </div>
      <div role="status" className="recommendation-muted">{loading ? "正在补全论文网站的题录信息…" : message}</div>
      <dl className="recommendation-facts">
        <dt>发表时间</dt><dd>{recommendationDateLabel(item)}</dd>
        {item.venue ? <><dt>刊物 / 会议</dt><dd>{item.venue}</dd></> : null}
        {Number.isSafeInteger(item.citationCount) && item.citationCount! >= 0 ? <><dt>引用</dt><dd>{item.citationCount}</dd></> : null}
        <dt>信息来源</dt><dd>{item.source}</dd>
        {item.canonicalId ? <><dt>标识</dt><dd>{item.canonicalId}</dd></> : null}
      </dl>
      {topics.length ? <div className="recommendation-topics" aria-label="论文主题">{topics.map((topic) => <span key={topic}>{topic}</span>)}</div> : null}
      <section className="recommendation-abstract" aria-label="论文摘要">
        {page ? <h2>摘要</h2> : null}
        {item.abstract ? <MarkdownContent value={item.abstract} /> : <p className="recommendation-muted">来源暂未提供摘要，可打开论文网站阅读全文介绍。</p>}
      </section>
      {page && (item.reason || item.relatedDocumentTitle) ? <aside className="recommendation-rationale">
        <h2>为什么推荐这篇论文</h2>
        {item.reason ? <p>{item.reason}</p> : null}
        {item.relatedDocumentTitle ? <p className="recommendation-muted">关联文献：{(item.relatedDocumentTitles?.length ? item.relatedDocumentTitles : [item.relatedDocumentTitle]).join("；")}</p> : null}
      </aside> : null}
      {onDownload ? <RecommendationDownload key={item.id} item={item} locations={locations} onDownload={onDownload} /> : null}
    </div>
  </section>;
}
