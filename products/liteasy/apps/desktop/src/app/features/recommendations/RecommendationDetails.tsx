import { ResourceTagChips } from "../resource-tags/ResourceTagChips";
import { recommendationKeywords } from "./recommendationKeywords";
import { Button } from "@fluentui/react-components";
import { useState } from "react";
import { ExternalNavigation } from "../navigation/externalNavigation";
import { ArrowClockwiseRegular, ArrowUpRightRegular } from "@fluentui/react-icons";
import { MarkdownContent } from "../markdown/MarkdownContent";
import type { RecommendationItem } from "./recommendation.types";
import { recommendationDateLabel, recommendationSourceUrl } from "./recommendationPresentation";
import { RecommendationDownload, type DownloadRecommendation, type RecommendationLocations } from "./RecommendationDownload";
import "./recommendationList.css";

export function RecommendationDetails({ item, onDownload, locations, page = false, loading = false, message, onRefresh, onOpenAsset }: {
  onOpenAsset?: (path: string) => void | Promise<unknown>;
  item: RecommendationItem; onDownload?: DownloadRecommendation; locations?: RecommendationLocations | null;
  page?: boolean; loading?: boolean; message?: string; onRefresh?: () => void;
}) {
  const url = recommendationSourceUrl(item);
  const [linkError, setLinkError] = useState("");
  const openPath = onOpenAsset ? async (path: string) => { await onOpenAsset(path); } : undefined;
  const topics = recommendationKeywords(item);
  return <section aria-label={page ? "推荐论文详情" : "推荐文献元信息"} className={page ? "recommendation-page" : "recommendation-detail"}>
    <div className="recommendation-detail-body">
      {page ? <p className="recommendation-page-eyebrow">论文详情 · {item.source}</p> : null}
      {page ? <h1>{item.title}</h1> : <h3>{item.title}</h3>}
      <p className="recommendation-detail-authors">{item.authors?.join(" · ") || "来源暂未提供作者信息"}</p>
      <div className="recommendation-detail-toolbar">
        {item.resourcePath && openPath ? <Button appearance="subtle" onClick={() => { void openPath(item.resourcePath!).catch((error: unknown) => setLinkError(String(error))); }}>打开本地资产</Button> : null}
        {url ? <a className="recommendation-source-link" href={url} rel="noopener noreferrer" target="_blank" onClick={(event) => {
          event.preventDefault(); setLinkError("");
          void ExternalNavigation.open(url).catch((error: unknown) => setLinkError(error instanceof Error ? error.message : String(error)));
        }}><ArrowUpRightRegular aria-hidden="true" />{page ? "打开论文网站" : item.source}</a> : <span className="recommendation-muted">暂无来源链接</span>}
        {onRefresh ? <Button appearance="subtle" size="small" icon={<ArrowClockwiseRegular />} disabled={loading} onClick={onRefresh}>刷新题录</Button> : null}
      </div>
      {linkError ? <p role="alert">{linkError} <Button size="small" appearance="subtle" onClick={() => {
        if (url) void navigator.clipboard.writeText(url).then(() => setLinkError("链接已复制。"), () => setLinkError(`请复制此地址：${url}`));
      }}>复制链接</Button></p> : null}
      <div role="status" className="recommendation-muted">{loading ? "正在补全论文网站的题录信息…" : message}</div>
      <dl className="recommendation-facts">
        <dt>发表时间</dt><dd>{recommendationDateLabel(item)}</dd>
        {item.venue ? <><dt>刊物 / 会议</dt><dd>{item.venue}</dd></> : null}
        {Number.isSafeInteger(item.citationCount) && item.citationCount! >= 0 ? <><dt>引用</dt><dd>{item.citationCount}</dd></> : null}
        <dt>信息来源</dt><dd>{item.source}</dd>
        {item.canonicalId ? <><dt>标识</dt><dd>{item.canonicalId}</dd></> : null}
      </dl>
      {topics.length ? <ResourceTagChips label="论文主题" tags={topics} limit={8} /> : null}
      <section className="recommendation-abstract" aria-label="论文摘要">
        {page ? <h2>摘要</h2> : null}
        {item.abstract ? <MarkdownContent value={item.abstract} /> : <p className="recommendation-muted">来源暂未提供摘要，可打开论文网站阅读全文介绍。</p>}
      </section>
      {page && (item.reason || item.relatedDocumentTitle) ? <aside className="recommendation-rationale">
        <h2>为什么推荐这篇论文</h2>
        {item.reason ? <MarkdownContent value={item.reason} onOpenLiteasyPath={openPath} /> : null}
        {item.relatedDocumentTitle ? <p className="recommendation-muted">关联文献：{(item.relatedDocumentTitles?.length ? item.relatedDocumentTitles : [item.relatedDocumentTitle]).join("；")}</p> : null}
      </aside> : null}
      {onDownload && !item.resourcePath ? <RecommendationDownload key={item.id} item={item} locations={locations} onDownload={onDownload} /> : null}
    </div>
  </section>;
}
