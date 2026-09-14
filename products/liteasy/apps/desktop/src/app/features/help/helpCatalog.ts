import type {
  HelpArticleEntry,
  HelpArticleRef,
  HelpContentProvider,
  HelpRequest,
  HelpTopicEntry,
  HelpTopicRef,
} from "./help.types";

export function createHelpCatalog(providers: readonly HelpContentProvider[]) {
  const registry = new Map<string, HelpContentProvider>();
  for (const provider of providers) {
    if (!provider.id.trim() || registry.has(provider.id))
      throw new Error("帮助内容提供方标识必须唯一。");
    registry.set(provider.id, provider);
  }
  const getProvider = (id: string) => {
    const provider = registry.get(id);
    if (!provider) throw new Error("此帮助内容暂不可用。");
    return provider;
  };
  return {
    async topics(request: HelpRequest): Promise<HelpTopicEntry[]> {
      const groups = await Promise.all(
        providers.map(async (provider) => {
          const topics = await provider.listTopics(request);
          return [...topics]
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
            .map((topic) => ({
              ...topic,
              providerTitle: provider.title,
              ref: { providerId: provider.id, topicId: topic.id },
            }));
        }),
      );
      return groups.flat();
    },
    async search(
      request: HelpRequest & { query: string; topic?: HelpTopicRef },
    ): Promise<HelpArticleEntry[]> {
      const targets = request.topic
        ? [getProvider(request.topic.providerId)]
        : providers;
      const groups = await Promise.all(
        targets.map(async (provider) => {
          const entries = await provider.search({
            signal: request.signal,
            locale: request.locale,
            query: request.query,
            topicId: request.topic?.topicId,
          });
          return entries.map((entry) => ({
            ...entry,
            ref: { providerId: provider.id, articleId: entry.id },
          }));
        }),
      );
      return groups.flat();
    },
    async read(ref: HelpArticleRef, request: HelpRequest) {
      return getProvider(ref.providerId).read(ref.articleId, request);
    },
  };
}
