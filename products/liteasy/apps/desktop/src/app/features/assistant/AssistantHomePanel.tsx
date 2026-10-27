import { Children, type ReactNode } from "react";
import { ArrowRightRegular, DocumentPdfRegular, SparkleRegular } from "@fluentui/react-icons";
import { ActionButton } from "../../shared/ui/productPrimitives";

export function AssistantHomePanel({ compact = false, papers, emptyMaterialsMessage, recentConversationsLabel = "最近对话", onAskSelected, onViewAll, children }: {
  compact?: boolean;
  papers: ReadonlyArray<{ id: string; title: string }>;
  emptyMaterialsMessage: string;
  recentConversationsLabel?: string;
  onAskSelected(): void;
  onViewAll(): void;
  children: ReactNode;
}) {
  if (compact) return <section className="assistant-home assistant-home-compact" aria-label="助手首页">
    <p>直接提问，或用 @ 添加资料、/ 选择命令。</p>
    {papers.length ? <ActionButton appearance="subtle" icon={<SparkleRegular />} onClick={onAskSelected}>根据已选 {papers.length} 篇资料提问</ActionButton> : null}
  </section>;
  return <section className="assistant-home" aria-label="助手首页">
    <div className="assistant-home-start">
      <h3>开始新对话</h3>
      {papers.length ? <>
        <p className="assistant-home-hint">可使用的已选资料：</p>
        <ul className="assistant-home-materials" aria-label="已选资料">{papers.map(paper => <li key={paper.id}>
          <DocumentPdfRegular aria-hidden="true" /><span title={paper.title}>{paper.title}</span>
        </li>)}</ul>
        <ActionButton className="assistant-home-ask" appearance="primary" icon={<SparkleRegular />} onClick={onAskSelected}>根据已选资料提问</ActionButton>
      </> : <p className="assistant-home-hint">{emptyMaterialsMessage}。可直接提问，或先从文献库选择资料。</p>}
    </div>
    <h4 className="assistant-recent-heading">最近对话</h4>
    {Children.count(children) ? <ul className="assistant-recent-conversations" aria-label={recentConversationsLabel}>{children}</ul>
      : <p className="assistant-home-empty">暂无最近对话。开始提问后，对话会显示在这里。</p>}
    <ActionButton className="assistant-home-view-all" appearance="subtle" icon={<ArrowRightRegular />} iconPosition="after" onClick={onViewAll}>查看全部</ActionButton>
  </section>;
}
