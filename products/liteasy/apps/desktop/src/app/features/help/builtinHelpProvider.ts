import type { HelpArticle, HelpContentProvider } from "./help.types";
import chatgptCommentReview from "./articles/chatgpt-comment-review.md?raw";

const articles: readonly HelpArticle[] = [{
  id: "reading.chatgpt-review",
  topicId: "reading",
  title: "连接 ChatGPT Review 论文评论",
  summary: "配置私有隧道或 HTTPS 连接，共享个人评论，在 ChatGPT 中评审并管理共享权限。",
  body: chatgptCommentReview,
  format: "markdown",
}];

// Bundle Markdown with the desktop so the manual remains readable offline.
export const builtinHelpProviders: readonly HelpContentProvider[] = [
  {
    id: "liteasy",
    title: "用户手册",
    async listTopics() {
      return [
        { id: "getting-started", title: "开始使用", order: 0 },
        { id: "reading", title: "文献与阅读", order: 1 },
        { id: "boards", title: "研究白板", order: 2 },
        { id: "agent", title: "Agent", order: 3 },
        { id: "preferences", title: "设置与快捷键", order: 4 },
      ];
    },
    async search({ query, topicId, signal }) {
      signal.throwIfAborted();
      const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
      return articles.filter((article) => {
        const text = `${article.title}\n${article.summary ?? ""}\n${article.body}`.toLocaleLowerCase();
        return (!topicId || article.topicId === topicId) && terms.every((term) => text.includes(term));
      }).map(({ body: _body, format: _format, ...summary }) => summary);
    },
    async read(articleId, { signal }) {
      signal.throwIfAborted();
      const article = articles.find((entry) => entry.id === articleId);
      return article ? { ...article } : null;
    },
  },
];
