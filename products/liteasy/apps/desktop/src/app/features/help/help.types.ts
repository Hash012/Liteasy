export type HelpArticleRef = { providerId: string; articleId: string };
export type HelpTopicRef = { providerId: string; topicId: string };
export type HelpRequest = { signal: AbortSignal; locale: string };
export type HelpTopic = { id: string; title: string; order?: number };
export type HelpArticleSummary = {
  id: string;
  topicId: string;
  title: string;
  summary?: string;
};
export type HelpArticle = HelpArticleSummary & {
  body: string;
  format: "markdown";
};

/** Content adapters own loading and search; the help UI never reads storage directly. */
export interface HelpContentProvider {
  readonly id: string;
  readonly title: string;
  listTopics(request: HelpRequest): Promise<readonly HelpTopic[]>;
  search(
    request: HelpRequest & { query: string; topicId?: string },
  ): Promise<readonly HelpArticleSummary[]>;
  read(articleId: string, request: HelpRequest): Promise<HelpArticle | null>;
}

export type HelpTopicEntry = HelpTopic & {
  ref: HelpTopicRef;
  providerTitle: string;
};
export type HelpArticleEntry = HelpArticleSummary & { ref: HelpArticleRef };
export interface HelpPort {
  open(article?: HelpArticleRef): void;
}

export type HelpViewModel = {
  topics: HelpTopicEntry[];
  articles: HelpArticleEntry[];
  article?: HelpArticle | null;
  articleRef?: HelpArticleRef;
  topic?: HelpTopicRef;
  query: string;
  loading: boolean;
  error: string;
  setQuery(value: string): void;
  selectTopic(topic?: HelpTopicRef): void;
  openArticle(article: HelpArticleRef): void;
  home(): void;
  retry(): void;
};
