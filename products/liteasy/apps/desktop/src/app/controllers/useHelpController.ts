import { useEffect, useMemo, useRef, useState } from "react";
import { createHelpCatalog } from "../features/help/helpCatalog";
import type {
  HelpArticle,
  HelpArticleEntry,
  HelpArticleRef,
  HelpContentProvider,
  HelpPort,
  HelpTopicEntry,
  HelpTopicRef,
  HelpViewModel,
} from "../features/help/help.types";

export function useHelpController({
  providers,
  onOpen,
  visible,
  locale = "zh-CN",
}: {
  providers: readonly HelpContentProvider[];
  onOpen(): void;
  visible: boolean;
  locale?: string;
}): { port: HelpPort; model: HelpViewModel } {
  const catalog = useMemo(() => createHelpCatalog(providers), [providers]);
  const [topics, setTopics] = useState<HelpTopicEntry[]>([]);
  const [articles, setArticles] = useState<HelpArticleEntry[]>([]);
  const [article, setArticle] = useState<HelpArticle | null>();
  const [articleRef, setArticleRef] = useState<HelpArticleRef>();
  const [topic, setTopic] = useState<HelpTopicRef>();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const openRef = useRef(onOpen);
  openRef.current = onOpen;
  const port = useMemo<HelpPort>(
    () => ({
      open(ref) {
        if (ref) setArticleRef(ref);
        openRef.current();
      },
    }),
    [],
  );

  useEffect(() => {
    const openHelp = (event: KeyboardEvent) => {
      if (
        event.key !== "F1" ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.isComposing
      )
        return;
      event.preventDefault();
      port.open();
    };
    window.addEventListener("keydown", openHelp);
    return () => window.removeEventListener("keydown", openHelp);
  }, [port]);

  useEffect(() => {
    if (!visible) return;
    const abort = new AbortController();
    const request = { signal: abort.signal, locale };
    setLoading(true);
    setError("");
    setArticle(undefined);
    void Promise.all([
      catalog.topics(request),
      catalog.search({ ...request, query, topic }),
      articleRef
        ? catalog.read(articleRef, request)
        : Promise.resolve(undefined),
    ])
      .then(([nextTopics, nextArticles, nextArticle]) => {
        if (abort.signal.aborted) return;
        setTopics(nextTopics);
        setArticles(nextArticles);
        setArticle(nextArticle);
      })
      .catch(() => {
        if (!abort.signal.aborted) setError("帮助内容加载失败，请重试。");
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [catalog, visible, locale, query, topic, articleRef, attempt]);

  return {
    port,
    model: {
      topics,
      articles,
      article,
      articleRef,
      topic,
      query,
      loading,
      error,
      setQuery(value) {
        setQuery(value);
        setArticleRef(undefined);
      },
      selectTopic(next) {
        setTopic(next);
        setArticleRef(undefined);
      },
      openArticle: setArticleRef,
      home() {
        setTopic(undefined);
        setQuery("");
        setArticleRef(undefined);
      },
      retry() {
        setAttempt((value) => value + 1);
      },
    },
  };
}
