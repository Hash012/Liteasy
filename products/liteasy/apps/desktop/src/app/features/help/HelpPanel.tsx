import { Button, Input, Spinner, Tooltip } from "@fluentui/react-components";
import {
  ArrowClockwiseRegular,
  BookOpenRegular,
  HomeRegular,
  SearchRegular,
} from "@fluentui/react-icons";
import ReactMarkdown from "react-markdown";
import type { HelpViewModel } from "./help.types";
import "./help.css";

export function HelpPanel({ model }: { model: HelpViewModel }) {
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
            onClick={model.home}
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
        placeholder="搜索帮助"
        contentBefore={<SearchRegular />}
        value={model.query}
        onChange={(_, data) => model.setQuery(data.value)}
      />
      <div className="help-workspace">
        <nav aria-label="帮助目录" className="help-topics">
          <Button
            appearance={!model.topic ? "primary" : "subtle"}
            aria-pressed={!model.topic}
            onClick={() => model.selectTopic()}
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
                onClick={() => model.selectTopic(topic.ref)}
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
          ) : model.articleRef ? (
            model.article ? (
              <article aria-label={model.article.title}>
                <h1>{model.article.title}</h1>
                <ReactMarkdown skipHtml>{model.article.body}</ReactMarkdown>
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
            <div className="help-empty">
              <BookOpenRegular aria-hidden />
              <p>
                {model.query ? "没有匹配的帮助条目。" : "此目录暂无帮助条目。"}
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
