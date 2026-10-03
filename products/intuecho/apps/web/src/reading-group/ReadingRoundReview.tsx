import { Button } from "@fluentui/react-components";
import type { CommunityAnnotation, CommunityReply } from "../community.types";
import { isHostSummary } from "./readingGroup";

export type DiscussionFilter = "all" | "question" | "evidence" | "summary";
export function matchesDiscussionFilter(pack: CommunityAnnotation, reply: CommunityReply, filter: DiscussionFilter) {
  if (reply.parentAnnotationId !== pack.id) return false;
  if (filter === "all") return true;
  if (filter === "summary") return isHostSummary(pack, reply);
  return reply.collaboration?.schemaVersion === 1 && reply.collaboration.parentPackId === pack.id &&
    reply.collaboration.kind === (filter === "question" ? "question" : "reflection");
}
function sectionText(body: string, title: string) {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${title}`);
  if (start < 0) return "";
  let end = start + 1;
  while (end < lines.length && !/^#{1,2}\s/.test(lines[end])) end += 1;
  return lines.slice(start + 1, end).join("\n").trim();
}
export function previousReadingRound(pack: CommunityAnnotation, replies: CommunityReply[]) {
  const summary = replies.filter((reply) => isHostSummary(pack, reply)).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))[0];
  return summary ? {
    reply: summary,
    summary: sectionText(summary.body, "主持人手动摘要") || summary.body,
    unresolved: sectionText(summary.body, "未解决项与异议"),
    evidenceCount: summary.collaboration?.sourceRefs.length ?? 0
  } : null;
}
export function ReadingRoundReview({ pack, replies, onFilter }: {
  pack: CommunityAnnotation; replies: CommunityReply[]; onFilter: (filter: DiscussionFilter) => void;
}) {
  const previous = previousReadingRound(pack, replies);
  if (!previous) return null;
  return <section className="reading-round-review" aria-label="继续上次讨论">
    <div className="reading-group-row"><h3>继续上次讨论</h3><small>主持人整理 · {new Date(previous.reply.createdAt).toLocaleDateString("zh-CN")} · 修订 {previous.reply.revision}</small></div>
    <p className="reading-round-summary">{previous.summary}</p>
    <strong>前次记录的未解决项与异议</strong>
    <p className="reading-group-body">{previous.unresolved || "该次整理未单独列出未解决项，请查看完整摘要。"}</p>
    <p>主持人整理不代表所有问题已解决，也不代表全员共识。已有 {previous.evidenceCount} 条版本固定的讨论依据。</p>
    <div className="reading-round-actions"><Button onClick={() => onFilter("summary")}>查看前次摘要与证据</Button><Button appearance="subtle" onClick={() => onFilter("question")}>回顾问题</Button></div>
  </section>;
}
