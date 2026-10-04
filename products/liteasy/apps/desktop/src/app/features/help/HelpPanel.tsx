import { useState } from "react";
import { WorkbenchEmptyState } from "../workbench/WorkbenchPage";
import { Button, Input, Spinner, Tooltip } from "@fluentui/react-components";
import {
  ArrowClockwiseRegular,
  BookOpenRegular,
  HomeRegular,
  SearchRegular,
} from "@fluentui/react-icons";
import { MarkdownContent } from "../markdown/MarkdownContent";
import { LocalDiagnosticsPanel } from "../local-diagnostics/LocalDiagnosticsPanel";
import type { HelpViewModel } from "./help.types";
import "./help.css";

export function HelpPanel({ model }: { model: HelpViewModel }) {
  const [catalog, setCatalog] = useState(false);
  const home = !catalog && !model.query.trim() && !model.topic && !model.articleRef;
  const journeys = [
    { id: "getting-started.basics", title: "开始阅读第一份材料", detail: "导入 → 打开 → 恢复阅读位置" },
    { id: "reading.notes", title: "从一段原文形成研究笔记", detail: "选文 → 引用 → 提问 → 保存" },
    { id: "data.backup", title: "管理文件与备份", detail: "找到保存位置，确认同步范围" },
  ].map((item) => ({ ...item, article: model.articles.find((article) => article.id === item.id) })).filter((item) => item.article);
  return (
    <section className="help-panel" aria-label="帮助" aria-busy={model.loading}>
      <header className="help-header">
        <BookOpenRegular aria-hidden />
        <strong>用户手册</strong>
        <Tooltip content="帮助首页" relationship="description">
          <Button
            appearance="subtle"
            icon={<HomeRegular />}
            aria-label="帮助首页"
            onClick={() => { setCatalog(false); model.home(); }}
          />
        </Tooltip>
        <Tooltip content="刷新帮助" relationship="description">
          <Button
            appearance="subtle"
            icon={<ArrowClockwiseRegular />}
            aria-label="刷新帮助"
            onClick={model.retry}
          />
        </Tooltip>
      </header>
      <Input
        aria-label="搜索帮助"
        placeholder="搜索问题、功能或操作"
        contentBefore={<SearchRegular />}
        value={model.query}
        onChange={(_, data) => model.setQuery(data.value)}
      />
      <div className="help-workspace">
        <nav aria-label="帮助目录" className="help-topics">
          <Button
            appearance={!model.topic ? "primary" : "subtle"}
            aria-pressed={!model.topic}
            onClick={() => { setCatalog(true); model.selectTopic(); }}
          >
            全部
          </Button>
          {model.topics.map((topic) => {
            const selected =
              topic.ref.providerId === model.topic?.providerId &&
              topic.id === model.topic.topicId;
            return (
              <Button
                key={`${topic.ref.providerId}/${topic.id}`}
                appearance={selected ? "primary" : "subtle"}
                aria-pressed={selected}
                onClick={() => { setCatalog(true); model.selectTopic(topic.ref); }}
              >
                {topic.title}
              </Button>
            );
          })}
        </nav>
        <div className="help-content" aria-live="polite">

          {model.loading ? (
            <Spinner size="small" label="正在加载帮助" />
          ) : model.error ? (
            <div role="alert">
              <p>{model.error}</p>
              <Button onClick={model.retry}>重试</Button>
            </div>
          ) : home && journeys.length ? (
            <div className="help-home"><h1>你现在想完成什么？</h1><p>从一个任务开始，也可以随时查阅完整手册。</p>
              <div className="help-journeys">{journeys.map((item) => <Button key={item.id} appearance="subtle" onClick={() => model.openArticle(item.article!.ref)}><BookOpenRegular aria-hidden /><span><strong>{item.title}</strong><small>{item.detail}</small></span></Button>)}</div>
              <Button appearance="subtle" onClick={() => setCatalog(true)}>完整文档目录</Button>

            </div>
          ) : model.articleRef ? (
            model.article ? (
              <article aria-label={model.article.title}>
                <h1>{model.article.title}</h1>
                <MarkdownContent html="skip" value={model.article.body} />
              </article>
            ) : (
              <p>未找到此帮助条目。</p>
            )
          ) : model.articles.length ? (
            <ul className="help-results">
              {model.articles.map((article) => (
                <li key={`${article.ref.providerId}/${article.id}`}>
                  <Button
                    appearance="subtle"
                    onClick={() => model.openArticle(article.ref)}
                  >
                    {article.title}
                  </Button>
                  {article.summary ? <p>{article.summary}</p> : null}
                </li>
              ))}
            </ul>
          ) : (
            <WorkbenchEmptyState icon={<BookOpenRegular />} title={model.query ? "没有匹配的帮助条目" : "此目录暂无帮助条目"} description="可以更换关键词，或返回帮助首页。" actions={<Button onClick={() => { model.setQuery(""); model.home(); setCatalog(false); }}>返回帮助首页</Button>} />
          )}
          <LocalDiagnosticsPanel />
        </div>
      </div>
    </section>
  );
}
