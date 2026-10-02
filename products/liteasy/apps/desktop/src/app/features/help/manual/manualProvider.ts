import type { HelpArticle, HelpArticleSummary, HelpContentProvider, HelpTopic } from "../help.types";

export type ManualRecord = {
  id: string; topicId: string; title: string; summary: string; body: string;
  keywords: readonly string[]; condition: string; order: number;
  related: readonly string[]; sourceIds: readonly string[];
  kind: string;
};

export function normalizeManualText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("zh-CN").replace(/\s+/g, " ").trim();
}

function needsLanguageFallback(locale: string): boolean {
  return !/^(zh|zh-cn|zh-sg|zh-hans(?:-.+)?)$/i.test(locale);
}

/** Content-only adapter. No filesystem, network, React or application commands. */
export function createManualProvider(
  records: readonly ManualRecord[],
  topics: readonly HelpTopic[],
  shortcutTable: () => string = () => "",
): HelpContentProvider {
  const topicIds = new Set(topics.map((topic) => topic.id));
  if (topicIds.size !== topics.length) throw new Error("帮助主题 ID 必须唯一。");
  const byId = new Map<string, ManualRecord>();
  for (const entry of records) {
    if (byId.has(entry.id)) throw new Error(`帮助条目 ID 重复：${entry.id}`);
    if (!topicIds.has(entry.topicId)) throw new Error(`帮助条目主题不存在：${entry.id}`);
    byId.set(entry.id, { ...entry, keywords: [...entry.keywords], related: [...entry.related], sourceIds: [...entry.sourceIds] });
  }
  for (const entry of byId.values()) {
    if (entry.related.some((id) => !byId.has(id))) throw new Error(`关联帮助不存在：${entry.id}`);
  }
  const topicCopies = topics.map((topic) => ({ ...topic }));
  const entries = [...byId.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const index = entries.map((entry) => ({
    entry,
    title: normalizeManualText(entry.title),
    aliases: normalizeManualText(entry.keywords.join(" ")),
    summary: normalizeManualText(entry.summary),
    body: normalizeManualText(entry.body),
  }));

  function summary(entry: ManualRecord, locale: string): HelpArticleSummary {
    return { id: entry.id, topicId: entry.topicId, title: entry.title,
      summary: `${needsLanguageFallback(locale) ? "［简体中文内容回退］" : ""}${entry.summary}` };
  }

  return {
    id: "liteasy",
    title: "用户手册",
    async listTopics({ signal }) {
      signal.throwIfAborted();
      return topicCopies.map((topic) => ({ ...topic }));
    },
    async search({ query, topicId, signal, locale }) {
      signal.throwIfAborted();
      const normalized = normalizeManualText(query);
      const terms = normalized.split(" ").filter(Boolean);
      const ranked: { entry: ManualRecord; score: number }[] = [];
      for (const item of index) {
        signal.throwIfAborted();
        if (topicId && item.entry.topicId !== topicId) continue;
        let score = item.title === normalized && normalized ? 30 : 0;
        const shortcutText = ["getting-started.basics", "preferences.shortcuts"].includes(item.entry.id)
          ? normalizeManualText(shortcutTable()) : "";
        const complete = `${item.title} ${item.aliases} ${item.summary} ${item.body} ${shortcutText}`;
        if (!terms.every((term) => complete.includes(term))) continue;
        for (const term of terms) {
          score += item.title.includes(term) ? 12 : item.aliases.includes(term) ? 8
            : item.summary.includes(term) ? 4 : 1;
        }
        ranked.push({ entry: item.entry, score });
      }
      signal.throwIfAborted();
      return ranked.sort((a, b) => b.score - a.score || a.entry.order - b.entry.order)
        .map(({ entry }) => summary(entry, locale));
    },
    async read(articleId, { signal, locale }) {
      signal.throwIfAborted();
      const entry = byId.get(articleId);
      if (!entry) return null;
      const fallback = needsLanguageFallback(locale)
        ? "> 语言提示：当前内容包仅提供简体中文；此条目已回退到 zh-CN，并非已完成本地化。\n\n" : "";
      const shortcuts = ["getting-started.basics", "preferences.shortcuts"].includes(entry.id)
        ? `\n\n${shortcutTable()}\n` : "";
      const article: HelpArticle = { ...summary(entry, locale),
        body: `${fallback}> 适用条件：${entry.condition}\n\n${entry.body}${shortcuts}`, format: "markdown" };
      signal.throwIfAborted();
      return article;
    },
  };
}
