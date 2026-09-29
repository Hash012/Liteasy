import { Button } from "@fluentui/react-components";
import { ArrowDownloadRegular } from "@fluentui/react-icons";
import { useState } from "react";
import { MarkdownContent } from "../markdown/MarkdownContent";
import type { RecommendationItem } from "./recommendation.types";
import { recommendationDateLabel } from "./RecommendationList";

export function RecommendationDetails({ item, onDownload }: { item: RecommendationItem; onDownload?: (item: RecommendationItem) => Promise<string> }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  return <section aria-label="推荐文献元信息" className="recommendation-detail">
    <h3>{item.title}</h3>
    <dl>
      <dt>作者</dt><dd>{item.authors?.join(" · ") || "未提供"}</dd>
      <dt>发表时间</dt><dd>{recommendationDateLabel(item)}</dd>
      {item.venue ? <><dt>刊物 / 会议</dt><dd>{item.venue}</dd></> : null}
      {item.subjects?.length ? <><dt>学科</dt><dd>{item.subjects.join(" · ")}</dd></> : null}
      {Number.isSafeInteger(item.citationCount) && item.citationCount! >= 0 ? <><dt>引用</dt><dd>{item.citationCount}</dd></> : null}
      <dt>来源</dt><dd>{item.sourceUrl && /^https?:\/\//i.test(item.sourceUrl)
        ? <a href={item.sourceUrl} rel="noopener noreferrer" target="_blank">{item.source}</a> : item.source}</dd>
      {item.canonicalId ? <><dt>标识</dt><dd>{item.canonicalId}</dd></> : null}
    </dl>
    {item.abstract ? <MarkdownContent value={item.abstract} /> : null}
    {item.reason ? <p>{item.reason}</p> : null}
    {onDownload ? <Button icon={<ArrowDownloadRegular />} disabled={busy} onClick={() => {
      setBusy(true); setMessage("正在下载…");
      void onDownload(item).then(setMessage, (error: unknown) => setMessage(error instanceof Error ? error.message : "下载失败，请重试。")).finally(() => setBusy(false));
    }}>下载到文献库 / Download</Button> : null}
    {message ? <p role="status">{message}</p> : null}
  </section>;
}
